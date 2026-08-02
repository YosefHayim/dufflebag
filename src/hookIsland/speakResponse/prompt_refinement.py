"""Validated Apple Foundation Models prompt refinement for the voice worker."""

from __future__ import annotations

import asyncio
import re
import sys
from typing import Any

PROMPT_REFINEMENT_INSTRUCTIONS = """Refine the user's draft into a precise prompt for a coding agent.
Preserve the exact intent, facts, constraints, code, commands, paths, URLs, quoted literals, and acceptance criteria.
Remove filler and repetition. Make implied deliverables explicit only when they are already supported by the draft.
Do not answer the prompt. Do not add commentary, labels, Markdown fences, or invented requirements.
Return only the revised prompt."""


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


def validate_refined_prompt(original: str, refined: str) -> str:
    clean = refined.strip()
    if not clean:
        raise ValueError("The local model returned an empty prompt")
    missing = [literal for literal in prompt_literals(original) if literal not in clean]
    if missing:
        raise ValueError(f"The local model changed a protected literal: {missing[0]}")
    return clean


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


async def generate_refined_prompt(original: str) -> str:
    import apple_fm_sdk as fm

    model = fm.SystemLanguageModel(guardrails=fm.SystemLanguageModelGuardrails.PERMISSIVE_CONTENT_TRANSFORMATIONS)
    available, reason = model.is_available()
    if not available:
        raise RuntimeError(f"Apple Foundation Models is unavailable: {refinement_unavailable_reason(reason)}")
    session = fm.LanguageModelSession(model=model, instructions=PROMPT_REFINEMENT_INSTRUCTIONS)
    refined_reply = await session.respond(prompt=original)
    return validate_refined_prompt(original, str(refined_reply))


def refine_prompt(original: str) -> str:
    if sys.platform != "darwin":
        raise RuntimeError("Prompt refinement currently requires macOS 26 or newer")
    return asyncio.run(generate_refined_prompt(original))
