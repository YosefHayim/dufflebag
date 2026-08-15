# Testing STT → route-aware refine → input

Goal: speak a messy freeform request, see a **refined** prompt land in the agent input, hit Enter, same session continues. No second “routing chat.”

## Prerequisites

1. **Codex CLI logged in** (for default backend):

   ```bash
   codex login
   codex exec -m gpt-5.3-codex-spark --ephemeral --skip-git-repo-check -s read-only "Reply with exactly: ok"
   ```

2. **Voice built and installed** from this package:

   ```bash
   cd /path/to/dufflebag
   ./scripts/buildVoice.sh
   pnpm cli voice on --scope global   # or project
   ```

3. **Mic + Accessibility** allowed for Terminal / the host that runs `dufflebag-voice` (macOS System Settings).

## Configure cheap Spark refine on STT

```bash
# Enable refine on dictation release (keeps double-tap off unless you use both)
pnpm cli config set prompt-refinement-mode stt

# Defaults are already codex + Spark; set explicitly if needed:
pnpm cli config set prompt-refinement-backend codex
pnpm cli config set prompt-refinement-model gpt-5.3-codex-spark

pnpm cli config show
```

Restart voice so the daemon reloads config:

```bash
pnpm cli voice off
pnpm cli voice on
```

Optional: `both` also enables Control double-tap clipboard refine.

## Offline refine (no mic) — prove Codex path first

```bash
# Via worker CLI (uses bag config, or pass flags)
src/hookIsland/speakResponse/dufflebag-voice refine \
  --text "uh can you like make a branch and change the bio line to hello and open a pr but dont merge"

# Or Python directly
python3 src/hookIsland/speakResponse/prompt_refinement.py \
  --backend codex \
  --model gpt-5.3-codex-spark \
  --text "deslop this repo its full of ceremony and wrappers"
```

Expect a single paste-ready line (often starting with a skill id like `finish-and-ship:` or `deslop-v2:`), not a multi-page plan.

## Live STT test

1. Focus an agent input (Claude Code, Codex, Cursor, Grok terminal, TextEdit, etc.).
2. **Hold Control**, speak something messy, e.g.:

   > “yeah so um can you finish and ship this, make a branch, commit the voice refine stuff, open a pr, don’t merge it”

3. **Release Control**.
4. **Immediately** (after offline STT decode, ~100–300ms) raw transcript lands in the input and the HUD **hides** (no lingering “Refining…” spinner over already-pasted text).
5. Refine runs in the background. If the rewrite differs from raw, a brief `Updating…` flash appears while the caret is replaced; if it’s the same, nothing else is shown.
6. If the preferred model is missing / not allowed for your Codex account (e.g. Spark on ChatGPT login), the worker **rotates** to a working model (`gpt-5.4-mini`, `gpt-5.6-terra`, …) and remembers the last-good id.
7. If refine hits a **quota / rate limit / billing** error (or every automatic model fails), a **macOS picker** appears:
   - Alert explaining the limit
   - Choose **model** from the available list (or “Skip refine”)
   - Choose **reasoning effort** (`minimal` … `xhigh`)
   - Choice is saved to bag config + sticky voice cache for the next dictation
8. Glance, press **Enter** — real work starts in the same session.

Headless / CI: set `DUFFLEBAG_REFINE_NO_PICKER=1` or pass `--no-picker` to `prompt_refinement.py`.

### Pick refine model interactively (dynamic providers)

Lists backends that are actually on your PATH (codex, claude, grok, ollama, opencode, …) and their models:

```bash
# JSON inventory
python3 src/hookIsland/speakResponse/prompt_refinement.py --list-providers

# Interactive TTY menu → writes bag config
pnpm cli config pick-refine
# aliases:
pnpm cli config set prompt-refinement-model menu
pnpm cli config set prompt-refinement-backend menu

# Force macOS GUI dialogs
pnpm cli config pick-refine --gui
```

### Logs

```bash
tail -f ~/Library/Application\ Support/dufflebag/voice/dictation.log
```

Look for:

- `stt refine gen=… backend=codex model=gpt-5.3-codex-spark … refined=…`
- `typed gen=… text=…`

If refine fails, the raw transcript is typed anyway (`stt refine failed …; typing raw transcript`).

## Modes cheat sheet

| `promptRefinementMode` | Behavior |
| --- | --- |
| `off` | Type STT as-is (default) |
| `stt` | Refine after final transcript, then deliver |
| `review` | Double-tap Control refines **clipboard** only |
| `both` | STT refine + double-tap clipboard |

| `promptRefinementBackend` | Engine (ytcap-style; pair with `promptRefinementModel`) |
| --- | --- |
| `codex` | Codex CLI (default model `gpt-5.3-codex-spark`) |
| `grok` | Grok Build (`-m`, `--reasoning-effort`) |
| `ollama` | Local Ollama (`ollama run <model>`) |
| `opencode` | OpenCode CLI when installed |
| `claude` / `gemini` | Headless print modes |
| `local` | Apple Foundation Models |
| `auto` | local, then codex fallback |

