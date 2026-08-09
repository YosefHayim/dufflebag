---
name: test-gap-ship
description: Use when the user runs /test-gap-ship, says "test gaps all the way to main", "ship test gaps", "parallel test-gap worktrees merge", "one skill init test coverage campaign", or wants a single orchestrator that scans test gaps (or resumes docs/agent/test-gap/REPORT.md), fans out one sub-agent worktree+issue per feature, TDD-fills unit/mocks/e2e, opens PRs, and merges to default after gates — main stays on topic branches only with a backup first. Artifacts under docs/agent/test-gap/ only (never repo root). Reuses test-gap-tdd, sdlc-tasks-executions, messy-repo-orchestrator, organized-commits, finish-and-ship; does not reimplement them. Default e2e is headless unless user says headed/visible/ui. Prefer over plain test-gap-tdd when merge + parallel lanes are required; over ship-feature-e2e when the job is multi-feature test coverage not one product feature.
type: flow
---

# Test Gap Ship

**One slash → full campaign.** Scan test gaps (or **resume** an existing report) → **backup main** → **one parallel lane per feature with gaps** (worktree + issue + branch) → each lane **TDD-fills** + **unit + headless e2e** → PR with confidence → **merge** after hard gates → done receipt.

Slash: **`/test-gap-ship`**.

This skill is the **glue**. Load sibling `SKILL.md` files and follow them. Do not invent a second worktree scheme, gap taxonomy, or ship path.

## Reuse first (mandatory)

| Concern | Load and follow |
|---------|-----------------|
| Gap layers, scan briefs, TDD order, headless e2e policy | **`test-gap-tdd`** |
| Backup main + multi-feature parallel fan-out + lane matrix | **`messy-repo-orchestrator`** (host mode A/B/C) |
| Worktree / issue / branch / LANE-BRIEF per lane | **`sdlc-tasks-executions` setup-lanes** |
| Commits | **`organized-commits`** |
| Push + open/update PR (pre-merge) | **`finish-and-ship`** |
| Per-lane merge gates + confidence rubric (adapt) | **`ship-feature-e2e`** REFERENCE (confidence, act) — **merge owned here for multi-lane** |
| Single product feature (not a test campaign) | **Stop** → `ship-feature-e2e` |
| Over-engineering lean | **Stop** → `lean-prove` |

Owns only: campaign modes, lane selection from gap report, merge sequencing, e2e-unblock policy, campaign done receipt, artifact paths.

## Artifact paths (mandatory)

Never write campaign markdown at the **repository root**. Never overwrite another run’s fixed flat files.

| File | Path |
|------|------|
| Features (from test-gap-tdd) | `docs/agent/test-gap/<run-id>/FEATURES.md` |
| Gap report | `docs/agent/test-gap/<run-id>/REPORT.md` |
| Campaign board | `docs/agent/test-gap/<run-id>/SHIP.md` |
| Active pointer | `docs/agent/test-gap/CURRENT` |

1. **New campaign:** `RUN_ID=$(date -u +%Y-%m-%dT%H%M%SZ)`; `AGENT_DOCS=docs/agent/test-gap/$RUN_ID`; `mkdir -p "$AGENT_DOCS"`; write `CURRENT`.
2. **Resume / from-report:** resolve `CURRENT` or explicit run path; do not mint a new run-id. Migrate legacy root `TEST-GAP-*.md` or flat campaign files into a run dir.
3. `LANE-BRIEF.md` stays **inside each worktree**, not under `docs/agent/`. Include `AGENT_DOCS` in every brief.
4. Shared rules: [references/agent-artifacts.md](references/agent-artifacts.md).

## Invocation

```text
/test-gap-ship
/test-gap-ship MYPR-App
/test-gap-ship resume
/test-gap-ship residual-only
/test-gap-ship scan-only
/test-gap-ship no-merge
/test-gap-ship wave=1
/test-gap-ship surface=web
/test-gap-ship headed
/test-gap-ship no-cmux
/test-gap-ship agent=grok
```

