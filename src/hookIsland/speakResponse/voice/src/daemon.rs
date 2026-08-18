//! Dictate worker: primed mic + hold Control + serial STT queue.
//! Narration runs in a separate process (`narrate-daemon`).

use crate::audio::PrimedMic;
use crate::config::voice_preferences;
use crate::hotkey::{
    control_hold_transition, control_modifier_down, HoldAction, HoldEvent, HoldState,
    CONTROL_DOUBLE_TAP_SECONDS, CONTROL_HOLD_SECONDS, CONTROL_POLL_MS,
};
use crate::live_preview::{self, LiveCaption};
use crate::models::{self, selected_model_key};
use crate::narrate;
use crate::overlay;
use crate::pipeline::{self, DictationJob, DictationPipeline};
use crate::state::{
    acquire_worker_pid, clear_stop_flag, ensure_state_home, reap_child_processes, release_worker_pid,
    reset_voice_runtime, stop_requested, worker_already_running, write_worker_status, WorkerStatus,
};
use crate::stt::SttEngine;
use crate::tts;
// release_control_keys is only used when inserting text (typing.rs), never while holding.
use parking_lot::Mutex;
use rdev::{listen, EventType, Key};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

struct SharedControl {
    hold: HoldState,
    hold_deadline: Option<Instant>,
    dictation_generation: u64,
    stop_request: Option<u64>,
    model_name: String,
    backend: String,
    /// True from begin_capture until clip is enqueued (mic owns audio).
    dictation_active: bool,
    last_tap_at: Option<Instant>,
}