| Extra knobs | Default | Purpose |
| --- | --- | --- |
| `promptRefinementModel` | `gpt-5.3-codex-spark` | Preferred model id; Codex path rotates if unavailable |
| `promptRefinementReasoningEffort` | `low` | `low` / `medium` / `high` / … (default **low** so release is not stuck on xhigh reasoning) |
| `promptRefinementShowRawFirst` | `true` | Paste **raw STT** first, then replace with refined (STT+refine always does this for latency) |
| `promptRefinementAutoSubmit` | `false` | Press **Enter** after refined text lands in the caret |

### Switch providers like ytcap (`agent=` / `model=` / `reasoning-effort=`)

```bash
# Codex Spark (cheap default)
pnpm cli config set prompt-refinement-backend codex
pnpm cli config set prompt-refinement-model gpt-5.3-codex-spark

# Grok with low reasoning
pnpm cli config set prompt-refinement-backend grok
pnpm cli config set prompt-refinement-model grok-4.5
pnpm cli config set prompt-refinement-reasoning-effort low

# Ollama local
pnpm cli config set prompt-refinement-backend ollama
pnpm cli config set prompt-refinement-model llama3.2

# See raw STT in the input, then refined replaces it; optional auto-Enter
pnpm cli config set prompt-refinement-show-raw-first true
pnpm cli config set prompt-refinement-auto-submit false   # true = Enter after refined paste

pnpm cli voice off && pnpm cli voice on
```

Offline one-shots:

```bash
# Grok
src/hookIsland/speakResponse/dufflebag-voice refine \
  --backend grok --model grok-4.5 --reasoning-effort low \
  --text "uh make a branch and open a pr dont merge"

# Ollama
src/hookIsland/speakResponse/dufflebag-voice refine \
  --backend ollama --model llama3.2 \
  --text "deslop this its full of wrappers"
```

| `promptRefinementDelivery` | Where the refined text goes |
| --- | --- |
| `caret` | Focused input (default) — same as classic STT type |
| `cmux-new` | **New focused cmux workspace/terminal** (paste refined text; optional command) |
| `cmux-resume` | Inject into the **focused cmux surface** (uses session when resume binding exists) |

### Spawn a new cmux terminal (watch the agent run)

**Paste only** (you review + Enter in the new tab):

```bash
pnpm cli config set prompt-refinement-mode stt
pnpm cli config set prompt-refinement-delivery cmux-new
pnpm cli config set prompt-refinement-cmux-command ""
pnpm cli config set prompt-refinement-cmux-auto-submit false
pnpm cli voice off && pnpm cli voice on
```

Offline smoke (no mic):

```bash
src/hookIsland/speakResponse/dufflebag-voice refine \
  --backend codex \
  --model gpt-5.3-codex-spark \
  --delivery cmux-new \
  --text "uh make a branch change bio to hello open pr dont merge"
```

A new cmux workspace opens focused with the refined prompt typed into the terminal. Submit yourself (or set auto-submit true to send Enter).

**Auto-start Codex in the new workspace:**

```bash
pnpm cli config set prompt-refinement-delivery cmux-new
pnpm cli config set prompt-refinement-cmux-command 'codex --yolo -- "$(cat {{prompt_file}})"'
```

Other templates:

```bash
# Claude
pnpm cli config set prompt-refinement-cmux-command 'claude --dangerously-skip-permissions -- "$(cat {{prompt_file}})"'

# Grok
pnpm cli config set prompt-refinement-cmux-command 'grok "$(cat {{prompt_file}})"'
```

Placeholders: `{{prompt_file}}` (safe temp path), `{{prompt}}` (shell-escaped), `{{cwd}}`.

### Resume / inject into the current cmux session

```bash
pnpm cli config set prompt-refinement-delivery cmux-resume
# optional: send Enter after inject
pnpm cli config set prompt-refinement-cmux-auto-submit true
```

Offline:

```bash
src/hookIsland/speakResponse/dufflebag-voice refine \
  --delivery cmux-resume \
  --text "also fix the typo in the header while you are there"
```

Uses the focused cmux surface (and reports agent/session from `surface.resume` when available).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Always types raw mess | Mode still `off`; config path wrong; daemon not restarted |
| Refine hangs / errors | `codex login`; model name; network; `dictation.log` |
| Empty input after release | No speech / Whisper empty — try longer hold |
| Clipboard path only | You set `review` not `stt` |
| Want free Apple path | `prompt-refinement-backend local` (needs Apple Intelligence) |

## Turn off

```bash
pnpm cli config set prompt-refinement-mode off
pnpm cli voice off && pnpm cli voice on
```
