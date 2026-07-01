---
name: autorun
description: Drive the autonomous context loop for this session — arm it to auto-/compact and resume work hands-free, or pause/shut it down. Use when the user types /autorun (optionally with a number or `stop`/`exit`), says "autorun", "autopilot", "take it from here", "keep going hands-off", or asks to pause / stop / shut down / exit the auto-compact loop.
---

# autorun

One command drives the **autonomous loop** for the current session. The argument
selects the verb:

| You type | Meaning |
|---|---|
| `/autorun <n>` (or bare `/autorun`) | **arm** — allow up to **N** auto-compact cycles (bare = configured default) |
| `/autorun stop` | **pause** — stop compacting but keep the daemon observing (re-arm later) |
| `/autorun exit` | **shut down** — disarm and tell the daemon to self-terminate |

Once armed, the `ctx-watch` daemon watches context occupancy. Each time the session
nears the guardrail (the configured warn %) **and** a fresh handoff doc exists **and**
the turn is idle **and** Ghostty is frontmost, it types `/compact`, then a continuation
prompt — so the work carries across resets hands-free. It pauses after **N** cycles,
on `/autorun stop`, or when the task is marked done.

## Quick start

Read the argument and shell out to the one control plane:

```bash
# arm (bare or a number N)
node "@@CTL@@" arm "$N"
# pause
node "@@CTL@@" stop
# shut the daemon down
node "@@CTL@@" exit
```

- If the argument is a number (e.g. `/autorun 5`), run `arm 5`. Bare `/autorun` → `arm`
  with no number (uses the configured default).
- If the argument is `stop` → run `stop`. If it is `exit` → run `exit`.

Then relay the script's confirmation/report to the user **verbatim** (the report shows
the cycle paused/exited at, budget, session tokens in/out, wall-time, live 5h + weekly
usage, and the last auto-halt reason if any).

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
- `/autorun stop` is a **pause** (re-armable); `/autorun exit` shuts the daemon down for
  this session — re-enabling then needs a fresh `/autorun`, which re-spawns it.
- Tune the warn %, budget, and hard cap with `dufflebag config`.
