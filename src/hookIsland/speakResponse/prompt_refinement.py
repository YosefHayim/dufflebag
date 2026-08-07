"""Route-aware prompt refinement with dynamic providers (ytcap-style).

Providers (backend=):
  codex | local | auto | grok | ollama | opencode | claude | gemini | pi

Discovery scans PATH for known agent CLIs and only offers backends we can
actually invoke for refine (runnable). Detected-but-not-wired CLIs (e.g. kimi)
are listed by --list-providers with runnable:false and stay out of the picker.

Dynamic knobs (like yt-captions-mini-ai agent=/model=/reasoning-effort=):
  --model <id>
  --reasoning-effort low|medium|high|xhigh|minimal
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

DEFAULT_BACKEND = "codex"
DEFAULT_MODEL = "gpt-5.3-codex-spark"
# Prefer low effort for STT refine latency; empty config used to inherit Codex
# defaults (often xhigh on reasoning models → multi-second silence after Ctrl release).
DEFAULT_REASONING_EFFORT = "low"

# Rotate through these when the requested Codex model is missing / not allowed
# for the signed-in account (ChatGPT vs API). Prefer fast models first after the
# caller's choice so STT → input stays snappy.
CODEX_MODEL_FALLBACKS = (
    "gpt-5.3-codex-spark",
    "gpt-5.4-mini",
    "gpt-5.6-terra",
    "gpt-5.1-codex-mini",
    "o4-mini",
    "gpt-4.1-mini",
)

# Models shown in the quota / limit picker (curated + fallbacks, de-duped at runtime).
# Prefer live `~/.codex/models_cache.json` via _list_codex_models when present.
CODEX_PICKER_MODELS = (
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-5.5",
    "gpt-5.4-mini",
    "gpt-5.4",
    "gpt-5.3-codex-spark",
    "gpt-5.1-codex-mini",
    "o4-mini",
    "gpt-4.1-mini",
    "gpt-4.1",
)

# Short discovery timeouts so pick-refine does not hang for a minute on slow CLIs.
# Parallel discovery makes wall time ≈ this timeout, not sum(providers).
_DISCOVERY_CMD_TIMEOUT = 12
_DISCOVERY_CACHE_TTL_SECS = 120.0
_discovery_memo: dict[str, Any] | None = None
_discovery_memo_at: float = 0.0

REASONING_EFFORT_OPTIONS = ("minimal", "low", "medium", "high", "xhigh")
# ASCII hyphens: AppleScript choose-from-list can choke on em-dashes.
SKIP_REFINE_LABEL = "-- Skip refine (keep raw STT) --"
MAX_PICKER_ROUNDS = 2

KNOWN_BACKENDS = (
    "codex",
    "local",
    "auto",
    "grok",
    "agent",  # Grok Build alias
    "ollama",
    "opencode",
    "claude",
    "gemini",
    "agy",  # Antigravity / Gemini CLI (alias of gemini backend)
    "pi",  # @earendil-works/pi-coding-agent (binary: pi; people often say "pie")
    "pie",  # alias → pi
)

# Agent CLIs that print auth/help failures with exit 0 — treat as hard errors.
_CLI_AUTH_OR_CONFIG_FAIL_MARKERS = (
    "no api key found",
    "use /login",
    "not logged in",
    "no models available",
    "please log in",
    "authentication required",
    "unauthorized",
    "login required",
)

# Substrings that mean "this model id is unusable" → try the next fallback.
_MODEL_UNAVAILABLE_MARKERS = (
    "model is not supported",
    "model not found",
    "unknown model",
    "invalid model",
    "unsupported model",
    "does not exist",
    "not available for",
    "not supported when using",
    "model_not_found",
    "invalid_model",
    "no such model",
    "the requested model is not supported",
    "model_not_supported",
)

# Quota / rate-limit / billing → rotate model (and eventually backend).
_QUOTA_OR_LIMIT_MARKERS = (
    "quota",
    "rate limit",
    "rate_limit",
    "ratelimit",
    "too many requests",
    'status":429',
    "status code 429",
    "http 429",
    " 429",
    " 402",
    'status":402',
    "usage limit",
    "usage_limit",
    "insufficient_quota",
    "exceeded your current quota",
    "billing",
    "limit reached",
    "tokens per min",
    "requests per min",
    "tpm",
    "rpm",
    "out of credits",
    "requires more credits",
    "can only afford",
    "openrouter.ai/settings/credits",
    "payment required",
    "spending limit",
    "budget",
    "credit balance",
    "insufficient credits",
)

# Unified STT refine: try several models/backends without hanging release.
MAX_MODELS_PER_BACKEND = 6
MAX_CROSS_BACKEND_ATTEMPTS = 4
MAX_TOTAL_ATTEMPTS = 12
# Preferred try order when rotating across providers after the requested one fails.
_BACKEND_FALLBACK_ORDER = (
    "codex",
    "opencode",
    "gemini",
    "grok",
    "pi",
    "ollama",
    "claude",
)

PROMPT_REFINEMENT_INSTRUCTIONS = """You refine messy freeform or spoken drafts into a single paste-ready prompt for a coding agent.

