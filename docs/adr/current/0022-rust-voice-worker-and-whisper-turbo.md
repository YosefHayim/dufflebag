# 0022 — Rust voice worker and Whisper large-v3-turbo

- **Status:** Accepted (2026-08-04)
- **Scope:** `src/hookIsland/speakResponse/` voice runtime, catalog shipping, `dufflebag voice` CLI invocation
- **Supersedes:** the Python STT/TTS worker assumption in [0020 — Exact toolchain and Python style gate](0020-exact-toolchain-and-python-style-gate.md) for the speak-response hot path
- **Related:** [0001 — Zero-dependency hook payload](0001-zero-dependency-hook-payload.md), [0017 — Payload and runtime are separate trees](0017-payload-and-runtime-are-separate-trees.md)

## Context

Speak-response ran as a PEP 723 Python worker (`voice.py`) with
`faster-whisper` `small.en` on CPU. Quality lagged OpenSuperWhisper’s Whisper
path (whisper.cpp + large-v3-turbo, Metal on Apple Silicon). Process startup
also paid for `uv` and the Python runtime on every install path.

## Decision

**Ship a Rust binary (`dufflebag-voice`) as the speak-response worker; use
whisper.cpp via `whisper-rs` with Whisper large-v3-turbo weights (q5 default),
Metal on Apple Silicon.**

- TypeScript keeps install, receipts, catalog, and the fail-open Stop hook.
- The inbox JSON envelope and state-home layout stay stable.
- Optional thin Python remains only for Supertonic TTS (`tts_bridge.py`) and
  Apple Foundation Models prompt refinement (`prompt_refinement.py`).
- Model files download on `prepare` into Application Support (or
  `DUFFLEBAG_VOICE_HOME`), not into the git tree.
- Catalog ships the built binary plus bridge scripts (`tts_bridge.py`,
  `prompt_refinement.py`, `cmux_focus.py`) — not the retired monolithic
  `voice.py`.

## Consequences

- **+** Dictation quality and Apple Silicon speed track OpenSuperWhisper’s Whisper engine.
- **+** No Python on the STT / hotkey / daemon hot path.
- **+** One native binary is easier to start and reason about than a uv script graph.
- **−** Building voice requires a Rust toolchain and (on macOS) Xcode CLT for whisper.cpp Metal.
- **−** TTS may stay hybrid until a native engine matches Supertonic quality.
- **−** Packaging must stage a platform binary, not only TypeScript.
