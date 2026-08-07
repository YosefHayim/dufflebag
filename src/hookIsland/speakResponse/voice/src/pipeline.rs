//! Serial dictation queue (OpenSuperWhisper DictationPipeline shape).
//! Record never waits on STT — release enqueues, a single worker drains FIFO.

use crate::config::parse_dictation_replacements;
use crate::dictation_format::{dictation_projection, FormatState};
use crate::state::{voice_state_home, write_worker_status};
use crate::stt::SttEngine;
use crate::typing::type_text;
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct DictationJob {
    pub samples: Vec<f32>,
    pub replacements: HashMap<String, String>,
    /// Live-preview fallback text if offline STT returns empty (short clips).
    pub streamed_fallback: String,
    pub generation: u64,
}

pub struct DictationPipeline {
    queue: Mutex<VecDeque<DictationJob>>,
    pending: AtomicU64,
    in_flight: AtomicBool,
    running: AtomicBool,
}

impl DictationPipeline {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            queue: Mutex::new(VecDeque::new()),
            pending: AtomicU64::new(0),
            in_flight: AtomicBool::new(false),
            running: AtomicBool::new(true),
        })
    }

    pub fn pending_count(&self) -> u64 {
        self.pending.load(Ordering::SeqCst)
            + if self.in_flight.load(Ordering::SeqCst) {
                1
            } else {
                0
            }
    }

    pub fn enqueue(&self, job: DictationJob) {
        log_line(&format!(
            "enqueue gen={} samples={} fallback_chars={}",
            job.generation,
            job.samples.len(),
            job.streamed_fallback.len()
        ));
        self.queue.lock().push_back(job);
        self.pending.fetch_add(1, Ordering::SeqCst);
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    /// Spawn the serial STT + type worker. Safe to call once per daemon.
    pub fn spawn_worker(
        self: &Arc<Self>,
        engine: Arc<SttEngine>,
        model_name: String,
        backend: String,
    ) {
        let pipeline = Arc::clone(self);
        thread::spawn(move || {
            while pipeline.running.load(Ordering::SeqCst) {
                let job = {
                    let mut q = pipeline.queue.lock();
                    q.pop_front()
                };
                let Some(job) = job else {
                    thread::sleep(Duration::from_millis(15));
                    continue;
                };
                pipeline.pending.fetch_sub(1, Ordering::SeqCst);
                pipeline.in_flight.store(true, Ordering::SeqCst);
                write_worker_status(
                    "finishing",
                    &format!("Decoding {} samples…", job.samples.len()),
                    Some(&model_name),
                    Some(&backend),
                    None,
                );

                let boost = prompt_boost_from_replacements(&job.replacements);
                let secs = job.samples.len() as f32 / 16_000.0;
                let job_started = Instant::now();
                let language = crate::config::dictation_whisper_language();
                let result = engine.transcribe_timed(&job.samples, &language, boost.as_deref());
                match result {
                    Ok(timed) => {
                        let decode_ms = timed.decode_ms;
                        let mut text = crate::stt::clean_transcript(&timed.text);
                        if text.is_empty() {
                            text = crate::stt::clean_transcript(&job.streamed_fallback);
                        }
                        log_line(&format!(
                            "stt gen={} secs={secs:.2} decode_ms={decode_ms:.1} raw={:?} clean={:?}",
                            job.generation, timed.text, text
                        ));
                        if text.is_empty() {
                            write_worker_status(
                                "inactive",
                                &format!("No speech ({secs:.1}s audio, {decode_ms:.0}ms decode)"),
                                Some(&model_name),
                                Some(&backend),
                                None,
                            );
                        } else {
                            let prefs = crate::config::voice_preferences();
                            let raw_text = text.clone();
                            // Exact string that was pasted for raw-first (includes trailing space).
                            // Used to backspace-replace without global ⌘A (which blues WebGL).
                            let mut typed_raw: Option<String> = None;

                            // Always paste raw STT first when refine is on so Ctrl release
                            // writes immediately; refined text later replaces it. Previously
                            // this waited on the model (often multi-second reasoning), so the
                            // input looked stuck until refine finished.
                            //
                            // HUD rule: once raw is on screen, hide the pill. Keeping
                            // "Refining (codex/…)…" up for the whole model wait made it look
                            // stuck after paste (raw already looks final when refine is a
                            // no-op). Only re-show a short "Updating…" if refined text differs.
                            if prefs.stt_refine_enabled() {
                                write_worker_status(
                                    "typing",
                                    "Pasting…",
                                    Some(&model_name),
                                    Some(&backend),
                                    None,
                                );
                                match type_final_transcript(&raw_text, &job.replacements) {
                                    Ok(typed) if !typed.is_empty() => {
                                        typed_raw = Some(typed.clone());
                                        log_line(&format!(
                                            "stt raw-first gen={} text={:?}",
                                            job.generation, typed
                                        ));
                                        // Text is already in the caret — hide the spinner
                                        // while the model rewrites in the background.
                                        write_worker_status(
                                            "inactive",
                                            "",
                                            Some(&model_name),
                                            Some(&backend),
                                            None,
                                        );
                                    }
                                    Ok(_) => {
                                        log_line(&format!(
                                            "stt raw-first empty gen={}",
                                            job.generation
                                        ));
                                    }
                                    Err(error) => {
                                        log_line(&format!(
                                            "raw-first type failed gen={}: {error}",
                                            job.generation
                                        ));
                                    }
                                }
                            }

                            if prefs.stt_refine_enabled() {
                                // Only show a refining spinner when raw is NOT already on
                                // screen (raw-first failed) so the user isn't left staring
                                // at an empty input with no feedback.
                                if typed_raw.is_none() {
                                    let effort =
                                        if prefs.prompt_refinement_reasoning_effort.is_empty() {
                                            String::new()
                                        } else {
                                            format!("/{}", prefs.prompt_refinement_reasoning_effort)
                                        };
                                    write_worker_status(
                                        "refining",
                                        &format!(
                                            "Refining ({}/{}{})…",
                                            prefs.prompt_refinement_backend,
                                            prefs.prompt_refinement_model,
                                            effort
                                        ),
                                        Some(&model_name),
                                        Some(&backend),
                                        None,
                                    );
                                }
                                let refine_started = Instant::now();
                                match crate::refine::refine_with_prefs(&raw_text, &prefs) {
                                    Ok(refined) if !refined.trim().is_empty() => {
                                        let refine_ms =
                                            refine_started.elapsed().as_secs_f64() * 1000.0;
                                        log_line(&format!(
                                            "stt refine gen={} backend={} model={} effort={} refine_ms={refine_ms:.1} raw={:?} refined={:?}",
                                            job.generation,
                                            prefs.prompt_refinement_backend,
                                            prefs.prompt_refinement_model,
                                            prefs.prompt_refinement_reasoning_effort,
                                            raw_text,
                                            refined
                                        ));
                                        text = refined;
                                    }
                                    Ok(_) => {
                                        log_line(&format!(
                                            "stt refine empty gen={}; keeping raw transcript",
                                            job.generation
                                        ));
                                    }
                                    Err(error) => {
                                        log_line(&format!(
                                            "stt refine failed gen={}: {error}; keeping raw transcript",
                                            job.generation
                                        ));
                                    }
                                }
                            }

                            // If refined equals what we already pasted, skip re-deliver so we
                            // don't thrash the caret — and keep the HUD hidden.
                            let refined_equals_raw = typed_raw
                                .as_ref()
                                .is_some_and(|prev| {
                                    caret_projection_equals(prev, &text, &job.replacements)
                                });

                            let type_started = Instant::now();
                            let deliver_result = if refined_equals_raw {
                                log_line(&format!(
                                    "stt refine no-op gen={} (same as raw-first)",
                                    job.generation
                                ));
                                Ok(typed_raw.clone().unwrap_or_default())
                            } else {
                                // Only flash the pill when we're about to change the input.
                                if typed_raw.is_some() && prefs.stt_refine_enabled() {
                                    write_worker_status(
                                        "typing",
                                        "Updating…",
                                        Some(&model_name),
                                        Some(&backend),
                                        None,
                                    );
                                }
                                let delivery = prefs.prompt_refinement_delivery.clone();
                                if crate::cmux_deliver::is_cmux_delivery(&delivery)
                                    && prefs.stt_refine_enabled()
                                {
                                    match crate::cmux_deliver::deliver_text(&text, &prefs) {
                                        Ok(result) => Ok(result.summary),
                                        Err(error) => {
                                            log_line(&format!(
                                                "cmux deliver failed gen={}: {error}; falling back to caret",
                                                job.generation
                                            ));
                                            deliver_to_caret(
                                                &text,
                                                &job.replacements,
                                                typed_raw.as_deref(),
                                                prefs.prompt_refinement_auto_submit,
                                            )
                                        }
                                    }
                                } else {
                                    deliver_to_caret(
                                        &text,
                                        &job.replacements,
                                        typed_raw.as_deref(),
                                        prefs.prompt_refinement_auto_submit,
                                    )
                                }
                            };

                            match deliver_result {
                                Ok(out) => {
                                    let type_ms = type_started.elapsed().as_secs_f64() * 1000.0;
                                    let total_ms = job_started.elapsed().as_secs_f64() * 1000.0;
                                    log_line(&format!(
                                        "delivered gen={} decode_ms={decode_ms:.1} type_ms={type_ms:.1} total_ms={total_ms:.1} text={:?}",
                                        job.generation, out
                                    ));
                                    // Always clear the pill when work is done (including refine
                                    // no-op). Never leave dictation=refining after paste.
                                    write_worker_status(
                                        "inactive",
                                        "",
                                        Some(&model_name),
                                        Some(&backend),
                                        None,
                                    );
                                }
                                Err(error) => {
                                    log_line(&format!("deliver error: {error}"));
                                    write_worker_status(
                                        "unavailable",
                                        &error,
                                        Some(&model_name),
                                        Some(&backend),
                                        None,
                                    );
                                }
                            }
                        }
                    }
                    Err(error) => {
                        log_line(&format!("stt error: {error}"));
                        eprintln!("dictation stt: {error}");
                        write_worker_status(
                            "unavailable",
                            &error,
                            Some(&model_name),
                            Some(&backend),
                            None,
                        );
                        thread::sleep(Duration::from_millis(200));
                    }
                }

                pipeline.in_flight.store(false, Ordering::SeqCst);
                if pipeline.pending_count() == 0 {
                    // Keep last detail briefly; don't wipe the typed message immediately.
                    thread::sleep(Duration::from_millis(800));
                    if pipeline.pending_count() == 0 {
                        // leave detail as-is if still the typed message; only clear stage
                        write_worker_status(
                            "inactive",
                            "",
                            Some(&model_name),
                            Some(&backend),
                            None,
                        );
                    }
                }
            }
        });
    }
}