Rules:
1. Preserve exact intent, facts, constraints, code, commands, paths, URLs, quoted literals, and acceptance criteria.
2. Remove filler, false starts, and repetition. Make implied deliverables explicit only when already supported by the draft.
3. Prefer routing to existing skills when the draft is clearly that workflow (finish-and-ship, organized-commits, deslop-v2, messy-repo-orchestrator, coordinate-worktrees, preview-and-prove, deploy-and-prove, route-request, etc.). Lead with the primary skill id when helpful: "finish-and-ship: …".
4. Do not invent a multi-skill plan, a routing chat, or a long report. Output is the agent message the user would paste/send next.
5. Do not answer the prompt. Do not add commentary, labels, Markdown fences around the whole reply, or invented requirements.
6. Return only the revised prompt text."""


def prompt_literals(text: str) -> list[str]:
    patterns = [
        r"```[\s\S]*?```",
        r"`[^`\n]+`",
        r"https?://[^\s<>()]+",
        r"(?<!\w)(?:\.{0,2}/)[^\s,;:!?]+",
        r"(?<!\w)(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+",
        r"(?<!\w)(?:'[^'\n]+'|\"[^\"\n]+\")",
    ]
    literals: list[str] = []
    occupied: list[tuple[int, int]] = []
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            span = match.span()
            if any(span[0] < end and start < span[1] for start, end in occupied):
                continue
            occupied.append(span)
            literals.append(match.group(0))
    return literals


def _looks_like_cli_help(text: str) -> bool:
    """True when stdout is a CLI --help dump (e.g. yargs), not a refined prompt."""
    blob = (text or "").strip().lower()
    if not blob:
        return False
    # OpenCode / yargs help always carries these anchors together.
    anchors = (
        "positionals:",
        "options:",
        "show help",
        "[boolean]",
    )
    hits = sum(1 for a in anchors if a in blob)
    if hits >= 3:
        return True
    if "run opencode with a message" in blob and "positionals:" in blob:
        return True
    return blob.startswith("opencode run [message") or "opencode run [message..]" in blob


def validate_refined_prompt(original: str, refined: str) -> str:
    clean = refined.strip()
    if not clean:
        raise ValueError("The model returned an empty prompt")
    if clean.startswith("```") and clean.endswith("```"):
        lines = clean.splitlines()
        if len(lines) >= 2:
            clean = "\n".join(lines[1:-1]).strip()
    if not clean:
        raise ValueError("The model returned an empty prompt")
    if _looks_like_cli_help(clean):
        raise ValueError("The model returned CLI help text instead of a refined prompt")
    missing = [literal for literal in prompt_literals(original) if literal not in clean]
    if missing:
        raise ValueError(f"The model changed a protected literal: {missing[0]}")
    return clean


def build_user_prompt(original: str) -> str:
    return (
        f"{PROMPT_REFINEMENT_INSTRUCTIONS}\n\n"
        f"Draft to refine:\n---\n{original}\n---\n"
        "Return only the revised prompt text."
    )


def refinement_unavailable_reason(reason: Any) -> str:
    name = getattr(reason, "name", "")
    messages = {
        "APPLE_INTELLIGENCE_NOT_ENABLED": "Apple Intelligence is not enabled in System Settings",
        "DEVICE_NOT_ELIGIBLE": "this Mac is not eligible for Apple Intelligence",
        "MODEL_NOT_READY": "the Apple Intelligence model is still downloading or preparing",
        "UNKNOWN": "Apple did not report why the model is unavailable",
    }
    return messages.get(
        name, str(reason) if reason is not None else "Apple did not report why the model is unavailable"
    )


def refinement_availability() -> tuple[bool, str]:
    if sys.platform != "darwin":
        return False, "Apple Foundation Models requires macOS 26 or newer"
    try:
        import apple_fm_sdk as fm

        model = fm.SystemLanguageModel(guardrails=fm.SystemLanguageModelGuardrails.PERMISSIVE_CONTENT_TRANSFORMATIONS)
        available, reason = model.is_available()
        return bool(available), "" if available else refinement_unavailable_reason(reason)
    except Exception as error:
        return False, str(error)


async def generate_refined_prompt_local(original: str) -> str:
    import apple_fm_sdk as fm

    model = fm.SystemLanguageModel(guardrails=fm.SystemLanguageModelGuardrails.PERMISSIVE_CONTENT_TRANSFORMATIONS)
    available, reason = model.is_available()
    if not available:
        raise RuntimeError(f"Apple Foundation Models is unavailable: {refinement_unavailable_reason(reason)}")
    session = fm.LanguageModelSession(model=model, instructions=PROMPT_REFINEMENT_INSTRUCTIONS)
    refined_reply = await session.respond(prompt=original)
    return validate_refined_prompt(original, str(refined_reply))


def refine_prompt_local(original: str) -> str:
    if sys.platform != "darwin":
        raise RuntimeError("Local prompt refinement requires macOS with Apple Foundation Models")
    return asyncio.run(generate_refined_prompt_local(original))


def _which(name: str, extras: tuple[str, ...] = ()) -> str:
    found = shutil.which(name)
    if found:
        return found
    home = os.path.expanduser("~")
    candidates = [
        *extras,
        os.path.join(home, ".local", "bin", name),
        os.path.join(home, ".grok", "bin", name),
        os.path.join(home, ".npm-global", "bin", name),
        os.path.join(home, "Library", "pnpm", name),
        os.path.join(home, "Library", "pnpm", "bin", name),
        os.path.join(home, ".local", "share", "pnpm", name),
        os.path.join(home, ".local", "share", "pnpm", "bin", name),
        f"/usr/local/bin/{name}",
        f"/opt/homebrew/bin/{name}",
        f"/usr/local/opt/{name}/bin/{name}",
    ]
    for candidate in candidates:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise RuntimeError(f"{name} CLI not found on PATH")


def _run(command: list[str], *, timeout: int = 120, cwd: str | None = None) -> subprocess.CompletedProcess[str]:
    # Close stdin: several agent CLIs (codex exec, some print modes) block on
    # "Reading additional input from stdin..." when a pipe/TTY is inherited.
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=cwd or os.path.expanduser("~"),
        env={**os.environ, "NO_COLOR": "1"},
        stdin=subprocess.DEVNULL,
        check=False,
    )


def _stdout_text(completed: subprocess.CompletedProcess[str]) -> str:
    out = (completed.stdout or "").strip()
    if out:
        return out
    return (completed.stderr or "").strip()


def _part_text(value: dict[str, Any]) -> str:
    """Pull text from OpenCode-style `{type, part: {type, text}}` events."""
    part = value.get("part")
    if not isinstance(part, dict):
        return ""
    part_type = str(part.get("type") or "")
    event_type = str(value.get("type") or "")
    # Prefer explicit text parts; also accept top-level type=text.
    if part_type not in ("", "text") and event_type != "text":
        return ""
    text = part.get("text")
    if isinstance(text, str) and text.strip():
        return text.strip()
    return ""


def _extract_json_text(blob: str) -> str:
    """Best-effort: pull a final text field from agent JSON/JSONL stdout."""
    blob = blob.strip()
    if not blob:
        return ""
    # Whole JSON object
    try:
        value = json.loads(blob)
        if isinstance(value, dict):
            for key in ("result", "text", "content", "message", "output", "response"):
                item = value.get(key)
                if isinstance(item, str) and item.strip():
                    return item.strip()
                if isinstance(item, dict):
                    nested = item.get("text") or item.get("content")
                    if isinstance(nested, str) and nested.strip():
                        return nested.strip()
            part_text = _part_text(value)
            if part_text:
                return part_text
            # Claude-style content blocks
            content = value.get("content")
            if isinstance(content, list):
                parts = []
                for block in content:
                    if isinstance(block, dict) and isinstance(block.get("text"), str):
                        parts.append(block["text"])
                if parts:
                    return "\n".join(parts).strip()
        if isinstance(value, str):
            return value.strip()
    except json.JSONDecodeError:
        pass
    # JSONL: last object with text/result (OpenCode emits type=text + part.text)
    last = ""
    text_parts: list[str] = []
    for line in blob.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(value, dict):
            continue
        for key in ("result", "text", "content", "message", "output"):
            item = value.get(key)
            if isinstance(item, str) and item.strip():
                last = item.strip()
        part_text = _part_text(value)
        if part_text:
            # Streaming text events: keep the latest complete chunk; also collect
            # multi-part replies if they are non-prefix extensions.
            text_parts.append(part_text)
            last = part_text
        # nested message
        msg = value.get("message")
        if isinstance(msg, dict):
            content = msg.get("content")
            if isinstance(content, str) and content.strip():
                last = content.strip()
            elif isinstance(content, list):
                parts = [
                    block.get("text", "")
                    for block in content
                    if isinstance(block, dict) and isinstance(block.get("text"), str)
                ]
                joined = "\n".join(p for p in parts if p).strip()
                if joined:
                    last = joined
    if text_parts:
        # If later parts are cumulative supersets, prefer the longest/last.
        longest = max(text_parts, key=len)
        if all(longest.startswith(p) or p in longest for p in text_parts):
            return longest
        # Distinct chunks → join in order.
        return "\n".join(text_parts).strip()
    return last


def _voice_state_dir() -> str:
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/dufflebag/voice")
    if sys.platform == "win32":
        return os.path.join(
            os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
            "dufflebag",
            "voice",
        )
    return os.path.join(
        os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state")),
        "dufflebag",
        "voice",
    )


def _codex_model_cache_path() -> str:
    """Sticky last-good Codex model so subsequent STT releases skip dead ids."""
    return os.path.join(_voice_state_dir(), "refine-codex-model.cache")


def _codex_failed_models_path() -> str:
    return os.path.join(_voice_state_dir(), "refine-codex-failed-models.cache")


def _read_codex_model_cache() -> str:
    path = _codex_model_cache_path()
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return ""


def _write_codex_model_cache(model: str) -> None:
    path = _codex_model_cache_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(model.strip() + "\n")
    except OSError:
        pass


def _read_codex_failed_models() -> set[str]:
    path = _codex_failed_models_path()
    try:
        with open(path, encoding="utf-8") as handle:
            return {line.strip() for line in handle if line.strip()}
    except OSError:
        return set()


def _mark_codex_model_failed(model: str) -> None:
    name = model.strip()
    if not name:
        return
    failed = _read_codex_failed_models()
    if name in failed:
        return
    failed.add(name)
    path = _codex_failed_models_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("\n".join(sorted(failed)) + "\n")
    except OSError:
        pass


def _clear_codex_model_failed(model: str) -> None:
    name = model.strip()
    if not name:
        return
    failed = _read_codex_failed_models()
    if name not in failed:
        return
    failed.discard(name)
    path = _codex_failed_models_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("\n".join(sorted(failed)) + ("\n" if failed else ""))
    except OSError:
        pass


def _model_unavailable_error(message: str) -> bool:
    lower = message.lower()
    return any(marker in lower for marker in _MODEL_UNAVAILABLE_MARKERS)


def _quota_or_limit_error(message: str) -> bool:
    lower = message.lower()
    return any(marker in lower for marker in _QUOTA_OR_LIMIT_MARKERS)


def _user_choice_path() -> str:
    return os.path.join(_voice_state_dir(), "refine-user-choice.json")


def _read_user_choice() -> dict[str, str]:
    path = _user_choice_path()
    try:
        with open(path, encoding="utf-8") as handle:
            value = json.load(handle)
        if isinstance(value, dict):
            return {
                "backend": str(value.get("backend") or "").strip().lower(),
                "model": str(value.get("model") or "").strip(),
                "reasoningEffort": str(value.get("reasoningEffort") or "").strip().lower(),
            }
    except (OSError, json.JSONDecodeError, TypeError):
        pass
    return {"backend": "", "model": "", "reasoningEffort": ""}


def _write_user_choice(model: str, reasoning_effort: str) -> None:
    path = _user_choice_path()
    user_choice_document = {
        "model": model.strip(),
        "reasoningEffort": (reasoning_effort or DEFAULT_REASONING_EFFORT).strip().lower(),
        "updatedAt": __import__("time").time(),
    }
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(user_choice_document, handle, indent=2)
            handle.write("\n")
    except OSError:
        pass


def _bag_config_paths() -> list[str]:
    paths: list[str] = []
    # Installed package next to this script: …/runtime/speakResponse/prompt_refinement.py
    try:
        script = os.path.abspath(__file__)
        speak = os.path.dirname(script)
        runtime = os.path.dirname(speak)
        root = os.path.dirname(runtime)
        paths.append(os.path.join(root, "config.json"))
        paths.append(os.path.join(speak, "config.json"))
    except NameError:
        pass
    home = os.path.expanduser("~")
    paths.extend(
        [
            os.path.join(home, ".claude", "dufflebag", "config.json"),
            os.path.join(home, ".codex", "dufflebag", "config.json"),
            os.path.join(home, ".cursor", "dufflebag", "config.json"),
            os.path.join(home, ".grok", "dufflebag", "config.json"),
        ]
    )
    # De-dupe while preserving order
    seen: set[str] = set()
    ordered: list[str] = []
    for path in paths:
        if path in seen:
            continue
        seen.add(path)
        ordered.append(path)
    return ordered


def _write_user_choice_full(backend: str, model: str, reasoning_effort: str) -> None:
    path = _user_choice_path()
    user_choice_document = {
        "backend": (backend or "").strip().lower(),
        "model": model.strip(),
        "reasoningEffort": (reasoning_effort or DEFAULT_REASONING_EFFORT).strip().lower(),
        "updatedAt": __import__("time").time(),
    }
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(user_choice_document, handle, indent=2)
            handle.write("\n")
    except OSError:
        pass


def _persist_refine_choice(model: str, reasoning_effort: str, backend: str = "") -> None:
    """Remember backend+model+effort for next STT release and bag config when present."""
    effort = (reasoning_effort or DEFAULT_REASONING_EFFORT).strip().lower() or DEFAULT_REASONING_EFFORT
    model = model.strip()
    backend = (backend or "").strip().lower()
    if not model:
        return
    if backend:
        _write_user_choice_full(backend, model, effort)
    else:
        _write_user_choice(model, effort)
    if backend in ("", "codex", "auto"):
        _write_codex_model_cache(model)
        _clear_codex_model_failed(model)
    for path in _bag_config_paths():
        if not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                cfg = json.load(handle)
            if not isinstance(cfg, dict):
                continue
            if backend:
                cfg["promptRefinementBackend"] = backend
            cfg["promptRefinementModel"] = model
            cfg["promptRefinementReasoningEffort"] = effort
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(cfg, handle, indent=2)
                handle.write("\n")
            print(
                f"saved refine prefs → {path} ({backend or '?'}/{model}/{effort})",
                file=sys.stderr,
            )
            break
        except (OSError, json.JSONDecodeError, TypeError):
            continue


def _applescript_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"')


def _osascript(source: str, timeout: int = 300) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["osascript", "-e", source],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _macos_choose_from_list(
    *,
    title: str,
    prompt: str,
    items: list[str],
    default: str = "",
) -> str | None:
    """Native macOS list picker. Returns chosen item, or None if cancelled."""
    if not items:
        return None
    # Default first so it is pre-selected when present.
    ordered = list(items)
    if default and default in ordered:
        ordered = [default] + [item for item in ordered if item != default]
    quoted = ", ".join(f'"{_applescript_escape(item)}"' for item in ordered)
    script = f'''
try
  set theList to {{{quoted}}}
  set theChoice to choose from list theList with title "{_applescript_escape(title)}" with prompt "{_applescript_escape(prompt)}" default items {{item 1 of theList}} OK button name "Use" cancel button name "Cancel"
  if theChoice is false then
    return "CANCEL"
  end if
  return item 1 of theChoice
on error errMsg number errNum
  return "ERROR:" & errMsg
end try
'''
    completed = _osascript(script)
    out = (completed.stdout or "").strip()
    if not out or out == "CANCEL" or out.startswith("ERROR:"):
        return None
    return out


def _macos_alert(title: str, message: str) -> None:
    script = f'''
try
  display alert "{_applescript_escape(title)}" message "{_applescript_escape(message[:900])}" as warning buttons {{"OK"}} default button "OK"
end try
'''
    with contextlib.suppress(OSError, subprocess.TimeoutExpired):
        _osascript(script, timeout=60)


def _picker_enabled() -> bool:
    if os.environ.get("DUFFLEBAG_REFINE_NO_PICKER", "").strip() in ("1", "true", "yes"):
        return False
    if os.environ.get("CI", "").strip():
        return False
    return sys.platform == "darwin"


def _try_which(name: str) -> str | None:
    try:
        return _which(name)
    except RuntimeError:
        return None


def _run_lines(command: list[str], *, timeout: int = 20) -> list[str]:
    try:
        completed = _run(command, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return []
    blob = (completed.stdout or "") + "\n" + (completed.stderr or "")
    return [line.strip() for line in blob.splitlines() if line.strip()]


def _dedupe_keep(order: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for name in order:
        token = (name or "").strip()
        if not token or token in seen:
            continue
        seen.add(token)
        out.append(token)
    return out


def _list_ollama_models() -> list[str]:
    lines = _run_lines(["ollama", "list"], timeout=_DISCOVERY_CMD_TIMEOUT)
    models: list[str] = []
    for line in lines[1:]:  # skip header NAME ID SIZE …
        name = line.split()[0] if line.split() else ""
        if name and name.upper() != "NAME":
            models.append(name)
    return models


def _read_codex_models_cache_file() -> list[str]:
    """Live account catalog from Codex CLI cache (~/.codex/models_cache.json)."""
    path = os.path.expanduser("~/.codex/models_cache.json")
    try:
        with open(path, encoding="utf-8") as handle:
            models_cache_document = json.load(handle)
    except (OSError, json.JSONDecodeError, TypeError):
        return []
    rows = models_cache_document.get("models") if isinstance(models_cache_document, dict) else None
    if not isinstance(rows, list):
        return []
    ordered: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        slug = str(row.get("slug") or row.get("id") or "").strip()
        if not slug:
            continue
        visibility = str(row.get("visibility") or "list").strip().lower()
        # hide = internal / not for picker
        if visibility in ("hide", "hidden", "never"):
            continue
        ordered.append(slug)
    return ordered


def _list_codex_models() -> list[str]:
    """Config default + live models_cache.json + curated fallbacks (de-duped)."""
    ordered: list[str] = []
    config_path = os.path.expanduser("~/.codex/config.toml")
    try:
        with open(config_path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line.startswith("model") and "=" in line and not line.startswith("model_"):
                    value = line.split("=", 1)[1].strip().strip("\"'")
                    if value:
                        ordered.append(value)
                        break
    except OSError:
        pass
    ordered.extend(_read_codex_models_cache_file())
    sticky = _read_codex_model_cache()
    if sticky:
        ordered.append(sticky)
    ordered.extend(CODEX_PICKER_MODELS)
    ordered.extend(CODEX_MODEL_FALLBACKS)
    return _dedupe_keep(ordered)


def _list_claude_models() -> list[str]:
    fallback = [
        "claude-sonnet-4-5",
        "claude-opus-4-5",
        "claude-haiku-4-5",
        "sonnet",
        "opus",
        "haiku",
    ]
    for command in (
        ["claude", "models"],
        ["claude", "--list-models"],
    ):
        lines = _run_lines(command, timeout=_DISCOVERY_CMD_TIMEOUT)
        blob = "\n".join(lines).lower()
        if any(m in blob for m in ("not logged in", "please run /login", "please login")):
            return fallback
        tokens: list[str] = []
        for line in lines:
            if line.lower().startswith("usage") or line.startswith("-"):
                continue
            # Full model id on its own column / line first.
            for match in re.findall(r"\bclaude-[\w.\-]+\b", line):
                if match not in tokens:
                    tokens.append(match)
            for part in re.split(r"[\s,|]+", line):
                p = part.strip()
                if p in ("sonnet", "opus", "haiku") and p not in tokens:
                    tokens.append(p)
        if tokens:
            return tokens
    return fallback


def _list_gemini_models() -> list[str]:
    """List Gemini models from `agy models` (Antigravity) or `gemini --help`."""
    known = [
        "gemini-3.6-flash-low",
        "gemini-3.6-flash-medium",
        "gemini-3.5-flash-low",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
    ]
    found: list[str] = []
    # agy models prints "gemini-3.6-flash-highGemini 3.6 Flash (High)" (id glued to Title).
    agy = _try_which("agy")
    if agy:
        for line in _run_lines([agy, "models"], timeout=_DISCOVERY_CMD_TIMEOUT):
            text = line.strip()
            if not text or text.lower().startswith(("usage", "fetching", "error", "options")):
                continue
            # Split id from glued Title Case label: high|Gemini
            head = re.split(r"(?<=[a-z0-9])(?=[A-Z][a-z])", text, maxsplit=1)[0].strip()
            token = head.split()[0] if head.split() else ""
            token = token.strip("()[],")
            if (
                token
                and token not in found
                and (token.startswith("gemini-") or token.startswith("claude-") or token.startswith("gpt-"))
            ):
                found.append(token)
        if found:
            return found[:80]
    for binary in ("gemini", "agy"):
        path = _try_which(binary)
        if not path:
            continue
        for line in _run_lines([path, "--help"], timeout=5):
            for token in re.findall(r"gemini-[\w.\-]+", line):
                # Strip accidental CamelCase glue from help text too.
                clean = re.split(r"(?<=[a-z0-9])(?=[A-Z][a-z])", token, maxsplit=1)[0]
                if clean not in found:
                    found.append(clean)
        if found:
            return found[:80]
    return known


def _list_grok_models() -> list[str]:
    lines = _run_lines(["grok", "models"], timeout=_DISCOVERY_CMD_TIMEOUT)
    if not lines:
        lines = _run_lines(["agent", "models"], timeout=_DISCOVERY_CMD_TIMEOUT)
    ordered: list[str] = []
    in_available = False
    for line in lines:
        lower = line.lower()
        if "available model" in lower:
            in_available = True
            continue
        if in_available:
            # "* grok-4.5 (default)" or "  grok-4.5"
            token = re.sub(r"^[\s*•\-]+", "", line).split()[0] if line.split() else ""
            token = token.strip("()[],")
            if token.startswith("grok-") and token not in ordered:
                ordered.append(token)
                continue
            if lower.startswith("usage") or lower.startswith("options") or lower.startswith("grok "):
                break
        for token in re.findall(r"\bgrok-[\w.\-]+\b", line):
            if token not in ordered:
                ordered.append(token)
    if ordered:
        return ordered
    # help text fallback
    help_lines = _run_lines(["grok", "--help"], timeout=5)
    found = [t for line in help_lines for t in re.findall(r"\bgrok-[\w.\-]+\b", line)]
    return _dedupe_keep(found) or ["grok-4.5", "grok-4", "grok-3", "grok-3-mini"]


def _list_opencode_models() -> list[str]:
    for command in (
        ["opencode", "models"],
        ["opencode", "model", "list"],
    ):
        lines = _run_lines(command, timeout=_DISCOVERY_CMD_TIMEOUT)
        found: list[str] = []
        for line in lines:
            text = line.strip()
            if not text or text.lower().startswith(("usage", "error", "options")):
                continue
            # One model id per line is the common opencode format.
            if re.fullmatch(r"[\w.-]+/[\w.\-]+", text):
                if text not in found:
                    found.append(text)
                continue
            for token in re.findall(r"[\w.-]+/[\w.\-]+", text):
                if token not in found and "http" not in token:
                    found.append(token)
        if found:
            return found[:80]
    return []


def _list_cursor_models() -> list[str]:
    for binary in ("cursor-agent", "cursor"):
        path = _try_which(binary)
        if not path:
            continue
        lines = _run_lines([path, "--help"], timeout=5)
        found = re.findall(r"(?:gpt|claude|gemini|cursor)[\w.\-]*", "\n".join(lines), re.I)
        if found:
            return _dedupe_keep(found)
    return ["default"]


def _list_kimi_models() -> list[str]:
    return ["kimi-latest", "moonshot-v1-auto", "moonshot-v1-128k"]


def _list_pi_models() -> list[str]:
    """Models from `pi --list-models` as provider/model ids.

    Table format (v0.84+):
      provider        model                    context  ...
      openai-codex    gpt-5.4-mini             272K     ...
    """
    lines = _run_lines(["pi", "--list-models"], timeout=_DISCOVERY_CMD_TIMEOUT)
    blob = "\n".join(lines).lower()
    if any(
        marker in blob
        for marker in (
            "no models available",
            "no api key",
            "use /login",
            "not logged in",
        )
    ):
        return ["default"]
    found: list[str] = []
    for line in lines:
        text = line.strip()
        if not text:
            continue
        lower = text.lower()
        if lower.startswith(("usage", "options", "commands", "pi ", "use ", "see:", "error", "provider")):
            continue
        if any(noise in lower for noise in ("login", "api key", "providers.md", "models.md")):
            continue
        # Full provider/model already.
        slash = re.findall(r"\b[a-z][\w.-]*/[\w.:\-]+\b", text, flags=re.I)
        if slash:
            for token in slash:
                if token not in found and "http" not in token.lower():
                    found.append(token)
            continue
        # Two-column table: provider  model  context...
        parts = text.split()
        if len(parts) >= 2:
            provider, model_id = parts[0].strip(), parts[1].strip()
            if (
                provider
                and model_id
                and not provider.startswith("-")
                and model_id not in ("context", "max-out", "thinking", "images")
                and "http" not in model_id.lower()
            ):
                token = f"{provider}/{model_id}"
                if token not in found:
                    found.append(token)
                continue

    # Prefer providers that usually work with OAuth (codex/copilot) before OpenRouter credits.
    def _pi_rank(token: str) -> tuple[int, str]:
        lower = token.lower()
        if "openrouter" in lower:
            return (9, token)
        if lower.startswith("openai-codex/"):
            return (0, token)
        if lower.startswith("github-copilot/"):
            return (1, token)
        if lower.startswith("kimi"):
            return (2, token)
        return (5, token)

    ordered = sorted(found, key=_pi_rank)
    return ordered[:80] or ["default"]


# Specs: id → binary candidates, effort support, model lister.
_PROVIDER_DISCOVERY: tuple[dict[str, Any], ...] = (
    {"id": "codex", "bins": ("codex",), "effort": True, "list": _list_codex_models},
    {"id": "claude", "bins": ("claude",), "effort": False, "list": _list_claude_models},
    # Prefer stock `gemini` CLI; fall back to Antigravity `agy` (common Gemini path).
    {"id": "gemini", "bins": ("gemini", "agy"), "effort": True, "list": _list_gemini_models},
    {"id": "grok", "bins": ("grok", "agent"), "effort": True, "list": _list_grok_models},
    {"id": "ollama", "bins": ("ollama",), "effort": False, "list": _list_ollama_models},
    {"id": "opencode", "bins": ("opencode",), "effort": True, "list": _list_opencode_models},
    {"id": "cursor", "bins": ("cursor-agent", "cursor"), "effort": False, "list": _list_cursor_models},
    {"id": "kimi", "bins": ("kimi", "moonshot"), "effort": False, "list": _list_kimi_models},
    # Binary is `pi` (@earendil-works/pi-coding-agent); accept `pie` if someone aliases it.
    {"id": "pi", "bins": ("pi", "pie"), "effort": True, "list": _list_pi_models},
)


# Backends refine_prompt() can actually run today (picker only offers these).
_REFINE_RUNNABLE_BACKENDS = frozenset(
    {
        "codex",
        "claude",
        "gemini",
        "agy",
        "grok",
        "agent",
        "ollama",
        "opencode",
        "local",
        "auto",
        "pi",
        "pie",
    }
)


def _looks_like_cli_auth_or_config_failure(text: str) -> bool:
    blob = (text or "").strip().lower()
    if not blob:
        return False
    return any(marker in blob for marker in _CLI_AUTH_OR_CONFIG_FAIL_MARKERS)


def _looks_like_failed_model_output(text: str) -> bool:
    """True when CLI stdout is an error envelope, not a refined prompt.

    Several agents (pi, openrouter wrappers) print 402/JSON errors with exit 0.
    Those must never be typed into the caret as the "refined" draft.
    """
    blob = (text or "").strip()
    if not blob:
        return True
    if _looks_like_cli_help(blob) or _looks_like_cli_auth_or_config_failure(blob):
        return True
    if _quota_or_limit_error(blob) or _model_unavailable_error(blob):
        return True
    lower = blob.lower()
    if lower.startswith("402") or '"code":402' in lower or '"code": 402' in lower:
        return True
    if "invalid_request_error" in lower or "model_not_supported" in lower:
        return True
    # JSON error objects: {"message":"...","code":402} or {"error":{...}}
    return blob.startswith("{") and (
        '"error"' in lower or ('"code"' in lower and ("message" in lower or "credits" in lower))
    )


def _should_rotate_after_failure(detail: str) -> bool:
    """Rotate on quota/unavailable/auth/credits; stop only on empty unknown soft noise."""
    if not (detail or "").strip():
        return True
    if _looks_like_failed_model_output(detail):
        return True
    # Network / generic CLI failures: still try the next candidate.
    lower = detail.lower()
    return any(
        marker in lower
        for marker in (
            "failed",
            "error",
            "timeout",
            "timed out",
            "connection",
            "refused",
            "not found",
            "empty",
        )
    )


def _normalize_backend(backend: str) -> str:
    choice = (backend or DEFAULT_BACKEND).strip().lower() or DEFAULT_BACKEND
    if choice == "pie":
        return "pi"
    if choice == "agy":
        return "gemini"
    if choice == "agent":
        return "grok"
    return choice


def _backend_is_launchable(backend: str) -> bool:
    be = _normalize_backend(backend)
    if be == "local":
        return sys.platform == "darwin"
    if be == "codex":
        return bool(_try_which("codex"))
    if be == "claude":
        return bool(_try_which("claude"))
    if be == "gemini":
        return bool(_try_which("gemini") or _try_which("agy"))
    if be == "grok":
        return bool(_try_which("grok") or _try_which("agent"))
    if be == "ollama":
        return bool(_try_which("ollama"))
    if be == "opencode":
        return bool(_try_which("opencode"))
    if be == "pi":
        return bool(_try_which("pi") or _try_which("pie"))
    return False


def _model_candidates_for_backend(backend: str, preferred: str = "") -> list[str]:
    """Ordered model ids for one backend (preferred → sticky → discovery)."""
    be = _normalize_backend(backend)
    preferred_name = (preferred or "").strip()
    models: list[str] = []

    def push(name: str) -> None:
        token = (name or "").strip()
        if not token or token in models:
            return
        models.append(token)

    if preferred_name and preferred_name not in ("default", "auto", "menu"):
        push(preferred_name)

    sticky = _read_user_choice()
    if sticky.get("backend") == be and sticky.get("model"):
        push(sticky["model"])

    if be == "codex":
        for name in _codex_model_candidates(preferred_name or DEFAULT_MODEL):
            push(name)
        return models[:MAX_MODELS_PER_BACKEND]

    if be == "ollama":
        for name in _list_ollama_models():
            push(name)
        if not models:
            push("llama3.2")
        return models[:MAX_MODELS_PER_BACKEND]

    if be == "grok":
        for name in _list_grok_models():
            push(name)
        return models[:MAX_MODELS_PER_BACKEND] or ["grok-4.5"]

    if be == "claude":
        for name in _list_claude_models():
            push(name)
        return models[:MAX_MODELS_PER_BACKEND] or ["sonnet"]

    if be == "gemini":
        for name in _list_gemini_models():
            push(name)
        return models[:MAX_MODELS_PER_BACKEND] or ["gemini-3.6-flash-low"]

    if be == "opencode":
        for name in _list_opencode_models():
            push(name)
        return models[:MAX_MODELS_PER_BACKEND] or ["opencode/big-pickle"]

    if be == "pi":
        for name in _list_pi_models():
            push(name)
        return models[:MAX_MODELS_PER_BACKEND] or ["default"]

    push(preferred_name or "default")
    return models[:MAX_MODELS_PER_BACKEND]


def _build_attempt_queue(
    backend: str,
    model: str,
    *,
    cross_backend: bool = True,
) -> list[tuple[str, str]]:
    """Build (backend, model) attempts: preferred provider first, then others on PATH."""
    preferred_backend = _normalize_backend(backend)
    preferred_model = (model or "").strip()
    attempts: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()

    def add(be: str, mo: str) -> None:
        key = (_normalize_backend(be), (mo or "").strip())
        if not key[1] or key in seen:
            return
        if not _backend_is_launchable(key[0]) and key[0] != "local":
            return
        seen.add(key)
        attempts.append(key)

    if preferred_backend == "auto":
        sticky = _read_user_choice()
        order = list(_BACKEND_FALLBACK_ORDER)
        sticky_be = sticky.get("backend") or ""
        if sticky_be in _BACKEND_FALLBACK_ORDER:
            order = [sticky_be, *[b for b in order if b != sticky_be]]
        # Apple local is free/fast when available — try early for auto.
        if _backend_is_launchable("local"):
            add("local", "apple-fm")
        for be in order:
            sticky_model = sticky.get("model") if sticky.get("backend") == be else ""
            seed = preferred_model if be == sticky_be else sticky_model
            for mo in _model_candidates_for_backend(be, seed):
                add(be, mo)
                if len(attempts) >= MAX_MODELS_PER_BACKEND + MAX_CROSS_BACKEND_ATTEMPTS:
                    return attempts
        return attempts

    if preferred_backend == "local":
        add("local", "apple-fm")
        if not cross_backend:
            return attempts
        # After local fails, behave like auto without re-trying local.
        for be, mo in _build_attempt_queue("auto", preferred_model, cross_backend=False):
            if be != "local":
                add(be, mo)
        return attempts

    for mo in _model_candidates_for_backend(preferred_backend, preferred_model):
        add(preferred_backend, mo)

    if not cross_backend:
        return attempts

    sticky = _read_user_choice()
    cross = 0
    for be in _BACKEND_FALLBACK_ORDER:
        if be == preferred_backend:
            continue
        if not _backend_is_launchable(be):
            continue
        sticky_model = sticky.get("model") if sticky.get("backend") == be else ""
        cands = _model_candidates_for_backend(be, sticky_model)
        if not cands:
            continue
        add(be, cands[0])
        cross += 1
        if cross >= MAX_CROSS_BACKEND_ATTEMPTS:
            break
    return attempts[:MAX_TOTAL_ATTEMPTS]


def _dispatch_single(
    backend: str,
    model: str,
    reasoning_effort: str,
    original: str,
) -> str:
    """One backend+model attempt (no rotation). Raises RuntimeError on failure."""
    be = _normalize_backend(backend)
    effort = (reasoning_effort or "").strip().lower()
    if be == "local":
        refined = refine_prompt_local(original)
    elif be == "codex":
        # Single codex model — no nested rotation/picker (outer loop owns that).
        codex = _which("codex")
        prompt = build_user_prompt(original)
        refined_opt, detail = _run_codex_candidate(
            codex, model or DEFAULT_MODEL, prompt, effort or DEFAULT_REASONING_EFFORT
        )
        if refined_opt is None:
            raise RuntimeError(detail or "codex refine failed")
        refined = refined_opt
        if _looks_like_failed_model_output(refined):
            raise RuntimeError((detail or refined)[:2000])
    elif be == "grok":
        refined = refine_prompt_grok(original, model=model, reasoning_effort=effort)
    elif be == "ollama":
        refined = refine_prompt_ollama(original, model=model or "llama3.2")
    elif be == "opencode":
        refined = refine_prompt_opencode(original, model=model, reasoning_effort=effort)
    elif be == "claude":
        refined = refine_prompt_claude(original, model=model)
    elif be == "gemini":
        refined = refine_prompt_gemini(original, model=model, reasoning_effort=effort)
    elif be == "pi":
        refined = refine_prompt_pi(original, model=model, reasoning_effort=effort)
    else:
        raise RuntimeError(f"Unknown prompt refinement backend: {backend!r}")
    if _looks_like_failed_model_output(refined):
        raise RuntimeError(refined[:2000])
    return validate_refined_prompt(original, refined)


def _discover_one(spec: dict[str, Any]) -> dict[str, Any] | None:
    binary_path = None
    binary_name = ""
    for name in spec["bins"]:
        binary_path = _try_which(name)
        if binary_path:
            binary_name = name
            break
    if not binary_path:
        return None
    try:
        models = list(spec["list"]())
    except Exception:
        models = []
    if not models:
        models = ["default"]
    return {
        "id": spec["id"],
        "binary": binary_name,
        "path": binary_path,
        "effort": bool(spec["effort"]),
        "models": models,
        "runnable": spec["id"] in _REFINE_RUNNABLE_BACKENDS,
    }


def discover_providers(
    *,
    runnable_only: bool = False,
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    """Return providers with a binary on PATH + model ids discovered on this machine.

    Parallel + memoized so `pick-refine` does not block ~40s x2 on slow CLIs.
    """
    global _discovery_memo, _discovery_memo_at
    now = time.time()
    if not force_refresh and _discovery_memo is not None and (now - _discovery_memo_at) < _DISCOVERY_CACHE_TTL_SECS:
        found = list(_discovery_memo.get("providers") or [])
    else:
        # Discover binaries first (fast), then list models in parallel (slow CLIs).
        present: list[dict[str, Any]] = []
        for spec in _PROVIDER_DISCOVERY:
            for name in spec["bins"]:
                if _try_which(name):
                    present.append(spec)
                    break
        found: list[dict[str, Any]] = []
        if present:
            try:
                with ThreadPoolExecutor(max_workers=min(8, len(present))) as pool:
                    futures = [pool.submit(_discover_one, spec) for spec in present]
                    for fut in as_completed(futures):
                        try:
                            row = fut.result()
                        except Exception:
                            row = None
                        if row:
                            found.append(row)
                # Keep stable order matching _PROVIDER_DISCOVERY.
                order = {spec["id"]: index for index, spec in enumerate(_PROVIDER_DISCOVERY)}
                found.sort(key=lambda row: order.get(row["id"], 999))
            except Exception:
                found = []
                for spec in present:
                    row = _discover_one(spec)
                    if row:
                        found.append(row)
        _discovery_memo = {"providers": found}
        _discovery_memo_at = now

    if runnable_only:
        return [p for p in found if p.get("runnable")]
    return list(found)


def discover_providers_json() -> str:
    return json.dumps({"providers": discover_providers(force_refresh=True)}, indent=2)


def _picker_models_for_backend(
    backend: str,
    *,
    preferred: str = "",
    exclude: set[str] | None = None,
    providers: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Model ids for one backend. Pass `providers` to avoid a second full discovery."""
    exclude = exclude or set()
    providers_map = {p["id"]: p for p in discover_providers()} if providers is None else {p["id"]: p for p in providers}
    models_src: list[str] = []
    if backend in providers_map:
        models_src.extend(providers_map[backend]["models"])
    if backend in ("codex", "auto"):
        # Live cache first, then curated (already mostly inside _list_codex_models).
        models_src.extend(_read_codex_models_cache_file())
        models_src.extend(CODEX_PICKER_MODELS)
        models_src.extend(CODEX_MODEL_FALLBACKS)
    ordered: list[str] = []
    for name in (
        preferred,
        _read_codex_model_cache() if backend in ("codex", "auto") else "",
        _read_user_choice().get("model", "") if backend in ("codex", "auto") else "",
        *models_src,
    ):
        token = (name or "").strip()
        if not token or token in ordered or token in exclude:
            continue
        ordered.append(token)
    return ordered