pub fn run_daemon() -> i32 {
    if let Err(error) = ensure_state_home() {
        eprintln!("state home: {error}");
        return 1;
    }
    clear_stop_flag();
    let pid = std::process::id();
    match acquire_worker_pid(pid) {
        Ok(true) => {}
        Ok(false) => {
            return 0;
        }
        Err(error) => {
            eprintln!("pid lock: {error}");
            return 1;
        }
    }

    let key = selected_model_key();
    let model_path = match models::ensure_model(key) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("model: {error}");
            write_worker_status("unavailable", &error, None, None, None);
            release_worker_pid();
            return 1;
        }
    };
    // Load once per daemon lifetime — hold-to-talk never reloads weights.
    let load_started = Instant::now();
    let engine = match SttEngine::load(&model_path) {
        Ok(engine) => Arc::new(engine),
        Err(error) => {
            eprintln!("stt load: {error}");
            write_worker_status("unavailable", &error, None, None, None);
            release_worker_pid();
            return 1;
        }
    };
    let load_ms = load_started.elapsed().as_secs_f64() * 1000.0;
    eprintln!(
        "dufflebag-voice daemon pid={pid} model={} load_ms={load_ms:.0} (warm; not per utterance)",
        key.filename()
    );
    let backend = models::whisper_backend_label().to_string();
    let model_name = engine.model_name().to_string();
    write_worker_status(
        "inactive",
        &format!("Ready (model load {load_ms:.0}ms once)"),
        Some(&model_name),
        Some(&backend),
        None,
    );

    overlay::kill_existing_overlay();
    spawn_overlay(pid);

    // Narration is a sibling process — not on this critical path.
    if let Err(error) = narrate::start_narrate_detached() {
        eprintln!("narrate start: {error}");
    }

    // Warm STT only (TTS warms inside narrate-daemon).
    {
        let engine = engine.clone();
        thread::spawn(move || {
            engine.warmup();
        });
    }

    // Serial offline queue (OSW DictationPipeline).
    let pipeline = DictationPipeline::new();
    pipeline.spawn_worker(engine.clone(), model_name.clone(), backend.clone());

    let recording_flag = Arc::new(AtomicBool::new(false));
    let live_caption = LiveCaption::new();

    let control = Arc::new(Mutex::new(SharedControl {
        hold: HoldState::Idle,
        hold_deadline: None,
        dictation_generation: 0,
        stop_request: None,
        model_name: model_name.clone(),
        backend: backend.clone(),
        dictation_active: false,
        last_tap_at: None,
    }));
    let start_flag = Arc::new(AtomicBool::new(false));
    let prepare_flag = Arc::new(AtomicBool::new(false));
    let cancel_prepare = Arc::new(AtomicBool::new(false));
    let running = Arc::new(AtomicBool::new(true));

    // Capture control loop: prime mic here (Stream !Send), flip buffer + enqueue only.
    {
        let control = control.clone();
        let start_flag = start_flag.clone();
        let prepare_flag = prepare_flag.clone();
        let cancel_prepare = cancel_prepare.clone();
        let running = running.clone();
        let pipeline = pipeline.clone();
        let recording_flag = recording_flag.clone();
        let live_caption = live_caption.clone();
        let engine_preview = engine.clone();
        let model_name_c = model_name.clone();
        let backend_c = backend.clone();
        thread::spawn(move || {
            // Prime mic once on this thread — Control never pays device-open latency.
            let mic = match PrimedMic::prime() {
                Ok(m) => m,
                Err(error) => {
                    eprintln!("mic prime: {error}");
                    write_worker_status(
                        "unavailable",
                        &error,
                        Some(&model_name_c),
                        Some(&backend_c),
                        None,
                    );
                    return;
                }
            };
            // Live preview reads SharedCapture (Send); Stream stays here.
            live_preview::spawn_preview_loop(
                mic.shared(),
                recording_flag.clone(),
                engine_preview,
                live_caption.clone(),
                model_name_c.clone(),
                backend_c.clone(),
                running.clone(),
            );

            while running.load(Ordering::SeqCst) {
                if stop_requested() {
                    running.store(false, Ordering::SeqCst);
                    break;
                }

                {
                    let mut state = control.lock();
                    if let Some(deadline) = state.hold_deadline {
                        if Instant::now() >= deadline && state.hold == HoldState::Waiting {
                            let (next, action) = control_hold_transition(
                                state.hold,
                                HoldEvent::HoldElapsed,
                                false,
                            );
                            state.hold = next;
                            state.hold_deadline = None;
                            if action == HoldAction::Start {
                                start_flag.store(true, Ordering::SeqCst);
                            }
                        }
                    }
                }

                // Control-down: soft-stop TTS if any, begin buffer.
                // NEVER inject Control key-up here — that made the poller see a
                // fake release → Tap → HUD "Connecting…" then vanish, and enigo
                // key events can glitch system audio under other music apps.
                if prepare_flag.swap(false, Ordering::SeqCst) {
                    cancel_prepare.store(false, Ordering::SeqCst);
                    if tts::narration_busy() {
                        let _ = tts::cancel_narration();
                    }
                    let (model, backend_s) = {
                        let mut state = control.lock();
                        state.dictation_active = true;
                        (state.model_name.clone(), state.backend.clone())
                    };
                    if !mic.is_recording() {
                        mic.begin_capture();
                        recording_flag.store(true, Ordering::SeqCst);
                        live_caption.clear();
                    }
                    if cancel_prepare.load(Ordering::SeqCst) {
                        mic.cancel_capture();
                        recording_flag.store(false, Ordering::SeqCst);
                        control.lock().dictation_active = false;
                        write_worker_status("inactive", "", Some(&model), Some(&backend_s), None);
                    } else if start_flag.load(Ordering::SeqCst) {
                        start_flag.store(false, Ordering::SeqCst);
                        write_worker_status(
                            "listening",
                            "Recording",
                            Some(&model),
                            Some(&backend_s),
                            None,
                        );
                    }
                }

                if start_flag.swap(false, Ordering::SeqCst) {
                    let (model, backend_s) = {
                        let mut state = control.lock();
                        state.dictation_active = true;
                        (state.model_name.clone(), state.backend.clone())
                    };
                    if !mic.is_recording() {
                        if tts::narration_busy() {
                            let _ = tts::cancel_narration();
                        }
                        mic.begin_capture();
                        recording_flag.store(true, Ordering::SeqCst);
                        live_caption.clear();
                    }
                    write_worker_status(
                        "listening",
                        "Recording",
                        Some(&model),
                        Some(&backend_s),
                        None,
                    );
                }

                // Tap (not hold): cancel prepare, drop buffer.
                if cancel_prepare.swap(false, Ordering::SeqCst) {
                    let (model, backend_s) = {
                        let state = control.lock();
                        (state.model_name.clone(), state.backend.clone())
                    };
                    mic.cancel_capture();
                    recording_flag.store(false, Ordering::SeqCst);
                    live_caption.clear();
                    control.lock().dictation_active = false;
                    write_worker_status("inactive", "", Some(&model), Some(&backend_s), None);
                }

                // Release: grace → freeze samples → enqueue (never block on STT).
                let stop_gen = control.lock().stop_request.take();
                if let Some(generation) = stop_gen {
                    let (model, backend_s) = {
                        let state = control.lock();
                        (state.model_name.clone(), state.backend.clone())
                    };
                    // Wait briefly for prepare thread to open the buffer if needed.
                    for _ in 0..30 {
                        if mic.is_recording() || cancel_prepare.load(Ordering::SeqCst) {
                            break;
                        }
                        // Kick prepare if Control-down hasn't been processed yet.
                        if !prepare_flag.load(Ordering::SeqCst) && !mic.is_recording() {
                            // Capture may still be priming from Schedule — wait.
                        }
                        thread::sleep(Duration::from_millis(5));
                    }
                    // Release tail: keep capturing after Control-up so the last word is not clipped.
                    let grace_ms = voice_preferences().dictation_mic_off_delay_ms;
                    if grace_ms > 0 {
                        thread::sleep(Duration::from_millis(grace_ms));
                    }
                    recording_flag.store(false, Ordering::SeqCst);
                    // Prefer capturing whatever is buffered; generation mismatch only
                    // discards when a *newer* session already replaced this one.
                    let current_gen = control.lock().dictation_generation;
                    let still_current = current_gen == generation;
                    if still_current && mic.is_recording() {
                        let samples = mic.end_capture();
                        let fallback = live_caption.take();
                        let replacements = pipeline::replacements_from_prefs();
                        write_worker_status(
                            "finishing",
                            &format!("{} samples", samples.len()),
                            Some(&model),
                            Some(&backend_s),
                            None,
                        );
                        if samples.is_empty() && fallback.is_empty() {
                            write_worker_status(
                                "inactive",
                                "No audio captured",
                                Some(&model),
                                Some(&backend_s),
                                None,
                            );
                        } else {
                            pipeline.enqueue(DictationJob {
                                samples,
                                replacements,
                                streamed_fallback: fallback,
                                generation,
                            });
                        }
                    } else if still_current {
                        // Never started recording — surface why nothing typed.
                        mic.cancel_capture();
                        live_caption.clear();
                        write_worker_status(
                            "inactive",
                            "Mic did not start — try hold longer",
                            Some(&model),
                            Some(&backend_s),
                            None,
                        );
                    } else {
                        mic.cancel_capture();
                        live_caption.clear();
                    }
                    control.lock().dictation_active = false;
                }

                thread::sleep(Duration::from_millis(5));
            }
            pipeline.stop();
        });
    }

    // Primary Control path: poll HID modifier flags (works without Input Monitoring).
    // rdev CGEventTap often never delivers pure Control on macOS when TCC isn't granted
    // to this exact binary path — that left status stuck on "inactive" and no HUD.
    {
        let control = control.clone();
        let start_flag = start_flag.clone();
        let prepare_flag = prepare_flag.clone();
        let cancel_prepare = cancel_prepare.clone();
        let running = running.clone();
        thread::spawn(move || {
            let mut was_down = false;
            // Debounce both edges so brief HID glitches (or other apps probing
            // modifiers) don't cancel a real hold mid-recording.
            let mut down_streak = 0u8;
            let mut up_streak = 0u8;
            while running.load(Ordering::SeqCst) {
                if stop_requested() {
                    break;
                }
                let down = control_modifier_down();
                if down {
                    down_streak = down_streak.saturating_add(1);
                    up_streak = 0;
                } else {
                    up_streak = up_streak.saturating_add(1);
                    down_streak = 0;
                }
                // ~16ms down to start, ~32ms up to end (survives one-frame blips).
                if down_streak >= 2 && !was_down {
                    apply_hold(
                        &control,
                        &start_flag,
                        &prepare_flag,
                        &cancel_prepare,
                        HoldEvent::ControlDown,
                    );
                    was_down = true;
                } else if up_streak >= 4 && was_down {
                    apply_hold(
                        &control,
                        &start_flag,
                        &prepare_flag,
                        &cancel_prepare,
                        HoldEvent::ControlUp,
                    );
                    was_down = false;
                }
                thread::sleep(Duration::from_millis(CONTROL_POLL_MS));
            }
        });
    }

    // Optional: rdev for "other key while waiting" cancel (⌘C etc.). Best-effort;
    // if the tap has no permission, Control still works via the poller above.
    let control_keys = control.clone();
    let start_flag_keys = start_flag.clone();
    let prepare_flag_keys = prepare_flag.clone();
    let cancel_prepare_keys = cancel_prepare.clone();
    let running_keys = running.clone();
    thread::spawn(move || {
        let callback = move |event: rdev::Event| {
            if !running_keys.load(Ordering::SeqCst) {
                return;
            }
            if let EventType::KeyPress(key) = event.event_type {
                // Ignore Control — poller owns those edges (avoids double-fire).
                if matches!(key, Key::ControlLeft | Key::ControlRight) {
                    return;
                }
                apply_hold(
                    &control_keys,
                    &start_flag_keys,
                    &prepare_flag_keys,
                    &cancel_prepare_keys,
                    HoldEvent::OtherDown,
                );
            }
        };
        if let Err(error) = listen(callback) {
            eprintln!("rdev listen (optional): {error:?}");
        }
    });

    // Block until stop requested (daemon used to block on listen runloop).
    while running.load(Ordering::SeqCst) && !stop_requested() {
        // Reap overlay/narrate children so SIGKILL'd wrappers do not linger as
        // zombies that still pass kill(pid, 0) and block HUD respawn.
        reap_child_processes();
        thread::sleep(Duration::from_millis(100));
    }
    running.store(false, Ordering::SeqCst);
    pipeline.stop();
    overlay::kill_existing_overlay();
    release_worker_pid();
    0
}

