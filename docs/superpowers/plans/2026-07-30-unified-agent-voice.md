# Unified Agent Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Dufflebag's macOS-only `say` hook with a tiny, local, cross-platform voice feature that narrates complete agent responses naturally, supports hold-Control push-to-talk dictation at the active caret, and provides a receipt-safe `dufflebag voice` CLI.

**Architecture:** The existing dependency-free TypeScript Stop hook becomes a provider-normalizing queue bridge and exits immediately. One PEP 723 `voice.py` worker owns Markdown-to-speech rendering, Supertonic playback, Moonshine dictation, the global hotkey, and Devin ATIF watching. Dufflebag's existing catalog, staging, install, update, and receipt pipeline remains the only artifact owner.

**Tech Stack:** TypeScript 5.7, Effect CLI/Platform, Vitest, Python 3.10+, uv PEP 723 scripts, Supertonic 1.3.1, Moonshine Voice 0.1.0, pynput 1.8.2, sounddevice 0.5.5.

## Global Constraints

- Keep the installed Stop hook dependency-free, fail-open, and non-blocking.
- Keep exactly two authored runtime files: `hooks/speakResponse.ts` and `voice.py`; `voice.py.lock` is generated.
- Preserve the complete semantic response. Remove Markdown punctuation from speech, not content.
- Read every table header, row, and cell in order.
- Keep narration and transcription local; no API key or cloud speech service.
- Target macOS Apple Silicon, Windows x64, and Linux x64/aarch64. Report Wayland hotkey limitations instead of claiming unsupported behavior.
- Use receipt-authorized reconciliation for `voice on` and `voice off`; preserve every unrelated selected feature and user hook.
- Use Devin's documented `--export` ATIF file. Do not read its private session database.
- Do not add an npm runtime dependency.
- Run `pnpm verify` before completion.

---

### Task 1: Single-file narration, dictation, and Devin runtime

Complete the former Task 3 first so catalog staging never declares a source file that does not yet exist. Its files, interfaces, red-green steps, commands, and expectations are unchanged below under "Single-file narration, dictation, and Devin runtime."

### Task 2: Catalog-closed Python runtime asset

**Files:**
- Modify: `src/catalog/featureCatalog.ts`
- Modify: `src/catalog/featureCatalog.test.ts`
- Modify: `src/cli/stagePackage.ts`
- Modify: `src/cli/stagePackage.test.ts`

**Interfaces:**
- Consumes: existing `featureRuntimeSchema` and `stageRuntimeFeature`.
- Produces: `runtime.shippedPaths`, an exact feature-relative allowlist copied beside compiled hook output.

- [ ] **Step 1: Write the failing catalog test**

Assert that `speak-response` declares `voice.py` and `voice.py.lock`, while another hook feature can declare an empty allowlist:

```ts
expect(speakResponse?.runtime).toMatchObject({
  _tag: "hook",
  shippedPaths: ["voice.py", "voice.py.lock"],
});
```

- [ ] **Step 2: Run the catalog test and verify RED**

Run: `pnpm vitest run src/catalog/featureCatalog.test.ts`

Expected: FAIL because hook runtime definitions do not yet expose `shippedPaths`.

- [ ] **Step 3: Add the schema-owned allowlist**

Add `shippedPaths: Schema.Array(shippedPathSchema)` to the hook runtime schema. Add `shippedPaths: []` to existing hook features and `shippedPaths: ["voice.py", "voice.py.lock"]` to `speak-response`. Change its platform to `any` and its summary to the new local voice behavior.

- [ ] **Step 4: Write the failing staging test**

Create temporary authored `voice.py` and `voice.py.lock` fixtures and assert their exact bytes arrive under `dist/staged/runtime/speakResponse/`.

- [ ] **Step 5: Run the staging test and verify RED**

Run: `pnpm vitest run src/cli/stagePackage.test.ts`

Expected: FAIL because staging currently copies compiled `hooks`, `lib`, and `command` only.

- [ ] **Step 6: Copy only catalog-declared raw runtime files**

Extend `stageRuntimeFeature` with `shippedPaths`; copy each declared path from `src/skills/<sourceDirectory>` into the staged runtime feature root and fail if a declared path is missing.

- [ ] **Step 7: Run the narrow tests and verify GREEN**

Run: `pnpm vitest run src/catalog/featureCatalog.test.ts src/cli/stagePackage.test.ts`

Expected: PASS.

### Task 3: Cross-provider fail-open queue hook

