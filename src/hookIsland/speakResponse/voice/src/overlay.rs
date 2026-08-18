//! OSW-style floating recording indicator (macOS).
//! Exactly one overlay process is allowed — tracked via overlay.pid.
//!
//! Important: the visible pill is a `swift`/`swift-frontend` child. Killing only the
//! `dufflebag-voice overlay` wrapper orphans those interpreters (ppid=1) while the
//! worker stays alive, so every later respawn stacks another HUD.

use crate::state::{
    clear_overlay_pid, kill_all_overlay_huds, kill_stray_overlay_huds, process_running,
    read_overlay_pid, voice_state_home, write_overlay_pid,
};
use std::fs;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndicatorStage {
    Hidden,
    Starting,
    Listening,
    Finishing,
    Unavailable,
}

impl IndicatorStage {
    pub fn from_dictation(label: &str) -> Self {
        match label {
            "starting" => Self::Starting,
            "listening" => Self::Listening,
            "finishing" => Self::Finishing,
            "unavailable" => Self::Unavailable,
            _ => Self::Hidden,
        }
    }

    pub fn label(self, _frame: u32) -> &'static str {
        match self {
            Self::Hidden => "",
            Self::Starting => "Connecting",
            Self::Listening => "Recording",
            Self::Finishing => "Working",
            Self::Unavailable => "Mic unavailable",
        }
    }
}

fn force_kill_pid(pid: i32) {
    if pid <= 1 {
        return;
    }
    #[cfg(unix)]
    unsafe {
        extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        let _ = kill(pid, 15);
        thread::sleep(Duration::from_millis(40));
        let _ = kill(pid, 9);
    }
}

fn force_kill_process_group(pid: u32) {
    // pid 1 → kill(-1) broadcasts SIGKILL to every reachable process.
    if pid <= 1 || pid == std::process::id() {
        return;
    }
    #[cfg(unix)]
    {
        unsafe {
            extern "C" {
                fn kill(pid: i32, sig: i32) -> i32;
                fn getpgid(pid: i32) -> i32;
            }
            let self_pgid = getpgid(0);
            // Never kill(-our_pgid) — that terminates the CLI and its parent shell.
            if self_pgid > 1 && self_pgid == pid as i32 {
                force_kill_pid(pid as i32);
                return;
            }
            // Negative pid = whole process group (overlay wrapper + swift HUD).
            let _ = kill(-(pid as i32), 15);
            thread::sleep(Duration::from_millis(40));
            let _ = kill(-(pid as i32), 9);
            let _ = kill(pid as i32, 9);
        }
    }
}

/// Kill any previous HUD so Control never shows stacked pills.
pub fn kill_existing_overlay() {
    if let Some(pid) = read_overlay_pid() {
        if process_running(Some(pid)) {
            force_kill_process_group(pid);
        } else {
            force_kill_pid(pid as i32);
        }
        clear_overlay_pid();
    }
    // Sweep leftover `dufflebag-voice overlay` wrappers.
    #[cfg(unix)]
    {
        if let Ok(output) = std::process::Command::new("ps")
            .args(["-ax", "-o", "pid=,args="])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let line = line.trim();
                if !(line.contains("dufflebag-voice") && line.contains("overlay")) {
                    continue;
                }
                let mut parts = line.split_whitespace();
                if let Some(pid_str) = parts.next() {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        force_kill_process_group(pid);
                    }
                }
            }
        }
    }
    // Sweep every swift-frontend pill for this state home (orphans + live children).
    kill_all_overlay_huds();
    // Also catch any ppid=1 leftovers from older kills.
    kill_stray_overlay_huds();
    let _ = fs::remove_file(voice_state_home().join("overlay.lock"));
}

pub fn run_overlay_process(worker_pid: u32) -> i32 {
    // Single-instance: if another overlay already serves this worker, exit.
    if let Some(existing) = read_overlay_pid() {
        if process_running(Some(existing)) && existing != std::process::id() {
            return 0;
        }
    }
    let _ = write_overlay_pid(std::process::id());

    #[cfg(target_os = "macos")]
    {
        let code = match macos::run(worker_pid) {
            Ok(()) => 0,
            Err(error) => {
                eprintln!("overlay: {error}");
                1
            }
        };
        clear_overlay_pid();
        return code;
    }
    #[cfg(not(target_os = "macos"))]
    {
        while process_running(Some(worker_pid)) {
            thread::sleep(Duration::from_millis(250));
        }
        clear_overlay_pid();
        0
    }
}

pub fn read_stage_from_disk() -> IndicatorStage {
    let path = voice_state_home().join("status.json");
    let Ok(bytes) = fs::read(path) else {
        return IndicatorStage::Hidden;
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return IndicatorStage::Hidden;
    };
    let dictation = value
        .get("dictation")
        .and_then(|v| v.as_str())
        .unwrap_or("inactive");
    IndicatorStage::from_dictation(dictation)
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::io::Write;
    use std::process::{Command, Stdio};

    pub fn run(worker_pid: u32) -> Result<(), String> {
        let script = include_str!("overlay_hud.swift");
        // Child stays in this overlay wrapper's process group by default so
        // kill(-overlay.pid) from kill_existing_overlay reaps the Swift HUD too.
        let mut child = Command::new("swift")
            .arg("-")
            .arg(worker_pid.to_string())
            .arg(voice_state_home().to_string_lossy().as_ref())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn swift overlay: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(script.as_bytes())
                .map_err(|e| format!("write swift: {e}"))?;
        }
        // Block until the HUD exits (worker died) so overlay.pid stays accurate.
        let status = child.wait().map_err(|e| format!("wait overlay: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("swift overlay exited with {status}"))
        }
    }
}
