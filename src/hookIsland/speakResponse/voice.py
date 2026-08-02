#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "apple-fm-sdk==0.2.1; sys_platform == 'darwin'",
#   "faster-whisper==1.2.1",
#   "num2words==0.5.14",
#   "numpy==2.2.6; python_version < '3.11'",
#   "numpy==2.4.6; python_version == '3.11'",
#   "numpy==2.5.1; python_version >= '3.12'",
#   "pynput==1.8.2",
#   "sounddevice==0.5.5",
#   "supertonic==1.3.1",
# ]
# [tool.uv]
# exclude-newer = "2026-07-30T00:00:00Z"
# ///

"""Local narration and dictation worker for Dufflebag's speak-response feature."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from contextlib import suppress
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

from cmux_focus import (
    CMUX_BUNDLE_IDENTIFIER,
    cached_cmux_identify,
    frontmost_bundle_identifier,
)
from prompt_refinement import (
    refine_prompt,
    refinement_availability,
)

LANGUAGE_NAMES = {
    "bash": "Bash",
    "css": "CSS",
    "html": "HTML",
    "js": "JavaScript",
    "javascript": "JavaScript",
    "json": "JSON",
    "jsx": "JSX",
    "md": "Markdown",
    "py": "Python",
    "python": "Python",
    "sh": "Shell",
    "sql": "SQL",
    "ts": "TypeScript",
    "tsx": "TSX",
    "yaml": "YAML",
    "yml": "YAML",
}

UNIT_WORDS = {
    "B": ("byte", "bytes"),
    "GB": ("gigabyte", "gigabytes"),
    "Gi": ("gibibyte", "gibibytes"),
    "GiB": ("gibibyte", "gibibytes"),
    "h": ("hour", "hours"),
    "KB": ("kilobyte", "kilobytes"),
    "Ki": ("kibibyte", "kibibytes"),
    "KiB": ("kibibyte", "kibibytes"),
    "MB": ("megabyte", "megabytes"),
    "Mi": ("mebibyte", "mebibytes"),
    "MiB": ("mebibyte", "mebibytes"),
    "min": ("minute", "minutes"),
    "ms": ("millisecond", "milliseconds"),
    "s": ("second", "seconds"),
    "TB": ("terabyte", "terabytes"),
    "Ti": ("tebibyte", "tebibytes"),
    "TiB": ("tebibyte", "tebibytes"),
}

DEVELOPER_TERMS = {
    "ENOSPC": "E N O S P C, meaning no space left on device,",
    "tsx": "T S X",
}

NUMBER_PATTERN = r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
UNIT_PATTERN = "|".join(re.escape(unit) for unit in sorted(UNIT_WORDS, key=len, reverse=True))
PROTECTED_SPAN_PATTERN = re.compile(
    r"https?://[^\s<>()]+"
    r"|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}"
    r"|(?<!\w)v?\d+(?:\.\d+){2,}(?:[-+][A-Za-z0-9.-]+)?"
    r"|(?<!\w)(?:\.{0,2}/)[^\s,;:!?]+"
    r"|(?<!\w)(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+"
    r"|\b(?=[A-Fa-f0-9]{7,}\b)(?=[A-Fa-f0-9]*[A-Fa-f])[A-Fa-f0-9]+\b"
)

CONTROL_HOLD_SECONDS = 0.12
CONTROL_DOUBLE_TAP_SECONDS = 0.45
DICTATION_RELEASE_GRACE_SECONDS = 0.3
DICTATION_LIVE_TAIL_WORDS = 4
DICTATION_PULSE_SECONDS = 0.5
DICTATION_SAMPLE_RATE = 16_000
DICTATION_UPDATE_SECONDS = 0.5
STT_MODEL = "small.en"
HOTKEY_LABEL = "hold-control"
PENDING_NARRATION_TTL_SECONDS = 60 * 60
SEEN_NARRATION_TTL_SECONDS = 24 * 60 * 60
CONTROL_HOLD_TRANSITIONS = {
    ("idle", "control_down"): ("waiting", "schedule"),
    ("waiting", "control_up"): ("idle", "tap"),
    ("waiting", "other_down"): ("shortcut", "cancel"),
    ("waiting", "hold_elapsed"): ("listening", "start"),
    ("shortcut", "control_up"): ("idle", "none"),
    ("listening", "control_up"): ("idle", "stop"),
}

DICTATION_COMMANDS = [
    (("exclamation", "mark"), ("punctuation", "!")),
    (("exclamation", "point"), ("punctuation", "!")),
    (("next", "bullet", "point"), ("bullet", "")),
    (("new", "bullet", "point"), ("bullet", "")),
    (("numbered", "list"), ("numbered_list", "")),
    (("new", "paragraph"), ("new_paragraph", "")),
    (("question", "mark"), ("punctuation", "?")),
    (("bullet", "list"), ("bullet", "")),
    (("bullet", "point"), ("bullet", "")),
    (("next", "bullet"), ("bullet", "")),
    (("new", "bullet"), ("bullet", "")),
    (("next", "item"), ("next_item", "")),
    (("next", "line"), ("new_line", "")),
    (("full", "stop"), ("punctuation", ".")),
    (("new", "line"), ("new_line", "")),
    (("semicolon",), ("punctuation", ";")),
    (("newline",), ("new_line", "")),
    (("period",), ("punctuation", ".")),
    (("comma",), ("punctuation", ",")),
    (("colon",), ("punctuation", ":")),
    (("bullet",), ("bullet", "")),
    (("dot",), ("punctuation", ".")),
]

_tts_engine: Any = None
_tts_style: Any = None
_stt_engine: Any = None
_audio_lock = threading.Lock()
_audio: dict[str, Any] = {"generation": 0, "state": "idle"}
_dictation_lock = threading.Lock()
_dictation_audio_lock = threading.Lock()
_dictation_control_lock = threading.Lock()
_dictation_inference_lock = threading.Lock()
_dictation_start_lock = threading.Lock()
_stt_engine_lock = threading.Lock()
_dictation: dict[str, Any] = {
    "active": False,
    "audio_chunks": [],
    "audio_generation": 0,
    "capture": None,
    "controller": None,
    "format_state": None,
    "hypotheses": deque(maxlen=3),
    "line_start_state": None,
    "line_typed_text": "",
    "replacements": {},
    "request_generation": 0,
    "requested": False,
    "stage": "inactive",
    "typed_words": [],
}
_control_hold_lock = threading.Lock()
_control_hold: dict[str, Any] = {
    "key": None,
    "last_tap_at": 0.0,
    "state": "idle",
    "timer": None,
}
_prompt_refinement_lock = threading.Lock()


def control_hold_transition(state: str, event: str, injected: bool = False) -> dict[str, str]:
    if injected:
        return {"action": "none", "state": state}
    next_state, action = CONTROL_HOLD_TRANSITIONS.get((state, event), (state, "none"))
    return {"action": action, "state": next_state}


def sentence(text: str) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean or clean.endswith((".", "!", "?", ":", ";")):
        return clean
    return f"{clean}."


def number_words(numeric_text: str, *, ordinal: bool = False) -> str:
    try:
        from num2words import num2words

        compact = numeric_text.replace(",", "")
        mode = "ordinal" if ordinal else "cardinal"
        rendered = str(num2words(compact, lang="en", to=mode)).replace(",", "")
        rendered = re.sub(r"\band\s+", "", rendered)
        return f"plus {rendered}" if numeric_text.startswith("+") else rendered
    except (ArithmeticError, ImportError, NotImplementedError, TypeError, ValueError):
        return numeric_text


def preserve_span(value: str, spans: dict[str, str]) -> str:
    marker = f"\ue000{'x' * (len(spans) + 1)}\ue001"
    spans[marker] = value
    return marker


def protect_spans(text: str, spans: dict[str, str]) -> str:
    return PROTECTED_SPAN_PATTERN.sub(lambda match: preserve_span(match.group(0), spans), text)


def restore_spans(text: str, spans: dict[str, str]) -> str:
    restored = text
    # Restore every protected literal after all prose-only rules finish.
    for marker, value in spans.items():
        restored = restored.replace(marker, value)
    return restored


def currency_words(currency_text: str) -> str:
    value = Decimal(currency_text.replace(",", "")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    prefix = "minus " if value < 0 else ""
    absolute = abs(value)
    dollars = int(absolute)
    cents = int((absolute - dollars) * 100)
    dollar_unit = "dollar" if dollars == 1 else "dollars"
    spoken = f"{prefix}{number_words(str(dollars))} {dollar_unit}"
    if cents == 0:
        return spoken
    cent_unit = "cent" if cents == 1 else "cents"
    return f"{spoken} and {number_words(str(cents))} {cent_unit}"


def normalize_spoken_prose(text: str, spans: dict[str, str] | None = None) -> str:
    protected = {} if spans is None else spans

    def currency(match: re.Match[str]) -> str:
        try:
            return currency_words(match.group("number"))
        except (ArithmeticError, TypeError, ValueError):
            return match.group(0)

    def ordinal(match: re.Match[str]) -> str:
        return number_words(match.group("number"), ordinal=True)

    def quantity(match: re.Match[str]) -> str:
        matched_number_text = match.group("number")
        try:
            singular, plural = UNIT_WORDS[match.group("unit")]
            unit = singular if abs(Decimal(matched_number_text.replace(",", ""))) == 1 else plural
            return f"{number_words(matched_number_text)} {unit}"
        except (ArithmeticError, KeyError, TypeError, ValueError):
            return match.group(0)

    def percentage(match: re.Match[str]) -> str:
        return f"{number_words(match.group('number'))} percent"

    def standalone_number(match: re.Match[str]) -> str:
        return number_words(match.group("number"))

    clean = protect_spans(text, protected)
    # Expand exact developer tokens before the generic acronym rule.
    for term, pronunciation in DEVELOPER_TERMS.items():
        clean = re.sub(rf"(?<!\w){re.escape(term)}(?!\w)", pronunciation, clean)
    clean = re.sub(
        rf"(?<![\w.])\$(?P<number>{NUMBER_PATTERN})(?!\w|\.\d)",
        currency,
        clean,
    )
    clean = re.sub(
        r"(?<![\w.])(?P<number>\d{1,3}(?:,\d{3})+|\d+)(?:st|nd|rd|th)\b",
        ordinal,
        clean,
    )
    clean = re.sub(
        rf"(?<![\w.])(?P<number>{NUMBER_PATTERN})\s*(?P<unit>{UNIT_PATTERN})(?!\w)",
        quantity,
        clean,
    )
    clean = re.sub(
        rf"(?<![\w.])(?P<number>{NUMBER_PATTERN})\s*%(?!\w)",
        percentage,
        clean,
    )
    clean = re.sub(
        rf"(?<![\w.])(?P<number>{NUMBER_PATTERN})(?!\w|\.\d)",
        standalone_number,
        clean,
    )
    clean = re.sub(
        r"(?<!\w)([A-Z][A-Z0-9]{1,})(?!\w)",
        lambda match: " ".join(match.group(1)),
        clean,
    )
    return restore_spans(clean, protected)


def inline_speech(text: str) -> str:
    spans: dict[str, str] = {}

    def image(match: re.Match[str]) -> str:
        alt = match.group(1).strip() or "image"
        source = preserve_span(match.group(2).strip(), spans)
        return f"Image: {alt}. Source {source}"

    def link(match: re.Match[str]) -> str:
        label = match.group(1).strip()
        address = preserve_span(match.group(2).strip(), spans)
        return f"{label}, link {address}"

    clean = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", image, text)
    clean = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, clean)
    clean = re.sub(
        r"<(https?://[^>]+)>",
        lambda match: f"link {preserve_span(match.group(1), spans)}",
        clean,
    )
    clean = re.sub(r"`([^`]*)`", lambda match: preserve_span(match.group(1), spans), clean)
    clean = re.sub(r"<[^>]+>", " ", clean)
    clean = re.sub(r"(?<!\\)[*_~]", "", clean)
    clean = re.sub(r"\\([\\`*{}\[\]()#+.!_|>-])", r"\1", clean)
    clean = re.sub(r"(?<!\w)#([0-9]+)\b", r"number \1", clean)
    return normalize_spoken_prose(re.sub(r"\s+", " ", clean).strip(), spans)


def code_speech(text: str) -> str:
    replacements = [
        ("===", " strictly equals "),
        ("!==", " does not strictly equal "),
        ("=>", " arrow "),
        ("==", " equals "),
        ("!=", " does not equal "),
        (">=", " greater than or equal to "),
        ("<=", " less than or equal to "),
        ("&&", " and "),
        ("||", " or "),
        ("=", " equals "),
        (";", " semicolon "),
        ("{", " open brace "),
        ("}", " close brace "),
        ("[", " open bracket "),
        ("]", " close bracket "),
    ]
    clean = text.strip()
    # Speak operators as words while leaving identifiers and values intact.
    for symbol, spoken in replacements:
        clean = clean.replace(symbol, spoken)
    return sentence(clean)


def split_table_row(line: str) -> list[str]:
    row_text = line.strip()
    if row_text.startswith("|"):
        row_text = row_text[1:]
    if row_text.endswith("|") and not row_text.endswith("\\|"):
        row_text = row_text[:-1]

    cells: list[str] = []
    current: list[str] = []
    escaped = False
    # Split only unescaped pipes so cell content is never silently discarded.
    for character in row_text:
        if escaped:
            current.append(character)
            escaped = False
            continue
        if character == "\\":
            escaped = True
            current.append(character)
            continue
        if character == "|":
            cells.append(inline_speech("".join(current).strip()))
            current = []
            continue
        current.append(character)
    cells.append(inline_speech("".join(current).strip()))
    return cells


def is_table_separator(line: str) -> bool:
    cells = split_table_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) is not None for cell in cells)


def table_speech(lines: list[str], start: int) -> tuple[list[str], int] | None:
    if start + 1 >= len(lines) or "|" not in lines[start] or not is_table_separator(lines[start + 1]):
        return None

    headers = split_table_row(lines[start])
    spoken = [sentence(f"Table with columns {' and '.join(headers)}")]
    index = start + 2
    row_number = 1
    # Consume contiguous table rows and name every cell by its header.
    while index < len(lines) and lines[index].strip() and "|" in lines[index]:
        cells = split_table_row(lines[index])
        values = [
            f"{headers[cell_index] if cell_index < len(headers) else f'Column {cell_index + 1}'}: {value}"
            for cell_index, value in enumerate(cells)
        ]
        spoken.append(sentence(f"Row {row_number}. {'. '.join(values)}"))
        row_number += 1
        index += 1
    return spoken, index


def render_speech(markdown: str) -> str:
    lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    spoken: list[str] = []
    index = 0
    in_code = False

    # Preserve source order while translating each Markdown block into speech.
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        fence = re.match(r"^\s*```\s*([^\s`]*)", line)
        if fence is not None:
            if in_code:
                spoken.append("End code block.")
                in_code = False
            else:
                language = LANGUAGE_NAMES.get(fence.group(1).lower(), fence.group(1) or "code")
                spoken.append(sentence(f"Code block, {language}"))
                in_code = True
            index += 1
            continue

        if in_code:
            if stripped:
                spoken.append(code_speech(line))
            else:
                spoken.append("Blank line.")
            index += 1
            continue

        table = table_speech(lines, index)
        if table is not None:
            table_lines, index = table
            spoken.extend(table_lines)
            continue

        if not stripped or re.fullmatch(r"\s*([-*_])(?:\s*\1){2,}\s*", line):
            index += 1
            continue

        heading = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", line)
        if heading is not None:
            spoken.append(sentence(inline_speech(heading.group(1))))
            index += 1
            continue

        unordered = re.match(r"^\s*[-+*]\s+(.+)$", line)
        if unordered is not None:
            spoken.append(sentence(inline_speech(unordered.group(1))))
            index += 1
            continue

        ordered = re.match(r"^\s*([0-9]+)[.)]\s+(.+)$", line)
        if ordered is not None:
            spoken.append(sentence(f"{ordered.group(1)}. {inline_speech(ordered.group(2))}"))
            index += 1
            continue

        quote = re.match(r"^\s*>\s?(.*)$", line)
        if quote is not None:
            spoken.append(sentence(f"Quote. {inline_speech(quote.group(1))}"))
            index += 1
            continue

        clean = sentence(inline_speech(line))
        if clean:
            spoken.append(clean)
        index += 1

    if in_code:
        spoken.append("End code block.")
    return "\n".join(spoken)


def stable_words(hypotheses: list[str]) -> list[str]:
    if len(hypotheses) < 3:
        return []
    word_sets = [hypothesis.split() for hypothesis in hypotheses[-3:]]
    stable: list[str] = []
    # Stop at the first word that any of the three latest hypotheses changes.
    common_word_count = min(len(words) for words in word_sets)
    for word_index in range(common_word_count):
        values = [words[word_index] for words in word_sets]
        if len(set(values)) != 1:
            break
        stable.append(values[0])
    return stable


def remaining_text(typed_words: list[str], completed_text: str) -> str:
    completed_words = completed_text.split()
    typed_count = min(len(typed_words), len(completed_words))
    # A late transcription revision may differ, but never duplicate words that
    # were already committed to the active caret.
    return " ".join(completed_words[typed_count:])


def initial_dictation_format_state() -> dict[str, Any]:
    return {
        "at_line_start": True,
        "capitalize_next": True,
        "has_output": False,
        "needs_space": False,
        "numbered_next": 0,
    }


def canonical_dictation_word(word: str) -> str:
    return re.sub(r"^\W+|\W+$", "", word, flags=re.UNICODE).casefold()


def replacement_phrases(replacements: dict[str, str] | None) -> list[tuple[tuple[str, ...], str]]:
    phrases: list[tuple[tuple[str, ...], str]] = []
    for heard, written in (replacements or {}).items():
        if not isinstance(heard, str) or not isinstance(written, str):
            continue
        phrase = tuple(canonical_dictation_word(word) for word in heard.split())
        phrase = tuple(word for word in phrase if word)
        if phrase and written.strip():
            phrases.append((phrase, written.strip()))
    return sorted(phrases, key=lambda item: len(item[0]), reverse=True)


def matching_dictation_phrase(
    canonical_words: list[str],
    index: int,
    phrases: list[tuple[tuple[str, ...], Any]],
) -> tuple[tuple[str, ...], Any] | None:
    for phrase, value in phrases:
        if canonical_words[index : index + len(phrase)] == list(phrase):
            return phrase, value
    return None


def capitalize_dictation_text(text: str) -> str:
    return re.sub(r"^([^A-Za-z]*)([a-z])", lambda match: f"{match.group(1)}{match.group(2).upper()}", text, count=1)


def append_dictation_text(parts: list[str], state: dict[str, Any], text: str) -> None:
    rendered = capitalize_dictation_text(text) if state["capitalize_next"] else text
    if state["needs_space"]:
        parts.append(" ")
    parts.append(rendered)
    state["at_line_start"] = False
    state["capitalize_next"] = re.search(r"[.!?][\"']?$", rendered) is not None
    state["has_output"] = True
    state["needs_space"] = True


def append_dictation_command(parts: list[str], state: dict[str, Any], command: tuple[str, str]) -> None:
    action, value = command
    if action == "punctuation":
        parts.append(value)
        state["at_line_start"] = False
        state["capitalize_next"] = value in {".", "!", "?"}
        state["has_output"] = True
        state["needs_space"] = True
        return
    if action in {"new_line", "new_paragraph"}:
        parts.append("\n\n" if action == "new_paragraph" else "\n")
        state["at_line_start"] = True
        state["capitalize_next"] = True
        state["has_output"] = True
        state["needs_space"] = False
        return
    if state["has_output"] and not state["at_line_start"]:
        parts.append("\n")
    if action == "bullet":
        parts.append("- ")
        state["numbered_next"] = 0
    else:
        number = 1 if action == "numbered_list" or state["numbered_next"] < 1 else state["numbered_next"]
        parts.append(f"{number}. ")
        state["numbered_next"] = number + 1
    state["at_line_start"] = False
    state["capitalize_next"] = True
    state["has_output"] = True
    state["needs_space"] = False


def dictation_projection(
    words: list[str],
    state: dict[str, Any] | None = None,
    replacements: dict[str, str] | None = None,
    live: bool = False,
) -> dict[str, Any]:
    next_state = dict(state or initial_dictation_format_state())
    canonical_words = [canonical_dictation_word(word) for word in words]
    replacement_options = replacement_phrases(replacements)
    command_options: list[tuple[tuple[str, ...], Any]] = DICTATION_COMMANDS
    commit_limit = max(0, len(words) - DICTATION_LIVE_TAIL_WORDS) if live else len(words)
    parts: list[str] = []
    index = 0
    while index < commit_limit:
        if canonical_words[index] == "literal" and index + 1 < len(words):
            literal_match = matching_dictation_phrase(canonical_words, index + 1, command_options + replacement_options)
            literal_length = len(literal_match[0]) if literal_match is not None else 1
            literal_end = index + 1 + literal_length
            if literal_end > commit_limit:
                break
            append_dictation_text(parts, next_state, " ".join(words[index + 1 : literal_end]))
            index = literal_end
            continue

        command_match = matching_dictation_phrase(canonical_words, index, command_options)
        if command_match is not None:
            command_end = index + len(command_match[0])
            if command_end > commit_limit:
                break
            append_dictation_command(parts, next_state, command_match[1])
            index = command_end
            continue

        replacement_match = matching_dictation_phrase(canonical_words, index, replacement_options)
        if replacement_match is not None:
            replacement_end = index + len(replacement_match[0])
            if replacement_end > commit_limit:
                break
            append_dictation_text(parts, next_state, replacement_match[1])
            index = replacement_end
            continue

        append_dictation_text(parts, next_state, words[index])
        index += 1
    return {"consumed": index, "state": next_state, "text": "".join(parts)}


def format_dictation(text: str, replacements: dict[str, str] | None = None) -> str:
    return dictation_projection(text.split(), replacements=replacements)["text"]


def select_devin_narration(document: Any) -> dict[str, str]:
    if not isinstance(document, dict) or not isinstance(document.get("steps"), list):
        return {"markdown": "", "turn_id": ""}
    steps = document["steps"]
    last_user_index = -1
    # A Devin export may contain many turns; only the latest user turn is current.
    for index, step in enumerate(steps):
        if isinstance(step, dict) and step.get("source") == "user":
            last_user_index = index

    messages: list[str] = []
    turn_id = ""
    # Preserve every visible agent message emitted after that user turn.
    for step in steps[last_user_index + 1 :]:
        if not isinstance(step, dict) or step.get("source") != "agent" or not isinstance(step.get("message"), str):
            continue
        message = step["message"].strip()
        if not message:
            continue
        messages.append(message)
        if isinstance(step.get("step_id"), str):
            turn_id = step["step_id"]
    return {"markdown": "\n\n".join(messages), "turn_id": turn_id}


def chunk_speech(text: str, max_chars: int = 800) -> list[str]:
    if max_chars < 1:
        raise ValueError("max_chars must be positive")
    chunks: list[str] = []
    remaining = text
    # Keep every character while preferring a sentence or whitespace boundary.
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


def voice_state_home() -> Path:
    override = os.environ.get("DUFFLEBAG_VOICE_HOME", "").strip()
    if override:
        return Path(override).expanduser()
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        return base / "dufflebag" / "voice"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "dufflebag" / "voice"
    base = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state"))
    return base / "dufflebag" / "voice"


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)


def read_pid(state_home: Path | None = None) -> int | None:
    pid_path = (state_home or voice_state_home()) / "worker.pid"
    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip())
    except (FileNotFoundError, OSError, ValueError):
        return None
    return pid if pid > 0 else None


def process_running(pid: int | None) -> bool:
    if pid is None:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def worker_status(state_home: Path | None = None) -> dict[str, Any]:
    home = state_home or voice_state_home()
    running = process_running(read_pid(home))
    status = {"dictation": "inactive", "hotkey": HOTKEY_LABEL, "running": running}
    status_path = home / "status.json"
    if not running or not status_path.exists():
        return status
    try:
        saved = json.loads(status_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return status
    if isinstance(saved, dict) and saved.get("dictation") in {
        "active",
        "finishing",
        "inactive",
        "listening",
        "starting",
        "unavailable",
    }:
        status["dictation"] = saved["dictation"]
    if isinstance(saved, dict) and isinstance(saved.get("detail"), str) and saved["detail"]:
        status["detail"] = saved["detail"]
    return status


def voice_status_report() -> dict[str, Any]:
    status = worker_status()
    preferences = voice_preferences()
    status.update(
        {
            "prompt_refinement": preferences["prompt_refinement"],
            "read_along": preferences["read_along"],
            "narration_mode": preferences["narration_mode"],
        }
    )
    if preferences["prompt_refinement"] == "review":
        available, reason = refinement_availability()
        status["prompt_refinement_available"] = available
        if reason:
            status["prompt_refinement_detail"] = reason
    return status


def write_worker_status(dictation: str, detail: str = "") -> None:
    value: dict[str, Any] = {
        "dictation": dictation,
        "hotkey": HOTKEY_LABEL,
        "running": True,
    }
    if detail:
        value["detail"] = detail
    atomic_json(voice_state_home() / "status.json", value)


def set_dictation_stage(stage: str, detail: str = "") -> None:
    _dictation["stage"] = stage
    write_worker_status(stage, detail)


def dictation_indicator(stage: str, frame: int = 0) -> dict[str, Any]:
    labels = {
        "starting": "Starting microphone…",
        "listening": "Listening…",
        "finishing": "Finishing…",
    }
    label = labels.get(stage, "")
    if not label:
        return {"color": "#64748b", "label": "", "pulse": "", "visible": False}
    colors = {
        "starting": "#fbbf24",
        "listening": "#34d399" if frame % 2 == 0 else "#86efac",
        "finishing": "#60a5fa",
    }
    return {
        "color": colors[stage],
        "kind": "dictation",
        "label": label,
        "pulse": "●" if frame % 2 == 0 else "◉",
        "visible": True,
    }


def read_along_frame(text: str, elapsed: float, duration: float, max_words: int = 15) -> dict[str, Any]:
    matches = list(re.finditer(r"\S+", text))
    if not matches or duration <= 0:
        return {"active_length": 0, "active_start": 0, "text": "", "visible": False}
    weights = [
        max(1.0, len(re.sub(r"\W", "", match.group(0))) ** 0.6)
        + (0.8 if match.group(0).endswith((".", "!", "?", ":", ";")) else 0.0)
        for match in matches
    ]
    target = min(0.999_999, max(0.0, elapsed / duration)) * sum(weights)
    active_index = 0
    consumed = 0.0
    for index, weight in enumerate(weights):
        active_index = index
        consumed += weight
        if consumed > target:
            break

    radius = max(1, max_words // 2)
    start_index = max(0, active_index - radius)
    end_index = min(len(matches), start_index + max_words)
    start_index = max(0, end_index - max_words)
    selected = [match.group(0) for match in matches[start_index:end_index]]
    relative_index = active_index - start_index
    rendered = " ".join(selected)
    active_start = sum(len(word) + 1 for word in selected[:relative_index])
    return {
        "active_length": len(selected[relative_index]),
        "active_start": active_start,
        "text": rendered,
        "visible": True,
    }


def read_along_indicator(now: float | None = None) -> dict[str, Any]:
    document = read_json_file(voice_state_home() / "read-along.json")
    if not isinstance(document, dict):
        return {"active_length": 0, "active_start": 0, "text": "", "visible": False}
    text = document.get("text")
    started_at = document.get("started_at")
    duration = document.get("duration")
    if not isinstance(text, str) or not isinstance(started_at, (int, float)) or not isinstance(duration, (int, float)):
        return {"active_length": 0, "active_start": 0, "text": "", "visible": False}
    current_time = time.time() if now is None else now
    return {"kind": "read-along", **read_along_frame(text, current_time - started_at, duration)}


def refinement_indicator(now: float | None = None) -> dict[str, Any]:
    document = read_json_file(voice_state_home() / "refinement.json")
    if not isinstance(document, dict) or not isinstance(document.get("message"), str):
        return {"visible": False}
    current_time = time.time() if now is None else now
    expires_at = document.get("expires_at")
    if isinstance(expires_at, (int, float)) and current_time >= float(expires_at):
        (voice_state_home() / "refinement.json").unlink(missing_ok=True)
        return {"visible": False}
    stage = document.get("stage")
    colors = {"error": "#f87171", "ready": "#34d399", "refining": "#c084fc"}
    return {
        "color": colors.get(stage, "#cbd5e1"),
        "kind": "refinement",
        "label": document["message"],
        "pulse": "✦",
        "visible": True,
    }


def create_macos_dictation_overlay() -> dict[str, Any]:
    from AppKit import (
        NSApplication,
        NSApplicationActivationPolicyAccessory,
        NSBackingStoreBuffered,
        NSColor,
        NSFloatingWindowLevel,
        NSFont,
        NSMakeRect,
        NSPanel,
        NSScreen,
        NSTextAlignmentCenter,
        NSTextField,
        NSWindowCollectionBehaviorCanJoinAllSpaces,
        NSWindowCollectionBehaviorFullScreenAuxiliary,
        NSWindowStyleMaskBorderless,
        NSWindowStyleMaskNonactivatingPanel,
    )
    from Foundation import NSRunLoop

    class DictationPanel(NSPanel):
        def canBecomeKeyWindow(self) -> bool:
            return False

        def canBecomeMainWindow(self) -> bool:
            return False

    application = NSApplication.sharedApplication()
    application.setActivationPolicy_(NSApplicationActivationPolicyAccessory)
    application.finishLaunching()
    screen = NSScreen.mainScreen().visibleFrame()
    width = min(760, max(320, screen.size.width - 96))
    height = 68
    x = screen.origin.x + max(0, (screen.size.width - width) / 2)
    y = screen.origin.y + 72
    panel = DictationPanel.alloc().initWithContentRect_styleMask_backing_defer_(
        NSMakeRect(x, y, width, height),
        NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel,
        NSBackingStoreBuffered,
        False,
    )
    panel.setLevel_(NSFloatingWindowLevel)
    panel.setOpaque_(False)
    panel.setBackgroundColor_(NSColor.colorWithSRGBRed_green_blue_alpha_(17 / 255, 24 / 255, 39 / 255, 1))
    panel.setAlphaValue_(0.94)
    panel.setHasShadow_(True)
    panel.setHidesOnDeactivate_(False)
    panel.setIgnoresMouseEvents_(True)
    panel.setCollectionBehavior_(
        NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary
    )
    label = NSTextField.labelWithString_("")
    label.setFrame_(NSMakeRect(0, 0, width, height))
    label.setAlignment_(NSTextAlignmentCenter)
    label.setFont_(NSFont.boldSystemFontOfSize_(14))
    label.setTextColor_(NSColor.colorWithSRGBRed_green_blue_alpha_(248 / 255, 250 / 255, 252 / 255, 1))
    panel.contentView().addSubview_(label)
    return {
        "application": application,
        "backend": "appkit",
        "frame": 0,
        "label": label,
        "last_pulse_at": time.monotonic(),
        "mode": "hidden",
        "panel": panel,
        "rendered_indicator": None,
        "run_loop": NSRunLoop.currentRunLoop(),
        "visible": False,
    }


def create_tk_dictation_overlay() -> dict[str, Any] | None:
    try:
        import tkinter

        root = tkinter.Tk(className="DufflebagVoice")
        root.withdraw()
        root.overrideredirect(True)
        root.attributes("-topmost", True)
        with suppress(tkinter.TclError):
            root.attributes("-alpha", 0.94)
        width = min(760, max(320, root.winfo_screenwidth() - 96))
        height = 68
        x = max(0, (root.winfo_screenwidth() - width) // 2)
        y = max(0, root.winfo_screenheight() - height - 72)
        root.geometry(f"{width}x{height}+{x}+{y}")
        root.configure(background="#111827")
        label = tkinter.Label(
            root,
            background="#111827",
            font=("TkDefaultFont", 14, "bold"),
            foreground="#f8fafc",
            padx=16,
            pady=12,
        )
        label.pack(fill="both", expand=True)
        return {
            "frame": 0,
            "label": label,
            "last_pulse_at": time.monotonic(),
            "mode": "hidden",
            "rendered_indicator": None,
            "root": root,
            "visible": False,
        }
    except Exception:
        return None


def create_dictation_overlay() -> dict[str, Any] | None:
    if sys.platform == "darwin":
        try:
            return create_macos_dictation_overlay()
        except Exception:
            return None
    return create_tk_dictation_overlay()


def update_dictation_overlay(overlay: dict[str, Any] | None) -> None:
    if overlay is None or overlay.get("disabled"):
        return
    try:
        now = time.monotonic()
        if now - float(overlay["last_pulse_at"]) >= DICTATION_PULSE_SECONDS:
            overlay["frame"] = int(overlay["frame"]) + 1
            overlay["last_pulse_at"] = now
        indicator = dictation_indicator(str(_dictation.get("stage", "inactive")), int(overlay["frame"]))
        if not indicator["visible"]:
            indicator = read_along_indicator()
        if not indicator["visible"]:
            indicator = refinement_indicator()
        rendered_indicator = tuple(sorted(indicator.items()))
        indicator_changed = rendered_indicator != overlay["rendered_indicator"]
        if overlay.get("backend") == "appkit":
            from AppKit import (
                NSBackgroundColorAttributeName,
                NSColor,
                NSFont,
                NSFontAttributeName,
                NSForegroundColorAttributeName,
            )
            from Foundation import NSDate, NSMakeRange, NSMutableAttributedString

            panel = overlay["panel"]
            if indicator["visible"] and indicator_changed:
                if indicator.get("kind") == "read-along":
                    rendered = str(indicator["text"])
                    attributed = NSMutableAttributedString.alloc().initWithString_(rendered)
                    full_range = NSMakeRange(0, len(rendered.encode("utf-16-le")) // 2)
                    attributed.addAttribute_value_range_(
                        NSForegroundColorAttributeName,
                        NSColor.colorWithSRGBRed_green_blue_alpha_(226 / 255, 232 / 255, 240 / 255, 1),
                        full_range,
                    )
                    attributed.addAttribute_value_range_(NSFontAttributeName, NSFont.systemFontOfSize_(17), full_range)
                    active_start = int(indicator["active_start"])
                    active_end = active_start + int(indicator["active_length"])
                    active_range = NSMakeRange(
                        len(rendered[:active_start].encode("utf-16-le")) // 2,
                        len(rendered[active_start:active_end].encode("utf-16-le")) // 2,
                    )
                    attributed.addAttribute_value_range_(
                        NSBackgroundColorAttributeName,
                        NSColor.colorWithSRGBRed_green_blue_alpha_(3 / 255, 105 / 255, 161 / 255, 1),
                        active_range,
                    )
                    attributed.addAttribute_value_range_(
                        NSForegroundColorAttributeName,
                        NSColor.colorWithSRGBRed_green_blue_alpha_(1, 1, 1, 1),
                        active_range,
                    )
                    overlay["label"].setAttributedStringValue_(attributed)
                    overlay["mode"] = "read-along"
                else:
                    color = indicator["color"].lstrip("#")
                    overlay["label"].setTextColor_(
                        NSColor.colorWithSRGBRed_green_blue_alpha_(
                            int(color[0:2], 16) / 255,
                            int(color[2:4], 16) / 255,
                            int(color[4:6], 16) / 255,
                            1,
                        )
                    )
                    overlay["label"].setFont_(NSFont.boldSystemFontOfSize_(14))
                    overlay["label"].setStringValue_(f"{indicator['pulse']}  {indicator['label']}")
                    overlay["mode"] = "dictation"
                if not overlay["visible"]:
                    panel.orderFrontRegardless()
                    overlay["visible"] = True
                panel.displayIfNeeded()
            elif not indicator["visible"] and overlay["visible"]:
                panel.orderOut_(None)
                overlay["visible"] = False
            overlay["rendered_indicator"] = rendered_indicator
            overlay["application"].updateWindows()
            overlay["run_loop"].runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.001))
            return
        root = overlay["root"]
        if indicator["visible"] and indicator_changed:
            overlay["label"].configure(
                background="#0369a1" if indicator.get("kind") == "read-along" else "#111827",
                foreground="#ffffff" if indicator.get("kind") == "read-along" else indicator["color"],
                text=(
                    str(indicator["text"])
                    if indicator.get("kind") == "read-along"
                    else f"{indicator['pulse']}  {indicator['label']}"
                ),
            )
            if not overlay["visible"]:
                root.deiconify()
                root.lift()
                overlay["visible"] = True
        elif not indicator["visible"] and overlay["visible"]:
            root.withdraw()
            overlay["visible"] = False
        overlay["rendered_indicator"] = rendered_indicator
        root.update_idletasks()
        root.update()
    except Exception:
        overlay["disabled"] = True
        try:
            if overlay.get("backend") == "appkit":
                overlay["panel"].close()
            else:
                overlay["root"].destroy()
        except Exception:
            pass


def close_dictation_overlay(overlay: dict[str, Any] | None) -> None:
    if overlay is None or overlay.get("disabled"):
        return
    try:
        if overlay.get("backend") == "appkit":
            overlay["panel"].orderOut_(None)
            overlay["panel"].close()
            return
        overlay["root"].destroy()
    except Exception:
        pass


def run_dictation_overlay(worker_pid: int) -> int:
    overlay = create_dictation_overlay()
    try:
        while process_running(worker_pid):
            _dictation["stage"] = worker_status()["dictation"]
            update_dictation_overlay(overlay)
            time.sleep(0.05)
    finally:
        close_dictation_overlay(overlay)
    return 0


def start_dictation_overlay_process() -> Any:
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "overlay",
        "--worker-pid",
        str(os.getpid()),
    ]
    options: dict[str, Any] = {
        "cwd": str(Path(__file__).resolve().parent),
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        options["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        return subprocess.Popen(command, **options)
    except OSError:
        return None


def stop_dictation_overlay_process(process: Any) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2)


def acquire_worker_pid() -> bool:
    home = voice_state_home()
    home.mkdir(parents=True, exist_ok=True)
    pid_path = home / "worker.pid"
    current = read_pid(home)
    if process_running(current):
        return False
    try:
        pid_path.unlink(missing_ok=True)
        descriptor = os.open(pid_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        return False
    with os.fdopen(descriptor, "w", encoding="utf-8") as pid_file:
        pid_file.write(str(os.getpid()))
    return True


def installed_config() -> dict[str, Any]:
    script = Path(__file__).resolve()
    candidates = [script.parents[2] / "config.json"] if len(script.parents) > 2 else []
    # Read only the bag-owned config adjacent to an installed runtime.
    for candidate in candidates:
        try:
            value = json.loads(candidate.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            continue
        if isinstance(value, dict):
            return value
    return {}


def voice_preferences(config: dict[str, Any] | None = None) -> dict[str, Any]:
    values = installed_config() if config is None else config
    narration_mode = values.get("speechResponseMode", "auto")
    if narration_mode not in {"auto", "focused", "immediate", "off"}:
        narration_mode = "auto"
    refinement_mode = values.get("promptRefinementMode", "off")
    if refinement_mode not in {"off", "review"}:
        refinement_mode = "off"
    return {
        "prompt_refinement": refinement_mode,
        "read_along": values.get("speechReadAlong", True) is not False,
        "narration_mode": narration_mode,
    }


def envelope_eligible(
    envelope: dict[str, Any],
    *,
    focused_context: dict[str, Any] | None = None,
    frontmost_bundle: str | None = None,
    preferences: dict[str, Any] | None = None,
) -> bool:
    settings = voice_preferences() if preferences is None else preferences
    mode = settings["narration_mode"]
    if mode == "off":
        return False
    origin = envelope.get("origin")
    if not isinstance(origin, dict) or origin.get("kind") != "cmux" or mode == "immediate":
        return True
    focused = focused_context
    if focused is None:
        focused = cached_cmux_identify(str(origin.get("socket_path", "")))
    frontmost = frontmost_bundle_identifier() if frontmost_bundle is None else frontmost_bundle
    selected = focused.get("focused") if isinstance(focused, dict) else None
    return bool(
        frontmost == CMUX_BUNDLE_IDENTIFIER
        and isinstance(selected, dict)
        and selected.get("surface_id") == origin.get("surface_id")
        and selected.get("workspace_id") == origin.get("workspace_id")
    )


def parse_dictation_replacements(replacement_text: Any) -> dict[str, str]:
    if not isinstance(replacement_text, str):
        return {}
    replacements: dict[str, str] = {}
    for entry in replacement_text.split(";"):
        heard, separator, written = entry.partition("=")
        heard = heard.strip()
        written = written.strip()
        if separator and heard and written:
            replacements[heard] = written
    return replacements


def dictation_replacements() -> dict[str, str]:
    return parse_dictation_replacements(installed_config().get("dictationReplacements", ""))


def voice_settings() -> tuple[str, float]:
    config = installed_config()
    voice = config.get("speechVoice", "F4")
    if not isinstance(voice, str) or re.fullmatch(r"[MF][1-5]", voice.upper()) is None:
        voice = "F4"
    rate = config.get("speechWordsPerMinute", 230)
    if not isinstance(rate, (int, float)):
        rate = 230
    speed = min(2.0, max(0.7, float(rate) / 200.0))
    return voice.upper(), speed


def macos_clipboard_text() -> str:
    if sys.platform != "darwin":
        raise RuntimeError("Clipboard prompt refinement currently requires macOS")
    clipboard_read = subprocess.run(["pbpaste"], check=True, capture_output=True, text=True, timeout=2)
    return clipboard_read.stdout


def write_macos_clipboard(text: str) -> None:
    subprocess.run(["pbcopy"], check=True, input=text, text=True, timeout=2)


def write_refinement_status(stage: str, message: str, *, lifetime: float = 0.0) -> None:
    value: dict[str, Any] = {"message": message, "stage": stage}
    if lifetime > 0:
        value["expires_at"] = time.time() + lifetime
    atomic_json(voice_state_home() / "refinement.json", value)


def refine_clipboard_prompt() -> None:
    if not _prompt_refinement_lock.acquire(blocking=False):
        return
    try:
        write_refinement_status("refining", "Refining copied prompt locally…")
        original = macos_clipboard_text().strip()
        if not original:
            raise ValueError("Copy a prompt before double-tapping Control")
        refined = refine_prompt(original)
        write_macos_clipboard(refined)
        write_refinement_status("ready", "Refined prompt copied — press ⌘V to paste", lifetime=10)
        speak_markdown(refined)
    except Exception as error:
        write_refinement_status("error", f"Prompt refinement unavailable: {error}", lifetime=8)
    finally:
        _prompt_refinement_lock.release()


def tts_runtime() -> tuple[Any, Any]:
    global _tts_engine, _tts_style
    if _tts_engine is None:
        from supertonic import TTS

        _tts_engine = TTS(auto_download=True)
        voice, _ = voice_settings()
        _tts_style = _tts_engine.get_voice_style(voice_name=voice)
    return _tts_engine, _tts_style


def stt_runtime() -> Any:
    global _stt_engine
    with _stt_engine_lock:
        if _stt_engine is None:
            from faster_whisper import WhisperModel

            # Float32 avoids the ARM64 int8 short-utterance failures reported by Moonshine users.
            _stt_engine = WhisperModel(STT_MODEL, device="cpu", compute_type="float32")
    return _stt_engine


def prepare_voice() -> dict[str, str]:
    tts_runtime()
    stt_runtime()
    readiness = {"dictation": "ready", "narration": "ready"}
    if voice_preferences()["prompt_refinement"] == "review":
        available, reason = refinement_availability()
        readiness["prompt_refinement"] = "ready" if available else f"unavailable: {reason}"
    return readiness


def begin_audio_state(state: str) -> int:
    with _audio_lock:
        _audio["generation"] += 1
        _audio["state"] = state
        return int(_audio["generation"])


def audio_state_active(generation: int, state: str) -> bool:
    with _audio_lock:
        return _audio["generation"] == generation and _audio["state"] == state


def finish_audio_state(generation: int, state: str) -> None:
    with _audio_lock:
        if _audio["generation"] == generation and _audio["state"] == state:
            _audio["state"] = "idle"


def clear_read_along() -> None:
    (voice_state_home() / "read-along.json").unlink(missing_ok=True)


def cancel_narration() -> bool:
    with _audio_lock:
        if _audio["state"] != "narrating":
            return False
        _audio["generation"] += 1
        _audio["state"] = "idle"
    clear_read_along()
    try:
        import sounddevice

        sounddevice.stop()
    except Exception:
        pass
    return True


def publish_read_along(text: str, duration: float) -> None:
    if not voice_preferences()["read_along"]:
        clear_read_along()
        return
    atomic_json(
        voice_state_home() / "read-along.json",
        {"duration": max(0.01, duration), "started_at": time.time(), "text": text},
    )


def narration_still_eligible(origin: Any) -> bool:
    if not isinstance(origin, dict) or origin.get("kind") != "cmux":
        return True
    return envelope_eligible({"origin": origin})


def speak_markdown(markdown: str, origin: Any = None, *, respect_focus: bool = False) -> str:
    import sounddevice

    speech = render_speech(markdown)
    if not speech:
        return "completed"
    generation = begin_audio_state("narrating")
    last_focus_check = 0.0
    focus_allowed = True

    def focus_is_allowed(*, force: bool = False) -> bool:
        nonlocal focus_allowed, last_focus_check
        if not respect_focus:
            return True
        now = time.monotonic()
        if force or now - last_focus_check >= 0.25:
            focus_allowed = narration_still_eligible(origin)
            last_focus_check = now
        return focus_allowed

    try:
        engine, style = tts_runtime()
        _, speed = voice_settings()
        # Synthesize bounded pieces so giant responses remain interruptible.
        for chunk in chunk_speech(speech):
            if (voice_state_home() / "stop").exists():
                return "stopped"
            if not audio_state_active(generation, "narrating"):
                return "cancelled"
            if not focus_is_allowed(force=True):
                return "focus-lost"
            audio, _ = engine.synthesize(
                chunk.strip(),
                voice_style=style,
                # Below the model's default 8 steps the flow solver leaves impulse artifacts
                # (~38 full-scale sample discontinuities per utterance at 4) that sound like crunches.
                total_steps=8,
                speed=speed,
                max_chunk_length=300,
                silence_duration=0.24,
                lang="en",
                verbose=False,
            )
            if not audio_state_active(generation, "narrating"):
                return "cancelled"
            if not focus_is_allowed(force=True):
                return "focus-lost"
            samples = audio.squeeze()
            duration = max(0.01, float(len(samples)) / float(engine.sample_rate))
            sounddevice.play(samples, engine.sample_rate)
            publish_read_along(chunk.strip(), duration)
            started_at = time.monotonic()
            while time.monotonic() - started_at < duration:
                if not audio_state_active(generation, "narrating"):
                    sounddevice.stop()
                    return "cancelled"
                if not focus_is_allowed():
                    sounddevice.stop()
                    return "focus-lost"
                time.sleep(0.04)
            sounddevice.wait()
        return "completed"
    finally:
        clear_read_along()
        finish_audio_state(generation, "narrating")


def enqueue_narration(markdown: str, source: str, agent_reply_id: str = "", origin: Any = None) -> Path:
    inbox = voice_state_home() / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    path = inbox / f"{time.time_ns()}-{uuid.uuid4().hex}.json"
    atomic_json(
        path,
        {
            "markdown": markdown,
            "origin": origin if isinstance(origin, dict) else {"kind": "terminal"},
            "received_at": time.time(),
            "agent_reply_id": agent_reply_id,
            "source": source,
        },
    )
    return path


def envelope_identity(envelope: dict[str, Any]) -> str:
    agent_reply_id = envelope.get("agent_reply_id")
    token = (
        agent_reply_id.strip()
        if isinstance(agent_reply_id, str) and agent_reply_id.strip()
        else hashlib.sha256(str(envelope.get("markdown", "")).encode("utf-8")).hexdigest()
    )
    surface = envelope_surface_identity(envelope) or "terminal"
    return f"{envelope.get('source', 'unknown')}:{surface}:{token}"


def envelope_surface_identity(envelope: dict[str, Any]) -> str:
    origin = envelope.get("origin")
    if not isinstance(origin, dict) or origin.get("kind") != "cmux":
        return ""
    workspace = origin.get("workspace_id")
    surface = origin.get("surface_id")
    return f"{workspace}:{surface}" if isinstance(workspace, str) and isinstance(surface, str) else ""


def seen_narration_keys() -> dict[str, float]:
    document = read_json_file(voice_state_home() / "seen.json")
    if not isinstance(document, dict):
        return {}
    now = time.time()
    return {
        key: float(value)
        for key, value in document.items()
        if isinstance(key, str) and isinstance(value, (int, float)) and now - float(value) <= SEEN_NARRATION_TTL_SECONDS
    }


def remember_envelope(envelope: dict[str, Any]) -> None:
    seen = seen_narration_keys()
    seen[envelope_identity(envelope)] = time.time()
    atomic_json(voice_state_home() / "seen.json", seen)


def next_envelope() -> tuple[Path, dict[str, Any]] | None:
    inbox = voice_state_home() / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    pending: list[tuple[Path, dict[str, Any]]] = []
    for path in sorted(inbox.glob("*.json")):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            path.unlink(missing_ok=True)
            continue
        if not isinstance(value, dict) or not isinstance(value.get("markdown"), str) or not value["markdown"].strip():
            path.unlink(missing_ok=True)
            continue
        received_at = value.get("received_at")
        if isinstance(received_at, (int, float)) and time.time() - float(received_at) > PENDING_NARRATION_TTL_SECONDS:
            path.unlink(missing_ok=True)
            continue
        pending.append((path, value))

    settings = voice_preferences()
    if settings["narration_mode"] == "off":
        for path, _ in pending:
            path.unlink(missing_ok=True)
        return None

    newest_identity = {envelope_identity(value): path for path, value in pending}
    newest_surface: dict[str, Path] = {}
    for path, value in pending:
        surface_key = envelope_surface_identity(value)
        if surface_key:
            newest_surface[surface_key] = path

    seen = seen_narration_keys()
    focused_by_socket: dict[str, dict[str, Any] | None] = {}
    frontmost = frontmost_bundle_identifier() if newest_surface else ""
    for path, value in pending:
        identity = envelope_identity(value)
        origin = value.get("origin")
        surface_key = envelope_surface_identity(value)
        superseded = newest_identity[identity] != path or (
            surface_key != "" and newest_surface.get(surface_key) != path
        )
        if superseded or identity in seen:
            path.unlink(missing_ok=True)
            continue
        focused = None
        if isinstance(origin, dict) and origin.get("kind") == "cmux":
            socket_path = str(origin.get("socket_path", ""))
            if socket_path not in focused_by_socket:
                focused_by_socket[socket_path] = cached_cmux_identify(socket_path)
            focused = focused_by_socket[socket_path]
        if envelope_eligible(value, focused_context=focused, frontmost_bundle=frontmost, preferences=settings):
            return path, value
    return None


def type_text(text: str) -> None:
    controller = _dictation.get("controller")
    if controller is None or not text:
        return
    controller.type(text)


def reconcile_typed_text(previous: str, completed: str) -> None:
    controller = _dictation.get("controller")
    if controller is None or previous == completed:
        return
    shared_length = 0
    shared_limit = min(len(previous), len(completed))
    # Keep the already-correct character prefix and replace only the revised tail.
    while shared_length < shared_limit and previous[shared_length] == completed[shared_length]:
        shared_length += 1
    from pynput.keyboard import Key

    # Remove the live tail that the completed transcription revised.
    for _ in previous[shared_length:]:
        controller.press(Key.backspace)
        controller.release(Key.backspace)
    controller.type(completed[shared_length:])


def finalize_dictation_output() -> bool:
    with _dictation_lock:
        state = _dictation.get("format_state")
        if not isinstance(state, dict) or not state.get("has_output") or not state.get("needs_space"):
            return False
        type_text(" ")
        state["needs_space"] = False
        return True


def update_dictation_transcript(text: str, *, completed: bool) -> None:
    with _dictation_lock:
        clean = text.strip()
        if not completed:
            _dictation["hypotheses"].append(clean)
            stable = stable_words(list(_dictation["hypotheses"]))
            typed = _dictation["typed_words"]
            if stable[: len(typed)] != typed:
                return
            pending = stable[len(typed) :]
            projection = dictation_projection(
                pending,
                state=_dictation["format_state"],
                replacements=_dictation["replacements"],
                live=True,
            )
            consumed = projection["consumed"]
            if consumed:
                type_text(projection["text"])
                _dictation["format_state"] = projection["state"]
                _dictation["line_typed_text"] += projection["text"]
                _dictation["typed_words"] = [*typed, *pending[:consumed]]
            return

        completed_words = clean.split()
        projection = dictation_projection(
            completed_words,
            state=_dictation["line_start_state"],
            replacements=_dictation["replacements"],
        )
        reconcile_typed_text(_dictation["line_typed_text"], projection["text"])
        _dictation["format_state"] = projection["state"]
        _dictation["hypotheses"].clear()
        _dictation["line_start_state"] = dict(projection["state"])
        _dictation["line_typed_text"] = ""
        _dictation["typed_words"] = []


def collect_dictation_audio(microphone_samples: Any, _frames: int, _timing: Any, _status: Any) -> None:
    with _dictation_audio_lock:
        _dictation["audio_chunks"].append(microphone_samples.copy())


def dictation_audio_snapshot() -> Any:
    import numpy

    with _dictation_audio_lock:
        chunks = list(_dictation["audio_chunks"])
    if not chunks:
        return numpy.empty(0, dtype=numpy.float32)
    return numpy.concatenate(chunks, axis=0).reshape(-1).astype(numpy.float32, copy=False)


def transcribe_dictation_audio(audio: Any) -> str:
    if getattr(audio, "size", 0) == 0:
        return ""
    with _dictation_inference_lock:
        segments, _ = stt_runtime().transcribe(
            audio,
            beam_size=5,
            condition_on_previous_text=False,
            language="en",
            temperature=0.0,
            without_timestamps=True,
        )
        return " ".join(segment.text.strip() for segment in segments if segment.text.strip())


def stream_dictation_updates(request_generation: int) -> None:
    while True:
        time.sleep(DICTATION_UPDATE_SECONDS)
        with _dictation_control_lock:
            if not _dictation["requested"] or _dictation["request_generation"] != request_generation:
                return
        transcript = transcribe_dictation_audio(dictation_audio_snapshot())
        with _dictation_control_lock:
            if not _dictation["requested"] or _dictation["request_generation"] != request_generation:
                return
            update_dictation_transcript(transcript, completed=False)


def start_dictation(request_generation: int) -> None:
    capture = None
    try:
        with _dictation_start_lock:
            with _dictation_control_lock:
                if not _dictation["requested"] or _dictation["request_generation"] != request_generation:
                    return
                if _dictation["active"]:
                    set_dictation_stage("listening")
                    return
            import sounddevice

            sounddevice.stop()
            with _dictation_audio_lock:
                _dictation["audio_chunks"] = []
            capture = sounddevice.InputStream(
                blocksize=1024,
                callback=collect_dictation_audio,
                channels=1,
                dtype="float32",
                samplerate=DICTATION_SAMPLE_RATE,
            )
            with _dictation_control_lock:
                if not _dictation["requested"] or _dictation["request_generation"] != request_generation:
                    capture.close()
                    return
                capture.start()
                _dictation["capture"] = capture
                _dictation["active"] = True
                set_dictation_stage("listening")
            threading.Thread(
                target=stream_dictation_updates,
                args=(request_generation,),
                name="dufflebag-dictation-live",
                daemon=True,
            ).start()
    except Exception as error:
        if capture is not None:
            with suppress(Exception):
                capture.close()
        with _dictation_control_lock:
            if _dictation["request_generation"] != request_generation:
                return
            _dictation["active"] = False
            _dictation["requested"] = False
        set_dictation_stage("unavailable", str(error))
        finish_audio_state(int(_dictation.get("audio_generation", 0)), "listening")


def request_dictation_start() -> None:
    cancel_narration()
    audio_generation = begin_audio_state("listening")
    replacements = dictation_replacements()
    with _dictation_lock:
        _dictation["format_state"] = initial_dictation_format_state()
        _dictation["hypotheses"].clear()
        _dictation["line_start_state"] = dict(_dictation["format_state"])
        _dictation["line_typed_text"] = ""
        _dictation["replacements"] = replacements
        _dictation["typed_words"] = []
    with _dictation_audio_lock:
        _dictation["audio_chunks"] = []
    with _dictation_control_lock:
        _dictation["request_generation"] += 1
        request_generation = _dictation["request_generation"]
        _dictation["requested"] = True
        _dictation["audio_generation"] = audio_generation
        set_dictation_stage("starting")
    threading.Thread(
        target=start_dictation,
        args=(request_generation,),
        name="dufflebag-dictation-start",
        daemon=True,
    ).start()


def stop_dictation(request_generation: int) -> None:
    with _dictation_control_lock:
        if _dictation["requested"] or _dictation["request_generation"] != request_generation:
            return
    time.sleep(DICTATION_RELEASE_GRACE_SECONDS)
    with _dictation_control_lock:
        if _dictation["requested"] or _dictation["request_generation"] != request_generation:
            return
        capture = _dictation.get("capture")
        if not _dictation["active"] or capture is None:
            _dictation["active"] = False
            set_dictation_stage("inactive")
            finish_audio_state(int(_dictation.get("audio_generation", 0)), "listening")
            return
        try:
            capture.stop()
            capture.close()
        except Exception as error:
            _dictation["active"] = False
            _dictation["capture"] = None
            set_dictation_stage("unavailable", str(error))
            finish_audio_state(int(_dictation.get("audio_generation", 0)), "listening")
            return
        audio = dictation_audio_snapshot()
        _dictation["active"] = False
        _dictation["capture"] = None
        with _dictation_audio_lock:
            _dictation["audio_chunks"] = []
    try:
        transcript = transcribe_dictation_audio(audio)
        with _dictation_control_lock:
            if _dictation["requested"] or _dictation["request_generation"] != request_generation:
                return
            update_dictation_transcript(transcript, completed=True)
            finalize_dictation_output()
            set_dictation_stage("inactive")
            finish_audio_state(int(_dictation.get("audio_generation", 0)), "listening")
    except Exception as error:
        with _dictation_control_lock:
            if not _dictation["requested"] and _dictation["request_generation"] == request_generation:
                set_dictation_stage("unavailable", str(error))
        finish_audio_state(int(_dictation.get("audio_generation", 0)), "listening")


def request_dictation_stop() -> None:
    with _dictation_control_lock:
        _dictation["request_generation"] += 1
        request_generation = _dictation["request_generation"]
        _dictation["requested"] = False
        set_dictation_stage("finishing")
    threading.Thread(
        target=stop_dictation,
        args=(request_generation,),
        name="dufflebag-dictation-stop",
        daemon=True,
    ).start()


def dictation_owns_audio() -> bool:
    with _dictation_control_lock:
        return bool(_dictation["requested"] or _dictation["active"] or _dictation["stage"] == "finishing")


def is_control_key(key: Any) -> bool:
    from pynput.keyboard import Key

    return key in (Key.ctrl, Key.ctrl_l, Key.ctrl_r)


def begin_control_dictation(key: Any) -> None:
    controller = _dictation.get("controller")
    if controller is None or key is None:
        set_dictation_stage("unavailable", "Keyboard controller is unavailable")
        return
    try:
        # Release the logical modifier so streamed words arrive as text while the physical key stays held.
        controller.release(key)
        request_dictation_start()
    except Exception as error:
        set_dictation_stage("unavailable", str(error))


def handle_control_tap() -> None:
    if cancel_narration():
        return
    if voice_preferences()["prompt_refinement"] != "review":
        return
    now = time.monotonic()
    should_refine = False
    with _control_hold_lock:
        last_tap = float(_control_hold.get("last_tap_at", 0.0))
        if now - last_tap <= CONTROL_DOUBLE_TAP_SECONDS:
            _control_hold["last_tap_at"] = 0.0
            should_refine = True
        else:
            _control_hold["last_tap_at"] = now
    if should_refine:
        threading.Thread(target=refine_clipboard_prompt, name="dufflebag-prompt-refinement", daemon=True).start()


def handle_control_event(event: str, key: Any = None, injected: bool = False) -> None:
    timer_to_start = None
    held_key = None
    with _control_hold_lock:
        transition = control_hold_transition(_control_hold["state"], event, injected)
        action = transition["action"]
        _control_hold["state"] = transition["state"]
        if action == "schedule":
            timer = threading.Timer(CONTROL_HOLD_SECONDS, handle_control_event, args=("hold_elapsed",))
            timer.daemon = True
            _control_hold["key"] = key
            _control_hold["timer"] = timer
            timer_to_start = timer
        elif action in {"cancel", "tap"}:
            timer = _control_hold.get("timer")
            if timer is not None:
                timer.cancel()
            _control_hold["timer"] = None
        elif action == "start":
            _control_hold["timer"] = None
            held_key = _control_hold.get("key")
        if transition["state"] == "idle":
            _control_hold["key"] = None
            _control_hold["timer"] = None

    if timer_to_start is not None:
        timer_to_start.start()
    if action == "start":
        begin_control_dictation(held_key)
    elif action == "stop":
        request_dictation_stop()
    elif action == "tap":
        handle_control_tap()


def control_pressed(key: Any, injected: bool = False) -> None:
    event = "control_down" if is_control_key(key) else "other_down"
    handle_control_event(event, key, injected)


def control_released(key: Any, injected: bool = False) -> None:
    if is_control_key(key):
        handle_control_event("control_up", key, injected)


def start_control_listener() -> Any:
    try:
        from pynput.keyboard import Controller, Listener

        _dictation["controller"] = Controller()
        listener = Listener(on_press=control_pressed, on_release=control_released)
        listener.start()
        set_dictation_stage("inactive")
        return listener
    except Exception as error:
        set_dictation_stage("unavailable", str(error))
        return None


def close_dictation(listener: Any) -> None:
    if listener is not None:
        listener.stop()
    with _control_hold_lock:
        timer = _control_hold.get("timer")
        if timer is not None:
            timer.cancel()
        _control_hold["key"] = None
        _control_hold["state"] = "idle"
        _control_hold["timer"] = None
    with _dictation_control_lock:
        _dictation["request_generation"] += 1
        _dictation["requested"] = False
        capture = _dictation.get("capture")
        if capture is None:
            return
        try:
            if _dictation["active"]:
                capture.stop()
            capture.close()
        except Exception:
            pass
        finally:
            _dictation["active"] = False
            _dictation["capture"] = None
            _dictation["stage"] = "inactive"
            finish_audio_state(int(_dictation.get("audio_generation", 0)), "listening")


def run_daemon() -> int:
    if not acquire_worker_pid():
        return 0
    home = voice_state_home()
    stop_path = home / "stop"
    stop_path.unlink(missing_ok=True)
    stopping = threading.Event()

    def request_stop(_signal: int, _frame: Any) -> None:
        stopping.set()

    signal.signal(signal.SIGTERM, request_stop)
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, request_stop)
    listener = start_control_listener()
    overlay_process = start_dictation_overlay_process()
    try:
        # Narrate queued responses sequentially unless the microphone owns audio.
        while not stopping.is_set() and not stop_path.exists():
            envelope = None if dictation_owns_audio() else next_envelope()
            if envelope is None:
                time.sleep(0.15)
                continue
            path, value = envelope
            try:
                narration_state = speak_markdown(value["markdown"], value.get("origin"), respect_focus=True)
                if narration_state != "stopped":
                    remember_envelope(value)
                    path.unlink(missing_ok=True)
            except Exception as error:
                write_worker_status("inactive", f"Narration failed: {error}")
                failed = home / "failed" / path.name
                failed.parent.mkdir(parents=True, exist_ok=True)
                os.replace(path, failed)
    finally:
        stop_dictation_overlay_process(overlay_process)
        close_dictation(listener)
        (home / "worker.pid").unlink(missing_ok=True)
        stop_path.unlink(missing_ok=True)
        atomic_json(home / "status.json", {"dictation": "inactive", "hotkey": HOTKEY_LABEL, "running": False})
    return 0


def start_worker(quiet: bool = False) -> dict[str, Any]:
    current = worker_status()
    if current["running"]:
        if not quiet:
            print(json.dumps(current))
        return current
    home = voice_state_home()
    home.mkdir(parents=True, exist_ok=True)
    (home / "stop").unlink(missing_ok=True)
    command = [sys.executable, str(Path(__file__).resolve()), "daemon"]
    options: dict[str, Any] = {
        "cwd": str(Path(__file__).resolve().parent),
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        options["start_new_session"] = True
    process = subprocess.Popen(command, **options)
    deadline = time.monotonic() + 8
    # Wait only for the PID handshake, never for models or audio hardware.
    while time.monotonic() < deadline and not worker_status()["running"] and process.poll() is None:
        time.sleep(0.05)
    worker_state = worker_status()
    if not worker_state["running"]:
        raise RuntimeError("Voice worker did not start")
    if not quiet:
        print(json.dumps(worker_state))
    return worker_state


def stop_worker() -> dict[str, Any]:
    home = voice_state_home()
    pid = read_pid(home)
    (home / "stop").parent.mkdir(parents=True, exist_ok=True)
    (home / "stop").touch()
    deadline = time.monotonic() + 4
    # Give the worker time to stop playback and close microphone resources.
    while process_running(pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    if process_running(pid):
        os.kill(pid, signal.SIGTERM)
    stopped_state = {"dictation": "inactive", "hotkey": HOTKEY_LABEL, "running": False}
    print(json.dumps(stopped_state))
    return stopped_state


def read_json_file(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def watch_devin(path: Path) -> int:
    start_worker(quiet=True)
    current = select_devin_narration(read_json_file(path))
    seen_turn_id = current["turn_id"]
    last_change = 0
    pending_turn_id = ""
    # Devin rewrites ATIF after turns; debounce one stable export before queueing it.
    while True:
        document = read_json_file(path)
        selected = select_devin_narration(document)
        turn_id = selected["turn_id"]
        if turn_id and turn_id != seen_turn_id and turn_id != pending_turn_id:
            pending_turn_id = turn_id
            last_change = time.monotonic()
        if pending_turn_id and time.monotonic() - last_change >= 0.8:
            confirmed = select_devin_narration(read_json_file(path))
            if confirmed["turn_id"] == pending_turn_id and confirmed["markdown"]:
                enqueue_narration(confirmed["markdown"], "devin", confirmed["turn_id"])
                seen_turn_id = confirmed["turn_id"]
            pending_turn_id = ""
        time.sleep(0.2)


def argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Dufflebag local voice worker")
    commands = parser.add_subparsers(dest="command", required=True)
    render = commands.add_parser("render", help="render Markdown as a speech document")
    render.add_argument("--text", required=True)
    speak = commands.add_parser("speak", help="play one complete narration through Supertonic")
    speak.add_argument("--text", required=True)
    speak.add_argument("--source", default="manual")
    refine = commands.add_parser("refine", help="refine one prompt with Apple's on-device model")
    refine.add_argument("--speak", action="store_true")
    refine.add_argument("--text", required=True)
    commands.add_parser("prepare", help="download and verify the pinned local speech models")
    commands.add_parser("start", help="start the local narration and dictation worker")
    commands.add_parser("daemon", help=argparse.SUPPRESS)
    overlay = commands.add_parser("overlay", help=argparse.SUPPRESS)
    overlay.add_argument("--worker-pid", required=True, type=int)
    commands.add_parser("stop", help="stop the local worker")
    commands.add_parser("status", help="print local worker status")
    devin = commands.add_parser("watch-devin", help="watch a Devin ATIF export for complete responses")
    devin.add_argument("--path", required=True, type=Path)
    return parser


def main() -> int:
    args = argument_parser().parse_args()
    if args.command == "render":
        print(render_speech(args.text))
        return 0
    if args.command == "speak":
        speak_markdown(args.text)
        return 0
    if args.command == "refine":
        try:
            refined = refine_prompt(args.text)
            print(refined)
            if args.speak:
                speak_markdown(refined)
            return 0
        except Exception as error:
            print(str(error), file=sys.stderr)
            return 1
    if args.command == "prepare":
        print(json.dumps(prepare_voice()))
        return 0
    if args.command == "start":
        start_worker()
        return 0
    if args.command == "daemon":
        return run_daemon()
    if args.command == "overlay":
        return run_dictation_overlay(args.worker_pid)
    if args.command == "stop":
        stop_worker()
        return 0
    if args.command == "status":
        print(json.dumps(voice_status_report()))
        return 0
    if args.command == "watch-devin":
        return watch_devin(args.path)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
