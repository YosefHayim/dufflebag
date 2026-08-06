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