def _picker_models(*, preferred: str = "", exclude: set[str] | None = None) -> list[str]:
    """Backward-compat: codex-oriented model list + skip label."""
    models = _picker_models_for_backend("codex", preferred=preferred, exclude=exclude)
    models.append(SKIP_REFINE_LABEL)
    return models


def pick_refine_target(
    *,
    reason: str = "",
    preferred_backend: str = "",
    preferred_model: str = "",
    preferred_effort: str = "",
    exclude_models: set[str] | None = None,
    include_skip: bool = True,
    use_gui: bool | None = None,
) -> dict[str, str] | None:
    """Interactive pick of backend + model + effort from providers on this machine.

    Returns {"backend", "model", "reasoningEffort"} or None if cancelled.
    model may be SKIP_REFINE_LABEL when include_skip.
    """
    gui = _picker_enabled() if use_gui is None else use_gui
    # Only offer backends we can actually invoke for refine.
    print("Discovering refine providers on this machine…", file=sys.stderr, flush=True)
    providers = discover_providers(runnable_only=True)
    if not providers:
        if gui:
            _macos_alert(
                "No refine providers",
                "No known agent CLIs found on PATH (codex, claude, gemini, grok, ollama, opencode, …).",
            )
        else:
            print(
                "No known agent CLIs found on PATH (codex, claude, gemini, grok, ollama, opencode, …).",
                file=sys.stderr,
            )
        return None

    backend_labels = [f"{p['id']}  ({p['binary']}, {len(p['models'])} models)" for p in providers]
    backend_ids = [p["id"] for p in providers]
    pref_b = (preferred_backend or "").strip().lower()
    default_label = ""
    if pref_b in backend_ids:
        default_label = backend_labels[backend_ids.index(pref_b)]
    elif backend_labels:
        default_label = backend_labels[0]

    summary = reason.strip() or "Choose a refine provider available on this machine."
    if len(summary) > 280:
        summary = summary[:277] + "…"

    if gui:
        if reason.strip():
            _macos_alert("Prompt refine — pick provider / model", summary)
        backend_choice = _macos_choose_from_list(
            title="Dufflebag refine",
            prompt="Provider (detected on this Mac):",
            items=backend_labels,
            default=default_label,
        )
        if backend_choice is None:
            return None
        try:
            backend = backend_ids[backend_labels.index(backend_choice)]
        except ValueError:
            # Label mismatch (rare AppleScript encoding); match by id prefix.
            backend = next(
                (bid for bid, label in zip(backend_ids, backend_labels, strict=False) if label == backend_choice),
                backend_ids[0],
            )
    else:
        # TTY stdin menu for CLI `pick-refine`
        print(summary, file=sys.stderr)
        print("Providers:", file=sys.stderr)
        for index, label in enumerate(backend_labels, start=1):
            print(f"  {index}. {label}", file=sys.stderr)
        try:
            provider_selection = input(f"Provider [1-{len(backend_labels)}]: ").strip()
        except EOFError:
            return None
        if not provider_selection:
            backend = backend_ids[0]
        elif provider_selection.isdigit() and 1 <= int(provider_selection) <= len(backend_ids):
            backend = backend_ids[int(provider_selection) - 1]
        elif provider_selection.lower() in backend_ids:
            backend = provider_selection.lower()
        else:
            return None

    # Reuse the already-discovered provider list (do NOT scan again).
    models = _picker_models_for_backend(
        backend,
        preferred=preferred_model,
        exclude=exclude_models,
        providers=providers,
    )
    if include_skip:
        models = [*models, SKIP_REFINE_LABEL]
    if not models:
        models = ["default", SKIP_REFINE_LABEL] if include_skip else ["default"]

    if gui:
        model = _macos_choose_from_list(
            title="Dufflebag refine",
            prompt=f"Model for {backend}:",
            items=models,
            default=preferred_model if preferred_model in models else models[0],
        )
        if model is None:
            return None
    else:
        print(f"Models for {backend}:", file=sys.stderr)
        for index, name in enumerate(models, start=1):
            print(f"  {index}. {name}", file=sys.stderr)
        try:
            model_selection = input(f"Model [1-{len(models)}]: ").strip()
        except EOFError:
            return None
        if not model_selection:
            model = models[0]
        elif model_selection.isdigit() and 1 <= int(model_selection) <= len(models):
            model = models[int(model_selection) - 1]
        else:
            model = model_selection

    if model == SKIP_REFINE_LABEL:
        return {"backend": backend, "model": SKIP_REFINE_LABEL, "reasoningEffort": ""}

    prov = next((p for p in providers if p["id"] == backend), None)
    supports_effort = bool(prov and prov.get("effort"))
    effort = ""
    if supports_effort:
        effort_default = (preferred_effort or DEFAULT_REASONING_EFFORT).strip().lower()
        if effort_default not in REASONING_EFFORT_OPTIONS:
            effort_default = DEFAULT_REASONING_EFFORT
        if gui:
            effort_pick = _macos_choose_from_list(
                title="Dufflebag refine",
                prompt=f"Reasoning effort for {model}:",
                items=list(REASONING_EFFORT_OPTIONS),
                default=effort_default,
            )
            if effort_pick is None:
                return None
            effort = effort_pick
        else:
            print(f"Reasoning: {', '.join(REASONING_EFFORT_OPTIONS)}", file=sys.stderr)
            try:
                effort_selection = input(f"Effort [{effort_default}]: ").strip().lower()
            except EOFError:
                return None
            effort = effort_selection if effort_selection in REASONING_EFFORT_OPTIONS else effort_default

    return {"backend": backend, "model": model, "reasoningEffort": effort}


