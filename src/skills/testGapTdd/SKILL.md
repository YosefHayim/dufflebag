---
name: test-gap-tdd
description: Use when the user runs /test-gap-tdd, says "scan test gaps", "find missing tests per feature", "subagents inventory unit mocks e2e", "fill test gaps with TDD", "backend unit and MSW gaps", or wants a framework-agnostic first scan of all test layers (backend unit, client unit, mocks/MSW/fixtures, integration, e2e web/native) via sub-agents, a per-feature missing summary, then TDD implementation of gaps, then e2e runs. Default e2e is headless unless the user says headed/visible. Persist reports under docs/agent/test-gap/ (never repo root). Reuse sdlc-tasks-executions for fan-out; do not invent a second worktree scheme.
type: flow
---

# Test Gap TDD

**Orchestrator.** Discover product features → fan out **sub-agents** to scan **every test layer** → publish a **per-feature missing summary** → (unless `scan-only`) **TDD-fill** gaps → **run** the repo’s unit/e2e commands.

Slash: **`/test-gap-tdd`**, optional scope (repo, feature list, surface).

**Not** framework-locked. Discover Vitest/Jest/pytest/Go/Cargo, MSW/nock/fixtures, Playwright/Cypress/Maestro/Detox from the repo. Prefer existing patterns over new harnesses.

## Reuse first (mandatory)

Load sibling `SKILL.md` files; do not reimplement them.

| Concern | Skill |
|---------|--------|
| Parallel lanes / worktrees / cmux | `sdlc-tasks-executions` **setup-lanes** (one lane per feature domain when filling) |
| Commits | `organized-commits` |
| Push / PR / handoff | `finish-and-ship` when user wants ship (default: **no merge**) |
| Single visible browser proof | `preview-and-prove` only if user asks headed interactive QA beyond suite |
| One product feature to main | `ship-feature-e2e` (different job) |
| Full campaign: parallel lanes + PR + merge to main | **`test-gap-ship`** (loads this skill for scan/fill rules) |
| Over-engineering scan + lean with parity prove | `lean-prove` (different job; may call this skill for business test gaps only) |
| Multi-feature cleanup (not tests) | `messy-repo-orchestrator` |

This skill owns: layer taxonomy, scan briefs, gap matrix, TDD fill order, default **headless** e2e policy, done receipt, and **artifact paths** under `docs/agent/test-gap/`.

## Artifact paths (mandatory)

Never write campaign/report markdown at the **repository root**. Never use a fixed flat file that parallel runs overwrite.

| File | Path |
|------|------|
| Feature inventory | `docs/agent/test-gap/<run-id>/FEATURES.md` |
| Gap report | `docs/agent/test-gap/<run-id>/REPORT.md` |
| Active pointer | `docs/agent/test-gap/CURRENT` (one line: run-id) |

1. **New run:** mint UTC run-id, then write only under that dir:

   ```bash
   RUN_ID=$(date -u +%Y-%m-%dT%H%M%SZ)
   AGENT_DOCS="docs/agent/test-gap/$RUN_ID"
   mkdir -p "$AGENT_DOCS"
   printf '%s\n' "$RUN_ID" > docs/agent/test-gap/CURRENT
   ```

2. **Resume:** resolve `CURRENT` / explicit run-id / newest run dir; do **not** mint a new run-id. Update files in place under that `AGENT_DOCS`.
3. **Legacy migrate:** root `TEST-GAP-*.md` or flat `docs/agent/test-gap/*.md` → move into a run dir, set `CURRENT`, remove root copies.
4. Full convention: [references/agent-artifacts.md](references/agent-artifacts.md).

## Layers (scan all that exist)

Framework-agnostic **capability** layers — mark N/A if the product has no such surface:

