//! Insert text at the active caret.
//! Prefer direct key injection for STT-length text (avoids bare `v` from failed ⌘V).
//! Clipboard paste is reserved for long multi-line payloads.

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::io::Write;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

/// macOS virtual key code for ANSI `V` (kVK_ANSI_V). Unicode('v') often drops the
/// Command modifier and types a bare `v` into the focused field.
#[cfg(target_os = "macos")]
const MAC_KEYCODE_V: u32 = 0x09;

/// Above this length, prefer clipboard paste (faster for long refined prompts).
const CLIPBOARD_PREFERS_CHARS: usize = 800;

/// Insert `text` into the focused field. Returns Ok after a successful path.
pub fn type_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    // Wait for Control to fully release so modifiers do not corrupt injection.
    ensure_control_released(900)?;

    let char_len = text.chars().count();
    let control_down = crate::hotkey::control_modifier_down();

    // Short/medium STT text: type characters directly. This avoids the classic
    // hold-Control bug where Meta+V loses Command and only `v` appears in the caret
    // while the HUD shows the full transcript.
    if char_len <= CLIPBOARD_PREFERS_CHARS || control_down {
        match type_via_enigo_text(text) {
            Ok(()) => {
                log_type_path("enigo.text", char_len);
                return Ok(());
            }
            Err(error) => {
                log_type_path(&format!("enigo.text failed: {error}"), char_len);
                eprintln!("enigo.text failed: {error}; trying clipboard paste");
            }
        }
    }

    // Long text (or enigo.text failed): clipboard + ⌘V.
    if !crate::hotkey::control_modifier_down() {
        match paste_via_clipboard(text) {
            Ok(()) => {
                log_type_path("clipboard", char_len);
                return Ok(());
            }
            Err(error) => {
                log_type_path(&format!("clipboard failed: {error}"), char_len);
                eprintln!("clipboard paste failed: {error}; last-resort enigo.text");
            }
        }
    } else {
        log_type_path("skip clipboard (control held)", char_len);
    }

    // Last resort.
    type_via_enigo_text(text).map_err(|e| {
        format!(
            "type failed ({e}). Grant Accessibility (+ Input Monitoring) to dufflebag-voice in \
             System Settings → Privacy & Security"
        )
    })?;
    log_type_path("enigo.text last-resort", char_len);
    Ok(())
}

fn type_via_enigo_text(text: &str) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
    // Small settle so the focused app accepts key events after Control release.
    thread::sleep(Duration::from_millis(25));
    enigo.text(text).map_err(|e| format!("enigo.text: {e}"))
}

fn log_type_path(detail: &str, char_len: usize) {
    let path = crate::state::voice_state_home().join("dictation.log");
    let line = format!(
        "{:.3} type_path chars={char_len} {detail}\n",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0)
    );
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

/// Replace `previous` (just typed into the caret) with `next` without ⌘A.
///
/// Global ⌘A selects the whole cmux/Grok WebGL session (blue highlight) and
/// often fails to replace only the input field — raw + refined double-paste.
/// We backspace the exact previous string, then paste `next`.
pub fn replace_previous_with(previous: &str, next: &str) -> Result<(), String> {
    if previous == next {
        return Ok(());
    }
    ensure_control_released(800)?;

    if !previous.is_empty() {
        backspace_chars(previous.chars().count())?;
        thread::sleep(Duration::from_millis(30));
    }
    if !next.is_empty() {
        // type_text waits for Control again; call paste/type body directly after release.
        type_text(next)?;
    }
    // Nudge caret so any residual selection (from host quirks) collapses.
    let _ = collapse_selection();
    Ok(())
}

/// Legacy name: replace without knowing previous text. Prefer
/// [`replace_previous_with`]. Falls back to backspace-heavy path only when
/// previous is empty (just type). Never sends global ⌘A.
pub fn replace_text(text: &str) -> Result<(), String> {
    replace_previous_with("", text)
}

/// Press Enter / Return in the focused field (submit).
pub fn press_enter() -> Result<(), String> {
    ensure_control_released(400)?;
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
    enigo
        .key(Key::Return, Direction::Click)
        .map_err(|e| format!("return: {e}"))?;
    Ok(())
}

fn backspace_chars(count: usize) -> Result<(), String> {
    if count == 0 {
        return Ok(());
    }
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
    for _ in 0..count {
        enigo
            .key(Key::Backspace, Direction::Click)
            .map_err(|e| format!("backspace: {e}"))?;
        // Tiny gap so WebGL/React inputs don't drop key events under load.
        thread::sleep(Duration::from_millis(2));
    }
    Ok(())
}

fn collapse_selection() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
    // Right arrow collapses a range selection to the caret end in most inputs.
    enigo
        .key(Key::RightArrow, Direction::Click)
        .map_err(|e| format!("right: {e}"))?;
    Ok(())
}

