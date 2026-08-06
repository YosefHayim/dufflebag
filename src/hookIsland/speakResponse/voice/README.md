# dufflebag-voice

Native local voice worker for the speak-response feature.

## What it is

- **STT:** whisper.cpp via `whisper-rs`, **Whisper large-v3-turbo** (default `q5_0`), Metal on Apple Silicon
- **TTS:** separate `narrate-daemon` process + warm `tts_bridge.py serve` (Supertonic)
- **UX:** hold Control to dictate; floating OSW-style pill with **live preview** caption
- **Devin:** `watch-devin --path <atif.json>` debounces and enqueues agent turns
- **Refine:** double-tap Control (when `promptRefinementMode=review`) or `refine --text …` via Apple Foundation Models

## Architecture (OpenSuperWhisper-shaped)

```
hold Control → primed mic (always open) → release → enqueue clip
                                                    ↓
                              serial offline STT queue → clean → type once
                                                    ↑
while holding: sliding-window live preview → HUD only (never types)

narrate-daemon (separate process): inbox → TTS
```

| Piece | Role |
| --- | --- |
| Primed mic | Device opened once at daemon start; Control only flips a buffer flag |
| Serial queue | Record never waits on Whisper; next hold can start while previous decodes |
| Dictionary boost | `dictationReplacements` terms feed Whisper `initial_prompt` |
| No-speech | Empty / `[MUSIC]` / tags never type |
| Live preview | Sliding-window Whisper caption for HUD (`DUFFLEBAG_LIVE_PREVIEW=0` to disable) |
| Process split | `daemon` = dictate; `narrate-daemon` = inbox/TTS |

## Build

Requires Rust, CMake, and Xcode CLT:

```bash
# from package root
./scripts/buildVoice.sh
```

Output: `src/hookIsland/speakResponse/dufflebag-voice` (gitignored; built during staging when missing).

## Model

`prepare` downloads Whisper weights into Application Support and warms Supertonic:

| `DUFFLEBAG_WHISPER_MODEL` | File | Notes |
| --- | --- | --- |
| `turbo-q5` (default) | `ggml-large-v3-turbo-q5_0.bin` | Best quality default (OSW turbo small) |
| `turbo-q8` | `ggml-large-v3-turbo-q8_0.bin` | |
| `turbo` | `ggml-large-v3-turbo.bin` | |
| `small` / `small.en` | `ggml-small.en.bin` | Faster short holds |
| `base` / `base.en` | `ggml-base.en.bin` | Faster still |
| `tiny` / `fast` | `ggml-tiny.en.bin` | Fastest English-only |

Same Hugging Face `ggerganov/whisper.cpp` sources as OpenSuperWhisper.

### Latency bench

Warm-model decode timing (no mic, no typing). Use this before changing languages or engines:

```bash
./scripts/buildVoice.sh
src/hookIsland/speakResponse/dufflebag-voice bench --models tiny,base,small,turbo-q5 --seconds 1,2,4 --runs 3
```

Live holds also log `decode_ms` / `type_ms` / `total_ms` to
`~/Library/Application Support/dufflebag/voice/dictation.log`.

The daemon loads the model **once** at start and reuses it for every utterance
(`start` while already running reuses the same pid).

### Measured on Apple M5 Max (Metal, 2026-08)

Warm decode on synthetic speech-like audio (not mic). Host language is not on this path.

| Model | Load once | Warm decode ~1s clip | Warm decode ~2s clip |
| --- | --- | --- | --- |
| `tiny.en` | ~180 ms | ~200–400 ms (first) | often VAD-empty on synth |
| `base.en` | ~60 ms | ~15–50 ms | ~17 ms |
| `small.en` | ~160 ms | ~30–60 ms | ~29 ms |
| `turbo-q5` (default) | ~150–380 ms | ~105–140 ms | ~100–340 ms |

Takeaway: default turbo is already **sub-second** on this machine. Faster English models help a bit; switching Rust→Swift does not move these numbers.

## Hybrid surface

| Path | Implementation |
| --- | --- |
| STT / hotkey / daemon / HUD / inbox / Devin | Rust binary |
| Supertonic synthesize + play (warm serve, streamed chunks) | `tts_bridge.py serve` |
| Apple prompt refinement | `prompt_refinement.py` |
| Cmux focus helper (optional) | `cmux_focus.py` |

Python is off the dictation hot path. Narration still shells to Supertonic for quality parity.
