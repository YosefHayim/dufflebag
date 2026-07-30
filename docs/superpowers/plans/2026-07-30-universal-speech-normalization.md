# Universal Speech Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every narrated agent response pronounce numbers, quantities, and developer terminology naturally without changing or omitting the original content.

**Architecture:** Keep all provider hooks unchanged and add one deterministic `normalize_spoken_prose` function to `voice.py`. The existing Markdown renderer sends only prose spans through it while protecting code and structured technical literals; every provider already converges on this renderer.

**Tech Stack:** Python 3.10-3.13, pinned `num2words`, PEP 723 with `uv`, TypeScript/Vitest behavioral tests, Supertonic.

## Global Constraints

- No LLM, remote service, or runtime network request may rewrite narration.
- Narrate the complete response in source order; never summarize, cap, or omit content.
- Change only the spoken copy; preserve the displayed and queued Markdown exactly.
- Unknown or ambiguous tokens pass through unchanged.
- Fenced code, URLs, email addresses, file paths, hashes, versions, and IP addresses must not be corrupted by prose rules.
- Narration remains fail-open and cannot block the coding agent.
- Keep one shared implementation for Claude Code, Codex, Grok, Devin, and manual examples.
- Do not commit or push; this checkout already contains the user's uncommitted voice work.

---

### Task 1: Natural numbers, units, and developer terms

**Files:**
- Modify: `src/skills/speakResponse/voice.test.ts`
- Modify: `src/skills/speakResponse/voice.py`
- Modify: `src/skills/speakResponse/voice.py.lock`

**Interfaces:**
- Consumes: prose strings already cleaned of Markdown structure by `inline_speech(text: str) -> str`.
- Produces: `normalize_spoken_prose(text: str) -> str`, returning deterministic English speech text.

- [ ] **Step 1: Write the failing real-render regression**

Add this behavioral test to `voice speech document`:

```ts
it("naturally reads quantities and technical terms in every prose response", () => {
  const markdown =
    "Your disk is full: 127Mi free of 460Gi, 100% capacity. All 13 full-suite failures are ENOSPC on the jest transform cache; zero logic failures. Also 1,381 stale tsx IPC pipes.";

  expect(runVoice(["render", "--text", markdown])).toBe(
    "Your disk is full: one hundred twenty-seven mebibytes free of four hundred sixty gibibytes, one hundred percent capacity. All thirteen full-suite failures are E N O S P C, meaning no space left on device, on the jest transform cache; zero logic failures. Also one thousand three hundred eighty-one stale T S X I P C pipes.",
  );
});
```

This test catches removal of the central normalizer, grouped-number handling, unit expansion, or developer-term pronunciation.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm vitest run src/skills/speakResponse/voice.test.ts -t "naturally reads quantities"
```

Expected: FAIL because the current renderer returns `127Mi`, `460Gi`, `100%`, `13`, `ENOSPC`, `1,381`, `tsx`, and `IPC` literally.

- [ ] **Step 3: Add the pinned local dependency**

Add the PEP 723 dependency and import:

```python
# dependencies = [
#   "moonshine-voice==0.1.0",
#   "num2words==0.5.14",
#   "pynput==1.8.2",
#   "sounddevice==0.5.5",
#   "supertonic==1.3.1",
# ]

from num2words import num2words
```

- [ ] **Step 4: Implement the smallest universal prose normalizer**

Add these stable boundaries near `inline_speech`:

```python
UNIT_WORDS = {
    "B": ("byte", "bytes"),
    "KB": ("kilobyte", "kilobytes"),
    "MB": ("megabyte", "megabytes"),
    "GB": ("gigabyte", "gigabytes"),
    "TB": ("terabyte", "terabytes"),
    "Ki": ("kibibyte", "kibibytes"),
    "KiB": ("kibibyte", "kibibytes"),
    "Mi": ("mebibyte", "mebibytes"),
    "MiB": ("mebibyte", "mebibytes"),
    "Gi": ("gibibyte", "gibibytes"),
    "GiB": ("gibibyte", "gibibytes"),
    "Ti": ("tebibyte", "tebibytes"),
    "TiB": ("tebibyte", "tebibytes"),
    "ms": ("millisecond", "milliseconds"),
    "s": ("second", "seconds"),
    "min": ("minute", "minutes"),
    "h": ("hour", "hours"),
}

DEVELOPER_TERMS = {
    "ENOSPC": "E N O S P C, meaning no space left on device,",
    "tsx": "T S X",
}

NUMBER_PATTERN = r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
UNIT_PATTERN = "|".join(
    re.escape(unit) for unit in sorted(UNIT_WORDS, key=len, reverse=True)
)

