//! Narration inbox drain (JSON envelopes written by the Stop hook).

use crate::config::VoicePreferences;
use crate::state::{atomic_json, now_secs, voice_state_home};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const PENDING_NARRATION_TTL_SECONDS: f64 = 60.0 * 60.0;
pub const SEEN_NARRATION_TTL_SECONDS: f64 = 24.0 * 60.0 * 60.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub markdown: String,
    #[serde(default)]
    pub origin: Value,
    #[serde(default)]
    pub received_at: f64,
    #[serde(default)]
    pub agent_reply_id: String,
    #[serde(default)]
    pub source: String,
}

pub fn enqueue_narration(
    markdown: &str,
    source: &str,
    agent_reply_id: &str,
    origin: Option<Value>,
) -> std::io::Result<PathBuf> {
    let inbox = voice_state_home().join("inbox");
    fs::create_dir_all(&inbox)?;
    let path = inbox.join(format!(
        "{}-{}.json",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
        uuid::Uuid::new_v4().simple()
    ));
    let envelope = Envelope {
        markdown: markdown.to_string(),
        origin: origin.unwrap_or_else(|| serde_json::json!({"kind": "terminal"})),
        received_at: now_secs(),
        agent_reply_id: agent_reply_id.to_string(),
        source: source.to_string(),
    };
    // Drop duplicates before they ever reach the speaker.
    if seen_narration_keys().contains_key(&envelope_identity(&envelope)) {
        return Ok(path);
    }
    atomic_json(&path, &envelope)?;
    Ok(path)
}

fn envelope_surface_identity(envelope: &Envelope) -> String {
    let origin = &envelope.origin;
    if origin.get("kind").and_then(|v| v.as_str()) != Some("cmux") {
        return String::new();
    }
    let workspace = origin.get("workspace_id").and_then(|v| v.as_str()).unwrap_or("");
    let surface = origin.get("surface_id").and_then(|v| v.as_str()).unwrap_or("");
    if workspace.is_empty() || surface.is_empty() {
        String::new()
    } else {
        format!("{workspace}:{surface}")
    }
}

/// Stable FNV-1a over markdown bytes (DefaultHasher is re-seeded per process — never use for seen keys).
pub fn stable_content_token(markdown: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in markdown.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}:{}", markdown.len())
}

/// Identity is content-based so the same reply cannot be spoken twice even if hooks fire
/// without a stable response_id or the worker restarts.
pub fn envelope_identity(envelope: &Envelope) -> String {
    let content = stable_content_token(&envelope.markdown);
    let surface = envelope_surface_identity(envelope);
    let surface = if surface.is_empty() {
        "terminal".into()
    } else {
        surface
    };
    let source = if envelope.source.is_empty() {
        "unknown"
    } else {
        &envelope.source
    };
    // Prefer reply id when present (more precise), but always bind content so empty ids don't thrash.
    let reply = envelope.agent_reply_id.trim();
    if reply.is_empty() {
        format!("{source}:{surface}:{content}")
    } else {
        format!("{source}:{surface}:{reply}:{content}")
    }
}

fn seen_narration_keys() -> HashMap<String, f64> {
    let path = voice_state_home().join("seen.json");
    let Ok(bytes) = fs::read(path) else {
        return HashMap::new();
    };
    let Ok(document) = serde_json::from_slice::<Value>(&bytes) else {
        return HashMap::new();
    };
    let Some(object) = document.as_object() else {
        return HashMap::new();
    };
    let now = now_secs();
    object
        .iter()
        .filter_map(|(key, value)| {
            let stamp = value.as_f64()?;
            if now - stamp <= SEEN_NARRATION_TTL_SECONDS {
                Some((key.clone(), stamp))
            } else {
                None
            }
        })
        .collect()
}

pub fn remember_envelope(envelope: &Envelope) {
    let mut seen = seen_narration_keys();
    let identity = envelope_identity(envelope);
    seen.insert(identity.clone(), now_secs());
    // Also remember pure content key so a later hook with a different reply id can't re-speak it.
    let content_only = format!(
        "{}:{}:{}",
        if envelope.source.is_empty() {
            "unknown"
        } else {
            &envelope.source
        },
        {
            let surface = envelope_surface_identity(envelope);
            if surface.is_empty() {
                "terminal".into()
            } else {
                surface
            }
        },
        stable_content_token(&envelope.markdown)
    );
    seen.insert(content_only, now_secs());
    let _ = atomic_json(&voice_state_home().join("seen.json"), &seen);
}