def pick_model_and_effort(
    *,
    reason: str,
    preferred_model: str = "",
    preferred_effort: str = "",
    exclude_models: set[str] | None = None,
) -> tuple[str, str] | None:
    """Backward-compat wrapper → (model, effort). Prefer pick_refine_target."""
    picked = pick_refine_target(
        reason=reason,
        preferred_model=preferred_model,
        preferred_effort=preferred_effort,
        exclude_models=exclude_models,
        include_skip=True,
        use_gui=True,
    )
    if picked is None:
        return None
    return picked["model"], picked.get("reasoningEffort") or ""


def _codex_model_candidates(preferred: str) -> list[str]:
    """Build try-order: last-good (if preferred is known-dead) → preferred → fallbacks.

    Known-unavailable models are deferred to the end so we do not re-pay a 3s
    ChatGPT-account rejection on every Ctrl release after the first failure.
    """
    preferred_name = (preferred or "").strip() or DEFAULT_MODEL
    last_good = _read_codex_model_cache()
    failed = _read_codex_failed_models()

    head: list[str] = []
    if preferred_name in failed and last_good and last_good not in failed:
        head = [last_good, preferred_name]
    else:
        head = [preferred_name]
        if last_good:
            head.append(last_good)

    ordered: list[str] = []
    deferred: list[str] = []
    for candidate in (*head, *CODEX_MODEL_FALLBACKS):
        name = (candidate or "").strip()
        if not name or name in ordered or name in deferred:
            continue
        if name in failed and name != preferred_name:
            # Still allow a single re-check of the preferred id occasionally via head.
            deferred.append(name)
            continue
        if name in failed and name == preferred_name and last_good and last_good not in failed:
            deferred.append(name)
            continue
        ordered.append(name)
    ordered.extend(deferred)
    return ordered


