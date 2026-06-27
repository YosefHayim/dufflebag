# skills-bag

> A one-command installer for a personal bag of [Claude Code](https://claude.com/claude-code) skills and hooks — a context guardrail, a hands-free autonomous-compact loop, and macOS text-to-speech. Pure TypeScript, Node-only, **no Python**.

```bash
npx skills-bag install
```

`skills-bag` wires a small set of hooks and skills into your `~/.claude` (or a project's `.claude/`), tunes them to your taste, and removes them just as cleanly. It edits your `settings.json` **surgically** — every bag-owned entry is path-identified, so `uninstall` takes back exactly what it added and never touches your own hooks or config.

---

## What's in the bag

| Feature | What it does | Runs on |
| --- | --- | --- |
| **context-guard** | Nudges you to run `/handoff` at ~18% of the model's context window, then hard-denies new code edits at ~20% (handoff-doc writes stay allowed) — so long sessions wind down gracefully instead of ballooning past usable context. | 🟢 any OS, any terminal |
| **autonomous-loop** (`/autorun` `/autostop` `/autoexit`) | A background daemon that, once armed, auto-`/compact`s and resumes your work hands-free each time context nears the guardrail and a fresh handoff exists — until a cycle budget, a done-marker, or `/autostop`. | 🔴 macOS + [Ghostty](https://ghostty.org) only |
| **speak-response** | A `Stop` hook that speaks Claude's prose (code stripped) via the macOS `say` command. | 🟡 macOS |

`context-guard` is the safe default. The autonomous loop is **experimental and macOS+Ghostty-only** because it works by typing `/compact` into your terminal window via AppleScript — every keystroke is gated behind a wall of safety checks (see [How it works](#how-it-works)).

> **Heads up:** the autonomous loop types into your terminal. Install it only if you understand and want that. The kill switch is always one command away: `touch ~/.claude/.ctx-guard-off`.

---

## Install

```bash
# Interactive — pick features, install to ~/.claude
npx skills-bag install

# Non-interactive (CI / scripted)
npx skills-bag install --yes --features context-guard,autonomous-loop,speak-response

# Project scope — writes ./.claude and commits the payload so teammates get it on clone
npx skills-bag install --project
```

After installing, **restart Claude Code** (or start a new session) so the hooks load.

Requirements: **Node ≥ 20**. The autonomous loop additionally needs **macOS + Ghostty**; `speak-response` needs **macOS**. `skills-bag doctor` tells you what's satisfied.

## Configure

All tunables live as `SKILLS_BAG_*` environment variables in your `settings.json` — one source of truth shared by the guard and the daemon, so thresholds can't drift.

```bash
skills-bag config                       # show effective values
skills-bag config --warn 0.15           # nudge earlier
skills-bag config --block 0.22 --budget 5
```

| Flag | Env var | Default | Meaning |
| --- | --- | --- | --- |
| `--warn` | `SKILLS_BAG_WARN_PCT` | `0.18` | Fraction of the window at which to nudge `/handoff` |
| `--block` | `SKILLS_BAG_BLOCK_PCT` | `0.20` | Fraction at which to hard-deny code edits |
| `--budget` | `SKILLS_BAG_DEFAULT_BUDGET` | `10` | Cycles for a bare `/autorun` |
| `--hard-cap` | `SKILLS_BAG_HARD_CAP` | `50` | Absolute anti-runaway ceiling |
| `--poll` | `SKILLS_BAG_POLL_SECONDS` | `5` | Daemon poll interval |
| `--idle` | `SKILLS_BAG_IDLE_SECONDS` | `8` | Quiescence required before the daemon counts a turn as idle |
| `--tts-voice` | `SKILLS_BAG_TTS_VOICE` | `Samantha` | macOS `say` voice |
| `--tts-rate` | `SKILLS_BAG_TTS_RATE` | `230` | TTS words per minute |

Project `settings.json` overrides global, so different repos can run different thresholds. The guard sees changes immediately; an already-running autorun daemon picks them up on the next session.

## Commands

| Command | Description |
| --- | --- |
| `skills-bag install` | Install (or re-run to refresh) the selected features |
| `skills-bag update` | Refresh hook code, keep your features **and** your tuned config |
| `skills-bag uninstall` | Surgically remove everything the bag added |
| `skills-bag config` | Show or change tunables |
| `skills-bag doctor` | Read-only health check across global + project scopes |

All commands take `--global` (default) or `--project`.

## Using the autonomous loop

In a session (macOS + Ghostty):

```text
/autorun 5     → arm the loop for up to 5 compact cycles
/autostop      → pause (re-arm later with /autorun)
/autoexit      → shut the daemon down for this session
```

While armed, **you** make each compaction safe: run `/handoff` to save a resume doc before the guardrail, and write the done-marker (the guard message tells you the exact path) when the task is genuinely finished — instead of another handoff — to halt the loop.

---

## How it works

```
            settings.json (yours, edited surgically)
            ├─ hooks  → node "~/.claude/skills-bag/hooks/<hook>.js"   (path-identified)
            └─ env    → SKILLS_BAG_*                                  (prefix-identified)

  PreToolUse / PostToolUse / UserPromptSubmit ─▶ context-guard.js   reads context %, nudges/denies
  SessionStart                                ─▶ ctx-watch-spawn.js  launches the daemon (disarmed)
  Stop                                        ─▶ speak-response.js   speaks the turn (macOS)

  /autorun /autostop /autoexit (skills)       ─▶ ctx-loop-ctl.js     arms/pauses/exits + reports
  ctx-watch.js (daemon, one per session)      ─▶ types /compact      only when EVERY gate passes
```

The daemon never types unless **all** of these hold: the session is armed; context is ≥ warn %; a *fresh* handoff doc exists; the turn is idle; Ghostty is frontmost; this session's window is uniquely located (it refuses rather than guess); and a global keystroke mutex is held so parallel armed sessions can't interleave. A hard cap, kill switches (`~/.claude/.ctx-guard-off` and `/autoexit`), and self-reap on a stale/dead session bound it. Every hook is **fail-open** — any error allows the tool through; the guard never blocks because of its own bug.

### Install layout

```
~/.claude/
├─ settings.json            # your file; bag hooks + SKILLS_BAG_* env merged in, backed up first
├─ skills-bag/
│  ├─ hooks/                # the self-contained compiled hook payload (bare Node, zero deps)
│  ├─ manifest.json         # what this scope installed (features, skills, version)
│  └─ package.json          # { "type": "module" } so the ESM hooks run as bare files
└─ skills/
   ├─ autorun/ autostop/ autoexit/   # only with the autonomous loop
```

The CLI uses [`commander`](https://github.com/tj/commander.js), [`@clack/prompts`](https://github.com/bombshell-dev/clack), and [`picocolors`](https://github.com/alexeyraspopov/picocolors) for the interactive UX; the **hook payload depends on nothing** so it runs the instant a hook fires.

## Uninstall

```bash
skills-bag uninstall            # global
skills-bag uninstall --project  # project
```

Removes the bag's hooks (by path marker), `SKILLS_BAG_*` env keys (by prefix), the installed skills, and the payload dir — backing up `settings.json` first. Your own hooks, env, and settings are untouched, and timestamped backups remain next to `settings.json` for rollback.

## Development

```bash
pnpm install
pnpm build        # tsc → dist/
pnpm test         # vitest
pnpm typecheck
pnpm dev -- install --project   # run the CLI from source
```

## License

[MIT](./LICENSE) © Yosef Hayim Sabag