pub fn was_already_spoken(envelope: &Envelope) -> bool {
    let seen = seen_narration_keys();
    let identity = envelope_identity(envelope);
    if seen.contains_key(&identity) {
        return true;
    }
    let content_only = format!(
        "{}:{}:{}",
        if envelope.source.is_empty() {
            "unknown"
        } else {
            &envelope.source
        },
        {
            let surface = envelope_surface_identity(envelope);
            if surface.is_empty() {
                "terminal".into()
            } else {
                surface
            }
        },
        stable_content_token(&envelope.markdown)
    );
    seen.contains_key(&content_only)
}

pub fn envelope_eligible(envelope: &Envelope, preferences: &VoicePreferences) -> bool {
    if preferences.narration_mode == "off" {
        return false;
    }
    if crate::state::narration_muted() {
        return false;
    }
    let origin = &envelope.origin;
    if origin.get("kind").and_then(|v| v.as_str()) != Some("cmux")
        || preferences.narration_mode == "immediate"
    {
        return true;
    }
    true
}

/// Claim the next eligible envelope by renaming it to `.speaking` so it cannot be picked twice.
pub fn next_envelope(preferences: &VoicePreferences) -> Option<(PathBuf, Envelope)> {
    let inbox = voice_state_home().join("inbox");
    let _ = fs::create_dir_all(&inbox);
    let mut pending: Vec<(PathBuf, Envelope)> = Vec::new();
    let Ok(entries) = fs::read_dir(&inbox) else {
        return None;
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            // Ignore in-flight claims and temp files.
            ext == "json"
        })
        .collect();
    paths.sort();
    for path in paths {
        let Ok(bytes) = fs::read(&path) else {
            let _ = fs::remove_file(&path);
            continue;
        };
        let Ok(value) = serde_json::from_slice::<Envelope>(&bytes) else {
            let _ = fs::remove_file(&path);
            continue;
        };
        if value.markdown.trim().is_empty() {
            let _ = fs::remove_file(&path);
            continue;
        }
        if value.received_at > 0.0 && now_secs() - value.received_at > PENDING_NARRATION_TTL_SECONDS {
            let _ = fs::remove_file(&path);
            continue;
        }
        pending.push((path, value));
    }

    if preferences.narration_mode == "off" {
        for (path, _) in &pending {
            let _ = fs::remove_file(path);
        }
        return None;
    }

    let newest_identity: HashMap<String, PathBuf> = pending
        .iter()
        .map(|(path, value)| (envelope_identity(value), path.clone()))
        .collect();
    let mut newest_surface: HashMap<String, PathBuf> = HashMap::new();
    for (path, value) in &pending {
        let surface = envelope_surface_identity(value);
        if !surface.is_empty() {
            newest_surface.insert(surface, path.clone());
        }
    }
    let seen = seen_narration_keys();
    for (path, value) in pending {
        let identity = envelope_identity(&value);
        let surface = envelope_surface_identity(&value);
        let superseded = newest_identity.get(&identity) != Some(&path)
            || (!surface.is_empty() && newest_surface.get(&surface) != Some(&path));
        if superseded || was_already_spoken(&value) || seen.contains_key(&identity) {
            let _ = fs::remove_file(&path);
            continue;
        }
        if !envelope_eligible(&value, preferences) {
            continue;
        }
        // Claim before speaking so a crash mid-playback cannot re-queue forever.
        let claimed = path.with_extension("speaking");
        if fs::rename(&path, &claimed).is_err() {
            continue;
        }
        // Mark seen *before* playback so a restart during TTS won't replay it.
        remember_envelope(&value);
        return Some((claimed, value));
    }
    None
}

pub fn complete_envelope(path: &Path) {
    let _ = fs::remove_file(path);
}

pub fn fail_envelope(path: &Path) {
    let failed = voice_state_home().join("failed");
    let _ = fs::create_dir_all(&failed);
    if let Some(name) = path.file_name() {
        let _ = fs::rename(path, failed.join(name));
    } else {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_token_is_stable() {
        assert_eq!(
            stable_content_token("hello world"),
            stable_content_token("hello world")
        );
        assert_ne!(
            stable_content_token("hello world"),
            stable_content_token("hello world!")
        );
    }

    #[test]
    fn identity_prefers_content() {
        let a = Envelope {
            markdown: "Same reply".into(),
            origin: serde_json::json!({"kind": "terminal"}),
            received_at: 0.0,
            agent_reply_id: String::new(),
            source: "claude-code".into(),
        };
        let b = Envelope {
            agent_reply_id: "different-id".into(),
            ..a.clone()
        };
        // Content-only and reply+content differ, but was_already_spoken should catch both after remember.
        assert_ne!(envelope_identity(&a), envelope_identity(&b));
        assert_eq!(
            stable_content_token(&a.markdown),
            stable_content_token(&b.markdown)
        );
    }
}
