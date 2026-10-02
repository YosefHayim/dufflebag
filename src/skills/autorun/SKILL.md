---
name: autorun
description: Use when you want the agent to keep working without you. When the context is full, it compacts it and continues the task. You can pause or stop it. macOS and Ghostty only. Say "autorun", "autorun 3", "autorun stop", or "keep going alone".
---

# autorun

One command drives **autorun** for the current session. The argument
selects the verb:

| You type | Meaning |
|---|---|
| `/autorun <n>` (or bare `/autorun`) | **arm** — allow up to **N** compact cycles (bare = configured default) |
| `/autorun stop` | **pause** — stop compacting but keep the watcher observing (re-arm later) |
| `/autorun exit` | **shut down** — disarm and tell the watcher to self-terminate |

Once armed, the autorun watcher watches context occupancy. Each time the session
nears the guardrail (the configured warn %) **and** a fresh handoff doc exists **and**
the turn is idle **and** Ghostty is frontmost, it types `/compact`, then a continuation
prompt — so the work carries across resets hands-free. It pauses after **N** cycles,
on `/autorun stop`, or when the task is marked done.

## Quick start

Read the argument and shell out to the one control plane:

```bash
# arm (bare or a number N)
node "@@AUTORUN_CONTROL@@" arm "$N"
# pause
node "@@AUTORUN_CONTROL@@" stop
# shut the watcher down
node "@@AUTORUN_CONTROL@@" exit
```

- If the argument is a number (e.g. `/autorun 5`), run `arm 5`. Bare `/autorun` → `arm`
  with no number (uses the configured default).
- If the argument is `stop` → run `stop`. If it is `exit` → run `exit`.

Then relay the script's confirmation/report to the user **verbatim** (the report shows
the cycle paused/exited at, budget, session tokens in/out, wall-time, live 5h + weekly
usage, and the last auto-halt reason if any).

## Your responsibility while armed

The watcher only presses keys — **you** make each compact safe and productive:

- As you approach the guardrail, **run `/handoff`** to save a resume doc *before* the
  watcher compacts. No fresh handoff → it waits and never compacts (by design).
- When the task is **genuinely, fully complete** — nothing left to do — create the
  done-marker the watcher halts on (the context-guard message tells you the exact path,
  `~/.claude/dufflebag/state/autorun/<session-id>.done`) **instead of** another handoff, then
  stop. Do **not** invent busy-work to keep the loop alive.

## Notes

- **Requires macOS + Ghostty.** The watcher types only into THIS session's Ghostty window
  (located by title, idle state only), only when Ghostty is frontmost and the turn is
  idle; a global keystroke mutex serializes injection; a hard cycle cap applies
  regardless of N; global kill switch `touch ~/.claude/dufflebag/state/context-guard-off`.
- `/autorun stop` is a **pause** (re-armable); `/autorun exit` shuts the watcher down for
  this session — re-enabling then needs a fresh `/autorun`, which starts it again.
- Tune the warn %, budget, and hard cap with `dufflebag config`.
