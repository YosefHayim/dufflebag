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
                            let type_started = Instant::now();
                            match type_final_transcript(&text, &job.replacements) {
                                Ok(out) => {
                                    let type_ms = type_started.elapsed().as_secs_f64() * 1000.0;
                                    let total_ms = job_started.elapsed().as_secs_f64() * 1000.0;
                                    log_line(&format!(
                                        "typed gen={} decode_ms={decode_ms:.1} type_ms={type_ms:.1} total_ms={total_ms:.1} text={:?}",
                                        job.generation, out
                                    ));
                                    write_worker_status(
                                        "inactive",
                                        &format!(
                                            "Typed in {total_ms:.0}ms (decode {decode_ms:.0}ms): {out}"
                                        ),
                                        Some(&model_name),
                                        Some(&backend),
                                        None,
                                    );
                                }
                                Err(error) => {
                                    log_line(&format!("type error: {error}"));
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