**Files:**
- Create: `src/skills/speakResponse/hooks/speakResponse.test.ts`
- Modify: `src/skills/speakResponse/hooks/speakResponse.ts`
- Modify: `src/install/install.ts`
- Modify: `src/install/install.test.ts`

**Interfaces:**
- Consumes: Claude/Codex `last_assistant_message`, Grok `lastAssistantMessage`, and Claude transcript fallback.
- Produces: atomic JSON envelopes under the platform voice state `inbox`, then detached `uv run --frozen --script voice.py start`.

- [ ] **Step 1: Write failing real-process hook tests**

Spawn the hook with a temporary `DUFFLEBAG_VOICE_HOME` and an empty `PATH`. Assert a Claude payload writes the exact Markdown, a Grok `end_turn` payload writes the exact Markdown, and a non-final Grok payload writes nothing.

- [ ] **Step 2: Run the hook test and verify RED**

Run: `pnpm vitest run src/skills/speakResponse/hooks/speakResponse.test.ts`

Expected: FAIL because the current hook requires a transcript and invokes macOS `say`.

- [ ] **Step 3: Implement the queue bridge**

Use Node built-ins only. Normalize provider payloads, preserve the response bytes as a JSON string, atomically rename the envelope into `inbox`, derive `voice.py` from `import.meta.url`, spawn uv detached, handle child `error`, and always exit zero.

- [ ] **Step 4: Write the failing Windows-safe command test**

Assert the installed `speak-response` command passes `--dufflebag-agent-id` as an argument and does not begin with POSIX environment assignments.

- [ ] **Step 5: Run the install test and verify RED**

Run: `pnpm vitest run src/install/install.test.ts`

Expected: FAIL because every current hook command uses inline `NAME=value` shell syntax.

- [ ] **Step 6: Make the voice hook command portable**

Specialize only `speak-response` registration to:

```text
node "<installed>/speakResponse/hooks/speakResponse.js" --dufflebag-agent-id <agent-id>
```

Leave existing guard command behavior unchanged.

- [ ] **Step 7: Run the narrow tests and verify GREEN**

Run: `pnpm vitest run src/skills/speakResponse/hooks/speakResponse.test.ts src/install/install.test.ts`

Expected: PASS.

### Task 1 details: Single-file narration, dictation, and Devin runtime

**Files:**
- Create: `src/skills/speakResponse/voice.test.ts`
- Create: `src/skills/speakResponse/voice.py`
- Generate: `src/skills/speakResponse/voice.py.lock`

**Interfaces:**
- Consumes: queued response envelopes and Devin ATIF objects with `steps[].source/message/step_id`.
- Produces: natural speech, stable-prefix caret typing, daemon lifecycle commands, and ATIF-to-queue watching.

- [ ] **Step 1: Write failing Markdown speech tests**

Run `python3 voice.py render --text <fixture>` and assert headings lose markers, links retain label and address, code remains present in spoken form, and this table:

```markdown
| Agent | State |
| --- | --- |
| Claude | Ready |
| Devin | Watching |
```

renders every column and row without pipe/dash narration.

- [ ] **Step 2: Run the render tests and verify RED**

Run: `pnpm vitest run src/skills/speakResponse/voice.test.ts`

Expected: FAIL because `voice.py` does not exist.

- [ ] **Step 3: Implement the stdlib Markdown speech document**

Implement line-oriented headings, paragraphs, lists, quotes, fenced code, links, images, inline code, horizontal rules, and tables. Break long blocks at sentence/word boundaries without dropping characters or cells.

- [ ] **Step 4: Write the failing stable-prefix test**

Import `voice.py` from Python and assert three evolving hypotheses type only their common completed words, while completion types the remainder exactly once.

- [ ] **Step 5: Run the stable-prefix test and verify RED**

Run: `pnpm vitest run src/skills/speakResponse/voice.test.ts`

Expected: FAIL because stable dictation projection is absent.

- [ ] **Step 6: Implement the worker**

Add these commands:

```text
voice.py render --text TEXT
voice.py example --text TEXT --source AGENT
voice.py start
voice.py daemon
voice.py stop
voice.py status
voice.py watch-devin --path FILE
```

Load Supertonic F4 lazily with speed `speechWordsPerMinute / 200` (default 1.15) and four steps. Play through sounddevice. Load Moonshine only after Control is held for 350 ms. Use three-hypothesis common-word stability, then type the final remainder on `LineCompleted`. Release the logical Control modifier before caret typing, stop dictation when physical Control is released, and stop playback before microphone capture. Keep narration alive if pynput cannot initialize.