fn wait_control_up(max_ms: u64) {
    let steps = max_ms / 10;
    for _ in 0..steps {
        if !crate::hotkey::control_modifier_down() {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

/// Release Control and wait until the OS reports it up. Cmd+V while Control is
/// still down commonly injects a bare `v` (Meta chord fails) into the caret.
fn ensure_control_released(max_ms: u64) -> Result<(), String> {
    wait_control_up(max_ms / 2);
    let _ = release_control_keys();
    thread::sleep(Duration::from_millis(40));
    wait_control_up(max_ms / 2);
    if crate::hotkey::control_modifier_down() {
        // One more hard release pulse.
        let _ = release_control_keys();
        thread::sleep(Duration::from_millis(60));
        wait_control_up(200);
    }
    Ok(())
}

fn paste_via_clipboard(text: &str) -> Result<(), String> {
    // Save previous clipboard (best-effort).
    let previous = Command::new("pbpaste")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok());

    write_macos_clipboard(text)?;

    // Confirm the pasteboard actually holds our text before sending ⌘V.
    // A failed/raced pbcopy previously still pressed V and typed a lone letter.
    let roundtrip = Command::new("pbpaste")
        .output()
        .map_err(|e| format!("pbpaste verify: {e}"))?;
    if !roundtrip.status.success() {
        return Err("pbpaste verify failed".into());
    }
    let on_board = String::from_utf8_lossy(&roundtrip.stdout);
    if on_board.as_ref() != text {
        return Err(format!(
            "clipboard round-trip mismatch (got {} bytes, want {})",
            on_board.len(),
            text.len()
        ));
    }

    // Prefer System Events keystroke — more reliable than enigo Meta+Unicode('v'),
    // which frequently drops the Command modifier and types a bare `v`.
    if let Err(error) = paste_cmd_v_system_events() {
        eprintln!("System Events ⌘V failed: {error}; trying enigo keycode path");
        paste_cmd_v_enigo()?;
    }

    // Restore previous clipboard shortly after paste lands.
    if let Some(prev) = previous {
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(400));
            let _ = write_macos_clipboard(&prev);
        });
    }
    Ok(())
}

fn write_macos_clipboard(text: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("pbcopy: {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("pbcopy write: {e}"))?;
    }
    let status = child.wait().map_err(|e| format!("pbcopy wait: {e}"))?;
    if !status.success() {
        return Err("pbcopy failed".into());
    }
    Ok(())
}

/// ⌘V via AppleScript System Events (needs Accessibility for the worker process).
fn paste_cmd_v_system_events() -> Result<(), String> {
    let status = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to keystroke \"v\" using command down",
        ])
        .status()
        .map_err(|e| format!("osascript: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("osascript keystroke exit {status}"))
    }
}

/// ⌘V via enigo using the ANSI V virtual key code (not Unicode 'v').
fn paste_cmd_v_enigo() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
    enigo
        .key(Key::Meta, Direction::Press)
        .map_err(|e| format!("meta down: {e}"))?;
    // Hold Command long enough for the OS to register the chord.
    thread::sleep(Duration::from_millis(35));
    #[cfg(target_os = "macos")]
    {
        enigo
            .key(Key::Other(MAC_KEYCODE_V), Direction::Press)
            .map_err(|e| format!("v down: {e}"))?;
        thread::sleep(Duration::from_millis(20));
        enigo
            .key(Key::Other(MAC_KEYCODE_V), Direction::Release)
            .map_err(|e| format!("v up: {e}"))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        enigo
            .key(Key::Unicode('v'), Direction::Click)
            .map_err(|e| format!("v: {e}"))?;
    }
    thread::sleep(Duration::from_millis(20));
    enigo
        .key(Key::Meta, Direction::Release)
        .map_err(|e| format!("meta up: {e}"))?;
    Ok(())
}

pub fn release_control_keys() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
    let _ = enigo.key(Key::Control, Direction::Release);
    let _ = enigo.key(Key::LControl, Direction::Release);
    let _ = enigo.key(Key::RControl, Direction::Release);
    Ok(())
}

pub fn reconcile_typed_text(previous: &str, completed: &str) -> Result<(), String> {
    if previous == completed {
        return Ok(());
    }
    let mut shared = 0usize;
    let prev_chars: Vec<char> = previous.chars().collect();
    let next_chars: Vec<char> = completed.chars().collect();
    let limit = prev_chars.len().min(next_chars.len());
    while shared < limit && prev_chars[shared] == next_chars[shared] {
        shared += 1;
    }
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
    for _ in shared..prev_chars.len() {
        enigo
            .key(Key::Backspace, Direction::Click)
            .map_err(|e| format!("backspace: {e}"))?;
    }
    let tail: String = next_chars[shared..].iter().collect();
    if !tail.is_empty() {
        type_text(&tail)?;
    }
    Ok(())
}

pub fn remaining_text(typed_words: &[String], completed_text: &str) -> String {
    crate::dictation_format::remaining_text(typed_words, completed_text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remaining_skips_committed_prefix() {
        let typed = vec!["hello".into(), "world".into()];
        assert_eq!(remaining_text(&typed, "hello world again"), "again");
        assert_eq!(remaining_text(&typed, "hello world"), "");
    }

    #[test]
    fn clipboard_roundtrip_helper_writes() {
        // Only assert the write/read helpers; full Cmd+V needs Accessibility + focus.
        let marker = format!("dufflebag-paste-test-{}", std::process::id());
        write_macos_clipboard(&marker).expect("pbcopy");
        let out = Command::new("pbpaste").output().expect("pbpaste");
        assert_eq!(String::from_utf8_lossy(&out.stdout), marker);
    }
}
