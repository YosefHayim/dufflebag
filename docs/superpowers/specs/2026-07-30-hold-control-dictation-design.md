# Hold-Control Dictation Design

## Goal

Replace the `Ctrl+Alt+Space` toggle with one-key push-to-talk: hold either Control key to dictate into the active caret and release it to stop.

## Interaction

- A Control press becomes dictation only after a 350 ms hold.
- Releasing Control stops dictation.
- A quick Control tap does nothing to dictation.
- Pressing another key before the hold threshold treats the gesture as a normal Control shortcut and cancels the pending microphone start.
- Once the hold activates, the worker emits a synthetic release for that Control modifier. This keeps streamed transcription text from becoming Control-modified shortcuts while the physical key remains held.
- Listener callbacks ignore injected events, so the worker's own modifier release and typed transcription cannot change push-to-talk state.

## Runtime Shape

Keep the existing single Python worker. Replace `GlobalHotKeys` with a `pynput.keyboard.Listener` and a four-state transition function:

```text
idle -> waiting -> listening -> idle
          |
          +-> shortcut -> idle
```

The transition function owns decisions only. Listener callbacks own the timer and dispatch asynchronous microphone start/stop work. A requested-listening flag prevents a slow first model load from starting the microphone after Control was already released.

Keep the existing `hotkey` status field for compatibility, but report its value as `hold-control`. Update CLI and README wording to say "Hold Control to dictate; release to stop."

## Verification

- Unit-test long-hold, quick-release, shortcut cancellation, release-to-stop, and injected-event behavior without opening the microphone.
- Keep existing narration, stable-transcript, Devin, lifecycle, CLI, install, and staging tests green.
- Run `pnpm verify`, reinstall the global feature, restart its worker, and confirm `dufflebag voice status` reports `hold-control` with the worker running.

## Boundaries

- No new runtime file or dependency.
- No LLM or cloud service.
- No change to response narration or transcript normalization.
- Preserve macOS, Windows, and Linux support; existing Wayland limitations still apply.