def number_words(raw: str, *, ordinal: bool = False) -> str:
    compact = raw.replace(",", "")
    mode = "ordinal" if ordinal else "cardinal"
    rendered = str(num2words(compact, lang="en", to=mode))
    rendered = rendered.replace(",", "")
    rendered = re.sub(r"\band\s+", "", rendered)
    return f"plus {rendered}" if raw.startswith("+") else rendered

def normalize_spoken_prose(text: str) -> str:
    def quantity(match: re.Match[str]) -> str:
        raw = match.group("number")
        singular, plural = UNIT_WORDS[match.group("unit")]
        unit = singular if abs(Decimal(raw.replace(",", ""))) == 1 else plural
        return f"{number_words(raw)} {unit}"

    def percentage(match: re.Match[str]) -> str:
        return f"{number_words(match.group('number'))} percent"

    def standalone_number(match: re.Match[str]) -> str:
        return number_words(match.group("number"))

    clean = text
    for term, pronunciation in DEVELOPER_TERMS.items():
        clean = re.sub(rf"(?<!\w){re.escape(term)}(?!\w)", pronunciation, clean)
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
    return re.sub(
        r"(?<!\w)([A-Z][A-Z0-9]{1,})(?!\w)",
        lambda match: " ".join(match.group(1)),
        clean,
    )
```

Implement ordered regex callbacks for quantity-plus-unit, percentage, ordinal, standalone number, explicit developer terms, and generic all-uppercase acronyms of at least two letters. Use token boundaries so identifiers such as `sha256sum` are not split. Use singular unit words only when the parsed numeric value equals one. Catch `ArithmeticError`, `TypeError`, and `ValueError` inside each callback and return the original matched token.

Call `normalize_spoken_prose` once at the end of `inline_speech`, after Markdown punctuation is removed.

- [ ] **Step 5: Regenerate the reproducible worker lock**

Run:

```bash
uv lock --script src/skills/speakResponse/voice.py
```

Expected: `voice.py.lock` resolves `num2words==0.5.14` and its pinned transitive dependency.

- [ ] **Step 6: Run the focused regression and verify GREEN**

Run:

```bash
pnpm vitest run src/skills/speakResponse/voice.test.ts -t "naturally reads quantities"
```

Expected: PASS with the literal speech document from Step 1.

### Task 2: Protect technical literals and cover the general grammar

**Files:**
- Modify: `src/skills/speakResponse/voice.test.ts`
- Modify: `src/skills/speakResponse/voice.py`

**Interfaces:**
- Consumes: `normalize_spoken_prose(text: str) -> str` from Task 1.
- Produces: protected prose normalization that leaves structured literals complete and unchanged.

- [ ] **Step 1: Write failing normalization fixtures**

Add literal expectations that call the real Python function:

```ts
it("normalizes common numeric forms without losing their meaning", () => {
  expect(
    callVoiceFunction("normalize_spoken_prose", {
      text: "-12.5%, 21st, 1 byte, 2GB, 350ms, and $1,024.50.",
    }),
  ).toBe(
    "minus twelve point five percent, twenty-first, one byte, two gigabytes, three hundred fifty milliseconds, and one thousand twenty-four dollars and fifty cents.",
  );
});

it("does not reinterpret structured technical literals", () => {
  expect(
    callVoiceFunction("normalize_spoken_prose", {
      text: "See https://example.com/v1.2.3?q=100, dev@example.com, /tmp/build-123/log.txt, v1.2.3, 127.0.0.1, and a1b2c3d4.",
    }),
  ).toBe(
    "See https://example.com/v1.2.3?q=100, dev@example.com, /tmp/build-123/log.txt, v1.2.3, 127.0.0.1, and a1b2c3d4.",
  );
});

it("keeps inline and fenced code literals exact", () => {
  expect(runVoice(["render", "--text", "Use `limit = 1,381`.\n\n```ts\nconst limit = 1_381;\n```"])).toBe(
    "Use limit = 1,381.\nCode block, TypeScript.\nconst limit equals 1_381 semicolon.\nEnd code block.",
  );
});
```

The first test catches missing general grammar. The latter two catch accidental rewriting of URLs, addresses, paths, versions, IPs, hashes, and code.

- [ ] **Step 2: Run the fixtures and verify RED**

Run:

```bash
pnpm vitest run src/skills/speakResponse/voice.test.ts -t "common numeric forms|structured technical literals|inline and fenced code"
```

Expected: at least the code-protection and numeric-form cases FAIL against Task 1's intentionally minimal normalizer.

- [ ] **Step 3: Add protected-span segmentation and remaining grammar**

Add these pure interfaces:

```python
PROTECTED_SPAN_PATTERN = re.compile(
    r"https?://[^\s<>()]+"
    r"|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}"
    r"|(?<!\w)v?\d+(?:\.\d+){2,}(?:[-+][A-Za-z0-9.-]+)?"
    r"|(?<!\w)(?:\.{0,2}/)[^\s,;:!?]+"
    r"|(?<!\w)(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+"
    r"|\b(?=[A-Fa-f0-9]{7,}\b)(?=[A-Fa-f0-9]*[A-Fa-f])[A-Fa-f0-9]+\b"
)