| Layer id | What counts as coverage | Typical evidence (examples only) |
|----------|-------------------------|----------------------------------|
| `backend-unit` | Domain/use-case/store/controller pure tests | `*.test.ts` next to server domain, `go test`, `pytest` |
| `client-unit` | UI/state/hooks/view-model unit tests | vitest/jest colocated under features |
| `contract` | Shared Zod/OpenAPI/schema tests | `shared/**/*.test.*` |
| `mocks` | HTTP/API doubles for client or server | **MSW** handlers, nock, msw/node, fixture servers, recorded cassettes |
| `integration` | Multi-module in-process without full UI | supertest, effect test, worker miniflare tests |
| `e2e-web` | Real browser journey | Playwright, Cypress, Puppeteer |
| `e2e-native` | Real device/simulator journey | Maestro, Detox, XCUITest wrappers |
| `e2e-cli` | Real CLI binary journey | packaged CLI smoke |

A gap is **missing** when the feature’s real behavior has no test that would **fail if that behavior were deleted** (happy path **and** important edges: auth fail, empty, validation, idempotency, permission deny, timeout/retry when code has them).

## Invocation

```text
/test-gap-tdd
/test-gap-tdd MYPR-App
/test-gap-tdd scan-only
/test-gap-tdd fill outreach conversation
/test-gap-tdd headed
/test-gap-tdd surface=web
/test-gap-tdd surface=native
/test-gap-tdd surface=all
```

| Flag / phrase | Meaning |
|---------------|---------|
| (default) | Full: scan → summary → TDD fill → run tests |
| `scan-only` | Stop after per-feature gap summary (no write) |
| `fill` / default after scan | Implement missing tests via TDD |
| `surface=web` | E2E focus web only (still scan all unit/mock layers) |
| `surface=native` | E2E focus native only |
| `surface=all` | All e2e surfaces the repo has (default when running e2e) |
| **headless (DEFAULT)** | E2E runners headless / CI mode — **do not require user to say headless** |
| `headed` / `visible` / `ui` | Non-headless / headed / Playwright UI only when user says so |
| `no-cmux` | In-process subagents only |
| `ship` / `open-pr` | After green, use `finish-and-ship` to open PR (**still no merge** unless user says merge) |

If the user does **not** say headed/visible/ui → **headless**.

## Safety

- Read-only for **scan** phase. No product code changes until fill phase (or user approved matrix if they asked to review first — default full pipeline does not wait unless `scan-only` or they said “report first”).
- Never print `.env` secrets, real tokens, or production customer data in fixtures. Prefer repo e2e seed accounts and documented test data scripts.
- Do not hit production write APIs for “proof.” Use local/sandbox.
- Topic branch for fill work; never commit test spam on default branch.
- Do not delete remote branches. Do not merge unless user explicitly says merge (this skill defaults to **no merge**).
- Cap fan-out: prefer one sub-agent **per feature domain**; batch tiny features; do not spawn unbounded agents.

## Workflow

### 0. Resolve repo

1. Repo root (cwd or path in prompt). Read `AGENTS.md`, `PROJECT.md`/`CONTEXT.md`, `CODE-STYLE.md`, package scripts, existing e2e folders.
2. Detect commands **from the repo** (do not hardcode Playwright/Maestro):
   - unit: `test`, `test:unit`, workspace tests, language defaults
   - mocks: directories named `msw`, `mocks`, `handlers`, `fixtures` + imports
   - e2e-web / e2e-native / e2e-cli scripts
3. Record headless vs headed flags **supported by those scripts** (e.g. Playwright default headless; `--headed` only when user asked).

### 1. Feature inventory (orchestrator)

Build a feature list from evidence, not vibes:

- `client/src/features/*`, `server/src/<domain>`, packages, routes, documented domains in CONTEXT.md
- Exclude pure primitives/platform unless they own product rules

Write `$AGENT_DOCS/FEATURES.md` with stable feature ids + path globs.

### 2. Scan phase — sub-agents

For each feature (or batch), spawn a **read-only** sub-agent (host subagent API and/or `sdlc-tasks-executions` brief-only / cmux). Brief:

1. Own only these path globs.
2. Inventory existing tests per **layer** above (paths + what behavior they assert).
3. List **missing** happy paths and edges grounded in **real code** (handlers, use cases, screens) — no invented product.
4. Note mock/MSW: which APIs the feature calls and whether handlers cover success + error shapes.
5. Return structured JSON/markdown only (template in [REFERENCE.md](REFERENCE.md)).

