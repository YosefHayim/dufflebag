//! Voice state home and atomic status helpers (stable paths for the TS CLI).

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const HOTKEY_LABEL: &str = "hold-control";
pub const SAMPLE_RATE: u32 = 16_000;

/// Session mute: inbox stays, nothing is spoken until unmuted.
pub fn narration_muted() -> bool {
    voice_state_home().join("narration-muted").exists()
}

pub fn set_narration_muted(muted: bool) {
    let path = voice_state_home().join("narration-muted");
    if muted {
        let _ = fs::create_dir_all(voice_state_home());
        let _ = fs::write(&path, b"1");
    } else {
        let _ = fs::remove_file(path);
    }
}

pub fn toggle_narration_muted() -> bool {
    let next = !narration_muted();
    set_narration_muted(next);
    next
}

pub fn voice_state_home() -> PathBuf {
    if let Ok(override_home) = std::env::var("DUFFLEBAG_VOICE_HOME") {
        let trimmed = override_home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| dirs_fallback_home().join("AppData").join("Local"));
        return base.join("dufflebag").join("voice");
    }

    #[cfg(target_os = "macos")]
    {
        return dirs_fallback_home()
            .join("Library")
            .join("Application Support")
            .join("dufflebag")
            .join("voice");
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let base = std::env::var("XDG_STATE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| dirs_fallback_home().join(".local").join("state"));
        base.join("dufflebag").join("voice")
    }
}

fn dirs_fallback_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

pub fn models_dir() -> PathBuf {
    voice_state_home().join("models")
}

pub fn ensure_state_home() -> std::io::Result<PathBuf> {
    let home = voice_state_home();
    fs::create_dir_all(&home)?;
    fs::create_dir_all(home.join("inbox"))?;
    fs::create_dir_all(models_dir())?;
    Ok(home)
}

pub fn atomic_json(path: &Path, value: &impl Serialize) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("tmp"),
        Uuid::new_v4().simple()
    ));
    {
        let mut file = fs::File::create(&temp)?;
        let body = serde_json::to_vec(value).map_err(std::io::Error::other)?;
        file.write_all(&body)?;
        file.sync_all()?;
    }
    fs::rename(temp, path)?;
    Ok(())
}

pub fn write_pid(pid: u32) -> std::io::Result<()> {
    let home = ensure_state_home()?;
    fs::write(home.join("worker.pid"), pid.to_string())
}

pub fn read_pid() -> Option<u32> {
    let text = fs::read_to_string(voice_state_home().join("worker.pid")).ok()?;
    let pid: u32 = text.trim().parse().ok()?;
    (pid > 0).then_some(pid)
}

