---
name: ship-feature-e2e
description: Use when the user runs /ship-feature-e2e, pastes an existing GitHub issue (#N / URL), or says "ship this feature end to end", "implement this issue fully", "feature to main", "issue to PR to merge", "act then merge reinstall" — one feature or one issue through issue → worktree/branch → implement → unit + e2e happy paths → PR with summary + confidence 1–10 → local act → merge → reinstall. Orchestrate by loading and reusing sdlc-tasks-executions, organized-commits, finish-and-ship (and siblings); do not reimplement those skills. Prefer over finish-and-ship when merge/act/reinstall are in scope; over messy-repo-orchestrator for a single feature/issue.
type: flow
---

# Ship Feature End-to-End

**Orchestrator only.** One invocation → one feature **or** one existing issue landed on the default branch with proof.

Slash: **`/ship-feature-e2e`**, then either freeform feature text **or** an existing issue (`#2`, full URL, `Fixes #2`).

**Done** means: issue linked, topic branch/worktree, happy-path **unit** + **e2e** green, PR with short **Summary** + **Confidence 1–10**, local **act** green when CI exists, **merged** to default, product **reinstalled/proven**, done receipt. “PR open” alone is **not** done for this skill.

## Reuse first (mandatory)

This skill **must not** reinvent sibling workflows. Before any step, **load the sibling `SKILL.md` and follow it** for that concern. Only implement glue those skills do not own (test hard-gates, confidence score, act, merge, reinstall, done receipt).

| Concern | Load and follow |
|---------|-----------------|
| Single-lane issue + worktree + branch + cmux/brief + PR skeleton | `sdlc-tasks-executions` **setup-lanes** (exactly **one** lane) |
| Atomic commits / history shape | `organized-commits` |
| Verify, push, open/update PR, handoff hygiene (pre-merge) | `finish-and-ship` |
| Multi-feature parallel cleanup | **Stop** — hand off to `messy-repo-orchestrator` (not this skill) |
| Multi-feature **test-gap** campaign to main | **Stop** — hand off to `test-gap-ship` |
| Live production deploy URL | `deploy-and-prove` after ship if user asks |
| Browser-only local proof | `preview-and-prove` when the product is a web UI |
| “Which skill?” mid-flight | `route-request` |
| Patch this skill later | `skill-from-feedback` |

If a sibling skill already defines a command, branch naming, safety rule, or verify step: **use that definition**. Do not fork a second house style inside this file. Recommended practices = **repo docs** (`AGENTS.md`, `CODE-STYLE.md`, ADRs) + **sibling skills**, not improvisation.

## Entry modes (equal first-class)

| Mode | User says | Issue step | Everything after |
|------|-----------|------------|------------------|
| **A — New feature** | Feature description only | Create issue (via setup-lanes / `gh issue create`) with acceptance criteria | Same pipeline |
| **B — Existing issue** | `#N`, issue URL, or “implement issue N” | **Do not** create a duplicate. `gh issue view N`; acceptance = issue body + comments | Same pipeline |

Mode B is not a shortcut that skips worktrees, tests, act, or merge gates. It only skips issue creation.

```text
/ship-feature-e2e add restore-on-launch for packed sessions
/ship-feature-e2e #2
/ship-feature-e2e https://github.com/org/repo/issues/2
/ship-feature-e2e Fixes #2 — also document restore flags
```

Optional freeform flags:

| Flag | Meaning |
|------|---------|
| (default) | Full pipeline including merge + reinstall |
| `no-merge` | Stop after green PR + act |
| `no-reinstall` | Merge ok; skip global reinstall |
| `no-cmux` | No cmux; implement in this session’s worktree |
| `agent=grok\|claude\|codex` | Lane CLI when cmux is used |

## Safety

- Invoking this skill **authorizes** merge to default + product reinstall **after** hard gates. It does **not** authorize force-push of protected refs, remote branch deletion, secret exposure, or unrelated deploys.
- Never commit product work on the default branch (same as `finish-and-ship` / `sdlc-tasks-executions`).
- **Hard stop** if unit or e2e happy paths are missing/failing — no “test later.”
- **Hard stop** if `act` fails when workflows + Docker/`act` exist. If tooling is missing, report and **do not merge** without an explicit override this turn.
- Never delete remote branches unless the user separately asks.
- Own only the feature worktree; foreign dirty trees are user-owned.
- Confidence must be honest (see [REFERENCE.md](REFERENCE.md)). Cap rules there apply.
- Prefer cmux when available (per `sdlc-tasks-executions` / messy-repo host B); else in-process and say so.

## Workflow

### 0. Resolve repo + mode

1. Git root, remote, default branch from `origin/HEAD`. Unrelated dirty main → stop or isolate (sibling safety).
2. Read `AGENTS.md`, `CODE-STYLE.md`, ADRs, package verify/test scripts, `.github/workflows/*`.
3. Detect product install surface (npm/pnpm `bin`, dufflebag, cargo, source-only).
4. Classify **Mode A** vs **Mode B** from the user text. If both a description and `#N` appear, **Mode B** wins for the issue id; treat extra text as scope notes on that issue.

### 1. Issue

- **Mode B:** `gh issue view <n> --json title,body,url,labels,state`. Refuse closed issues unless the user insists. Acceptance criteria come from the issue (and clarified comments). Record URL.
- **Mode A:** create one issue with title, problem, acceptance, out-of-scope, label “shipped by ship-feature-e2e” if useful — prefer the issue-creation path inside **`sdlc-tasks-executions` setup-lanes** rather than ad-hoc divergent fields.

### 2. Lane = `sdlc-tasks-executions` setup-lanes (single lane)

**Load `sdlc-tasks-executions` and run setup-lanes for one task only:**

- one worktree under `.worktrees/`
- one topic branch (`feat|fix|refactor|chore/<issue>-<slug>`)
- `LANE-BRIEF.md` in the worktree
- host: cmux (default when available) or in-process / `no-cmux`

Do **not** invent alternate worktree roots or branch schemes when the sibling already defines them. Brief must include: issue URL, acceptance criteria, unit + e2e happy-path requirement, style doc paths, “no main commits,” “orchestrator owns act/merge/reinstall.”

### 3. Implement (in the lane only)

Satisfy the issue/feature acceptance criteria using **repo patterns** (reuse internal helpers first; see `reuse-first-audit` only when build-vs-buy is ambiguous).

**Gate A — tests (owned by this skill):**

1. **Unit happy path** — add/extend tests for the primary success path; run repo unit command → green.
2. **E2E/integration happy path** — add/extend real suite (CLI integration, Playwright, API, etc.), or smallest durable e2e if none exists → green.
3. Full documented repo gate when present → green.

No PR marked ready / no merge until Gate A passes.

### 4. Commit + push = `organized-commits` then `finish-and-ship` (pre-merge)

- Commits: **load `organized-commits`** — intent-split messages, topic branch only.
- Verify + push + open/update PR: **load `finish-and-ship`** for status ledger, gates, push confirmation, PR open/update, leftover hygiene.
- Extend the PR body (this skill’s only PR extras) with **Summary**, **Confidence N/10**, and test-plan lines for unit/e2e/act (template in REFERENCE.md). Always `Fixes #<n>` / `Closes #<n>`.

**Confidence (1–10):** honest belief correctness **and** repo-pattern fidelity. Rubric in REFERENCE.md. Do not default to 9–10. **&lt; 6 → do not merge** (ask human). Partial tests → ≤4 and block merge.

### 5. Local act (owned glue)

When workflows exist: `act` + Docker; prefer repo-documented act invocation; else PR/push workflow files (REFERENCE.md). Red → fix on branch, push, re-run. Monitor `gh pr checks` when hosted CI exists.

### 6. Merge (owned glue; authorized by this skill)

Only after Gate A + act/CI + confidence ≥ 6 (or human override):

```bash
gh pr merge <n> --merge   # or house squash/rebase if that is repo default
```

Confirm default branch SHA. Do not delete remote feature branch unless asked.

### 7. Reinstall / smoke (owned glue)

From updated default: package-appropriate global install or documented prove (REFERENCE.md). Failure → follow-up issue; do not claim shipped.

### 8. Done receipt

Print the verification matrix. Leave cmux open unless the user asked to close it.

## Verification

Shipped only when all are fresh evidence:

- [ ] Mode A created issue **or** Mode B used existing issue (no duplicate)
- [ ] Lane created via **`sdlc-tasks-executions` practices** (worktree + branch + brief)
- [ ] Commits via **`organized-commits`**; pre-merge ship via **`finish-and-ship`** (not a private fork of those steps)
- [ ] Unit + e2e happy paths passed
- [ ] PR has Summary + Confidence N/10
- [ ] act green or skipped with recorded reason + override policy respected
- [ ] Merged (unless `no-merge`); default SHA recorded
- [ ] Reinstall/smoke done or N/A
- [ ] No remote deletes unless asked

```text
mode: A-new-feature | B-existing-issue
issue: <url>
branch: <name>
worktree: <path>
host: cmux:<name> | in-process
skills_reused: sdlc-tasks-executions, organized-commits, finish-and-ship[, …]
pr: <url>
confidence: N/10 — <reason>
unit: <cmd> → pass
e2e: <cmd> → pass
act: <cmd> → pass | skipped:<why>
merge: <default> @ <sha> | no-merge
reinstall: <cmd> → <smoke>
residual: <none or risks>
```

“Should work” is not shipped. Reimplementing sibling skills instead of loading them is a process failure even if the PR merges.
