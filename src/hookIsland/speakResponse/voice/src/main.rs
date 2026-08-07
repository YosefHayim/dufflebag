//! dufflebag-voice — local STT/TTS worker (Rust).
//! Dictate path: primed mic + serial STT queue. Narrate path: separate process.

mod audio;
mod bench;
mod cmux_deliver;
mod config;
mod daemon;
mod devin;
mod dictation_format;
mod hotkey;
mod inbox;
mod live_preview;
mod models;
mod narrate;
mod overlay;
mod pipeline;
mod refine;
mod speech_render;
mod state;
mod stt;
mod tts;
mod typing;

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "dufflebag-voice", about = "Dufflebag local voice worker")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Render Markdown as a speech document
    Render {
        #[arg(long)]
        text: String,
    },
    /// Play one complete narration through Supertonic (via tts_bridge.py)
    Speak {
        #[arg(long)]
        text: String,
        #[arg(long, default_value = "manual")]
        source: String,
    },
    /// Download and verify Whisper turbo + warm Supertonic
    Prepare,
    /// Start the local narration and dictation worker
    Start,
    /// Internal dictate daemon entry (hotkey + mic + STT queue)
    Daemon,
    /// Internal narrate daemon entry (inbox + TTS only)
    NarrateDaemon,
    /// Floating indicator process
    Overlay {
        #[arg(long)]
        worker_pid: u32,
    },
    /// Stop the local worker
    Stop,
    /// Kill every voice daemon/overlay/TTS process and clear locks (fresh slate)
    Reset,
    /// Print local worker status
    Status,
    /// Watch a Devin ATIF export for complete responses
    WatchDevin {
        #[arg(long)]
        path: PathBuf,
    },
    /// Refine a prompt (route-aware; multi-provider via prompt_refinement.py)
    Refine {
        #[arg(long)]
        text: String,
        #[arg(long, default_value_t = false)]
        speak: bool,
        /// Provider: codex|local|auto|grok|ollama|opencode|claude|gemini
        #[arg(long)]
        backend: Option<String>,
        /// Model id for the provider (e.g. gpt-5.3-codex-spark, grok-4.5, llama3.2)
        #[arg(long)]
        model: Option<String>,
        /// Reasoning effort for providers that support it (low|medium|high|…)
        #[arg(long)]
        reasoning_effort: Option<String>,
        /// caret | cmux-new | cmux-resume (default: bag config / caret)
        #[arg(long)]
        delivery: Option<String>,
        /// cmux-new shell template; {{prompt_file}} {{prompt}} {{cwd}}
        #[arg(long)]
        cmux_command: Option<String>,
        /// Send Enter after caret/cmux inject
        #[arg(long, default_value_t = false)]
        auto_submit: bool,
    },
    /// Debug: poll HID Control for N seconds (hold Control to verify detection)
    ControlCheck {
        #[arg(long, default_value_t = 8)]
        seconds: u64,
    },
    /// Offline latency bench: load + warm + decode timing across models
    Bench {
        /// Comma-separated model keys: tiny, base, small, turbo-q5 (default: all of those)
        #[arg(long, default_value = "tiny,base,small,turbo-q5")]
        models: String,
        /// Comma-separated clip lengths in seconds
        #[arg(long, default_value = "1,2,4")]
        seconds: String,
        /// Timed runs per clip after warm-up
        #[arg(long, default_value_t = 3)]
        runs: u32,
    },
}