| Flag / phrase | Meaning |
|---------------|---------|
| **(default)** | Scan if no fresh report → backup main → parallel lanes for P0 gaps → fill → prove → PR → **merge** each green lane |
| `resume` / `from-report` | Skip scan; use existing `$AGENT_DOCS/REPORT.md` (+ FEATURES.md via CURRENT/run-id; migrate legacy if needed) |
| `residual-only` | Only features listed under residual / still-missing in the report |
| `scan-only` | Only run `test-gap-tdd` scan; stop (no lanes) |
| `no-merge` | Open PRs only; human merges |
| `wave=N` / `max-lanes=N` | Cap parallel lanes this run (default: all P0, max **8** unless user raises) |
| `surface=web\|native\|all` | E2E surfaces (default `all` that exist) |
| **headless (DEFAULT)** | Do **not** require user to say headless |
| `headed` / `visible` / `ui` | Headed e2e only when said |
| `no-cmux` | Host subagents / in-process only (messy-repo host A) |
| `agent=grok\|claude\|codex` | cmux lane CLI when host B |

If the user does **not** say headed/visible/ui → **headless**.

## Safety

- Invoking this skill **authorizes** merge to default **after hard gates** (same spirit as `ship-feature-e2e`), unless `no-merge`.
- **Never** commit campaign work on the default branch. Product/test commits only on topic branches.
- **Backup main first** before fan-out (mandatory — follow `messy-repo-orchestrator` backup recipe). Record backup name + SHA.
- **Never** force-push protected default. **Never** delete remote branches unless user asks.
- **Hard stop per lane** if unit fails. **Hard stop merge** if required e2e fails when the stack is available.
- If e2e tooling/API/sim is **unavailable**: record **honest skip**, still merge **only if** unit + contract gates pass **and** confidence ≤ cap for missing e2e (see REFERENCE). Prefer `no-merge` wave for e2e-blocked residual when user cares about e2e proof first.
- Cap fan-out: default max **8** concurrent lanes; queue the rest as wave 2.
- One lane = one feature domain = one worktree = one issue = one PR. No cross-lane file thrash.
- Never print `.env` secrets or production customer data in fixtures.

## Workflow

### 0. Resolve repo

1. Repo root (cwd or path). Default branch from `origin/HEAD`. Dirty unrelated main → stop or isolate.
2. Read `AGENTS.md`, `PROJECT.md`/`CONTEXT.md`, `CODE-STYLE.md`, package scripts, e2e setup docs.
3. Detect unit / e2e commands via **`test-gap-tdd`** discovery rules.
4. Detect existing run via `docs/agent/test-gap/CURRENT` → `$AGENT_DOCS/REPORT.md` / `FEATURES.md` (or legacy flat/root `TEST-GAP-*.md` to migrate) / open branch from a prior `test-gap-tdd` run.

### 1. Gap matrix (scan or resume)

| Situation | Action |
|-----------|--------|
| `scan-only` | Load **`test-gap-tdd`** scan-only → stop with report |
| `resume` / report exists and user implies continue / residual | Use report; refresh only if stale vs HEAD (optional quick re-scan of residual ids) |
| No report or default full campaign without resume | Load **`test-gap-tdd`** through **scan + summary** (fill happens **in lanes**, not as one mono-branch dump) |

Orchestrator produces a **campaign board** (write `$AGENT_DOCS/SHIP.md`):

| Feature id | P0 gaps | Layers | Priority | Wave | Notes |
|------------|---------|--------|----------|------|-------|

Select lanes: all features with **P0/P1 missing** (or `residual-only` list). Batch tiny features only when paths do not overlap.

Present the board briefly. If user said “just run it” / default full, **do not wait** for approval unless gaps > max-lanes and need wave split — then run wave 1 and list wave 2.

### 2. Freeze base + host mode

1. **Backup main** — `messy-repo-orchestrator` Safety (required).
2. Host mode — follow **messy-repo §1b**:
   - Default if they said “just run it” / `/test-gap-ship` alone: **A host subagents**
   - If they said cmux / watch: **B**
   - `no-cmux` → **A**
3. Do not start lanes until backup SHA is recorded.

### 3. Fan out lanes

For each selected feature, **`sdlc-tasks-executions` setup-lanes** (via messy-repo defaults):

| Item | Value |
|------|--------|
| Worktree | `REPO/.worktrees/test-gap-<slug>/` |
| Branch | `test/<issue>-gap-<slug>` |
| Issue | Title: `test-gap: <feature id>`; body = missing list from report + acceptance “tests would fail if behavior deleted”; label if useful |
| Brief | `LANE-BRIEF.md` with mandate below |
| Host | A / B / C from step 2 |

