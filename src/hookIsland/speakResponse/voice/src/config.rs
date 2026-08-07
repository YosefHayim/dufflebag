//! Bag-owned voice preferences from the installed config.json.

use serde_json::Value;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct VoicePreferences {
    /// off | review | stt | both
    pub prompt_refinement: String,
    /// codex | local | auto
    pub prompt_refinement_backend: String,
    /// Provider model id (dynamic; e.g. gpt-5.3-codex-spark, grok-4.5, llama3.2)
    pub prompt_refinement_model: String,
    /// Optional reasoning effort (low|medium|high|…) for grok/codex when supported
    pub prompt_refinement_reasoning_effort: String,
    /// Paste raw STT first, then replace with refined text
    pub prompt_refinement_show_raw_first: bool,
    /// Send Enter after refined caret paste
    pub prompt_refinement_auto_submit: bool,
    /// caret | cmux-new | cmux-resume
    pub prompt_refinement_delivery: String,
    /// Optional cmux-new shell template ({{prompt_file}}, {{prompt}}, {{cwd}})
    pub prompt_refinement_cmux_command: String,
    /// Send Enter after inject for cmux-resume / paste-only cmux-new
    pub prompt_refinement_cmux_auto_submit: bool,
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
            prompt_refinement_backend: "codex".into(),
            prompt_refinement_model: "gpt-5.3-codex-spark".into(),
            // low avoids Codex defaulting reasoning models to xhigh after Ctrl release
            prompt_refinement_reasoning_effort: "low".into(),
            // Prefer showing STT immediately; pipeline also force raw-first when refining.
            prompt_refinement_show_raw_first: true,
            prompt_refinement_auto_submit: false,
            prompt_refinement_delivery: "caret".into(),
            prompt_refinement_cmux_command: String::new(),
            prompt_refinement_cmux_auto_submit: false,
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

impl VoicePreferences {
    pub fn stt_refine_enabled(&self) -> bool {
        matches!(self.prompt_refinement.as_str(), "stt" | "both")
    }

    pub fn review_refine_enabled(&self) -> bool {
        matches!(self.prompt_refinement.as_str(), "review" | "both")
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
        "off" | "review" | "stt" | "both" => refinement_mode,
        _ => "off",
    }
    .to_string();
    let refinement_backend = values
        .get("promptRefinementBackend")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("codex")
        .to_ascii_lowercase();
    let refinement_model = values
        .get("promptRefinementModel")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("gpt-5.3-codex-spark")
        .to_string();
    let refinement_reasoning_effort = values
        .get("promptRefinementReasoningEffort")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("low")
        .to_ascii_lowercase();
    let refinement_reasoning_effort = match refinement_reasoning_effort.as_str() {
        "low" | "medium" | "high" | "xhigh" | "minimal" => refinement_reasoning_effort,
        // Empty / unknown → low so STT refine stays snappy on reasoning models.
        _ => "low".to_string(),
    };
    let refinement_show_raw_first = values
        .get("promptRefinementShowRawFirst")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let refinement_auto_submit = values
        .get("promptRefinementAutoSubmit")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let refinement_delivery = values
        .get("promptRefinementDelivery")
        .and_then(|v| v.as_str())
        .unwrap_or("caret");
    let refinement_delivery = match refinement_delivery {
        "caret" | "cmux-new" | "cmux-resume" => refinement_delivery,
        _ => "caret",
    }
    .to_string();
    let refinement_cmux_command = values
        .get("promptRefinementCmuxCommand")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let refinement_cmux_auto_submit = values
        .get("promptRefinementCmuxAutoSubmit")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
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
        prompt_refinement_backend: refinement_backend,
        prompt_refinement_model: refinement_model,
        prompt_refinement_reasoning_effort: refinement_reasoning_effort,
        prompt_refinement_show_raw_first: refinement_show_raw_first,
        prompt_refinement_auto_submit: refinement_auto_submit,
        prompt_refinement_delivery: refinement_delivery,
        prompt_refinement_cmux_command: refinement_cmux_command,
        prompt_refinement_cmux_auto_submit: refinement_cmux_auto_submit,
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

    #[test]
    fn mode_helpers() {
        let mut p = VoicePreferences::default();
        assert!(!p.stt_refine_enabled());
        assert!(!p.review_refine_enabled());
        p.prompt_refinement = "stt".into();
        assert!(p.stt_refine_enabled());
        assert!(!p.review_refine_enabled());
        p.prompt_refinement = "both".into();
        assert!(p.stt_refine_enabled());
        assert!(p.review_refine_enabled());
        p.prompt_refinement = "review".into();
        assert!(!p.stt_refine_enabled());
        assert!(p.review_refine_enabled());
    }
}