fn apply_hold(
    control: &Arc<Mutex<SharedControl>>,
    start_flag: &Arc<AtomicBool>,
    prepare_flag: &Arc<AtomicBool>,
    cancel_prepare: &Arc<AtomicBool>,
    event: HoldEvent,
) {
    let action = {
        let mut state = control.lock();
        let (next, action) = control_hold_transition(state.hold, event, false);
        state.hold = next;
        match action {
            HoldAction::Schedule => {
                state.hold_deadline =
                    Some(Instant::now() + Duration::from_secs_f64(CONTROL_HOLD_SECONDS));
            }
            HoldAction::Cancel | HoldAction::Tap => {
                state.hold_deadline = None;
            }
            HoldAction::Start => {
                state.hold_deadline = None;
            }
            HoldAction::Stop => {
                state.stop_request = Some(state.dictation_generation);
            }
            HoldAction::None => {}
        }
        action
    };
    match action {
        HoldAction::Schedule => {
            // Bump generation here (single source of truth) so Stop always matches.
            {
                let mut state = control.lock();
                state.dictation_generation = state.dictation_generation.wrapping_add(1);
                state.dictation_active = true;
            }
            prepare_flag.store(true, Ordering::SeqCst);
            let (model, backend) = {
                let state = control.lock();
                (state.model_name.clone(), state.backend.clone())
            };
            write_worker_status("starting", "Control held", Some(&model), Some(&backend), None);
        }
        HoldAction::Start => {
            start_flag.store(true, Ordering::SeqCst);
            let (model, backend) = {
                let state = control.lock();
                (state.model_name.clone(), state.backend.clone())
            };
            write_worker_status("listening", "Recording", Some(&model), Some(&backend), None);
        }
        HoldAction::Cancel | HoldAction::Tap => {
            cancel_prepare.store(true, Ordering::SeqCst);
            if action == HoldAction::Tap {
                handle_control_tap(control);
            }
        }
        HoldAction::Stop => {
            let (model, backend) = {
                let state = control.lock();
                (state.model_name.clone(), state.backend.clone())
            };
            write_worker_status("finishing", "Decoding…", Some(&model), Some(&backend), None);
        }
        _ => {}
    }
}

