//! Warm Supertonic TTS via long-lived `tts_bridge.py serve` (streamed chunks).

use crate::config::voice_preferences;
use crate::speech_render::render_speech;
use crate::state::{ensure_state_home, kill_stray_tts_bridges, voice_state_home};
use parking_lot::Mutex;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

static NARRATING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

struct WarmBridge {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    pid: u32,
}

static WARM: Mutex<Option<WarmBridge>> = Mutex::new(None);

pub fn bridge_script() -> Result<PathBuf, String> {
    let candidates = [
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("tts_bridge.py"))),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tts_bridge.py")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|p| p.is_file())
        .ok_or_else(|| "tts_bridge.py not found beside worker".to_string())
}

fn write_tts_pid(pid: u32) {
    let _ = std::fs::write(voice_state_home().join("tts.pid"), pid.to_string());
}

fn clear_tts_pid() {
    let _ = std::fs::remove_file(voice_state_home().join("tts.pid"));
}

pub fn read_tts_pid() -> Option<u32> {
    let text = std::fs::read_to_string(voice_state_home().join("tts.pid")).ok()?;
    text.trim().parse().ok()
}

/// One-shot prepare (CLI). Also warms the long-lived server when possible.
pub fn prepare_tts() -> Result<serde_json::Value, String> {
    ensure_state_home().map_err(|e| e.to_string())?;
    let prefs = voice_preferences();
    ensure_warm(&prefs.speech_voice)?;
    Ok(serde_json::json!({
        "narration": "ready",
        "voice": prefs.speech_voice,
        "mode": "warm-serve",
    }))
}

pub fn narration_busy() -> bool {
    NARRATING.load(Ordering::SeqCst)
}

