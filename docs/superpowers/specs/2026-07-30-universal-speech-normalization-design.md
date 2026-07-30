# Universal Speech Normalization Design

## Status

Approved direction: deterministic, local, and shared by every narration source. No LLM may rewrite, summarize, or otherwise mediate a response.

## Goal

Make complete agent responses pleasant to hear without changing their meaning or displayed text. Every Claude Code, Codex, Grok, Devin, and manual example response must pass through the same speech-normalization path before Supertonic synthesis.

For example:

```text
Your disk is full: 127Mi free of 460Gi, 100% capacity. All 13 full-suite
failures are ENOSPC on the jest transform cache; zero logic failures. Also
1,381 stale tsx IPC pipes.
```

must be narrated as:

```text
Your disk is full: one hundred twenty-seven mebibytes free of four hundred
sixty gibibytes, one hundred percent capacity. All thirteen full-suite
failures are E N O S P C, meaning no space left on device, on the Jest transform
cache; zero logic failures. Also one thousand three hundred eighty-one stale
T S X I P C pipes.
```

The original response remains intact. Only the text sent to the speech engine is normalized.

## Boundaries

- Narrate the complete response in source order. Do not shorten or omit content.
- Use deterministic local code only. No LLM, remote service, or network request belongs in narration.
- Normalize English prose; unknown or ambiguous tokens pass through unchanged.
- Preserve fenced code, URLs, email addresses, file paths, hashes, and structured identifiers before applying prose rules.
- Keep the hook fail-open: narration failure must never block or alter the coding agent.
- Dictation is unchanged by this work.

## Design

`voice.py` will gain one pure `normalize_spoken_prose` boundary inside the Markdown renderer's prose path. All integrations already converge on `speak_markdown`, so this applies the behavior to every supported agent and to `dufflebag voice example` without provider-specific copies.

The normalizer processes each prose span in this order:

1. Separate protected technical spans from ordinary prose so later rules cannot corrupt them.
2. Expand quantities with units before standalone numbers, including byte units, durations, and percentages.
3. Convert grouped integers, signed values, decimals, ordinals, and currency with a pinned local number-to-words dependency.
4. Pronounce generic uppercase acronyms letter by letter.
5. Apply a small explicit developer glossary for lowercase tokens such as `tsx` and well-known codes such as `ENOSPC`. Error-code expansions retain both the literal code and its meaning.
6. Restore protected spans and preserve the existing Markdown-derived pacing.

Fenced code continues through `code_speech`, which reads every source line and translates syntax operators. Numeric prose normalization will not rewrite code literals. URLs and paths remain complete rather than being mistaken for decimals, fractions, or units.

## Dependency Choice

Use the pinned `num2words` package for English cardinal, ordinal, and decimal conversion. It is a small, pure-Python dependency and avoids maintaining a brittle home-grown grammar. Dufflebag owns all context detection—units, percentages, versions, paths, acronyms, and error codes—because a number library cannot decide those meanings.

The package is added to the existing PEP 723 dependency list and `voice.py.lock`, preserving the single-file worker and reproducible `uv` installation model.

## Failure Behavior

Normalization is token-local and fail-open. If a token is outside the supported numeric range or cannot be converted, that token is returned unchanged. If the entire normalization pass unexpectedly fails, `speak_markdown` uses the existing rendered speech document. Queue processing continues with later responses.

## Verification

Tests will exercise real rendered output with literal expected speech:

- The reported disk-full paragraph, including `1,381`, `127Mi`, `460Gi`, `100%`, `ENOSPC`, `tsx`, and `IPC`.
- Grouped integers, negative numbers, decimals, ordinals, percentages, currency, byte units, and durations.
- URLs, semantic versions, IP addresses, paths, hashes, issue numbers, inline code, and fenced code to prove that normalization does not corrupt technical content.
- Tables, lists, links, and giant lossless chunks to retain the existing complete-response guarantees.
- The full repository verification command after the focused red-green test cycle.

Real audio playback of the original paragraph is the final macOS acceptance check. Windows and Linux remain code-and-build verified unless hardware on those systems is available.