fn handle_control_tap(control: &Arc<Mutex<SharedControl>>) {
    let now = Instant::now();
    let is_double = {
        let mut state = control.lock();
        if let Some(last) = state.last_tap_at {
            if now.duration_since(last).as_secs_f64() <= CONTROL_DOUBLE_TAP_SECONDS {
                state.last_tap_at = None;
                true
            } else {
                state.last_tap_at = Some(now);
                false
            }
        } else {
            state.last_tap_at = Some(now);
            false
        }
    };

    if is_double {
        let was_speaking = tts::hard_cancel_narration();
        if was_speaking {
            let (model, backend) = {
                let state = control.lock();
                (state.model_name.clone(), state.backend.clone())
            };
            write_worker_status(
                "inactive",
                "Narration stopped",
                Some(&model),
                Some(&backend),
                None,
            );
            return;
        }
        let prefs = voice_preferences();
        if prefs.review_refine_enabled() {
            thread::spawn(|| {
                if let Err(error) = refine_clipboard_prompt() {
                    eprintln!("prompt refine: {error}");
                }
            });
            return;
        }
        let muted = crate::state::toggle_narration_muted();
        let (model, backend) = {
            let state = control.lock();
            (state.model_name.clone(), state.backend.clone())
        };
        write_worker_status(
            "inactive",
            if muted {
                "Narration muted (double-tap Control to unmute)"
            } else {
                "Narration unmuted"
            },
            Some(&model),
            Some(&backend),
            None,
        );
        return;
    }

    if tts::cancel_narration() {
        let (model, backend) = {
            let state = control.lock();
            (state.model_name.clone(), state.backend.clone())
        };
        write_worker_status(
            "inactive",
            "Narration stopped",
            Some(&model),
            Some(&backend),
            None,
        );
    }
}

