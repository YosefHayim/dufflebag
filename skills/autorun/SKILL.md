---
name: autorun
description: Arm the autonomous context loop for this session so it auto-/compacts and resumes work until the task is done. Use when the user types /autorun, says "autorun", "autopilot", "take it from here", or asks to run hands-off / keep going under the context guardrail without manually compacting.
---

# autorun

Arm the **autonomous loop** for the current session with a cycle budget.

Once armed, the `ctx-watch` daemon watches context occupancy. Each time the session
nears the guardrail (the configured warn %) **and** a fresh handoff doc exists **and**
the turn is idle **and** Ghostty is frontmost, it types `/compact`, then a continuation
prompt — so the work carries across resets hands-free. It pauses after **N** cycles,
when the user runs `/autostop`, or when the task is marked done.

## Quick start

The user's argument is the cycle budget **N** (how many auto-compact cycles to allow).
Bare `/autorun` uses the configured default. Run:

```bash
node "@@CTL@@" arm "$N"
```

Substitute `$N` with the number the user gave (e.g. `/autorun 5` → `arm 5`). If they
gave none, omit the argument. Then relay the script's confirmation to the user verbatim.

## Your responsibility while armed

The daemon only presses keys — **you** make each compact safe and productive:

- As you approach the guardrail, **run `/handoff`** to save a resume doc *before* the
  daemon compacts. No fresh handoff → it waits and never compacts (by design).
- When the task is **genuinely, fully complete** — nothing left to do — create the
  done-marker the daemon halts on (the context-guard message tells you the exact path,
  `~/.claude/.ctx-loop-state/<session-id>.done`) **instead of** another handoff, then
  stop. Do **not** invent busy-work to keep the loop alive.

## Notes

- **Requires macOS + Ghostty.** The daemon types only into THIS session's Ghostty window
  (located by title, idle state only), only when Ghostty is frontmost and the turn is
  idle; a global keystroke mutex serializes injection; a hard cycle cap applies
  regardless of N; global kill switch `touch ~/.claude/.ctx-guard-off`.
- Pause with `/autostop` (re-armable) or shut the daemon down with `/autoexit`.
- Tune the warn %, budget, and hard cap with `skills-bag config`.
