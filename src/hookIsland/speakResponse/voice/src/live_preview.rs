//! Live HUD preview while holding Control.
//!
//! OSW uses Parakeet/FluidAudio for a cheap sliding-window caption, then offline
//! STT for the final insert. We mirror that shape with a Whisper sliding-window
//! preview (same Metal model, light params, separate WhisperState):
//! - While recording, periodically decode a short tail of audio.
//! - Write `preview` into status.json for the HUD only (never types).
//! - Final insert always comes from the offline queue (pipeline).
//!
//! Set `DUFFLEBAG_LIVE_PREVIEW=0` to disable.

use crate::audio::SharedCapture;
use crate::state::write_worker_status;
use crate::stt::SttEngine;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const PREVIEW_INTERVAL: Duration = Duration::from_millis(1400);
/// Seconds of audio tail for the live caption (OSW uses ~1.5s chunks).
const PREVIEW_TAIL_SECONDS: f32 = 3.0;
/// Need at least this much audio before first preview (~0.6s).
const MIN_PREVIEW_SAMPLES: usize = 9_600;

pub fn live_preview_enabled() -> bool {
    match std::env::var("DUFFLEBAG_LIVE_PREVIEW") {
        Ok(v) => {
            let t = v.trim().to_ascii_lowercase();
            !(t == "0" || t == "false" || t == "off" || t == "no")
        }
        Err(_) => true,
    }
}

/// Shared last live caption for short-clip fallback on release.
#[derive(Default)]
pub struct LiveCaption {
    text: parking_lot::Mutex<String>,
}

impl LiveCaption {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            text: parking_lot::Mutex::new(String::new()),
        })
    }

    pub fn set(&self, text: &str) {
        *self.text.lock() = text.to_string();
    }

    pub fn take(&self) -> String {
        std::mem::take(&mut *self.text.lock())
    }

    pub fn clear(&self) {
        self.text.lock().clear();
    }
}

/// Poll capture tail → whisper preview → HUD, only while `recording` is true.
pub fn spawn_preview_loop(
    capture: SharedCapture,
    recording: Arc<AtomicBool>,
    engine: Arc<SttEngine>,
    caption: Arc<LiveCaption>,
    model_name: String,
    backend: String,
    running: Arc<AtomicBool>,
) {
    if !live_preview_enabled() {
        return;
    }
    thread::spawn(move || {
        while running.load(Ordering::SeqCst) {
            if !recording.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(50));
                continue;
            }
            if !capture.is_recording() {
                thread::sleep(Duration::from_millis(50));
                continue;
            }
            let samples = capture.snapshot_tail(PREVIEW_TAIL_SECONDS);
            if samples.len() < MIN_PREVIEW_SAMPLES {
                thread::sleep(PREVIEW_INTERVAL);
                continue;
            }
            let language = crate::config::dictation_whisper_language();
            match engine.transcribe_preview(&samples, &language) {
                Ok(raw) => {
                    let text = crate::stt::clean_transcript(&raw);
                    if !text.is_empty() && recording.load(Ordering::SeqCst) {
                        caption.set(&text);
                        write_worker_status(
                            "listening",
                            "",
                            Some(&model_name),
                            Some(&backend),
                            Some(&text),
                        );
                    }
                }
                Err(error) => {
                    eprintln!("live preview: {error}");
                }
            }
            thread::sleep(PREVIEW_INTERVAL);
        }
    });
}
