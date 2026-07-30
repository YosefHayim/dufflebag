# Human Dictation Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute each task inline in the active Dufflebag voice slice. Do not create a second worktree because the approved voice implementation is already uncommitted in this checkout.

**Goal:** Make hold-Control dictation retain final words, type readable English and explicit Markdown list commands, support personal word replacements, show visible listening state, and prepare all native speech dependencies on a new machine without Docker.

**Architecture:** Keep one PEP 723 Python worker plus its generated `uv` lockfile. Moonshine remains the streaming recognizer, a deterministic formatter owns spoken commands before caret insertion, and Tkinter provides a best-effort host-native status pill. `dufflebag voice on` prepares the pinned models before launching the worker; Docker is intentionally absent because microphone, global keyboard, focused-caret, and desktop-window access belong to the host OS.

**Tech Stack:** TypeScript, Effect Schema and CLI, Python 3.10-3.13, Moonshine Voice 0.1.0, Supertonic 1.3.1, pynput, sounddevice, Tkinter, uv PEP 723 lock.

## Global Constraints

- Keep narration and dictation fully local; do not add an LLM or cloud service.
- Preserve live caret typing without backspacing or rewriting committed text.
- Retain the newest four recognized words so late punctuation and multiword commands can settle.
- Keep accepting microphone audio for 300 ms after Control release, then flush Moonshine once.
- Formatting commands are deterministic and escaped with `literal`, for example `literal comma`.
- The listening overlay is best-effort and fail-open when Tkinter or a desktop session is unavailable.
- Do not add Docker: it would duplicate the native dependency cache and cannot portably own the host microphone, global Control key, focused caret, or desktop overlay.
- Do not commit or push without a separate user request.

---

### Task 1: Deterministic dictation formatter and personal replacements

**Files:**
- Modify: `src/skills/speakResponse/voice.test.ts`
- Modify: `src/skills/speakResponse/voice.py`
- Modify: `src/config/bagConfigSchema.test.ts`
- Modify: `src/config/bagConfigSchema.ts`
- Modify: `src/cli/configCommand.ts`

**Interfaces:**
- Consumes: completed or stable Moonshine word sequences and the managed `dictationReplacements` string.
- Produces: `format_dictation(text, replacements)` for pure verification and incremental formatted output with a consumed raw-word count.

- [ ] **Step 1: Write failing formatter tests**

Add literal expectations for punctuation, bullet lists, numbered lists, `literal` escaping, replacement of `Joseph` with `Yosef`, and a four-word uncommitted live tail.

- [ ] **Step 2: Run the formatter tests and verify RED**

Run: `pnpm test src/skills/speakResponse/voice.test.ts`

Expected: FAIL because `format_dictation` and the hybrid projection do not exist.

- [ ] **Step 3: Implement the formatter minimally**

Add a longest-phrase command table, immutable formatting state, case-insensitive configured replacements, and incremental consumption that never emits trailing prose spaces or splits a command at the live boundary.

- [ ] **Step 4: Run the formatter tests and verify GREEN**

Run: `pnpm test src/skills/speakResponse/voice.test.ts`

Expected: formatter and existing narration tests pass.

- [ ] **Step 5: Write failing managed-config tests**

Expect `dictationReplacements` to default to an empty string, carry a description, reject explicit undefined, and accept a semicolon-separated value such as `Joseph=Yosef;type script=TypeScript`.

- [ ] **Step 6: Run the config tests and verify RED**

Run: `pnpm test src/config/bagConfigSchema.test.ts`

Expected: FAIL because the field is absent.

- [ ] **Step 7: Add the schema-owned config and CLI flag**

Add `dictationReplacements` to the managed schema and legacy environment mapping, expose it as `dufflebag config --dictation-words`, and include it in config display and patch ordering.

- [ ] **Step 8: Run the config and formatter tests and verify GREEN**

Run: `pnpm test src/config/bagConfigSchema.test.ts src/skills/speakResponse/voice.test.ts`

Expected: both files pass.

### Task 2: Release-tail finalization and visible state

**Files:**
- Modify: `src/skills/speakResponse/voice.test.ts`
- Modify: `src/skills/speakResponse/voice.py`