pub fn process_running(pid: Option<u32>) -> bool {
    let Some(pid) = pid else {
        return false;
    };
    #[cfg(unix)]
    {
        // Signal 0 probes existence without delivering a signal.
        unsafe { libc_kill(pid as i32, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

/// True when a live daemon already owns `worker.pid`.
pub fn worker_already_running() -> bool {
    process_running(read_pid())
}

/// Claim exclusive ownership of the voice worker. Returns `false` if another live worker holds the lock.
pub fn acquire_worker_pid(pid: u32) -> Result<bool, String> {
    ensure_state_home().map_err(|e| e.to_string())?;
    let home = voice_state_home();
    let pid_path = home.join("worker.pid");
    let lock_path = home.join("worker.lock");

    // Fast path: existing healthy worker.
    if let Some(existing) = read_pid() {
        if process_running(Some(existing)) && existing != pid {
            return Ok(false);
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // Exclusive create of the lock file acts as a mutex across spawn races.
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&lock_path)
        {
            Ok(file) => {
                let _ = file;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                // Stale lock from a dead worker — reclaim if pid is gone.
                if worker_already_running() {
                    return Ok(false);
                }
                let _ = fs::remove_file(&lock_path);
                fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(&lock_path)
                    .map_err(|e| format!("worker lock: {e}"))?;
            }
            Err(error) => return Err(format!("worker lock: {error}")),
        }
    }
    #[cfg(not(unix))]
    {
        if worker_already_running() {
            return Ok(false);
        }
        let _ = fs::write(&lock_path, b"");
    }

    write_pid(pid).map_err(|e| e.to_string())?;
    let _ = pid_path;
    Ok(true)
}

pub fn release_worker_pid() {
    let home = voice_state_home();
    let my_pid = std::process::id();
    if read_pid() == Some(my_pid) {
        let _ = fs::remove_file(home.join("worker.pid"));
    }
    let _ = fs::remove_file(home.join("worker.lock"));
}

pub fn write_overlay_pid(pid: u32) -> std::io::Result<()> {
    let home = ensure_state_home()?;
    fs::write(home.join("overlay.pid"), pid.to_string())
}

pub fn read_overlay_pid() -> Option<u32> {
    let text = fs::read_to_string(voice_state_home().join("overlay.pid")).ok()?;
    text.trim().parse().ok()
}

pub fn clear_overlay_pid() {
    let _ = fs::remove_file(voice_state_home().join("overlay.pid"));
}

fn force_kill_pid(pid: u32) {
    if pid == 0 || pid == std::process::id() {
        return;
    }
    #[cfg(unix)]
    unsafe {
        let _ = libc_kill(pid as i32, 15);
        std::thread::sleep(std::time::Duration::from_millis(30));
        let _ = libc_kill(pid as i32, 9);
    }
    let _ = pid;
}

fn force_kill_process_group(pid: u32) {
    if pid == 0 || pid == std::process::id() {
        return;
    }
    #[cfg(unix)]
    unsafe {
        // Negative pid = process group (warm uv + python TTS).
        let _ = libc_kill(-(pid as i32), 15);
        std::thread::sleep(std::time::Duration::from_millis(30));
        let _ = libc_kill(-(pid as i32), 9);
        let _ = libc_kill(pid as i32, 9);
    }
    let _ = pid;
}

/// True only for argv shaped like `…/dufflebag-voice daemon|narrate-daemon|overlay …`.
/// Must not match shells whose `-c` script merely *mentions* the binary.
fn is_voice_worker_line(args: &str) -> bool {
    let tokens: Vec<&str> = args.split_whitespace().collect();
    let Some(idx) = tokens.iter().position(|t| {
        let base = t.rsplit('/').next().unwrap_or(t);
        base == "dufflebag-voice"
    }) else {
        return false;
    };
    matches!(
        tokens.get(idx + 1).copied(),
        Some("daemon" | "narrate-daemon" | "overlay")
    )
}

/// Kill every `dufflebag-voice` process that looks like a daemon/overlay, except `keep`.
/// Safe to call from the short-lived `stop`/`start`/`reset` CLI.
pub fn kill_stray_voice_processes(keep: Option<u32>) {
    #[cfg(unix)]
    {
        let self_pid = std::process::id();
        let scan_and_kill = |signal: i32| {
            let output = std::process::Command::new("ps")
                .args(["-ax", "-o", "pid=,args="])
                .output();
            let Ok(output) = output else {
                return;
            };
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let mut parts = line.split_whitespace();
                let Some(pid_str) = parts.next() else {
                    continue;
                };
                let Ok(pid) = pid_str.parse::<u32>() else {
                    continue;
                };
                if pid == self_pid || keep == Some(pid) {
                    continue;
                }
                let args = line[pid_str.len()..].trim();
                if is_voice_worker_line(args) {
                    unsafe {
                        let _ = libc_kill(pid as i32, signal);
                    }
                }
            }
        };
        scan_and_kill(15);
        std::thread::sleep(std::time::Duration::from_millis(150));
        scan_and_kill(9);
    }
}

/// Kill leftover Supertonic bridge processes when pid files are gone or races rewarm.
pub fn kill_stray_tts_bridges() {
    #[cfg(unix)]
    {
        let self_pid = std::process::id();
        let output = std::process::Command::new("ps")
            .args(["-ax", "-o", "pid=,args="])
            .output();
        let Ok(output) = output else {
            return;
        };
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || !line.contains("tts_bridge.py") || !line.contains("serve") {
                continue;
            }
            let mut parts = line.split_whitespace();
            let Some(pid_str) = parts.next() else {
                continue;
            };
            let Ok(pid) = pid_str.parse::<u32>() else {
                continue;
            };
            if pid == self_pid {
                continue;
            }
            force_kill_process_group(pid);
        }
    }
}

/// Full clean slate: daemons, overlays, TTS bridge, locks, stop flags.
pub fn reset_voice_runtime() {
    // Prefer recorded pids first (most reliable).
    if let Some(pid) = read_pid() {
        force_kill_pid(pid);
    }
    if let Some(pid) = read_overlay_pid() {
        force_kill_pid(pid);
    }
    if let Ok(text) = fs::read_to_string(voice_state_home().join("narrate.pid")) {
        if let Ok(pid) = text.trim().parse::<u32>() {
            force_kill_pid(pid);
        }
    }
    if let Ok(text) = fs::read_to_string(voice_state_home().join("tts.pid")) {
        if let Ok(pid) = text.trim().parse::<u32>() {
            force_kill_process_group(pid);
        }
    }
    kill_stray_voice_processes(None);
    kill_stray_tts_bridges();
    let home = voice_state_home();
    for name in [
        "worker.pid",
        "worker.lock",
        "narrate.pid",
        "narrate.lock",
        "overlay.pid",
        "tts.pid",
        "tts-stop",
        "speaking.lock",
        "stop",
        // keep narration-muted across reset? clear so off is intentional via double-tap
        "narration-muted",
    ] {
        let _ = fs::remove_file(home.join(name));
    }
    // Drop stale claimed envelopes.
    if let Ok(entries) = fs::read_dir(home.join("inbox")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("speaking") {
                let _ = fs::remove_file(path);
            }
        }
    }
}

#[cfg(unix)]
unsafe fn libc_kill(pid: i32, signal: i32) -> i32 {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    kill(pid, signal)
}

pub fn clear_stop_flag() {
    let _ = fs::remove_file(voice_state_home().join("stop"));
}

pub fn request_stop() {
    let home = voice_state_home();
    let _ = fs::create_dir_all(&home);
    let _ = fs::write(home.join("stop"), b"");
}

pub fn stop_requested() -> bool {
    voice_state_home().join("stop").exists()
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkerStatus {
    pub dictation: String,
    pub hotkey: String,
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend: Option<String>,
}

impl WorkerStatus {
    pub fn snapshot() -> Self {
        let running = process_running(read_pid());
        let mut status = Self {
            dictation: "inactive".into(),
            hotkey: HOTKEY_LABEL.into(),
            running,
            detail: None,
            model: None,
            backend: None,
        };
        if !running {
            return status;
        }
        let path = voice_state_home().join("status.json");
        if let Ok(bytes) = fs::read(path) {
            if let Ok(saved) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if let Some(d) = saved.get("dictation").and_then(|v| v.as_str()) {
                    status.dictation = d.to_string();
                }
                if let Some(d) = saved.get("detail").and_then(|v| v.as_str()) {
                    if !d.is_empty() {
                        status.detail = Some(d.to_string());
                    }
                }
                if let Some(m) = saved.get("model").and_then(|v| v.as_str()) {
                    status.model = Some(m.to_string());
                }
                if let Some(b) = saved.get("backend").and_then(|v| v.as_str()) {
                    status.backend = Some(b.to_string());
                }
            }
        }
        status
    }
}

/// Write worker status. `preview` is live HUD caption only (never typed).
pub fn write_worker_status(
    dictation: &str,
    detail: &str,
    model: Option<&str>,
    backend: Option<&str>,
    preview: Option<&str>,
) {
    let value = serde_json::json!({
        "dictation": dictation,
        "detail": detail,
        "hotkey": HOTKEY_LABEL,
        "running": true,
        "model": model,
        "backend": backend,
        "preview": preview.unwrap_or(""),
        "updated_at": now_secs(),
    });
    let _ = atomic_json(&voice_state_home().join("status.json"), &value);
}

pub fn now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}
