# skills-bag

> A one-command installer for a personal bag of [Claude Code](https://claude.com/claude-code) skills and hooks — a context guardrail, a DRY dedup-guard, a hands-free autonomous-compact loop, macOS text-to-speech, and a PNG → pixel-perfect-code skill. Pure TypeScript, Node-only, **no Python**.

```bash
npx skills-bag install
```

`skills-bag` wires a small set of hooks and skills into your `~/.claude` (or a project's `.claude/`), tunes them to your taste, and removes them just as cleanly. It edits your `settings.json` **surgically** — every bag-owned entry is path-identified, so `uninstall` takes back exactly what it added and never touches your own hooks or config.

---

## What's in the bag

| Feature | What it does | Runs on |
| --- | --- | --- |
| **context-guard** | Nudges you to run `/handoff` at ~18% of the model's context window, then hard-denies new code edits at ~20% (handoff-doc writes stay allowed) — so long sessions wind down gracefully instead of ballooning past usable context. | 🟢 any OS, any terminal |
| **dedup-guard** | Blocks a Write/Edit that pastes a function body or `interface`/`type` shape already defined elsewhere in the repo — DRY enforced at the moment of the write, using an AST fingerprint over the repo's own TypeScript. Deny by default; tunable `warn`/`off`. Also wires Cursor (warn) + an AGENTS.md rule for Codex, and ships a `dedup check` CI gate. | 🟢 any OS · needs the repo's TypeScript |
| **autonomous-loop** (`/autorun` `/autostop` `/autoexit`) | A background daemon that, once armed, auto-`/compact`s and resumes your work hands-free each time context nears the guardrail and a fresh handoff exists — until a cycle budget, a done-marker, or `/autostop`. | 🔴 macOS + [Ghostty](https://ghostty.org) only |
| **speak-response** | A `Stop` hook that speaks Claude's prose (code stripped) via the macOS `say` command. | 🟡 macOS |
| **png-to-code** | A skill that turns a PNG design (illustration, logo, UI mockup) into SVG/HTML/CSS matching the original **1:1** — a decompose → reuse-or-build → render → screenshot-diff → refine loop where a measured pixel diff (not the eye) is the source of truth, plus a rig-first doctrine for animation. Pure skill, no hooks; the diff harness needs Node + Playwright. | 🟢 any OS · Node + Playwright for the diff loop |

`context-guard` is the safe default. The autonomous loop is **experimental and macOS+Ghostty-only** because it works by typing `/compact` into your terminal window via AppleScript — every keystroke is gated behind a wall of safety checks (see [How it works](#how-it-works)).

> **Heads up:** the autonomous loop types into your terminal. Install it only if you understand and want that. The kill switch is always one command away: `touch ~/.claude/.ctx-guard-off`.

---

## Install

```bash
# Interactive — pick features, install to ~/.claude
npx skills-bag install

# Non-interactive (CI / scripted)
npx skills-bag install --yes --features context-guard,dedup-guard,autonomous-loop,speak-response,png-to-code

# Project scope — writes ./.claude and commits the payload so teammates get it on clone
npx skills-bag install --project
```

After installing, **restart Claude Code** (or start a new session) so the hooks load.

Requirements: **Node ≥ 20**. The autonomous loop additionally needs **macOS + Ghostty**; `speak-response` needs **macOS**. `skills-bag doctor` tells you what's satisfied.

### Interactive setup

Run `npx skills-bag install` with no flags and it walks you through a short, animated TUI:

```text
┌   skills-bag · install · global
│
◇  Agents detected ─────────────────────────────╮
│  ✓ Claude Code — install target                │
│  • Cursor — detected · adapter tracked in #5   │
│  • Codex — detected · adapter tracked in #5    │
├───────────────────────────────────────────────╯
│
◆  Which features do you want to install?
│  ◼ context-guard    (any OS)
│  ◻ dedup-guard      (any OS · needs the repo's TypeScript)
│  ◻ autonomous-loop  (macos+ghostty)
│  ◻ speak-response   (macos)
│  ◻ png-to-code      (any OS · Node + Playwright)
└
```

1. **Agent detection.** skills-bag scans your machine for installed coding agents. **Claude Code** is the install target today; a detected **Cursor** or **Codex** is listed too, but skills-bag leaves them untouched for now — adapters are tracked in [#5](https://github.com/YosefHayim/skills-bag/issues/5).
2. **Feature pick.** Choose what to install — `context-guard` is preselected as the safe default.
3. **Ghostty bootstrap.** If you pick the **autonomous loop** on macOS and Ghostty isn't installed, skills-bag offers to install it for you (the loop can drive no other terminal):

   ```text
   ◆  Ghostty isn't installed — install it now with Homebrew? (required for /autorun)
   │  ●  Yes   ○  No
   ```

   - **Yes** → runs `brew install --cask ghostty`, then continues.
   - **No** → the loop still installs but stays **inert**: `/autorun` can't run without Ghostty, while `context-guard` keeps working everywhere. (No Homebrew on PATH? It prints the manual install link instead of offering.)

`skills-bag doctor` reports the same host + agent detection any time, read-only.

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
| `--dedup-mode` | `SKILLS_BAG_DEDUP_MODE` | `deny` | dedup-guard enforcement: `deny` · `warn` · `off` |
| `--dedup-skip` | `SKILLS_BAG_DEDUP_SKIP` | _(none)_ | extra dir names dedup-guard ignores (comma list) |

Project `settings.json` overrides global, so different repos can run different thresholds. The guard sees changes immediately; an already-running autorun daemon picks them up on the next session.

## Commands

| Command | Description |
| --- | --- |
| `skills-bag install` | Install (or re-run to refresh) the selected features |
| `skills-bag update` | Refresh hook code, keep your features **and** your tuned config |
| `skills-bag uninstall` | Surgically remove everything the bag added |
| `skills-bag config` | Show or change tunables |
| `skills-bag dedup check` | Scan for duplicate functions/types; exits non-zero on findings (pre-commit / CI gate) |
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

## Dedup guard

`dedup-guard` stops the most common form of AI slop — the same function or type re-pasted under a new name — at the moment it's written. It parses the added code with the repo's **own** TypeScript (nothing is bundled), fingerprints each named function body (alpha-canonical, so a renamed copy still matches) and each object-type shape (field-order independent), and compares against a cached index of the whole repo.

```bash
# add it to any TypeScript repo (--project commits the wiring for teammates)
npx skills-bag install --project --features dedup-guard
```

**Enforcement is per-agent — bounded by what each platform actually allows:**

| Agent | What you get | How |
| --- | --- | --- |
| **Claude Code** | hard **deny** before the write lands | `PreToolUse` hook |
| **Cursor** | **warn** after the edit (no native before-edit deny exists) | `afterFileEdit` in `.cursor/hooks.json` |
| **Codex** | an **AGENTS.md** rule + the `dedup check` command | Codex's `PreToolUse` only intercepts Bash, so edits can't be hooked |

So a duplicate is blocked on Claude, flagged on Cursor, and — on any agent that can't hook a file edit — caught by the command, which doubles as a **pre-commit / CI gate**:

```bash
skills-bag dedup check                 # scan the repo; exits non-zero on duplicates
skills-bag dedup check --staged        # only files staged for commit (pre-commit)
skills-bag dedup check --since main    # only files changed vs a ref (PR / CI)
```

Tune it with `SKILLS_BAG_DEDUP_MODE` (`deny` · `warn` · `off`) and exclude generated/scaffold dirs with `SKILLS_BAG_DEDUP_SKIP` (e.g. a monorepo's `templates`). A genuinely intentional duplicate? Append `// dup-ignore` to the declaration's first line — honored by both the live hooks and `dedup check`.

> **No TypeScript in the repo → no guard.** dedup-guard resolves the project's own `typescript`; a repo without it is reported by `doctor`, the hook fails open (allows the edit), and `dedup check` reports it as un-checkable and exits 0 rather than failing CI.

---

## PNG → pixel-perfect code

`png-to-code` is a **skill** (no hooks): instructions + a small verification harness Claude follows to reproduce a PNG design as code that matches the original **1:1**. The discipline is that a *measured pixel diff* — not the eye — is the source of truth, so the agent converges slowly and provably instead of declaring "looks close."

```bash
# add just this skill (any OS)
npx skills-bag install --features png-to-code
```

The loop: **decompose** the image into ordered regions → **reuse or build** vectors (search existing SVG libraries first, trace/hand-build only the gap) → **render + screenshot-diff** against the target → **refine the biggest hotspot** and re-measure, one change per iteration, until the mismatch ratio is below 0.1%. Animated figures follow a **rig-first doctrine** (slice at joints, pivot at the joint, parent, overlap) so motion is trivial keyframes on already-correct pivots.

It ships its own harness under the skill's `scripts/` — a one-time setup installs it:

```bash
cd ~/.claude/skills/png-to-code/scripts && npm i && npx playwright install chromium
```

`src/core/pixel-diff.ts` (Playwright render + `pixelmatch`) reports the ratio and a hotspot grid; `inspect-png.ts` samples dimensions/colors; `frames.ts` contact-sheets animation poses. All TypeScript, run via `tsx` from `scripts/`. Without Node/Playwright the skill falls back to a manual overlay and says plainly that the match is eyeballed, not measured.

---

## How it works

```
            settings.json (yours, edited surgically)
            ├─ hooks  → node "~/.claude/skills-bag/hooks/<hook>.js"   (path-identified)
            └─ env    → SKILLS_BAG_*                                  (prefix-identified)

  PreToolUse / PostToolUse / UserPromptSubmit ─▶ context-guard.js   reads context %, nudges/denies
  PreToolUse (Write|Edit|MultiEdit)           ─▶ dedup-guard.js     denies a duplicate fn/type (DRY)
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
   └─ png-to-code/                    # only with the png-to-code feature
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