fn refine_clipboard_prompt() -> Result<(), String> {
    let prefs = voice_preferences();
    write_refinement_status(
        "refining",
        &format!(
            "Refining copied prompt ({}/{})…",
            prefs.prompt_refinement_backend, prefs.prompt_refinement_model
        ),
        0.0,
    );
    let original = macos_clipboard_text()?;
    let refined = crate::refine::refine_with_prefs(&original, &prefs)?;
    write_macos_clipboard(&refined)?;
    write_refinement_status(
        "ready",
        "Refined prompt copied — press ⌘V to paste",
        10.0,
    );
    // Speak via narrate path if available (one-shot speak is fine).
    let _ = tts::speak_markdown(&refined);
    Ok(())
}

fn write_refinement_status(stage: &str, message: &str, lifetime: f64) {
    let value = serde_json::json!({
        "stage": stage,
        "message": message,
        "lifetime": lifetime,
        "updated_at": crate::state::now_secs(),
    });
    let _ = crate::state::atomic_json(
        &crate::state::voice_state_home().join("refinement.json"),
        &value,
    );
}

fn macos_clipboard_text() -> Result<String, String> {
    let output = Command::new("pbpaste")
        .output()
        .map_err(|e| format!("pbpaste: {e}"))?;
    if !output.status.success() {
        return Err("pbpaste failed".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn write_macos_clipboard(text: &str) -> Result<(), String> {
    use std::io::Write;
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

fn spawn_overlay(worker_pid: u32) {
    if let Ok(exe) = std::env::current_exe() {
        let mut command = Command::new(&exe);
        command
            .args(["overlay", "--worker-pid", &worker_pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        // Own process group so kill(-overlay.pid) reaps the Swift HUD child.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let _ = command.spawn();
    }
}

pub fn start_worker_detached() -> Result<serde_json::Value, String> {
    ensure_state_home().map_err(|e| e.to_string())?;
    if worker_already_running() {
        // Keep a healthy overlay. Only rebuild when the wrapper is gone; always
        // reap orphaned swift-frontend pills left by older kills.
        crate::state::kill_stray_overlay_huds();
        let overlay_alive = crate::state::read_overlay_pid()
            .is_some_and(|pid| crate::state::process_running(Some(pid)));
        if !overlay_alive {
            overlay::kill_existing_overlay();
            if let Some(pid) = crate::state::read_pid() {
                spawn_overlay(pid);
            }
        }
        // Ensure narrate is up even if only dictate was left.
        let _ = narrate::start_narrate_detached();
        return Ok(serde_json::to_value(WorkerStatus::snapshot()).unwrap_or_default());
    }
    reset_voice_runtime();
    clear_stop_flag();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut command = Command::new(&exe);
    command
        .arg("daemon")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let _child = command.spawn().map_err(|e| format!("spawn daemon: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        let status = WorkerStatus::snapshot();
        if status.running {
            // Give narrate-daemon a moment to claim its pid (spawned by dictate).
            let narrate_deadline = Instant::now() + Duration::from_secs(8);
            while Instant::now() < narrate_deadline {
                if narrate::narrate_already_running() {
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
            if !narrate::narrate_already_running() {
                let _ = narrate::start_narrate_detached();
            }
            return Ok(serde_json::to_value(status).unwrap_or_default());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("Voice worker did not start".into())
}

pub fn stop_worker() -> serde_json::Value {
    tts::kill_tts_process();
    crate::state::request_stop();
    narrate::stop_narrate();
    if let Some(pid) = crate::state::read_pid() {
        let deadline = Instant::now() + Duration::from_secs(4);
        while crate::state::process_running(Some(pid)) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        if crate::state::process_running(Some(pid)) {
            #[cfg(unix)]
            unsafe {
                let _ = libc_kill(pid as i32, 15);
            }
            thread::sleep(Duration::from_millis(100));
            if crate::state::process_running(Some(pid)) {
                #[cfg(unix)]
                unsafe {
                    let _ = libc_kill(pid as i32, 9);
                }
            }
        }
    }
    overlay::kill_existing_overlay();
    reset_voice_runtime();
    serde_json::json!({
        "dictation": "inactive",
        "hotkey": crate::state::HOTKEY_LABEL,
        "running": false,
    })
}

#[cfg(unix)]
unsafe fn libc_kill(pid: i32, sig: i32) -> i32 {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    kill(pid, sig)
}
