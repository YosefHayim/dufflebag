---
name: autoexit
description: Shut down the autonomous context loop daemon for this session and print a final usage report. Use when the user types /autoexit, says "autoexit", "kill the autorun daemon", or asks to fully stop and exit the hands-off auto-compact watcher (not just pause it).
---

# autoexit

**Shut down** the autonomous loop for the current session: disarm **and** tell the
`ctx-watch` daemon to self-terminate. Unlike `/autostop` (which pauses but keeps the
daemon observing), this stops the watcher process entirely. Re-enabling later needs a
fresh `/autorun`, which re-spawns it.

## Quick start

```bash
node "@@CTL@@" exit
```

Relay the script's final report to the user verbatim. It shows the cycle exited at (and
the budget), total input/output tokens this session, session wall-time, live 5h and
weekly usage percentages, and the last auto-halt reason if any. The daemon stops on its
next poll (within a few seconds) and releases its lockfile.

## Notes

- Use `/autostop` instead if you only want to pause and keep the option to resume.
- The global kill switch `touch ~/.claude/.ctx-guard-off` disables everything at once.
