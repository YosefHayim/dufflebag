//! Bag-owned voice preferences from the installed config.json.

use serde_json::Value;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct VoicePreferences {
    pub prompt_refinement: String,
    pub read_along: bool,
    pub narration_mode: String,
    pub speech_voice: String,
    pub speech_speed: f64,
    pub dictation_replacements: String,
    /// Keep the mic open this long after Control release (trailing-word tail).
    pub dictation_mic_off_delay_ms: u64,
    /// Whisper language code: `en` (default) or `he` (ivrit.ai Hebrew model).
    pub dictation_language: String,
}

impl Default for VoicePreferences {
    fn default() -> Self {
        Self {
            prompt_refinement: "off".into(),
            read_along: true,
            narration_mode: "auto".into(),
            speech_voice: "F4".into(),
            speech_speed: 1.15,
            dictation_replacements: String::new(),
            dictation_mic_off_delay_ms: 200,
            dictation_language: "en".into(),
        }
    }
}

pub fn installed_config() -> Value {
    for candidate in config_candidates() {
        if let Ok(bytes) = fs::read(&candidate) {
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                if value.is_object() {
                    return value;
                }
            }
        }
    }
    Value::Object(Default::default())
}

fn config_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        // .../runtime/speakResponse/dufflebag-voice → package/install root
        if let Some(speak) = exe.parent() {
            if let Some(runtime) = speak.parent() {
                if let Some(root) = runtime.parent() {
                    paths.push(root.join("config.json"));
                }
            }
            paths.push(speak.join("config.json"));
        }
    }
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let root = PathBuf::from(manifest)
            .join("../../..")
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        paths.push(root.join("config.json"));
    }
    paths
}

pub fn voice_preferences() -> VoicePreferences {
    let values = installed_config();
    let narration_mode = values
        .get("speechResponseMode")
        .and_then(|v| v.as_str())
        .unwrap_or("auto");
    let narration_mode = match narration_mode {
        "auto" | "focused" | "immediate" | "off" => narration_mode,
        _ => "auto",
    }
    .to_string();
    let refinement_mode = values
        .get("promptRefinementMode")
        .and_then(|v| v.as_str())
        .unwrap_or("off");
    let refinement_mode = match refinement_mode {
        "off" | "review" => refinement_mode,
        _ => "off",
    }
    .to_string();
    let voice = values
        .get("speechVoice")
        .and_then(|v| v.as_str())
        .unwrap_or("F4");
    let speech_voice = if regex_voice(voice) {
        voice.to_ascii_uppercase()
    } else {
        "F4".into()
    };
    let rate = values
        .get("speechWordsPerMinute")
        .and_then(|v| v.as_f64())
        .unwrap_or(230.0);
    let speech_speed = (rate / 200.0).clamp(0.7, 2.0);
    let dictation_replacements = values
        .get("dictationReplacements")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let read_along = values
        .get("speechReadAlong")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let dictation_mic_off_delay_ms = values
        .get("dictationMicOffDelayMs")
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_f64().map(|n| n.round() as u64))
        })
        .unwrap_or(200)
        .min(2000);
    let dictation_language = values
        .get("dictationLanguage")
        .and_then(|v| v.as_str())
        .unwrap_or("en");
    let dictation_language = match dictation_language.trim().to_ascii_lowercase().as_str() {
        "he" | "he-il" | "he_il" | "hebrew" | "ivrit" | "iw" => "he".to_string(),
        _ => "en".to_string(),
    };
    VoicePreferences {
        prompt_refinement: refinement_mode,
        read_along,
        narration_mode,
        speech_voice,
        speech_speed,
        dictation_replacements,
        dictation_mic_off_delay_ms,
        dictation_language,
    }
}

/// Whisper `set_language` token from bag preferences (live-read safe).
pub fn dictation_whisper_language() -> String {
    voice_preferences().dictation_language
}

fn regex_voice(voice: &str) -> bool {
    let bytes = voice.as_bytes();
    bytes.len() == 2
        && matches!(bytes[0].to_ascii_uppercase(), b'M' | b'F')
        && matches!(bytes[1], b'1'..=b'5')
}

pub fn parse_dictation_replacements(replacement_text: &str) -> std::collections::HashMap<String, String> {
    let mut replacements = std::collections::HashMap::new();
    for entry in replacement_text.split(';') {
        let Some((heard, written)) = entry.split_once('=') else {
            continue;
        };
        let heard = heard.trim();
        let written = written.trim();
        if !heard.is_empty() && !written.is_empty() {
            replacements.insert(heard.to_string(), written.to_string());
        }
    }
    replacements
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_replacements() {
        let map = parse_dictation_replacements(" Joseph = Yosef ; type script = TypeScript ; broken ; =bad ; empty= ");
        assert_eq!(map.get("Joseph").map(String::as_str), Some("Yosef"));
        assert_eq!(map.get("type script").map(String::as_str), Some("TypeScript"));
        assert_eq!(map.len(), 2);
    }
}
