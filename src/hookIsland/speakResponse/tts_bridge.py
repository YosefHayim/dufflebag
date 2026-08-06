#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "numpy==2.2.6; python_version < '3.11'",
#   "numpy==2.4.6; python_version == '3.11'",
#   "numpy==2.5.1; python_version >= '3.12'",
#   "sounddevice==0.5.5",
#   "supertonic==1.3.1",
# ]
# [tool.uv]
# exclude-newer = "2026-07-30T00:00:00Z"
# ///

"""Warm Supertonic TTS bridge for the Rust dufflebag-voice worker.

Modes:
  prepare — load models once and exit
  speak   — one-shot speak (legacy)
  serve   — long-lived JSON-line server (preferred): load once, stream chunks
"""

from __future__ import annotations

import argparse
import contextlib
import json
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any

_tts_engine: Any = None
_tts_style: Any = None
_tts_voice: str = ""
_stop_event = threading.Event()
# Prefer short chunks so the first audible words arrive sooner.
STREAM_CHUNK_CHARS = 280


def emit(event: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def chunk_speech(text: str, max_chars: int = STREAM_CHUNK_CHARS) -> list[str]:
    if max_chars < 1:
        raise ValueError("max_chars must be positive")
    chunks: list[str] = []
    remaining = text
    while len(remaining) > max_chars:
        window = remaining[: max_chars + 1]
        sentence_breaks = [match.end() for match in re.finditer(r"[.!?](?:\s|$)", window)]
        split_at = sentence_breaks[-1] if sentence_breaks else window.rfind(" ") + 1
        if split_at <= 0 or split_at > max_chars:
            split_at = max_chars
        chunks.append(remaining[:split_at])
        remaining = remaining[split_at:]
    if remaining:
        chunks.append(remaining)
    return chunks


def tts_runtime(voice: str) -> tuple[Any, Any]:
    global _tts_engine, _tts_style, _tts_voice
    voice_name = voice.upper() if re.fullmatch(r"[MF][1-5]", voice.upper() or "") else "F4"
    if _tts_engine is None:
        from supertonic import TTS

        _tts_engine = TTS(auto_download=True)
        _tts_style = _tts_engine.get_voice_style(voice_name=voice_name)
        _tts_voice = voice_name
    elif _tts_voice != voice_name:
        _tts_style = _tts_engine.get_voice_style(voice_name=voice_name)
        _tts_voice = voice_name
    return _tts_engine, _tts_style


def stop_requested(stop_file: str) -> bool:
    if _stop_event.is_set():
        return True
    return bool(stop_file) and Path(stop_file).exists()


def play_samples(samples: Any, sample_rate: int, stop_file: str) -> str:
    import sounddevice

    if getattr(samples, "size", 0) == 0:
        return "ok"
    duration = max(0.01, float(len(samples)) / float(sample_rate))
    duration = min(duration, 120.0)
    sounddevice.play(samples, sample_rate, blocking=False)
    started = time.monotonic()
    while time.monotonic() - started < duration:
        if stop_requested(stop_file):
            with contextlib.suppress(Exception):
                sounddevice.stop()
            return "stopped"
        time.sleep(0.03)
    try:
        sounddevice.wait(timeout=1.0)
    except TypeError:
        sounddevice.wait()
    except Exception:
        pass
    return "ok"


def speak(text: str, voice: str, speed: float, stop_file: str = "", *, stream_events: bool = False) -> str:
    import sounddevice

    clean = text.strip()
    if not clean:
        if stream_events:
            emit({"event": "done", "status": "completed"})
        return "completed"
    _stop_event.clear()
    engine, style = tts_runtime(voice)
    clamped = min(2.0, max(0.7, speed))
    pieces = [c.strip() for c in chunk_speech(clean) if c.strip()]
    total = len(pieces)
    for index, piece in enumerate(pieces):
        if stop_requested(stop_file):
            with contextlib.suppress(Exception):
                sounddevice.stop()
            if stream_events:
                emit({"event": "done", "status": "stopped"})
            return "stopped"
        if stream_events:
            emit({"event": "chunk", "i": index, "n": total})
        audio, _ = engine.synthesize(
            piece,
            voice_style=style,
            total_steps=8,
            speed=clamped,
            max_chunk_length=300,
            silence_duration=0.18,
            lang="en",
            verbose=False,
        )
        if stop_requested(stop_file):
            with contextlib.suppress(Exception):
                sounddevice.stop()
            if stream_events:
                emit({"event": "done", "status": "stopped"})
            return "stopped"
        samples = audio.squeeze()
        play_status = play_samples(samples, int(engine.sample_rate), stop_file)
        if play_status == "stopped":
            if stream_events:
                emit({"event": "done", "status": "stopped"})
            return "stopped"
    if stream_events:
        emit({"event": "done", "status": "completed"})
    return "completed"


def prepare(voice: str) -> dict[str, str]:
    tts_runtime(voice)
    return {
        "narration": "ready",
        "voice": voice.upper() if re.fullmatch(r"[MF][1-5]", voice.upper() or "") else "F4",
    }


def serve(default_voice: str) -> int:
    """Long-lived worker: load once, stream speech chunk-by-chunk."""
    try:
        prepare(default_voice)
    except Exception as error:
        emit({"event": "error", "message": str(error)})
        return 1
    emit(
        {
            "event": "ready",
            "voice": default_voice.upper() if re.fullmatch(r"[MF][1-5]", default_voice.upper() or "") else "F4",
        }
    )
    for stdin_line in sys.stdin:
        line = stdin_line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            emit({"event": "error", "message": "invalid json"})
            continue
        if not isinstance(message, dict):
            emit({"event": "error", "message": "expected object"})
            continue
        cmd = str(message.get("cmd", "")).strip().lower()
        if cmd == "quit":
            emit({"event": "bye"})
            return 0
        if cmd == "stop":
            _stop_event.set()
            with contextlib.suppress(Exception):
                import sounddevice

                sounddevice.stop()
            emit({"event": "done", "status": "stopped"})
            continue
        if cmd == "ping":
            emit({"event": "pong"})
            continue
        if cmd == "prepare":
            voice = str(message.get("voice", default_voice))
            try:
                report = prepare(voice)
                emit({"event": "ready", **report})
            except Exception as error:
                emit({"event": "error", "message": str(error)})
            continue
        if cmd == "speak":
            text = str(message.get("text", ""))
            voice = str(message.get("voice", default_voice))
            speed = float(message.get("speed", 1.15))
            try:
                speak(text, voice, speed, stop_file="", stream_events=True)
            except Exception as error:
                emit({"event": "error", "message": str(error)})
                emit({"event": "done", "status": "error"})
            continue
        emit({"event": "error", "message": f"unknown cmd: {cmd}"})
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Dufflebag Supertonic TTS bridge")
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_cmd = commands.add_parser("prepare")
    prepare_cmd.add_argument("--voice", default="F4")
    speak_cmd = commands.add_parser("speak")
    speak_cmd.add_argument("--text", default="")
    speak_cmd.add_argument("--text-stdin", action="store_true")
    speak_cmd.add_argument("--voice", default="F4")
    speak_cmd.add_argument("--speed", type=float, default=1.15)
    speak_cmd.add_argument("--stop-file", default="")
    serve_cmd = commands.add_parser("serve")
    serve_cmd.add_argument("--voice", default="F4")
    args = parser.parse_args()
    if args.command == "prepare":
        print(json.dumps(prepare(args.voice)), flush=True)
        return 0
    if args.command == "speak":
        try:
            text = sys.stdin.read() if args.text_stdin else args.text
            status = speak(text, args.voice, args.speed, args.stop_file)
            print(status, flush=True)
            return 0 if status in {"completed", "stopped"} else 1
        except Exception as error:
            print(str(error), file=sys.stderr)
            return 1
    if args.command == "serve":
        return serve(args.voice)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