#### Per-lane mandate (every LANE-BRIEF.md)

```markdown
# Lane: test-gap <feature_id>
You own ONLY these path globs: <globs>
Issue: #<n>
Base backup: <backup branch> @ <sha>
Default branch: <main>
Report source: $AGENT_DOCS/REPORT.md section for this feature
AGENT_DOCS: docs/agent/test-gap/<run-id>/

## Job
1. Load skill **test-gap-tdd** fill rules for YOUR feature only (TDD red→green).
2. Implement missing P0 then P1 gaps: backend-unit, mocks/MSW if adopted, client-unit, then e2e for surface=<…>.
3. Headless e2e unless brief says headed. Do not invent product features.
4. Run narrow unit for touched packages → must pass.
5. Run e2e for this feature’s journeys when stack allows; else document skip reason in PR.
6. organized-commits on this branch only. Never commit on default branch.
7. finish-and-ship: push + open PR to default with Fixes #<n>, Summary, Confidence N/10, Test plan.
8. Do NOT merge (orchestrator merges). Do NOT delete remotes.
9. Stay in cmux session if host B after PR open.
```

Orchestrator may also **promote** an existing mono-branch (`test/test-gap-tdd-p0-units`) as **wave 0**: one PR + merge first if it already holds filled work and is clean — then residual features get parallel lanes. Prefer not to re-do already-green clusters.

### 4. Parallel fill (sub-agents)

- Spawn one agent per lane (host A or cmux B).
- Poll PR / check status; do not busy-loop sleep without progress reads.
- On lane failure: fix in that worktree or open follow-up issue; do not block other lanes unless shared contract conflict.

### 5. Prove + PR gates (per lane)

Before merge eligibility:

1. **Unit** green for lane packages (repo scripts).
2. **E2E** headless for `surface` when available:
   - green → full merge eligibility
   - skip (no API/sim) → merge only with **confidence cap** and explicit PR note (REFERENCE); or hold if user said e2e-required
3. **Confidence** (1–10) on PR — same honesty as `ship-feature-e2e`. **&lt; 6 → do not merge** that lane.
4. **act** / `gh pr checks` when CI exists — red blocks merge.

### 6. Merge sequence (orchestrator; authorized by default)

Unless `no-merge`:

1. Order merges: **shared/contract** first, then independent features, then UI/e2e-heavy.
2. After each merge: `git fetch`; rebase/update remaining open lane PRs if needed (`sdlc-tasks-executions` land hygiene — no silent main rewrite).
3. Merge:

   ```bash
   gh pr merge <n> --merge   # or repo default squash/rebase
   ```

4. Confirm default branch SHA advances. Leave remote feature branches unless user asks delete.
5. Never merge a red PR.

### 7. Wave 2+

If max-lanes truncated the board: after wave 1 merges (or PRs open under `no-merge`), start next wave with the same backup lineage (new backup tip optional if main moved).

### 8. Done receipt

```text
repo: <path>
mode: full | resume | residual-only | scan-only | no-merge
headless: true | false
backup: <branch> @ <sha>
run_id: <YYYY-MM-DDTHHMMSSZ>
report: docs/agent/test-gap/<run-id>/REPORT.md
campaign: docs/agent/test-gap/<run-id>/SHIP.md
waves: N
lanes:
  - feature | issue | worktree | branch | pr | unit | e2e | confidence | merge
default: <branch> @ <sha after>
skills_reused: test-gap-tdd, messy-repo-orchestrator, sdlc-tasks-executions, organized-commits, finish-and-ship
residual: <still open gaps / deferred waves>
e2e_blockers: <API/sim notes if any>
```

## Verification

Campaign **done** only when:

- [ ] Backup of default recorded before fan-out
- [ ] Gap matrix from scan or resume exists
- [ ] Each started lane has issue + worktree + branch + PR (or explicit failed-with-reason)
- [ ] No product/test commits on default by agents
- [ ] Unit green (or lane failed honestly)
- [ ] E2E headless when run; skips explained
- [ ] Merges completed for eligible lanes **or** `no-merge` with open PRs
- [ ] Default branch only moved via PR merges
- [ ] Sibling skills loaded — no private fork of worktrees/TDD/ship steps

“Agents ran” is not done. **Merged (or review-ready PRs under no-merge) coverage on an undamaged main with a restore point** is done.
