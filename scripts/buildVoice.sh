#!/usr/bin/env bash
# Build the speak-response native worker and place it beside the hook island.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VOICE_CRATE="$ROOT/src/hookIsland/speakResponse/voice"
OUT="$ROOT/src/hookIsland/speakResponse/dufflebag-voice"

export PATH="/opt/homebrew/bin:${PATH:-}"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required to build dufflebag-voice" >&2
  exit 1
fi

if ! command -v cmake >/dev/null 2>&1; then
  echo "cmake is required to build whisper.cpp (brew install cmake)" >&2
  exit 1
fi

cd "$VOICE_CRATE"
cargo build --release
cp -f "$VOICE_CRATE/target/release/dufflebag-voice" "$OUT"
chmod +x "$OUT"
echo "Built $OUT"