pub fn prompt_boost_from_replacements(replacements: &HashMap<String, String>) -> Option<String> {
    if replacements.is_empty() {
        return None;
    }
    let mut terms: Vec<String> = replacements
        .iter()
        .flat_map(|(heard, written)| [heard.clone(), written.clone()])
        .collect();
    terms.sort();
    terms.dedup();
    let joined = terms.join(", ");
    if joined.is_empty() {
        None
    } else {
        Some(joined)
    }
}

pub fn replacements_from_prefs() -> HashMap<String, String> {
    let prefs = crate::config::voice_preferences();
    parse_dictation_replacements(&prefs.dictation_replacements)
}

/// Type one completed utterance. Returns the string that was inserted.
pub fn type_final_transcript(
    transcript: &str,
    replacements: &HashMap<String, String>,
) -> Result<String, String> {
    let clean = transcript.trim();
    if clean.is_empty() {
        return Ok(String::new());
    }
    let words: Vec<String> = clean.split_whitespace().map(str::to_string).collect();
    let projection =
        dictation_projection(&words, Some(&FormatState::default()), replacements, false);
    if projection.text.is_empty() {
        return Ok(String::new());
    }
    let mut out = projection.text;
    if projection.state.needs_space {
        out.push(' ');
    }
    type_text(&out)?;
    Ok(out)
}

