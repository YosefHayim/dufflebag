//! Devin ATIF export watcher → narration inbox.

use crate::inbox::enqueue_narration;
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevinNarration {
    pub markdown: String,
    pub turn_id: String,
}

pub fn select_devin_narration(document: &Value) -> DevinNarration {
    let empty = DevinNarration {
        markdown: String::new(),
        turn_id: String::new(),
    };
    let Some(steps) = document.get("steps").and_then(|v| v.as_array()) else {
        return empty;
    };
    let mut last_user_index: isize = -1;
    for (index, step) in steps.iter().enumerate() {
        if step.get("source").and_then(|v| v.as_str()) == Some("user") {
            last_user_index = index as isize;
        }
    }
    let mut messages = Vec::new();
    let mut turn_id = String::new();
    let start = (last_user_index + 1) as usize;
    for step in steps.iter().skip(start) {
        if step.get("source").and_then(|v| v.as_str()) != Some("agent") {
            continue;
        }
        let Some(message) = step.get("message").and_then(|v| v.as_str()) else {
            continue;
        };
        let message = message.trim();
        if message.is_empty() {
            continue;
        }
        messages.push(message.to_string());
        if let Some(id) = step.get("step_id").and_then(|v| v.as_str()) {
            turn_id = id.to_string();
        }
    }
    DevinNarration {
        markdown: messages.join("\n\n"),
        turn_id,
    }
}

fn read_json_file(path: &Path) -> Option<Value> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Watch a Devin ATIF export; debounce and enqueue stable agent turns.
pub fn watch_devin(path: &Path) -> i32 {
    if let Err(error) = crate::daemon::start_worker_detached() {
        eprintln!("start worker: {error}");
        return 1;
    }
    let mut seen_turn_id = read_json_file(path)
        .map(|doc| select_devin_narration(&doc).turn_id)
        .unwrap_or_default();
    let mut last_change = Instant::now();
    let mut pending_turn_id = String::new();

    loop {
        let selected = read_json_file(path)
            .map(|doc| select_devin_narration(&doc))
            .unwrap_or(DevinNarration {
                markdown: String::new(),
                turn_id: String::new(),
            });
        let turn_id = selected.turn_id.clone();
        if !turn_id.is_empty() && turn_id != seen_turn_id && turn_id != pending_turn_id {
            pending_turn_id = turn_id;
            last_change = Instant::now();
        }
        if !pending_turn_id.is_empty() && last_change.elapsed() >= Duration::from_millis(800) {
            let confirmed = read_json_file(path)
                .map(|doc| select_devin_narration(&doc))
                .unwrap_or(DevinNarration {
                    markdown: String::new(),
                    turn_id: String::new(),
                });
            if confirmed.turn_id == pending_turn_id && !confirmed.markdown.is_empty() {
                if let Err(error) =
                    enqueue_narration(&confirmed.markdown, "devin", &confirmed.turn_id, None)
                {
                    eprintln!("enqueue: {error}");
                }
                seen_turn_id = confirmed.turn_id;
            }
            pending_turn_id.clear();
        }
        thread::sleep(Duration::from_millis(200));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn joins_agent_messages_after_latest_user() {
        let document = json!({
            "steps": [
                {"step_id": "old-user", "source": "user", "message": "Earlier request"},
                {"step_id": "old-agent", "source": "agent", "message": "Earlier answer"},
                {"step_id": "new-user", "source": "user", "message": "Current request"},
                {"step_id": "new-agent-1", "source": "agent", "message": "First part"},
                {"step_id": "new-agent-2", "source": "agent", "message": "Second part"}
            ]
        });
        let selected = select_devin_narration(&document);
        assert_eq!(selected.markdown, "First part\n\nSecond part");
        assert_eq!(selected.turn_id, "new-agent-2");
    }
}