def _run_codex_candidate(
    codex: str,
    candidate: str,
    prompt: str,
    effort: str,
) -> tuple[str | None, str]:
    """Run one Codex model. Returns (refined_text|None, detail)."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as handle:
        out_path = handle.name
    try:
        command = [
            codex,
            "exec",
            "-m",
            candidate,
            "--ephemeral",
            "--skip-git-repo-check",
            "-s",
            "read-only",
            "--color",
            "never",
            "-o",
            out_path,
            prompt,
        ]
        if effort:
            command[2:2] = ["-c", f'model_reasoning_effort="{effort}"']
        completed = _run(command)
        # Prefer the -o file; only fall back to stdout when exit is clean.
        # Codex often dumps ERROR JSON to stdout with non-zero status for bad
        # models — that must not be treated as a refined prompt (it blocked rotation).
        file_refined = ""
        if os.path.isfile(out_path):
            with open(out_path, encoding="utf-8") as handle:
                file_refined = handle.read().strip()
        detail = (_stdout_text(completed) or "")[:2000]
        if completed.returncode != 0 and not file_refined:
            return None, detail or "codex exec failed"

        refined = file_refined
        if not refined:
            refined = _extract_json_text(completed.stdout or "") or _stdout_text(completed)
            lines = [line.strip() for line in refined.splitlines() if line.strip()]
            lines = [
                line
                for line in lines
                if not line.startswith("ERROR:")
                and not line.startswith("warning:")
                and "invalid_request_error" not in line
            ]
            refined = lines[-1] if lines else ""
        if not refined.strip():
            return None, detail or "codex refine returned empty output"
        return refined, detail
    finally:
        with contextlib.suppress(OSError):
            os.unlink(out_path)


def refine_prompt_codex(
    original: str,
    model: str = DEFAULT_MODEL,
    reasoning_effort: str = "",
    *,
    allow_picker: bool = True,
    _picker_rounds: int = 0,
) -> str:
    codex = _which("codex")
    preferred = (model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    # Prefer sticky user picker choice when preferred was not explicitly overridden
    # via a still-working last-good path.
    user_choice = _read_user_choice()
    if user_choice.get("model") and not model:
        preferred = user_choice["model"]
    # Empty effort → low so reasoning models don't sit on xhigh after Ctrl release.
    effort = (reasoning_effort or user_choice.get("reasoningEffort") or "").strip().lower()
    effort = effort or DEFAULT_REASONING_EFFORT
    prompt = build_user_prompt(original)
    candidates = _codex_model_candidates(preferred)
    errors: list[str] = []
    quota_hits: list[str] = []
    tried: set[str] = set()
    picker_rounds = _picker_rounds

    def offer_picker(reason: str, *, exclude: set[str]) -> str:
        nonlocal preferred, effort, candidates, picker_rounds
        if not allow_picker or picker_rounds >= MAX_PICKER_ROUNDS or not _picker_enabled():
            raise RuntimeError(reason[:2000])
        picker_rounds += 1
        picked = pick_refine_target(
            reason=reason,
            preferred_backend="codex",
            preferred_model=preferred,
            preferred_effort=effort,
            exclude_models=exclude,
            include_skip=True,
            use_gui=True,
        )
        if picked is None:
            raise RuntimeError(f"codex refine cancelled at model picker: {reason}"[:2000])
        pick_model = picked["model"]
        pick_effort = picked.get("reasoningEffort") or DEFAULT_REASONING_EFFORT
        pick_backend = (picked.get("backend") or "codex").strip().lower()
        if pick_model == SKIP_REFINE_LABEL:
            print("refine skipped via picker; returning raw draft", file=sys.stderr)
            return original.strip()
        _persist_refine_choice(pick_model, pick_effort, backend=pick_backend)
        # User switched provider — re-dispatch outside the codex loop.
        if pick_backend not in ("codex", "auto"):
            print(
                f"picker switched refine backend codex → {pick_backend}/{pick_model}",
                file=sys.stderr,
            )
            return refine_prompt(
                original,
                backend=pick_backend,
                model=pick_model,
                reasoning_effort=pick_effort,
                allow_picker=False,
            )
        preferred = pick_model
        effort = pick_effort or DEFAULT_REASONING_EFFORT
        rest = [name for name in candidates if name not in tried and name != preferred]
        candidates = [preferred, *rest]
        return ""  # empty means continue loop

    while candidates:
        candidate = candidates.pop(0)
        if candidate in tried:
            continue
        tried.add(candidate)
        refined, detail = _run_codex_candidate(codex, candidate, prompt, effort)
        if refined is None:
            errors.append(f"{candidate}: {detail}")
            if _quota_or_limit_error(detail):
                quota_hits.append(candidate)
                print(
                    f"codex model {candidate!r} hit quota/limit; opening model picker…",
                    file=sys.stderr,
                )
                if allow_picker and picker_rounds < MAX_PICKER_ROUNDS and _picker_enabled():
                    skipped = offer_picker(
                        f"Quota or rate limit on {candidate}.\n{detail[:400]}",
                        exclude={candidate, *quota_hits},
                    )
                    if skipped:
                        return skipped
                    continue
                # Headless / picker disabled: try next model rather than hard-fail.
                if candidates:
                    print(
                        f"codex model {candidate!r} quota/limit; trying next fallback…",
                        file=sys.stderr,
                    )
                    continue
                raise RuntimeError(f"codex refine quota/limit: {detail}"[:2000])

            if _model_unavailable_error(detail):
                _mark_codex_model_failed(candidate)
                if candidates:
                    print(
                        f"codex model {candidate!r} unavailable; trying {candidates[0]!r}",
                        file=sys.stderr,
                    )
                    continue
                break

            # Non-model failure (auth, network): do not burn the whole rotation.
            raise RuntimeError(detail or "codex exec failed")

        try:
            validated = validate_refined_prompt(original, refined)
        except ValueError as error:
            errors.append(f"{candidate}: {error}")
            # Do not rotate on a successful model that merely broke a literal.
            raise
        if candidate != preferred:
            print(
                f"codex refine used fallback model {candidate!r} (preferred {preferred!r})",
                file=sys.stderr,
            )
        _write_codex_model_cache(candidate)
        _clear_codex_model_failed(candidate)
        return validated

    # All automatic candidates exhausted — offer a last-chance picker.
    joined = "; ".join(errors) if errors else "no codex models available"
    if allow_picker and picker_rounds < MAX_PICKER_ROUNDS and _picker_enabled():
        skipped = offer_picker(
            f"All automatic models failed ({'quota/limit' if quota_hits else 'unavailable'}).\n{joined[:500]}",
            exclude=set(quota_hits),
        )
        if skipped:
            return skipped
        # Retry with the user-chosen candidate list built by offer_picker.
        return refine_prompt_codex(
            original,
            model=preferred,
            reasoning_effort=effort,
            allow_picker=True,
            _picker_rounds=picker_rounds,
        )
    raise RuntimeError(f"codex refine failed after model rotation: {joined}"[:2000])


def refine_prompt_grok(original: str, model: str = "", reasoning_effort: str = "") -> str:
    # grok and `agent` are the same Grok Build CLI.
    try:
        binary = _which("grok")
    except RuntimeError:
        binary = _which("agent")
    prompt = build_user_prompt(original)
    command = [
        binary,
        "-p",
        prompt,
        "--output-format",
        "plain",
        "--always-approve",
        "--max-turns",
        "1",
        "--no-subagents",
        "--disable-web-search",
    ]
    if model.strip():
        command.extend(["-m", model.strip()])
    if reasoning_effort.strip():
        command.extend(["--reasoning-effort", reasoning_effort.strip()])
    completed = _run(command, timeout=180)
    refined = _stdout_text(completed)
    if completed.returncode != 0 and not refined:
        raise RuntimeError(refined or "grok refine failed")
    if _looks_like_failed_model_output(refined):
        raise RuntimeError((refined or "grok refine failed")[:2000])
    # Plain mode is already the answer; strip chatter if any.
    return validate_refined_prompt(original, refined)


def refine_prompt_ollama(original: str, model: str = "llama3.2") -> str:
    binary = _which("ollama")
    model = (model or "llama3.2").strip() or "llama3.2"
    prompt = build_user_prompt(original)
    # Non-interactive: ollama run MODEL prompt
    completed = _run([binary, "run", model, prompt], timeout=180)
    refined = _stdout_text(completed)
    if completed.returncode != 0 and not refined:
        # HTTP fallback when CLI is picky
        refined = _ollama_http(model, prompt)
    if not refined:
        raise RuntimeError("ollama returned empty refine output")
    return validate_refined_prompt(original, refined)


def _ollama_http(model: str, prompt: str) -> str:
    import urllib.error
    import urllib.request

    ollama_request_bytes = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode("utf-8")
    request = urllib.request.Request(
        "http://127.0.0.1:11434/api/generate",
        data=ollama_request_bytes,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as ollama_http_reply:
            ollama_generate_document = json.loads(ollama_http_reply.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError(f"ollama HTTP refine failed: {error}") from error
    return str(ollama_generate_document.get("response") or "").strip()


def refine_prompt_opencode(
    original: str,
    model: str = "",
    reasoning_effort: str = "",
) -> str:
    """Refine via `opencode run` (message is positional; --format json).

    OpenCode 1.x CLI (verified):
      opencode run [message..] -m provider/model --format json [--variant effort]

    Historical bug: `--prompt` is not a flag. yargs then dumps help to stdout
    with exit 0, and STT refine pasted the huge help wall into the caret.
    """
    binary = _which("opencode")
    prompt = build_user_prompt(original)
    # Message must be positional (after options). Never pass --prompt.
    command = [binary, "run", "--format", "json"]
    model_token = (model or "").strip()
    if model_token and model_token not in ("default", "opencode", "auto"):
        command.extend(["-m", model_token])
    # --variant is provider-specific reasoning effort (high, max, minimal, …).
    effort = (reasoning_effort or "").strip().lower()
    if effort in ("minimal", "low", "medium", "high", "max"):
        command.extend(["--variant", effort])
    elif effort == "xhigh":
        command.extend(["--variant", "max"])
    command.append(prompt)

    completed = _run(command, timeout=180)
    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    refined = _extract_json_text(stdout)
    if not refined:
        blob = _stdout_text(completed)
        if _looks_like_cli_help(blob):
            raise RuntimeError(
                "opencode refine got CLI help instead of a reply "
                "(invoke as: opencode run -m provider/model --format json <prompt>)"
            )
        refined = blob
    if completed.returncode != 0 and not refined:
        detail = (stderr or stdout or "opencode refine failed").strip()
        raise RuntimeError(detail[:2000])
    if _looks_like_failed_model_output(refined):
        raise RuntimeError((refined or "opencode refine failed")[:2000])
    try:
        return validate_refined_prompt(original, refined)
    except ValueError as error:
        detail = f"{error}; stderr={(stderr or '')[:400]}"
        raise RuntimeError(detail[:2000]) from error


def refine_prompt_claude(original: str, model: str = "") -> str:
    binary = _which("claude")
    prompt = build_user_prompt(original)
    command = [binary, "-p", prompt, "--output-format", "text"]
    if model.strip():
        command.extend(["--model", model.strip()])
    completed = _run(command, timeout=180)
    refined = _extract_json_text(completed.stdout or "") or _stdout_text(completed)
    if completed.returncode != 0 and not refined:
        raise RuntimeError(refined or "claude refine failed")
    if _looks_like_failed_model_output(refined):
        raise RuntimeError((refined or "claude refine failed")[:2000])
    return validate_refined_prompt(original, refined)


def refine_prompt_gemini(
    original: str,
    model: str = "",
    reasoning_effort: str = "",
) -> str:
    """Refine via Google Gemini CLI (`gemini`) or Antigravity (`agy`).

    agy print mode: flags first, then `--print <prompt>` (or `-p <prompt>`).
    `-p` consumes the *next* argv as the prompt, so never put other flags after it.
    """
    binary = _try_which("gemini") or _try_which("agy")
    if not binary:
        raise RuntimeError("gemini/agy CLI not found on PATH")
    prompt = build_user_prompt(original)
    model_token = (model or "").strip()
    effort = (reasoning_effort or "").strip().lower()
    binary_name = os.path.basename(binary).lower()

    if binary_name == "agy" or binary.endswith("/agy"):
        # Antigravity (agy): --print takes the prompt; prefer JSON for clean extraction.
        command = [binary, "--output-format", "json"]
        if model_token and model_token not in ("default", "gemini", "auto"):
            command.extend(["--model", model_token])
        if effort in ("low", "medium", "high"):
            command.extend(["--effort", effort])
        elif effort in ("minimal", "xhigh", "max"):
            command.extend(["--effort", "high" if effort in ("xhigh", "max") else "low"])
        # --print last so nothing is swallowed as the prompt string.
        command.extend(["--print", prompt])
    else:
        # Stock gemini CLI (google-gemini-cli style): -p prompt, -m model.
        command = [binary, "-p", prompt]
        if model_token and model_token not in ("default", "gemini", "auto"):
            command.extend(["-m", model_token])

    completed = _run(command, timeout=180)
    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    refined = _extract_json_text(stdout)
    if not refined:
        # agy JSON: {"response":"…","status":"SUCCESS",…}
        try:
            agy_print_document = json.loads(stdout.strip())
            if isinstance(agy_print_document, dict) and isinstance(agy_print_document.get("response"), str):
                refined = agy_print_document["response"].strip()
        except json.JSONDecodeError:
            refined = ""
    if not refined:
        refined = _stdout_text(completed)
    if _looks_like_failed_model_output(refined):
        raise RuntimeError((refined or "gemini/agy refine failed")[:2000])
    if completed.returncode != 0 and not refined:
        raise RuntimeError((stderr or refined or "gemini/agy refine failed")[:2000])
    return validate_refined_prompt(original, refined)


def refine_prompt_pi(
    original: str,
    model: str = "",
    reasoning_effort: str = "",
) -> str:
    """Refine via `pi` (pi-coding-agent): print mode, no tools, ephemeral session."""
    binary = _try_which("pi") or _try_which("pie")
    if not binary:
        raise RuntimeError("pi (or pie) not found on PATH")
    prompt = build_user_prompt(original)
    # -p/--print: non-interactive; --no-tools: pure LLM rewrite; --no-session: no save.
    # Put options before -p; message is a trailing positional (pi accepts both).
    command = [
        binary,
        "--no-tools",
        "--no-session",
        "--mode",
        "text",
    ]
    model_token = (model or "").strip()
    if model_token and model_token not in ("default", "pi-latest"):
        # Supports "provider/id" and optional ":thinking" suffix.
        command.extend(["--model", model_token])
    effort = (reasoning_effort or "").strip().lower()
    if effort in REASONING_EFFORT_OPTIONS or effort in ("off", "max"):
        command.extend(["--thinking", effort or "low"])
    elif effort:
        command.extend(["--thinking", "low"])
    command.extend(["-p", prompt])
    completed = _run(command, timeout=180)
    refined = _extract_json_text(completed.stdout or "") or _stdout_text(completed)
    # pi often prints OpenRouter 402 JSON with exit 0 — still a hard failure.
    if _looks_like_failed_model_output(refined):
        raise RuntimeError((refined or "pi refine failed")[:2000])
    if completed.returncode != 0 and not refined:
        err = refined or _stdout_text(completed) or "pi refine failed"
        raise RuntimeError(err[:2000])
    if not refined:
        raise RuntimeError("pi refine returned empty output")
    return validate_refined_prompt(original, refined)


def refine_prompt(
    original: str,
    backend: str = DEFAULT_BACKEND,
    model: str = DEFAULT_MODEL,
    reasoning_effort: str = "",
    *,
    allow_picker: bool = True,
) -> str:
    """Refine via preferred provider, rotating models then backends on failure.

    Try order:
      1. Requested backend x preferred model, then that backend's discovery list
      2. Other launchable backends on PATH (last-good sticky model first)
      3. Optional macOS picker (or skip) after exhaustion

    Codex keeps its specialized last-good / failed-model bookkeeping when selected
    as the preferred backend (via candidate list + single-model dispatch).
    """
    draft = original.strip()
    if not draft:
        raise ValueError("Nothing to refine")
    choice = _normalize_backend(backend)
    effort = (reasoning_effort or "").strip().lower()
    if choice not in KNOWN_BACKENDS and choice not in _REFINE_RUNNABLE_BACKENDS:
        raise ValueError(f"Unknown prompt refinement backend: {backend!r}. Known: {', '.join(KNOWN_BACKENDS)}")

    # Sticky effort when caller left it empty.
    sticky = _read_user_choice()
    if not effort:
        effort = sticky.get("reasoningEffort") or DEFAULT_REASONING_EFFORT

    attempts = _build_attempt_queue(choice, model or sticky.get("model") or DEFAULT_MODEL)
    if not attempts:
        raise RuntimeError(
            "No refine providers available on PATH (install codex/opencode/pi/agy/… or enable Apple local)."
        )

    errors: list[str] = []
    for be, mo in attempts:
        try:
            print(f"refine try {be}/{mo}", file=sys.stderr)
            refined = _dispatch_single(be, mo, effort, draft)
            if be != choice or mo != (model or "").strip():
                print(
                    f"refine fell back to {be}/{mo} (preferred {choice}/{(model or '').strip() or 'default'})",
                    file=sys.stderr,
                )
            _persist_refine_choice(mo, effort, backend=be)
            if be == "codex":
                _write_codex_model_cache(mo)
                _clear_codex_model_failed(mo)
            return refined
        except Exception as error:
            detail = str(error)
            errors.append(f"{be}/{mo}: {detail[:400]}")
            if be == "codex" and _model_unavailable_error(detail):
                _mark_codex_model_failed(mo)
            if not _should_rotate_after_failure(detail):
                break
            print(f"refine rotate after {be}/{mo}: {detail[:160]}", file=sys.stderr)
            continue

    joined = "; ".join(errors) if errors else "all refine attempts failed"
    if allow_picker and _picker_enabled():
        picked = pick_refine_target(
            reason=f"Automatic refine fallbacks failed.\n{joined[:500]}",
            preferred_backend=choice,
            preferred_model=(model or "").strip(),
            preferred_effort=effort,
            include_skip=True,
            use_gui=True,
        )
        if picked is None:
            raise RuntimeError(f"refine cancelled at picker: {joined}"[:2000])
        if picked["model"] == SKIP_REFINE_LABEL:
            print("refine skipped via picker; returning raw draft", file=sys.stderr)
            return draft
        pick_backend = _normalize_backend(picked.get("backend") or choice)
        pick_model = picked["model"]
        pick_effort = picked.get("reasoningEffort") or effort or DEFAULT_REASONING_EFFORT
        _persist_refine_choice(pick_model, pick_effort, backend=pick_backend)
        # One more explicit attempt with the user's pick (no second picker).
        return _dispatch_single(pick_backend, pick_model, pick_effort, draft)

    raise RuntimeError(f"refine failed after fallbacks: {joined}"[:2000])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Refine a coding-agent prompt (route-aware, multi-provider).")
    parser.add_argument("--text", default="", help="Draft prompt text")
    parser.add_argument(
        "--backend",
        default=DEFAULT_BACKEND,
        help=f"Provider: {', '.join(KNOWN_BACKENDS)} (default: {DEFAULT_BACKEND})",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Model id for the provider (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--reasoning-effort",
        default="",
        dest="reasoning_effort",
        help="Optional reasoning effort (low|medium|high|xhigh|minimal)",
    )
    parser.add_argument(
        "--no-picker",
        action="store_true",
        help="Disable the macOS model/effort picker on quota or total failure (CI/headless).",
    )
    parser.add_argument(
        "--list-providers",
        action="store_true",
        help="JSON: providers + models discovered on this machine (no refine).",
    )
    parser.add_argument(
        "--pick-menu",
        action="store_true",
        help="Interactive pick of backend/model/effort; print JSON and persist prefs.",
    )
    parser.add_argument(
        "--gui",
        action="store_true",
        help="With --pick-menu, force macOS GUI dialogs (default on darwin TTY uses stdin).",
    )
    args = parser.parse_args(argv)

    if args.list_providers:
        print(discover_providers_json())
        return 0

    if args.pick_menu:
        use_gui = args.gui or (sys.platform == "darwin" and not sys.stdin.isatty())
        # Prefer GUI on macOS when user is not piping; TTY menu when interactive terminal.
        if sys.platform == "darwin" and sys.stdin.isatty() and not args.gui:
            use_gui = False
        if args.gui:
            use_gui = True
        picked = pick_refine_target(
            reason="Pick refine provider + model + effort for STT.",
            preferred_backend=args.backend,
            preferred_model=args.model,
            preferred_effort=args.reasoning_effort,
            include_skip=False,
            use_gui=use_gui,
        )
        if picked is None:
            print("cancelled", file=sys.stderr)
            return 1
        _persist_refine_choice(
            picked["model"],
            picked.get("reasoningEffort") or DEFAULT_REASONING_EFFORT,
            backend=picked.get("backend") or "",
        )
        print(json.dumps(picked, indent=2))
        return 0

    text = args.text
    if not text and not sys.stdin.isatty():
        text = sys.stdin.read()
    if not text.strip():
        print("error: pass --text or pipe stdin", file=sys.stderr)
        return 2
    if args.no_picker:
        os.environ["DUFFLEBAG_REFINE_NO_PICKER"] = "1"
    try:
        print(
            refine_prompt(
                text,
                backend=args.backend,
                model=args.model,
                reasoning_effort=args.reasoning_effort,
                allow_picker=not args.no_picker,
            )
        )
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
