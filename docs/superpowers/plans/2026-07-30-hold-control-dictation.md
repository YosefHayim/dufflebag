# Hold-Control Dictation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `Ctrl+Alt+Space` toggle with hold-Control push-to-talk while preserving live caret transcription and ordinary Control shortcuts.

**Architecture:** Keep the single `voice.py` worker and replace `GlobalHotKeys` with a listener backed by a pure four-state transition function. A 350 ms timer distinguishes a deliberate hold from a shortcut, injected events are ignored, and a requested-listening flag prevents model-load races.

**Tech Stack:** Python 3.10+, pynput 1.8.2, Moonshine Voice 0.1.0, TypeScript 5.7, Vitest, uv.

## Global Constraints

- Keep exactly the existing authored runtime files; add no dependency.
- Either left or right Control activates push-to-talk after 350 ms.
- A quick release or another key before 350 ms must not start dictation.
- Release Control to stop, including when the first model load is still running.
- Ignore injected events and neutralize the active modifier before live caret typing.
- Preserve narration, normalization, Devin, and receipt behavior.
- Do not commit or push unless the user asks.
- Run `pnpm verify`, refresh the global installation, and inspect live status before completion.

---

### Task 1: Push-to-talk state machine and microphone lifecycle

**Files:**
- Modify: `src/skills/speakResponse/voice.test.ts`
- Modify: `src/skills/speakResponse/voice.py`

**Interfaces:**
- Consumes: `pynput.keyboard.Listener`, `Controller`, left/right Control events, and existing Moonshine transcriber lifecycle.
- Produces: `control_hold_transition(state: str, event: str) -> dict[str, str]`, listener callbacks, and `hotkey: "hold-control"` status.

- [ ] **Step 1: Write failing transition and status tests**

Add literal expectations for these observable decisions:

```ts
expect(callVoiceFunction("control_hold_transition", { state: "idle", event: "control_down" })).toEqual({
  action: "schedule",
  state: "waiting",
});
expect(callVoiceFunction("control_hold_transition", { state: "waiting", event: "other_down" })).toEqual({
  action: "cancel",
  state: "shortcut",
});
expect(callVoiceFunction("control_hold_transition", { state: "waiting", event: "hold_elapsed" })).toEqual({
  action: "start",
  state: "listening",
});
expect(callVoiceFunction("control_hold_transition", { state: "listening", event: "control_up" })).toEqual({
  action: "stop",
  state: "idle",
});
```

Change the stopped-worker expectation from `ctrl+alt+space` to `hold-control`.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/skills/speakResponse/voice.test.ts`

Expected: FAIL because `control_hold_transition` does not exist and status still reports `ctrl+alt+space`.

- [ ] **Step 3: Implement the minimal state machine**

Add `CONTROL_HOLD_SECONDS = 0.35`, `HOTKEY_LABEL = "hold-control"`, and the explicit transitions:

```python
CONTROL_HOLD_TRANSITIONS = {
    ("idle", "control_down"): ("waiting", "schedule"),
    ("waiting", "control_up"): ("idle", "cancel"),
    ("waiting", "other_down"): ("shortcut", "cancel"),
    ("waiting", "hold_elapsed"): ("listening", "start"),
    ("shortcut", "control_up"): ("idle", "none"),
    ("listening", "control_up"): ("idle", "stop"),
}
```

Use one timer and listener callback pair. Ignore events whose `injected` argument is true. On `start`, release the captured Control key through the existing controller before starting Moonshine.

- [ ] **Step 4: Make start/stop race-safe**

Add a separate control lock and `requested` flag. Set `requested` before starting the background start thread; clear it immediately on release. After lazy model loading, start the transcriber only if `requested` is still true. Make narration wait while dictation is requested or active.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm vitest run src/skills/speakResponse/voice.test.ts`

Expected: all voice worker tests pass without opening the microphone or downloading a new model.

### Task 2: User-facing commands, docs, and installed worker

**Files:**
- Modify: `src/cli/voiceCommand.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-30-unified-agent-voice.md`

**Interfaces:**
- Consumes: `hotkey: "hold-control"` worker status.
- Produces: consistent CLI and README instructions: `Hold Control to dictate; release to stop.`

- [ ] **Step 1: Replace stale toggle instructions**

Change the `voice on` information line, `voice status` outro, README usage, and original voice plan from `Ctrl+Alt+Space` toggle wording to hold-Control push-to-talk wording.

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm vitest run src/skills/speakResponse/voice.test.ts src/cli/voiceCommand.test.ts src/cli/main.test.ts
```

Expected: all focused worker and command tests pass.

- [ ] **Step 3: Run the full repository gate**

Run: `pnpm verify`

Expected: Biome, typecheck, all Vitest files, build, staging, and hook assembly pass.

- [ ] **Step 4: Refresh and inspect the global installation**

Run:

```bash
dufflebag voice off
pnpm cli voice on
dufflebag voice status
```

Expected: the global worker is running and reports `"hotkey":"hold-control"`. Inspect the receipt before and after to ensure unrelated features remain selected.

- [ ] **Step 5: Report the physical-input boundary honestly**

Report automated verification and live worker status separately from the remaining manual hardware check: focus an input, hold Control longer than 350 ms, speak, and release. Do not claim microphone/caret success without that physical test.