Orchestrator merges into **`$AGENT_DOCS/REPORT.md`**:

```markdown
## Feature: <id>
### Covered
- backend-unit: …
- client-unit: …
- mocks: …
- e2e-web: …
- e2e-native: …
### Missing (priority)
1. [layer] <behavior> — why it matters — suggested test location matching repo patterns
2. …
### Commands to run later
- unit: …
- e2e: …
```

Also a **summary table** for the human:

| Feature | backend-unit | client-unit | mocks | integration | e2e-web | e2e-native | Top gaps |
|---------|--------------|-------------|-------|-------------|---------|------------|----------|

**scan-only → stop here** and present the report.

### 3. Fill phase — TDD (default after scan)

Work on a topic branch (`test/<slug>-gaps` or per-feature lanes via **`sdlc-tasks-executions`** when parallelizing).

For each prioritized gap (P0 edges that can ship bugs, then happy paths):

1. **Red** — write a failing test in the **correct layer** using the repo’s existing style (colocated unit, MSW handler + unit, Playwright spec, Maestro flow, etc.).
2. **Green** — minimal product fix **only if** the test exposed a real bug; otherwise make the test pass by completing coverage of already-correct code (fixtures, wiring). Prefer not to drive large product rewrites under this skill; open a product issue if behavior is wrong and out of scope.
3. **Refactor** — only within test helpers/patterns already used nearby.
4. Re-run the **narrow** test command after each gap cluster.

**MSW / mocks:** when the feature depends on HTTP, add or extend handlers for success **and** the error statuses the UI/domain already branches on. Do not mock away the behavior under test in unit tests that should exercise pure domain logic.

**Order:** backend-unit / contract → mocks → client-unit → integration → e2e-web/native (outer layers last).

### 4. Run phase

After fill (or scan-only + user said “just run existing”):

1. **Unit + integration** for touched packages (repo scripts).
2. **E2E** for requested `surface` (default `all` that exist):
   - **Headless by default** — use CI/headless flags; never open headed UI unless user said `headed`/`visible`/`ui`.
   - If native tools/simulators missing, report **skipped** with exact reason; do not claim native green.
3. Optionally full style/typecheck if `AGENTS.md` requires it before handoff.

On failure: fix tests or product within scope; re-run failed command; do not hide flakes — quarantine only with a tracked issue.

### 5. Handoff / ship (optional)

- Default: leave topic branch + `$AGENT_DOCS/REPORT.md` + list of new tests; commit via **`organized-commits`** if user wants commits.
- `open-pr` / `ship`: **`finish-and-ship`** (PR, no merge unless they said merge).
- Parallel worktrees + merge campaign: hand off to **`test-gap-ship`** (do not half-implement lanes here).
- Do not use `ship-feature-e2e` unless they want full merge+reinstall of a product feature (not a test-gap campaign).

## Verification

Done only with fresh evidence:

- [ ] Feature inventory written
- [ ] Every feature has a scan summary (or explicit skipped + reason)
- [ ] Layers include **backend-unit** and **mocks/MSW** when those surfaces exist (not e2e-only)
- [ ] If not `scan-only`: TDD red→green applied; new tests would fail if behavior removed
- [ ] Unit commands green for touched areas
- [ ] E2E ran **headless** unless user requested headed; surface respected
- [ ] Native/web skips explained when tooling absent
- [ ] Sibling skills used for worktrees/commits/PR; no private fork of those procedures

```text
repo: <path>
mode: full | scan-only
headless: true | false (user override)
surface: web | native | all
features_scanned: N
run_id: <YYYY-MM-DDTHHMMSSZ>
report: docs/agent/test-gap/<run-id>/REPORT.md
features: docs/agent/test-gap/<run-id>/FEATURES.md
gaps_filled: N
unit: <cmd> → pass|fail
e2e_web: <cmd> → pass|fail|skip
e2e_native: <cmd> → pass|fail|skip
branch: <name|none>
pr: <url|none>
skills_reused: sdlc-tasks-executions?, organized-commits?, finish-and-ship?
residual: <open gaps intentionally deferred>
```

A green e2e suite with silent missing backend unit/mocks is **not** success for this skill.