def preserve_span(value: str, spans: dict[str, str]) -> str:
    marker = f"\ue000{'x' * (len(spans) + 1)}\ue001"
    spans[marker] = value
    return marker

def protect_spans(text: str, spans: dict[str, str]) -> str:
    return PROTECTED_SPAN_PATTERN.sub(
        lambda match: preserve_span(match.group(0), spans), text
    )

def restore_spans(text: str, spans: dict[str, str]) -> str:
    restored = text
    # Restore every protected literal after all prose-only rules finish.
    for marker, value in spans.items():
        restored = restored.replace(marker, value)
    return restored

def currency_words(raw: str) -> str:
    value = Decimal(raw.replace(",", "")).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
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
```

Import `Decimal` and `ROUND_HALF_UP` from `decimal`. Start `normalize_spoken_prose` with `spans = {}` and `clean = protect_spans(text, spans)`, then return `restore_spans(clean, spans)` after all substitutions. Add these callbacks before quantity and standalone-number handling:

```python
def currency(match: re.Match[str]) -> str:
    return currency_words(match.group("number"))

def ordinal(match: re.Match[str]) -> str:
    return number_words(match.group("number"), ordinal=True)

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
```

Protect Markdown link destinations and inline-code contents in `inline_speech` with the same `spans` dictionary before formatting markers are removed:

```python
spans: dict[str, str] = {}

def link(match: re.Match[str]) -> str:
    label = match.group(1).strip()
    address = preserve_span(match.group(2).strip(), spans)
    return f"{label}, link {address}"

clean = re.sub(r"`([^`]*)`", lambda match: preserve_span(match.group(1), spans), clean)
return normalize_spoken_prose(re.sub(r"\s+", " ", clean).strip(), spans)
```

Extend `normalize_spoken_prose` to accept `spans: dict[str, str] | None = None`; reuse the provided dictionary when called from `inline_speech`, otherwise create an empty one. Protect raw URLs, emails, absolute and relative file paths, semantic versions, IPv4 addresses, hexadecimal/hash-like identifiers, and inline-code contents with the private-use Unicode markers.

Handle signed decimals, English ordinals, dollar values with cents, and singular/plural units before the standalone-number callback. Preserve punctuation outside each matched token. Do not add a generic dictionary that changes ordinary lowercase words.

- [ ] **Step 4: Run all worker tests and verify GREEN**

Run:

```bash
pnpm vitest run src/skills/speakResponse/voice.test.ts
```

Expected: every worker test passes, including the existing table, code, lossless chunking, dictation, Devin, and lifecycle coverage.

- [ ] **Step 5: Run the direct acceptance render**

Run:

```bash
python3 src/skills/speakResponse/voice.py render --text "Your disk is full: 127Mi free of 460Gi, 100% capacity. All 13 full-suite failures are ENOSPC on the jest transform cache; zero logic failures. Also 1,381 stale tsx IPC pipes."
```

Expected: the exact normalized paragraph from Task 1, Step 1.

### Task 3: Reconcile the installed worker and prove the complete feature

**Files:**
- Verify: `src/skills/speakResponse/voice.py`
- Verify: `src/skills/speakResponse/voice.py.lock`
- Verify: installed global Dufflebag runtime

**Interfaces:**
- Consumes: the tested worker and lock from Tasks 1-2.
- Produces: updated global runtime and audible acceptance evidence.

- [ ] **Step 1: Validate formatting, dependency resolution, and repository behavior**

Run:

```bash
git diff --check
uv lock --check --script src/skills/speakResponse/voice.py
pnpm verify
```

Expected: every command exits zero; Vitest reports zero failed tests; TypeScript and the production build succeed.

- [ ] **Step 2: Update the existing global CLI from the verified checkout**

Run:

```bash
npm install --global .
```

Expected: the existing `dufflebag` executable is replaced by this checkout's verified build.

- [ ] **Step 3: Reconcile voice ownership and play the user's exact paragraph**

Run:

```bash
dufflebag voice on devin --example "Your disk is full: 127Mi free of 460Gi, 100% capacity. All 13 full-suite failures are ENOSPC on the jest transform cache; zero logic failures. Also 1,381 stale tsx IPC pipes."
```

Expected: the command exits zero, the worker remains running, the global receipt owns the updated worker and lock, and the paragraph is spoken with the accepted normalization.

- [ ] **Step 4: Inspect final state without mutating unrelated work**

Run:

```bash
dufflebag voice status
git status --short --branch
git diff --check
```

Expected: voice is on, dictation status is reported, the repository contains only the intended uncommitted voice changes plus its pre-existing ahead commit, and no whitespace errors exist.