- [ ] **Step 7: Generate the cross-platform uv lock**

Run: `uv lock --script src/skills/speakResponse/voice.py`

Expected: `voice.py.lock` resolves the four exact direct dependencies.

- [ ] **Step 8: Run the runtime tests and verify GREEN**

Run: `pnpm vitest run src/skills/speakResponse/voice.test.ts`

Expected: PASS without downloading speech models.

### Task 4: Receipt-safe voice CLI

**Files:**
- Create: `src/cli/voiceCommand.ts`
- Create: `src/cli/voiceCommand.test.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/cli/main.test.ts`
- Modify: `src/config/bagConfigSchema.ts`
- Modify: `src/runtime/config.ts`
- Modify: `src/cli/configCommand.ts`

**Interfaces:**
- Consumes: current receipt feature IDs, staged package, detected agents, and the installed `voice.py` path.
- Produces: `dufflebag voice on [agent] --example TEXT`, `off`, `status`, `example`, and `devin -- <args>`.

- [ ] **Step 1: Write failing selection-policy tests**

Assert `on` adds `speak-response` once in catalog order and `off` removes only `speak-response` while preserving every other receipt feature.

- [ ] **Step 2: Run the command test and verify RED**

Run: `pnpm vitest run src/cli/voiceCommand.test.ts`

Expected: FAIL because the voice command does not exist.

- [ ] **Step 3: Implement the command group**

`on` checks uv before mutation, reads the receipt, calls install for a missing receipt or update for a present receipt, starts the worker, and optionally blocks until the example finishes playing. `off` stops the worker before receipt reconciliation. `status` reports receipt state. `devin` starts the ATIF watcher and runs Devin with inherited stdin/stdout/stderr and `--export <state>/devin.json`.

- [ ] **Step 4: Write and run the failing help test**

Run: `pnpm vitest run src/cli/main.test.ts`

Expected: FAIL until root help exposes `voice` and `voice on --help` exposes the optional agent plus `--example`.

- [ ] **Step 5: Register the command and update speech config language**

Add `voiceCommand` to root subcommands. Change the default `speechVoice` from `Samantha` to `F4`; retain `speechWordsPerMinute = 230`, which maps to speed 1.15. Update descriptions from macOS `say` language to Supertonic language.

- [ ] **Step 6: Run the CLI tests and verify GREEN**

Run: `pnpm vitest run src/cli/voiceCommand.test.ts src/cli/main.test.ts src/runtime/config.test.ts src/config/bagConfigSchema.test.ts`

Expected: PASS.

### Task 5: Real install and audible proof

**Files:**
- Inspect only after command execution: global receipt and bag-owned hook configuration.

**Interfaces:**
- Consumes: local global Dufflebag installation and Mac audio output.
- Produces: enabled receipt-owned voice hook and one audible Supertonic sample.

- [ ] **Step 1: Build before local installation**

Run: `pnpm build`

Expected: compiled hook and raw Python files appear under `dist/staged/runtime/speakResponse/`.

- [ ] **Step 2: Enable and play the requested form**

Run:

```bash
pnpm cli voice on devin --example "Read this number one. Now read this number two."
```

Expected: the command preserves existing receipt features, downloads/caches Supertonic on first use, and plays F4 through the active Mac output.

- [ ] **Step 3: Inspect ownership and status**

Run: `pnpm cli voice status`

Expected: enabled, worker running, hotkey reported, and `speak-response` present in the receipt.

### Task 6: Full verification and handoff

**Files:**
- Inspect: all changed files and generated lock data.

**Interfaces:**
- Consumes: completed implementation.
- Produces: fresh verification evidence and an honest remaining-platform note.

- [ ] **Step 1: Format maintained files**

Run: `pnpm biome check --write <changed TypeScript and JSON files>`

- [ ] **Step 2: Run the full gate**

Run: `pnpm verify`

Expected: Biome, TypeScript, Vitest, build, staging, and hook assembly all pass.

- [ ] **Step 3: Inspect the final diff and installation**

Run: `git status --short`, `git diff --check`, and targeted receipt/config inspection that prints only bag-owned paths and selected feature IDs.

- [ ] **Step 4: Report without committing**

Summarize the audible result, exact command, tests, changed runtime files, model-cache size tradeoff, macOS permission requirement for caret typing, and unverified Windows/Linux hardware behavior. Do not commit or push unless the user asks.
