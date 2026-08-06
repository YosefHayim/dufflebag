//! Primed microphone: stream stays open for the daemon lifetime.
//! Recording only flips a flag — no cold open on Control-down.
//!
//! `PrimedMic` owns the cpal Stream (!Send) and must live on one thread.
//! `SharedCapture` is Send/Sync so live-preview can read the buffer safely.

use crate::state::SAMPLE_RATE;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Shared buffer + recording flag (safe to clone across threads).
#[derive(Clone)]
pub struct SharedCapture {
    samples: Arc<Mutex<Vec<f32>>>,
    recording: Arc<AtomicBool>,
}

impl SharedCapture {
    pub fn begin_capture(&self) {
        self.samples.lock().clear();
        self.recording.store(true, Ordering::SeqCst);
    }

    pub fn end_capture(&self) -> Vec<f32> {
        self.recording.store(false, Ordering::SeqCst);
        std::mem::take(&mut *self.samples.lock())
    }

    pub fn cancel_capture(&self) {
        self.recording.store(false, Ordering::SeqCst);
        self.samples.lock().clear();
    }

    pub fn is_recording(&self) -> bool {
        self.recording.load(Ordering::SeqCst)
    }

    pub fn snapshot(&self) -> Vec<f32> {
        self.samples.lock().clone()
    }

    pub fn snapshot_tail(&self, seconds: f32) -> Vec<f32> {
        let max = ((SAMPLE_RATE as f32) * seconds.max(0.1)) as usize;
        let buf = self.samples.lock();
        if buf.len() <= max {
            buf.clone()
        } else {
            buf[buf.len() - max..].to_vec()
        }
    }
}

/// Long-lived capture. Hardware is opened once at daemon start (OSW prime pattern).
/// Not Send — keep on the capture thread.
pub struct PrimedMic {
    shared: SharedCapture,
    alive: Arc<AtomicBool>,
    _stream: cpal::Stream,
}

impl PrimedMic {
    /// Open default input and start streaming. Frames are discarded until `begin_capture`.
    pub fn prime() -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "no default input device".to_string())?;
        let config = device
            .default_input_config()
            .map_err(|e| format!("input config: {e}"))?;

        let samples = Arc::new(Mutex::new(Vec::with_capacity(SAMPLE_RATE as usize * 8)));
        let recording = Arc::new(AtomicBool::new(false));
        let alive = Arc::new(AtomicBool::new(true));
        let shared = SharedCapture {
            samples: samples.clone(),
            recording: recording.clone(),
        };
        let sample_format = config.sample_format();
        let stream_config: StreamConfig = config.clone().into();
        let channels = stream_config.channels as usize;
        let input_rate = stream_config.sample_rate.0;

        let stream = match sample_format {
            SampleFormat::F32 => build_f32_stream(
                &device,
                &stream_config,
                channels,
                input_rate,
                samples,
                recording,
                alive.clone(),
            )?,
            SampleFormat::I16 => build_i16_stream(
                &device,
                &stream_config,
                channels,
                input_rate,
                samples,
                recording,
                alive.clone(),
            )?,
            other => return Err(format!("unsupported sample format: {other:?}")),
        };
        stream.play().map_err(|e| format!("stream play: {e}"))?;
        Ok(Self {
            shared,
            alive,
            _stream: stream,
        })
    }

    pub fn shared(&self) -> SharedCapture {
        self.shared.clone()
    }

    pub fn begin_capture(&self) {
        self.shared.begin_capture();
    }

    pub fn end_capture(&self) -> Vec<f32> {
        self.shared.end_capture()
    }

    pub fn cancel_capture(&self) {
        self.shared.cancel_capture();
    }

    pub fn is_recording(&self) -> bool {
        self.shared.is_recording()
    }

    pub fn snapshot(&self) -> Vec<f32> {
        self.shared.snapshot()
    }
}

impl Drop for PrimedMic {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::SeqCst);
        self.shared.recording.store(false, Ordering::SeqCst);
    }
}

/// Legacy one-shot session (tests / CLI). Prefer `PrimedMic` in the daemon.
pub struct CaptureSession {
    mic: PrimedMic,
}

impl CaptureSession {
    pub fn start() -> Result<Self, String> {
        let mic = PrimedMic::prime()?;
        mic.begin_capture();
        Ok(Self { mic })
    }

    pub fn snapshot(&self) -> Vec<f32> {
        self.mic.snapshot()
    }

    pub fn stop(self) -> Vec<f32> {
        self.mic.end_capture()
    }
}

fn build_f32_stream(
    device: &cpal::Device,
    config: &StreamConfig,
    channels: usize,
    input_rate: u32,
    sink: Arc<Mutex<Vec<f32>>>,
    recording: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
) -> Result<cpal::Stream, String> {
    let err_fn = |err| eprintln!("audio input error: {err}");
    device
        .build_input_stream(
            config,
            move |data: &[f32], _| {
                if !alive.load(Ordering::Relaxed) || !recording.load(Ordering::Relaxed) {
                    return;
                }
                let mono = downsample_channels(data, channels);
                let resampled = resample_linear(&mono, input_rate, SAMPLE_RATE);
                sink.lock().extend_from_slice(&resampled);
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("build stream: {e}"))
}

fn build_i16_stream(
    device: &cpal::Device,
    config: &StreamConfig,
    channels: usize,
    input_rate: u32,
    sink: Arc<Mutex<Vec<f32>>>,
    recording: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
) -> Result<cpal::Stream, String> {
    let err_fn = |err| eprintln!("audio input error: {err}");
    device
        .build_input_stream(
            config,
            move |data: &[i16], _| {
                if !alive.load(Ordering::Relaxed) || !recording.load(Ordering::Relaxed) {
                    return;
                }
                let float: Vec<f32> = data.iter().map(|s| *s as f32 / i16::MAX as f32).collect();
                let mono = downsample_channels(&float, channels);
                let resampled = resample_linear(&mono, input_rate, SAMPLE_RATE);
                sink.lock().extend_from_slice(&resampled);
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("build stream: {e}"))
}

fn downsample_channels(data: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data.to_vec();
    }
    data.chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

fn resample_linear(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = to_rate as f64 / from_rate as f64;
    let out_len = ((input.len() as f64) * ratio).round().max(1.0) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 / ratio;
        let idx = src.floor() as usize;
        let frac = (src - idx as f64) as f32;
        let a = input[idx.min(input.len() - 1)];
        let b = input[(idx + 1).min(input.len() - 1)];
        out.push(a + (b - a) * frac);
    }
    out
}