/// Soft cancel: ask the warm bridge to stop playback (keeps process warm).
pub fn cancel_narration() -> bool {
    let was = NARRATING.swap(false, Ordering::SeqCst);
    CANCEL.store(true, Ordering::SeqCst);
    let _ = send_raw(r#"{"cmd":"stop"}"#);
    let _ = std::fs::write(voice_state_home().join("tts-stop"), b"");
    was
}

/// Hard cancel: stop + kill audio process group + rewarm (double-tap Control).
pub fn hard_cancel_narration() -> bool {
    let was = NARRATING.swap(false, Ordering::SeqCst);
    CANCEL.store(true, Ordering::SeqCst);
    let _ = send_raw(r#"{"cmd":"stop"}"#);
    let _ = std::fs::write(voice_state_home().join("tts-stop"), b"");
    if let Some(pid) = read_tts_pid() {
        kill_process_group(pid);
    }
    let prefs = voice_preferences();
    let _ = shutdown_warm();
    // Rewarm in background so the next speak is still fast.
    thread::spawn(move || {
        let _ = ensure_warm(&prefs.speech_voice);
    });
    was
}

/// Tear down TTS completely (CLI stop/reset). Never rewarms.
pub fn kill_tts_process() {
    NARRATING.store(false, Ordering::SeqCst);
    CANCEL.store(true, Ordering::SeqCst);
    let _ = send_raw(r#"{"cmd":"stop"}"#);
    let _ = std::fs::write(voice_state_home().join("tts-stop"), b"");
    // Prefer the on-disk pid: the CLI process has no WARM handle of its own.
    if let Some(pid) = read_tts_pid() {
        kill_process_group(pid);
    }
    let _ = shutdown_warm();
    clear_tts_pid();
    kill_stray_tts_bridges();
}

fn kill_process_group(pid: u32) {
    #[cfg(unix)]
    unsafe {
        extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        let _ = kill(-(pid as i32), 15);
        std::thread::sleep(Duration::from_millis(40));
        let _ = kill(-(pid as i32), 9);
        let _ = kill(pid as i32, 9);
    }
    let _ = pid;
}

fn send_raw(line: &str) -> Result<(), String> {
    let mut guard = WARM.lock();
    let bridge = guard.as_mut().ok_or_else(|| "tts warm bridge not running".to_string())?;
    writeln!(bridge.stdin, "{line}").map_err(|e| format!("tts write: {e}"))?;
    bridge.stdin.flush().map_err(|e| format!("tts flush: {e}"))?;
    Ok(())
}

fn read_event(bridge: &mut WarmBridge, timeout: Duration) -> Result<Value, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() > deadline {
            return Err("tts event timeout".into());
        }
        // Blocking readline — serve always emits promptly between chunks.
        let mut line = String::new();
        let n = bridge
            .stdout
            .read_line(&mut line)
            .map_err(|e| format!("tts read: {e}"))?;
        if n == 0 {
            return Err("tts bridge closed".into());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(trimmed) {
            Ok(value) => return Ok(value),
            Err(_) => continue,
        }
    }
}

/// Start (or reuse) the long-lived Supertonic server.
pub fn ensure_warm(voice: &str) -> Result<(), String> {
    ensure_state_home().map_err(|e| e.to_string())?;
    {
        let mut guard = WARM.lock();
        if let Some(bridge) = guard.as_mut() {
            // Health check.
            if writeln!(bridge.stdin, r#"{{"cmd":"ping"}}"#).is_ok()
                && bridge.stdin.flush().is_ok()
            {
                if let Ok(event) = read_event(bridge, Duration::from_secs(3)) {
                    if event.get("event").and_then(|v| v.as_str()) == Some("pong") {
                        return Ok(());
                    }
                }
            }
            // Dead — drop and respawn.
            let mut dead = guard.take().unwrap();
            let _ = dead.child.kill();
            let _ = dead.child.wait();
            clear_tts_pid();
        }
    }

    let script = bridge_script()?;
    let mut command = Command::new("uv");
    command
        .args([
            "run",
            "--script",
            script.to_str().unwrap_or_default(),
            "serve",
            "--voice",
            voice,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|e| format!("spawn tts serve: {e}"))?;
    let pid = child.id();
    write_tts_pid(pid);
    let stdin = child.stdin.take().ok_or_else(|| "tts stdin missing".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "tts stdout missing".to_string())?;
    let mut bridge = WarmBridge {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        pid,
    };

    // Wait for ready (model load can take a while first time).
    let ready = read_event(&mut bridge, Duration::from_secs(180))?;
    if ready.get("event").and_then(|v| v.as_str()) != Some("ready") {
        let _ = bridge.child.kill();
        clear_tts_pid();
        return Err(format!("tts serve not ready: {ready}"));
    }
    *WARM.lock() = Some(bridge);
    Ok(())
}

pub fn shutdown_warm() -> Result<(), String> {
    let mut guard = WARM.lock();
    if let Some(mut bridge) = guard.take() {
        let _ = writeln!(bridge.stdin, r#"{{"cmd":"quit"}}"#);
        let _ = bridge.stdin.flush();
        // Don't hang forever on quit.
        let _ = bridge.child.wait();
        kill_process_group(bridge.pid);
    }
    clear_tts_pid();
    Ok(())
}

pub fn speak_markdown(markdown: &str) -> Result<String, String> {
    let speech = render_speech(markdown);
    if speech.trim().is_empty() {
        return Ok("completed".into());
    }
    if NARRATING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok("busy".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let prefs = voice_preferences();
    let result = (|| {
        ensure_warm(&prefs.speech_voice)?;
        let payload = serde_json::json!({
            "cmd": "speak",
            "text": speech,
            "voice": prefs.speech_voice,
            "speed": prefs.speech_speed,
        });
        send_raw(&payload.to_string())?;
        // Drain streamed events until done.
        let deadline = Instant::now() + Duration::from_secs(60 * 30);
        loop {
            if CANCEL.load(Ordering::SeqCst) {
                return Ok("stopped".into());
            }
            if Instant::now() > deadline {
                return Err("tts speak timed out".into());
            }
            let event = {
                let mut guard = WARM.lock();
                let bridge = guard
                    .as_mut()
                    .ok_or_else(|| "tts warm bridge died mid-speak".to_string())?;
                read_event(bridge, Duration::from_secs(120))?
            };
            match event.get("event").and_then(|v| v.as_str()) {
                Some("done") => {
                    let status = event
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("completed");
                    return Ok(status.to_string());
                }
                Some("error") => {
                    let msg = event
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("tts error");
                    return Err(msg.to_string());
                }
                Some("chunk") => {
                    // Streaming progress — keep draining for lower first-word latency.
                    continue;
                }
                _ => continue,
            }
        }
    })();
    NARRATING.store(false, Ordering::SeqCst);
    let _ = std::fs::remove_file(voice_state_home().join("speaking.lock"));
    result
}

/// Used by one-shot CLI paths when the warm server isn't wanted.
#[allow(dead_code)]
pub fn speak_oneshot(markdown: &str) -> Result<String, String> {
    let speech = render_speech(markdown);
    if speech.trim().is_empty() {
        return Ok("completed".into());
    }
    let script = bridge_script()?;
    let prefs = voice_preferences();
    let mut child = Command::new("uv")
        .args([
            "run",
            "--script",
            script.to_str().unwrap_or_default(),
            "speak",
            "--text-stdin",
            "--voice",
            &prefs.speech_voice,
            "--speed",
            &format!("{:.3}", prefs.speech_speed),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn tts: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(speech.as_bytes())
            .map_err(|e| format!("tts stdin: {e}"))?;
    }
    let output = child.wait_with_output().map_err(|e| format!("tts wait: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let status = String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("completed")
        .to_string();
    Ok(status)
}

pub fn bridge_script_path() -> Result<PathBuf, String> {
    bridge_script()
}

#[allow(dead_code)]
fn _path_exists(path: &Path) -> bool {
    path.is_file()
}
