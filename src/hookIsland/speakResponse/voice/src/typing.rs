//! Insert text at the active caret.
//! Prefer clipboard + ⌘V on macOS (reliable without fighting Control); fall back to enigo.

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::io::Write;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

/// Insert `text` into the focused field. Returns Ok after a successful path.
pub fn type_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    // Wait for Control to fully release so ⌘V / typing is not modified.
    wait_control_up(400);
    let _ = release_control_keys();
    thread::sleep(Duration::from_millis(40));

    // 1) Clipboard paste — most reliable on macOS for focused inputs.
    if let Err(error) = paste_via_clipboard(text) {
        eprintln!("clipboard paste failed: {error}; trying enigo.text");
        // 2) Direct keyboard injection.
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
        enigo.text(text).map_err(|e| {
            format!(
                "type failed ({e}). Grant Accessibility to dufflebag-voice in \
                 System Settings → Privacy & Security → Accessibility"
            )
        })?;
    }
    Ok(())
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
    wait_control_up(400);
    let _ = release_control_keys();
    thread::sleep(Duration::from_millis(40));

    if !previous.is_empty() {
        backspace_chars(previous.chars().count())?;
        thread::sleep(Duration::from_millis(20));
    }
    if !next.is_empty() {
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
    wait_control_up(200);
    let _ = release_control_keys();
    thread::sleep(Duration::from_millis(30));
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

fn paste_via_clipboard(text: &str) -> Result<(), String> {
    // Save previous clipboard (best-effort).
    let previous = Command::new("pbpaste")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok());

    {
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
    }

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;
    // ⌘V
    enigo
        .key(Key::Meta, Direction::Press)
        .map_err(|e| format!("meta down: {e}"))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| format!("v: {e}"))?;
    enigo
        .key(Key::Meta, Direction::Release)
        .map_err(|e| format!("meta up: {e}"))?;

    // Restore previous clipboard shortly after paste lands.
    if let Some(prev) = previous {
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            if let Ok(mut child) = Command::new("pbcopy").stdin(Stdio::piped()).spawn() {
                if let Some(stdin) = child.stdin.as_mut() {
                    let _ = stdin.write_all(prev.as_bytes());
                }
                let _ = child.wait();
            }
        });
    }
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
}
