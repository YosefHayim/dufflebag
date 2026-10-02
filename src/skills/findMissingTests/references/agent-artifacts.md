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
    <campaign>/                             # e.g. run-tasks-in-parallel, find-missing-tests, improve-ux
      CURRENT                               # one line: active run-id (resume pointer)
      2026-08-09T143022Z/                   # run-id = UTC date-u +%Y-%m-%dT%H%M%SZ
        BOARD.md | REPORT.md | FEATURES.md  # names stable *inside* the run dir
        STATE.md | SHIP.md | …
      2026-08-09T150100Z/                   # prior / parallel runs stay intact
        …
    session-audit-YYYY-MM-DD/               # find-repeated-prompts (date folder OK)
  agents/                                   # product SSOT — issue-tracker, triage, domain
  adr/                                      # real product decisions — not agent noise
  learning/
    TEACH.md
```

## Run isolation (required — multi-agent / multi-run safe)

Fixed paths like `docs/agent/run-tasks-in-parallel/BOARD.md` **overwrite** when two runs or two agent hosts write the same file. **Every new run** must allocate a **time-stamped run directory** and write only under it.

```bash
CAMPAIGN="run-tasks-in-parallel"   # or find-missing-tests, clean-repo-by-feature, …
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

1. Explicit path or run-id from the user (`resume docs/agent/find-missing-tests/2026-08-09T143022Z`).
2. `docs/agent/<campaign>/CURRENT` → `docs/agent/<campaign>/<that-id>/`.
3. Newest sibling dir matching `YYYY-MM-DDTHHMMSSZ` (lexicographic sort works for this format).
4. **Legacy flat** files still under `docs/agent/<campaign>/*.md` (no run subdir): **read** for continuity; on next write, either keep using that flat file for this resume only, or **move** them into a new run dir and set `CURRENT` — do not leave silent duplicates forever.
5. **Root files** (reports or boards left at the repository root): move into a run dir under `docs/agent/<campaign>/`, delete the root copy after the copy.

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
| run-tasks-in-parallel | `docs/agent/run-tasks-in-parallel/<run-id>/` | `BOARD.md`, `STATE.md` | — |
| find-missing-tests | `docs/agent/find-missing-tests/<run-id>/` | `FEATURES.md`, `REPORT.md` | — |
| ship-missing-tests | `docs/agent/ship-missing-tests/<run-id>/` | `SHIP.md` (reads the find-missing-tests `REPORT.md`) | — |
| simplify-repo-with-tests | `docs/agent/simplify-repo-with-tests/<run-id>/` | `FEATURES.md`, `REPORT.md` | — |
| code-style-existing-project | `docs/agent/code-style-existing-project/<run-id>/` | `FINDINGS.md` | — |
| clean-repo-by-feature | `docs/agent/clean-repo-by-feature/<run-id>/` | `MATRIX.md`, `STATE.md`, `AUDIT.md`, `HEALTH.md`, planpage JSON | — |
| improve-ux | `docs/agent/improve-ux/<run-id>/` | `MATRIX.md`, `AUDIT.md`, `TASTE.md`, `mocks/` | — |
| benchmark-agents | `docs/agent/benchmark-agents/<run-id>/` | `REPORT.md`, `results.json` | — |
| teach | `docs/learning/TEACH.md` | (stable learning record; not multi-run board) | root `TEACH.md` |

`run-id` format: **`YYYY-MM-DDTHHMMSSZ`** from `date -u +%Y-%m-%dT%H%M%SZ` (filesystem-safe; no colons).

## Anti-slop

- No reports, audits, or campaign boards at **repository root**.
- No writing campaign boards to a **fixed** path that a second run will overwrite (`docs/agent/<campaign>/BOARD.md` without a run-id).
- Chat can show summaries; durable artifacts live under `docs/agent/<campaign>/<run-id>/`.
- Do not confuse **`docs/agent/`** (runs) with **`docs/agents/`** (product config).
