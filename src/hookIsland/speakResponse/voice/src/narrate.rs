//! Narration process — inbox drain + TTS only.
//! Completely off the dictate critical path (separate process / pid).

use crate::config::voice_preferences;
use crate::inbox::{complete_envelope, fail_envelope, next_envelope};
use crate::state::{
    ensure_state_home, narration_muted, process_running, stop_requested, voice_state_home,
};
use crate::tts;
use std::fs;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const NARRATE_PID: &str = "narrate.pid";
const NARRATE_LOCK: &str = "narrate.lock";

pub fn narrate_pid_path() -> std::path::PathBuf {
    voice_state_home().join(NARRATE_PID)
}

pub fn read_narrate_pid() -> Option<u32> {
    let text = fs::read_to_string(narrate_pid_path()).ok()?;
    text.trim().parse().ok()
}

pub fn narrate_already_running() -> bool {
    process_running(read_narrate_pid())
}

fn acquire_narrate_pid(pid: u32) -> Result<bool, String> {
    ensure_state_home().map_err(|e| e.to_string())?;
    let home = voice_state_home();
    let lock_path = home.join(NARRATE_LOCK);

    if let Some(existing) = read_narrate_pid() {
        if process_running(Some(existing)) && existing != pid {
            return Ok(false);
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&lock_path)
        {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if narrate_already_running() {
                    return Ok(false);
                }
                let _ = fs::remove_file(&lock_path);
                fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(&lock_path)
                    .map_err(|e| format!("narrate lock: {e}"))?;
            }
            Err(error) => return Err(format!("narrate lock: {error}")),
        }
    }
    #[cfg(not(unix))]
    {
        if narrate_already_running() {
            return Ok(false);
        }
        let _ = fs::write(&lock_path, b"");
    }

    fs::write(home.join(NARRATE_PID), pid.to_string()).map_err(|e| e.to_string())?;
    Ok(true)
}

fn release_narrate_pid() {
    let home = voice_state_home();
    let my = std::process::id();
    if read_narrate_pid() == Some(my) {
        let _ = fs::remove_file(home.join(NARRATE_PID));
    }
    let _ = fs::remove_file(home.join(NARRATE_LOCK));
}

/// Long-lived inbox → TTS loop. Does not own the hotkey or mic.
pub fn run_narrate_daemon() -> i32 {
    if let Err(error) = ensure_state_home() {
        eprintln!("narrate state: {error}");
        return 1;
    }
    let pid = std::process::id();
    match acquire_narrate_pid(pid) {
        Ok(true) => {}
        Ok(false) => return 0,
        Err(error) => {
            eprintln!("narrate pid: {error}");
            return 1;
        }
    }

    // Drop stale claims from a previous crash.
    if let Ok(entries) = fs::read_dir(voice_state_home().join("inbox")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("speaking") {
                let _ = fs::remove_file(path);
            }
        }
    }

    {
        let prefs = voice_preferences();
        if let Err(error) = tts::ensure_warm(&prefs.speech_voice) {
            eprintln!("tts warm: {error}");
        }
    }

    while !stop_requested() {
        // Pause while dictate owns audio (status listening/starting) or TTS busy.
        if dictate_owns_audio() || tts::narration_busy() {
            thread::sleep(Duration::from_millis(80));
            continue;
        }
        if narration_muted() {
            thread::sleep(Duration::from_millis(200));
            continue;
        }
        let prefs = voice_preferences();
        if let Some((path, envelope)) = next_envelope(&prefs) {
            match tts::speak_markdown(&envelope.markdown) {
                Ok(status) if status.trim().eq_ignore_ascii_case("busy") => {
                    complete_envelope(&path);
                }
                Ok(_) => complete_envelope(&path),
                Err(error) => {
                    eprintln!("narration failed: {error}");
                    fail_envelope(&path);
                }
            }
        } else {
            thread::sleep(Duration::from_millis(150));
        }
    }

    let _ = tts::shutdown_warm();
    release_narrate_pid();
    0
}

/// Dictate is active when status.json says starting/listening (mic open).
fn dictate_owns_audio() -> bool {
    let path = voice_state_home().join("status.json");
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return false;
    };
    matches!(
        value.get("dictation").and_then(|v| v.as_str()),
        Some("starting" | "listening")
    )
}

pub fn start_narrate_detached() -> Result<(), String> {
    ensure_state_home().map_err(|e| e.to_string())?;
    if narrate_already_running() {
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut command = Command::new(exe);
    command
        .arg("narrate-daemon")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
        .spawn()
        .map_err(|e| format!("spawn narrate: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if narrate_already_running() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(50));
    }
    // Soft fail — dictation can still work without TTS.
    eprintln!("narrate worker did not report ready (continuing without narration)");
    Ok(())
}

pub fn stop_narrate() {
    tts::kill_tts_process();
    if let Some(pid) = read_narrate_pid() {
        #[cfg(unix)]
        unsafe {
            extern "C" {
                fn kill(pid: i32, sig: i32) -> i32;
            }
            let _ = kill(pid as i32, 15);
            thread::sleep(Duration::from_millis(80));
            if process_running(Some(pid)) {
                let _ = kill(pid as i32, 9);
            }
        }
    }
    let home = voice_state_home();
    let _ = fs::remove_file(home.join(NARRATE_PID));
    let _ = fs::remove_file(home.join(NARRATE_LOCK));
}