**Interfaces:**
- Consumes: Control press/release transitions and Moonshine's synchronous final event from `MicTranscriber.stop()`.
- Produces: `starting`, `listening`, and `finishing` stages plus a 300 ms release grace that is generation-safe across rapid re-holds.

- [ ] **Step 1: Write a failing controlled-stop test**

Use a fake external transcriber in a subprocess, assert the real stop path waits at least 280 ms, flushes once, and leaves dictation inactive. Add a superseded-generation case that does not stop a newer hold.

- [ ] **Step 2: Run the stop tests and verify RED**

Run: `pnpm test src/skills/speakResponse/voice.test.ts`

Expected: FAIL because release currently stops immediately and has no generation argument.

- [ ] **Step 3: Implement generation-safe finalization**

Set `finishing` on release, wait 300 ms outside locks, re-check the request generation, call Moonshine stop once, and hide the state only after its final transcript callback completes.

- [ ] **Step 4: Run the stop tests and verify GREEN**

Run: `pnpm test src/skills/speakResponse/voice.test.ts`

Expected: finalization tests and existing hotkey tests pass.

- [ ] **Step 5: Add the best-effort Tkinter pill**

Create the borderless bottom-center pill on the daemon main thread, pulse its status dot without another dependency, update it from dictation stage, and disable it silently if Tkinter or the desktop is unavailable.

- [ ] **Step 6: Run the focused worker suite**

Run: `pnpm test src/skills/speakResponse/voice.test.ts src/cli/voiceCommand.test.ts`

Expected: all focused tests pass.

### Task 3: Native one-command preparation and public setup contract

**Files:**
- Modify: `src/skills/speakResponse/voice.test.ts`
- Modify: `src/skills/speakResponse/voice.py`
- Modify: `src/cli/voiceCommand.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the installed `voice.py`, adjacent `voice.py.lock`, and one host `uv` executable.
- Produces: a `prepare` worker command invoked by `dufflebag voice on` before `start`.

- [ ] **Step 1: Write a failing command-surface test**

Expect Python help to expose `prepare` and Dufflebag help to document the native setup and personal-word option.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm test src/skills/speakResponse/voice.test.ts src/cli/main.test.ts`

Expected: FAIL because `prepare` is absent.

- [ ] **Step 3: Implement native preparation**

Have `prepare` resolve both pinned models without opening the microphone, then invoke it from `voice on` before the worker starts. Keep `uv` as the sole explicit prerequisite; it installs a compatible Python and the locked packages in its shared cache.

- [ ] **Step 4: Document why there is no Dockerfile**

Explain the native host-integration boundary, the automatic `uv` dependency/model preparation, the direct formatting commands, the `literal` escape, and `dufflebag config --dictation-words` syntax.

- [ ] **Step 5: Run focused setup tests**

Run: `pnpm test src/skills/speakResponse/voice.test.ts src/cli/main.test.ts src/config/bagConfigSchema.test.ts`

Expected: all focused tests pass.

### Task 4: Full verification and current-machine refresh

**Files:**
- Verify only after Tasks 1-3.

**Interfaces:**
- Consumes: the complete active voice slice.
- Produces: a staged portable runtime and a refreshed local installation for manual microphone/caret proof.

- [ ] **Step 1: Format authored files**

Run: `pnpm exec biome check --write src/config/bagConfigSchema.ts src/config/bagConfigSchema.test.ts src/cli/configCommand.ts src/cli/voiceCommand.ts src/skills/speakResponse/voice.test.ts README.md`

- [ ] **Step 2: Run the repository gate**

Run: `pnpm verify`

Expected: Biome, typecheck, all Vitest files, build, staging, and hook assembly pass.

- [ ] **Step 3: Refresh the active global voice installation**

Run the local CLI with the existing receipt, configure `Joseph=Yosef`, restart voice, and inspect `voice status` without removing unrelated features.

- [ ] **Step 4: Perform live proof**

Focus a disposable input, hold Control, speak the two previously failing phrases plus one bullet-list command, release, and verify the visible Starting/Listening/Finishing pill and final caret text. Report any physical-input portion that still requires the user's own confirmation.
