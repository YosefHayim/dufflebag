---
name: autostop
description: Pause the autonomous context loop for this session and print a usage report. Use when the user types /autostop, says "autostop", "pause the autorun", or asks to stop the hands-off auto-compact loop without shutting the daemon down.
---

# autostop

**Pause** the autonomous loop for the current session. This deletes the arm flag so the
`ctx-watch` daemon stops typing `/compact`, but leaves the daemon **observing** — so
`/autorun` re-arms it later from where you left off.

## Quick start

```bash
node "@@CTL@@" stop
```

Relay the script's report to the user verbatim. It shows the cycle paused at (and the
budget), total input/output tokens this session, session wall-time, live 5h and weekly
usage percentages, and the last auto-halt reason if any.

## Notes

- This is a **pause**, not a shutdown. To shut the daemon down for this session, use
  `/autoexit`. To re-arm, use `/autorun <n>`.
- The global kill switch `touch ~/.claude/.ctx-guard-off` disables everything at once.
