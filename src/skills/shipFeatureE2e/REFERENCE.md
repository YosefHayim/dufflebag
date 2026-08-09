# ship-feature-e2e — reference

## Composition map (do not reimplement)

Load each sibling’s `SKILL.md` when you hit that concern:

| Phase | Skill | This skill adds |
|-------|--------|-----------------|
| Issue + worktree + branch + cmux/brief | `sdlc-tasks-executions` setup-lanes (1 lane) | Mode B: bind existing `#N` instead of always creating |
| Commits | `organized-commits` | — |
| Verify, push, open PR | `finish-and-ship` | PR **Summary** + **Confidence N/10** + unit/e2e/act checklist |
| Multi-lane cleanup | `messy-repo-orchestrator` | Out of scope — redirect |
| After merge live web | `deploy-and-prove` | Optional, only if user asks |

Orchestrator owns only: Gate A (unit+e2e), confidence rubric, act, merge, reinstall, done receipt.

## Entry modes

**Mode A — new feature:** user describes work → create issue → full pipeline.

**Mode B — existing issue:** user passes `#N` / URL → `gh issue view` → same pipeline (no second issue).

Both modes share the same gates. Mode B is first-class, not a half-path.

## Confidence rubric (1–10)

Score **belief the feature is correct and matches repo patterns**, not optimism.

| Score | When to use |
|------:|-------------|
| 1–3 | Spec unclear, tests missing/failing, or large pattern violations. **Do not merge.** |
| 4–5 | Works in a narrow demo; weak e2e; style/ADR drift. **Do not merge** without human. |
| 6 | Happy-path unit + e2e green; follows main patterns; minor residual risk. Default minimum to auto-merge. |
| 7 | Solid coverage; small unknowns (e.g. thin new e2e harness, one flaky host). |
| 8 | Full gate + act green; matches CODE-STYLE/ADRs; edge cases considered. |
| 9 | High coverage, act + hosted CI green, reinstall smoke clean, little residual risk. |
| 10 | Reserved: production-hardened, multi-surface proof, no known residual risk. Rare. |

**Caps (apply the lowest):**

- New thin e2e smoke only → max **7**
- No CODE-STYLE / AGENTS guidance and inconsistent neighbors → max **5**
- Unit without e2e (or reverse) → max **4** and **block merge**
- act skipped because tooling missing (no user override) → do not merge; score may still describe code quality

Always write one sentence under **Confidence** in the PR: what would lower the score.

## PR body template

```markdown
Fixes #<n>

## Summary
- <user-visible outcome 1>
- <user-visible outcome 2>

## Confidence
**7/10** — Unit + CLI e2e green and matches existing command layout; act ran push CI only (not matrix OS).

## Test plan
- [x] Unit: `pnpm test -- <path>` → pass
- [x] E2E: `pnpm test:integration` → pass
- [x] Full gate: `pnpm verify` → pass
- [x] Local act: `act pull_request -W .github/workflows/ci.yml` → pass

## Main safety
- Base: main @ <sha>
- Branch: feat/<n>-<slug>
- No history rewrite of default.
```

## Local act (Docker)

Prereqs: [nektos/act](https://github.com/nektos/act), Docker running.

```bash
act --version
docker info >/dev/null

# Prefer repo docs. Common patterns:
act pull_request -W .github/workflows/ci.yml
act push -W .github/workflows/ci.yml
act -l   # list jobs when unsure
```

Notes:

- Match the workflow files GitHub actually runs on PR/push.
- If act needs secrets, use repo-documented `.secrets` / `--secret-file` — never invent production secrets.
- Platform-specific jobs may need `-P` runner images; record skips that are environmental vs real failures.
- On failure: fix on the feature branch, push, re-run act; do not merge red.

## Test command discovery

Prefer documented scripts in order:

1. `AGENTS.md` / README “Verification”
2. `package.json`: `test`, `test:unit`, `test:e2e`, `test:integration`, `verify`, `check`
3. `Makefile` / `justfile` targets
4. Language defaults (`cargo test`, `go test`, `pytest`) only when no package script exists

**Happy path** means the primary success scenario of the feature (not only error branches). At least one unit and one e2e/integration assertion must fail if the feature is removed.

## Reinstall patterns

```bash
# npm/pnpm CLI from repo (pre-publish)
pnpm build && pnpm link --global
# or
npm install -g .

# published package
npm install -g <name>@latest

# dufflebag skills/features
dufflebag install   # preserve existing features; add if needed
dufflebag doctor

# prove
<binary> --version
<binary> <primary-smoke-command>
```

## Lane brief skeleton

```markdown
# LANE-BRIEF — ship-feature-e2e

Issue: <url>
Branch: <type>/<issue>-<slug>
Worktree: <path>
Default branch: <main>

## Feature
<user text>

## Acceptance
- [ ] …

## Required gates
- Unit happy path green
- E2E happy path green
- Full repo gate when present
- Follow CODE-STYLE.md / AGENTS.md

## Forbidden
- Commits on default branch
- Merge without orchestrator gates
- Delete remote branches
- Skip tests

## Done for implementer
Push topic branch with tests. Orchestrator owns PR confidence, act, merge, reinstall.
```

## Anti-triggers (use a different skill)

| Ask | Skill |
|-----|--------|
| Only commit/push/PR, no merge | `finish-and-ship` |
| Many features / cleanup main safely | `messy-repo-orchestrator` |
| Only open worktrees / multi-lane setup | `sdlc-tasks-executions` |
| Only deploy live URL | `deploy-and-prove` |
| Fix an existing skill from feedback | `skill-from-feedback` |
| Unsure which skill | `route-request` |

## Anti-patterns inside this skill

- Copy-pasting a second worktree/branch scheme instead of **loading `sdlc-tasks-executions`**
- Hand-rolling commit splits instead of **`organized-commits`**
- Skipping **`finish-and-ship`** verify/push/PR hygiene then inventing a weaker checklist
- Creating a **new** issue when the user already gave `#N` (Mode B)
- Claiming “reused skills” without actually following their Safety/Verification sections