/// True when projecting `transcript` with `replacements` yields the same caret string
/// as `previous` (exact raw-first paste including trailing space).
fn caret_projection_equals(
    previous: &str,
    transcript: &str,
    replacements: &HashMap<String, String>,
) -> bool {
    let clean = transcript.trim();
    if clean.is_empty() {
        return previous.is_empty();
    }
    let words: Vec<String> = clean.split_whitespace().map(str::to_string).collect();
    let projection =
        dictation_projection(&words, Some(&FormatState::default()), replacements, false);
    if projection.text.is_empty() {
        return previous.is_empty();
    }
    let mut out = projection.text;
    if projection.state.needs_space {
        out.push(' ');
    }
    previous == out
}

/// Deliver final text to the caret.
/// When `previous` is Some (raw-first path), backspace that exact string then paste
/// refined — never global ⌘A (blues WebGL terminals).
/// If `auto_submit`, press Enter after paste.
fn deliver_to_caret(
    transcript: &str,
    replacements: &HashMap<String, String>,
    previous: Option<&str>,
    auto_submit: bool,
) -> Result<String, String> {
    let clean = transcript.trim();
    if clean.is_empty() {
        return Ok(String::new());
    }
    let words: Vec<String> = clean.split_whitespace().map(str::to_string).collect();
    let projection =
        dictation_projection(&words, Some(&FormatState::default()), replacements, false);
    if projection.text.is_empty() {
        return Ok(String::new());
    }
    let mut out = projection.text;
    if projection.state.needs_space {
        out.push(' ');
    }
    if let Some(prev) = previous {
        if prev == out {
            // Refined equals what we already typed — leave it.
        } else {
            crate::typing::replace_previous_with(prev, &out)?;
        }
    } else {
        type_text(&out)?;
    }
    if auto_submit {
        crate::typing::press_enter()?;
        out.push_str(" [Enter]");
    }
    Ok(out)
}

fn log_line(line: &str) {
    let path = voice_state_home().join("dictation.log");
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let ts = crate::state::now_secs();
        let _ = writeln!(f, "{ts:.3} {line}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boost_includes_dictionary_terms() {
        let mut map = HashMap::new();
        map.insert("type script".into(), "TypeScript".into());
        map.insert("joseph".into(), "Yosef".into());
        let boost = prompt_boost_from_replacements(&map).unwrap();
        assert!(boost.contains("TypeScript"));
        assert!(boost.contains("Yosef"));
    }

    #[test]
    fn empty_replacements_no_boost() {
        assert!(prompt_boost_from_replacements(&HashMap::new()).is_none());
    }
}
