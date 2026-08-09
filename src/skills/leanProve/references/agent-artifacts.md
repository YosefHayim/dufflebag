# Agent-generated artifacts (house convention)

**Product SSOT stays at repo root (or existing homes):**  
`README.md`, `AGENTS.md`, `CODE-STYLE.md`, `PROJECT.md`, `CONTEXT.md`, `LANGUAGE.md`, `docs/adr/**`.

**Stable product agent config** (do not timestamp; not campaign noise):  
`docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md` — note the plural **`docs/agents/`**.

**Everything skills generate as run reports / campaign boards / audits** goes under **`docs/agent/`** (singular) — never the repo root, and never under product `docs/agents/`.

## Layout

```text
docs/
  agent/                                    # create if missing (singular = campaign noise)
    <campaign>/                             # e.g. sdlc-tasks, test-gap, messy-repo
      CURRENT                               # one line: active run-id (resume pointer)
      2026-08-09T143022Z/                   # run-id = UTC date-u +%Y-%m-%dT%H%M%SZ
        BOARD.md | REPORT.md | FEATURES.md  # names stable *inside* the run dir
        STATE.md | SHIP.md | …
      2026-08-09T150100Z/                   # prior / parallel runs stay intact
        …
    session-audit-YYYY-MM-DD/               # agent-session-auditor (date folder OK)
  agents/                                   # product SSOT — issue-tracker, triage, domain
  adr/                                      # real product decisions — not agent noise
  learning/
    TEACH.md
```

## Run isolation (required — multi-agent / multi-run safe)

Fixed paths like `docs/agent/sdlc-tasks/BOARD.md` **overwrite** when two runs or two agent hosts write the same file. **Every new run** must allocate a **time-stamped run directory** and write only under it.

```bash
CAMPAIGN="sdlc-tasks"   # or test-gap, lean-prove, messy-repo, …
RUN_ID=$(date -u +%Y-%m-%dT%H%M%SZ)   # e.g. 2026-08-09T143022Z
# Same-second collision (rare): append -$RANDOM or -$$ until free
while [ -e "docs/agent/$CAMPAIGN/$RUN_ID" ]; do
  RUN_ID="$(date -u +%Y-%m-%dT%H%M%SZ)-$$"
done
AGENT_DOCS="docs/agent/$CAMPAIGN/$RUN_ID"
mkdir -p "$AGENT_DOCS"
printf '%s\n' "$RUN_ID" > "docs/agent/$CAMPAIGN/CURRENT"
# Write only under $AGENT_DOCS for the life of this run
```

| Rule | Detail |
|------|--------|
| **New run** | Always create a new `RUN_ID` dir. Never clobber an existing run dir. |
| **Same multi-lane campaign** | One shared `RUN_ID` for the orchestrator + all lanes. Put `AGENT_DOCS` in every `LANE-BRIEF.md`. Lanes must not invent a second run-id. |
| **Resume** | Do **not** create a new run-id. Resolve existing (below) and keep writing there. |
| **CURRENT** | Update only when this run becomes the active one (new start or explicit resume target). |
| **Do not delete** prior run dirs unless the user explicitly asks for cleanup. |

### Resume lookup order

1. Explicit path or run-id from the user (`resume docs/agent/test-gap/2026-08-09T143022Z`).
2. `docs/agent/<campaign>/CURRENT` → `docs/agent/<campaign>/<that-id>/`.
3. Newest sibling dir matching `YYYY-MM-DDTHHMMSSZ` (lexicographic sort works for this format).
4. **Legacy flat** files still under `docs/agent/<campaign>/*.md` (no run subdir): **read** for continuity; on next write, either keep using that flat file for this resume only, or **move** them into a new run dir and set `CURRENT` — do not leave silent duplicates forever.
5. **Legacy root** (`TEST-GAP-REPORT.md`, etc.): migrate into a run dir under `docs/agent/<campaign>/`, delete root copy after copy.

## Rules for every flow skill

1. **Resolve dir:** `AGENT_DOCS = <repo>/docs/agent/<campaign>/<run-id>/` (new run → mint run-id; resume → lookup).
2. **Ensure path:** `mkdir -p "$AGENT_DOCS"` (and parents) before first write; write `CURRENT` on new/active run.
3. **Write only under that dir** for reports/boards/features/state for this run.
4. **LANE-BRIEF.md** stays inside the **worktree** (`.worktrees/.../LANE-BRIEF.md`), not under `docs/agent/` and not repo root of main. Brief must include `AGENT_DOCS` / `run-id`.
5. **Do not** put campaign files under `docs/adr/` or product **`docs/agents/`** (plural).
6. Optional: add `docs/agent/README.md` once listing campaigns — only if the repo has no agent README yet; keep it 5–10 lines.

## Campaign → path map

| Campaign | Run dir pattern | Primary files (inside run dir) | Legacy fallback (migrate away) |
|----------|-----------------|--------------------------------|--------------------------------|
| sdlc-tasks | `docs/agent/sdlc-tasks/<run-id>/` | `BOARD.md`, `STATE.md` | flat `docs/agent/sdlc-tasks/BOARD.md` |
| test-gap | `docs/agent/test-gap/<run-id>/` | `FEATURES.md`, `REPORT.md`, `SHIP.md` | root `TEST-GAP-*.md` or flat campaign dir |
| lean-prove | `docs/agent/lean-prove/<run-id>/` | `FEATURES.md`, `REPORT.md` | root `LEAN-PROVE-*.md` or flat |
| style-audit | `docs/agent/style-audit/<run-id>/` | `FINDINGS.md` | root `*-AUDIT*.md` or flat |
| messy-repo | `docs/agent/messy-repo/<run-id>/` | `MATRIX.md`, `STATE.md`, `AUDIT.md`, `HEALTH.md`, planpage JSON | flat campaign dir |
| ux-journey | `docs/agent/ux-journey/<run-id>/` | `MATRIX.md`, `AUDIT.md`, `TASTE.md`, `mocks/` | flat campaign dir |
| benchmark | `docs/agent/benchmark/<run-id>/` | `REPORT.md`, `results.json` | flat campaign dir |
| teach | `docs/learning/TEACH.md` | (stable learning record; not multi-run board) | root `TEACH.md` |

`run-id` format: **`YYYY-MM-DDTHHMMSSZ`** from `date -u +%Y-%m-%dT%H%M%SZ` (filesystem-safe; no colons).

## Anti-slop

- No `TEST-GAP-*.md`, `LEAN-PROVE-*.md`, `*AUDIT*.md`, or campaign boards at **repository root**.
- No writing campaign boards to a **fixed** path that a second run will overwrite (`docs/agent/<campaign>/BOARD.md` without a run-id).
- Chat can show summaries; durable artifacts live under `docs/agent/<campaign>/<run-id>/`.
- Do not confuse **`docs/agent/`** (runs) with **`docs/agents/`** (product config).