fn main() {
    let cli = Cli::parse();
    let code = match cli.command {
        Commands::Render { text } => {
            println!("{}", speech_render::render_speech(&text));
            0
        }
        Commands::Speak { text, source: _ } => match tts::speak_markdown(&text) {
            Ok(status) => {
                if status != "completed" {
                    eprintln!("{status}");
                }
                0
            }
            Err(error) => {
                eprintln!("{error}");
                1
            }
        },
        Commands::Prepare => match prepare() {
            Ok(report) => {
                println!("{}", serde_json::to_string(&report).unwrap_or_default());
                0
            }
            Err(error) => {
                eprintln!("{error}");
                1
            }
        },
        Commands::Start => match daemon::start_worker_detached() {
            Ok(status) => {
                println!("{}", serde_json::to_string(&status).unwrap_or_default());
                0
            }
            Err(error) => {
                eprintln!("{error}");
                1
            }
        },
        Commands::Daemon => daemon::run_daemon(),
        Commands::NarrateDaemon => narrate::run_narrate_daemon(),
        Commands::Overlay { worker_pid } => overlay::run_overlay_process(worker_pid),
        Commands::Stop => {
            let status = daemon::stop_worker();
            println!("{}", serde_json::to_string(&status).unwrap_or_default());
            0
        }
        Commands::Reset => {
            let _ = tts::shutdown_warm();
            state::reset_voice_runtime();
            println!(
                "{}",
                serde_json::json!({
                    "dictation": "inactive",
                    "hotkey": state::HOTKEY_LABEL,
                    "running": false,
                    "reset": true,
                })
            );
            0
        }
        Commands::Status => {
            let status = state::WorkerStatus::snapshot();
            println!("{}", serde_json::to_string(&status).unwrap_or_default());
            0
        }
        Commands::WatchDevin { path } => devin::watch_devin(&path),
        Commands::Refine {
            text,
            speak,
            backend,
            model,
            reasoning_effort,
            delivery,
            cmux_command,
            auto_submit,
        } => match refine_prompt_cli(
            &text,
            speak,
            backend.as_deref(),
            model.as_deref(),
            reasoning_effort.as_deref(),
            delivery.as_deref(),
            cmux_command.as_deref(),
            auto_submit,
        ) {
            Ok(refined) => {
                println!("{refined}");
                0
            }
            Err(error) => {
                eprintln!("{error}");
                1
            }
        },
        Commands::ControlCheck { seconds } => {
            use std::io::Write;
            use std::time::{Duration, Instant};
            println!("Hold Control… (polling HID {seconds}s)");
            let deadline = Instant::now() + Duration::from_secs(seconds);
            let mut was = false;
            let mut saw = false;
            while Instant::now() < deadline {
                let down = hotkey::control_modifier_down();
                if down && !was {
                    println!("CONTROL DOWN");
                    saw = true;
                } else if !down && was {
                    println!("CONTROL UP");
                }
                was = down;
                let _ = std::io::stdout().flush();
                std::thread::sleep(Duration::from_millis(20));
            }
            if saw {
                println!("ok — Control detection works");
                0
            } else {
                eprintln!("no Control edge seen — try physical Control key");
                1
            }
        }
        Commands::Bench {
            models,
            seconds,
            runs,
        } => match run_bench_command(&models, &seconds, runs) {
            Ok(report) => {
                println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
                0
            }
            Err(error) => {
                eprintln!("{error}");
                1
            }
        },
    };
    std::process::exit(code);
}

fn run_bench_command(models: &str, seconds: &str, runs: u32) -> Result<serde_json::Value, String> {
    let keys: Vec<models::ModelKey> = models
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(models::ModelKey::parse)
        .collect();
    if keys.is_empty() {
        return Err("pass at least one --models key".into());
    }
    let audio_secs: Result<Vec<f32>, _> = seconds
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.parse::<f32>().map_err(|e| format!("bad --seconds value {s}: {e}")))
        .collect();
    let audio_secs = audio_secs?;
    if audio_secs.is_empty() {
        return Err("pass at least one --seconds value".into());
    }
    bench::run_bench(&keys, &audio_secs, runs)
}

fn prepare() -> Result<serde_json::Value, String> {
    let key = models::selected_model_key();
    let path = models::ensure_model(key)?;
    let engine = stt::SttEngine::load(&path)?;
    let mut report = serde_json::to_value(
        models::prepare_report(&path, models::whisper_backend_label())
            .with_model_name(engine.model_name()),
    )
    .unwrap_or_default();
    match tts::prepare_tts() {
        Ok(tts_report) => {
            if let Some(obj) = report.as_object_mut() {
                obj.insert("narration".into(), serde_json::json!("ready"));
                if let Some(voice) = tts_report.get("voice") {
                    obj.insert("tts_voice".into(), voice.clone());
                }
            }
        }
        Err(error) => {
            if let Some(obj) = report.as_object_mut() {
                obj.insert(
                    "narration".into(),
                    serde_json::json!(format!("unavailable: {error}")),
                );
            }
        }
    }
    Ok(report)
}

fn refine_prompt_cli(
    text: &str,
    speak: bool,
    backend: Option<&str>,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
    delivery: Option<&str>,
    cmux_command: Option<&str>,
    auto_submit: bool,
) -> Result<String, String> {
    let mut prefs = config::voice_preferences();
    let backend = backend.unwrap_or(prefs.prompt_refinement_backend.as_str());
    let model = model.unwrap_or(prefs.prompt_refinement_model.as_str());
    let effort =
        reasoning_effort.unwrap_or(prefs.prompt_refinement_reasoning_effort.as_str());
    let refined = refine::refine_prompt(text, backend, model, effort)?;
    if speak {
        let _ = tts::speak_markdown(&refined);
    }
    if let Some(delivery) = delivery {
        prefs.prompt_refinement_delivery = delivery.to_string();
    }
    if let Some(cmd) = cmux_command {
        prefs.prompt_refinement_cmux_command = cmd.to_string();
    }
    if auto_submit {
        prefs.prompt_refinement_cmux_auto_submit = true;
        prefs.prompt_refinement_auto_submit = true;
    }
    if cmux_deliver::is_cmux_delivery(&prefs.prompt_refinement_delivery) {
        match cmux_deliver::deliver_text(&refined, &prefs) {
            Ok(result) => eprintln!("delivery: {}", result.summary),
            Err(error) => eprintln!("delivery failed: {error}"),
        }
    }
    Ok(refined)
}
