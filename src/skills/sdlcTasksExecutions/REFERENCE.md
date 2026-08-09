# sdlc-tasks-executions — reference

## Invocation examples

```text
/sdlc-tasks-executions
1. Add restore-on-launch for packed sessions
2. Fix empty-cart checkout edge case
3. Hebrew RTL on settings screen

/sdlc-tasks-executions merge
1. …
2. …

/sdlc-tasks-executions no-merge headed
1. …

/sdlc-tasks-executions setup-lanes
(task list or freeform features)

/sdlc-tasks-executions land-lanes
```

| Flag / phrase | Meaning |
|---------------|---------|
| (default numbered list) | **execute**, open PRs; merge only if user also said merge/to-main/full ship |
| `merge` / `to main` / `ship all` | Authorize merge after hard gates |
| `no-merge` | Force PR-only even if merge language appears elsewhere |
| `headed` / `visible` / `ui` | Headed e2e / visible UI QA |
| `no-cmux` | Host A / in-process only |
| `agent=grok\|claude\|codex` | cmux lane CLI |
| `max-lanes=N` | Cap parallel lanes (default soft 8; queue rest) |
| `setup-lanes` / `land-lanes` | Force that mode |

## Artifact paths

Run-isolated under `docs/agent/sdlc-tasks/<run-id>/` (UTC `date -u +%Y-%m-%dT%H%M%SZ`). Parallel SDLC runs and multi-agent hosts must not share a fixed `BOARD.md`.

| File | Path |
|------|------|
| Campaign board | `docs/agent/sdlc-tasks/<run-id>/BOARD.md` |
| Optional state | `docs/agent/sdlc-tasks/<run-id>/STATE.md` |
| Active pointer | `docs/agent/sdlc-tasks/CURRENT` (one line: run-id) |
| Lane brief | `<worktree>/LANE-BRIEF.md` only (include `AGENT_DOCS` / run-id) |

```bash
RUN_ID=$(date -u +%Y-%m-%dT%H%M%SZ)
AGENT_DOCS="docs/agent/sdlc-tasks/$RUN_ID"
mkdir -p "$AGENT_DOCS"
printf '%s\n' "$RUN_ID" > docs/agent/sdlc-tasks/CURRENT
```

Never write campaign boards at the repository root, to a flat fixed path (`docs/agent/sdlc-tasks/BOARD.md` without run-id), or under product `docs/agents/`.

## BOARD.md template

```markdown
# SDLC tasks board

run_id: <YYYY-MM-DDTHHMMSSZ>
agent_docs: docs/agent/sdlc-tasks/<run-id>/
default: main @ <sha>
host: A
merge_authorized: false
updated: <iso>

| # | Task | Slug | Issue | Worktree | Branch | PR | Unit | E2E | QA | Conf | Merge | Notes |
|---|------|------|-------|----------|--------|----|------|-----|----|------|-------|-------|
| 1 | … | … | #n | .worktrees/… | feat/n-… | url | pass | pass | pass | 7 | no | |
```

## LANE-BRIEF.md template (execute)

```markdown
# LANE-BRIEF — sdlc-tasks-executions

Task #: <n>
Issue: <url>
Branch: <type>/<issue>-<slug>
Worktree: <abs-path>
Default branch: <main>
Base SHA: <sha>
AGENT_DOCS: docs/agent/sdlc-tasks/<run-id>/   # shared run board; do not mint a new run-id
Path globs (only yours): <globs>
Merge authorized: false | true

## Task
<user text for this line only>

## Acceptance
- [ ] …

## Full SDLC (required)
1. Implement acceptance only in path globs.
2. Unit happy path — must fail if feature deleted — green.
3. E2E/integration happy path — headless unless brief says headed — green or honest skip.
4. If UI surface: run preview-and-prove checks; record evidence.
5. organized-commits on this branch only. Never commit on default.
6. finish-and-ship: push + open PR with Fixes #<n>, Summary, Confidence N/10, test plan.
7. act/CI when present — red blocks merge.
8. Do NOT merge unless Merge authorized: true and conf ≥ 6.
9. Do NOT delete remotes. Do NOT touch other lanes.

## Style
Follow AGENTS.md, CODE-STYLE.md, ADRs at repo root of this worktree.

## Done for implementer
PR open with gates evidence. Orchestrator owns merge sequencing and campaign board.
```

## Confidence (same honesty as ship-feature-e2e)

| Score | Meaning |
|------:|---------|
| 1–3 | Spec unclear / tests missing — **no merge** |
| 4–5 | Narrow demo / weak e2e — **no merge** without human |
| 6 | Happy-path unit + e2e green; min auto-merge |
| 7–8 | Solid coverage + act/CI |
| 9–10 | Rare; multi-surface hardened |

**Caps:** unit without e2e (or reverse) → max 4 + block merge when stack exists. Thin smoke e2e only → max 7.

## PR body skeleton

```markdown
Fixes #<n>

## Summary
- <user-visible outcome>

## Confidence
**N/10** — <one sentence residual risk>

## Test plan
- [x] Unit: `<cmd>` → pass
- [x] E2E: `<cmd>` → pass | skip:<why>
- [x] QA: preview-and-prove → pass | N/A
- [ ] act/CI: …

## Main safety
- Base: <default> @ <sha>
- Branch: <type>/<issue>-<slug>
- No history rewrite of default
```

## Host modes

| Mode | Behavior |
|------|----------|
| **A** | Background subagents; `cwd` = worktree |
| **B** | `cmux new-workspace --name "lane:<issue>-<slug>" --cwd <worktree> --command "<agent> \"$(cat LANE-BRIEF.md)\"" --focus false` |
| **C** | Print matrix + start commands only; do not claim agents running |

## Test command discovery

1. `AGENTS.md` / README Verification  
2. `package.json`: `test`, `test:unit`, `test:e2e`, `test:integration`, `verify`  
3. Makefile / just  
4. Language defaults only if no package script  

Happy path = primary success scenario. At least one unit and one e2e assertion should fail if the feature is removed.

## act (when CI exists)

```bash
act --version
docker info >/dev/null
act pull_request -W .github/workflows/ci.yml
```

Prefer repo-documented act invocations. Red → fix on branch, push, re-run; do not merge.

## Reinstall / smoke (optional full ship)

After merges to default when user asked reinstall/smoke:

```bash
pnpm build && pnpm link --global   # or package-specific
<binary> --version
<primary smoke command>
```

## Sibling mapping (old → new)

| Old reference | New |
|---------------|-----|
| `coordinate-worktrees` | **`sdlc-tasks-executions`** |
| `coordinate-worktrees` setup-lanes | **`sdlc-tasks-executions`** setup-lanes |
| `coordinate-worktrees` land-lanes | **`sdlc-tasks-executions`** land-lanes |

## Anti-triggers

| Ask | Skill |
|-----|--------|
| One feature merge+reinstall polish only | `ship-feature-e2e` (or this skill with **one** task + merge) |
| Only commit/push/PR, no multi-lane | `finish-and-ship` |
| Whole-repo cleanup matrix | `messy-repo-orchestrator` |
| Test coverage campaign | `test-gap-ship` |
| Live production URL | `deploy-and-prove` |
