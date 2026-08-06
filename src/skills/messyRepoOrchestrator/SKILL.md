---
name: messy-repo-orchestrator
description: Use when the user has a messy existing project and wants an orchestrator to fan out one sub-agent per feature (or module) for refactors, hardening, deslop, or fixes without damaging main — backup main first, work on topic branches in .worktrees/, open PRs to main with review-ready summaries. Triggers: "messy repo", "clean up this whole project by feature", "fan out agents per feature", "refactor every feature safely", "backup main then parallel cleanup".
type: flow
---

# Messy Repo Orchestrator

Turn a messy multi-feature repository into **parallel, reviewable remediations** without rewriting history on the default branch.

You are the **orchestrator**. Each sub-agent owns **exactly one** feature (or bounded module). Main stays safe: a **backup ref/branch** is created first; all product work lands on topic branches and **PRs into main** for human review.

Reuse existing skills rather than inventing a second ship path:

| Concern | Skill |
|---------|--------|
| Worktree layout, lane isolation, land later | `coordinate-worktrees` (**setup-lanes** / **land-lanes**) |
| Commit / push on a feature branch | `organized-commits` + `finish-and-ship` |
| Lean structure / ceremony kill | `deslop-v2` (then `deslop` for readability if needed) |
| Missing style SSOT | `grill-me-code-style-with-docs` (once, before mass fan-out when absent) |
| UI / local proof | `preview-and-prove` |
| After lanes merge messily | `coordinate-worktrees` **land-lanes** only |

## Safety

- **Protect main:** never commit product work on the default branch; never force-push it; never rewrite its published history as part of this skill.
- **Backup main first** (required gate before any fan-out):

  ```bash
  git fetch origin
  DEFAULT=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo main)
  git branch "backup/${DEFAULT}-$(date -u +%Y%m%dT%H%M%SZ)" "origin/${DEFAULT}"
  # optional remote safety copy when user allows push of backup refs:
  # git push origin "refs/heads/backup/${DEFAULT}-…"
  ```

  Record the backup branch name and SHA in the orchestrator report. Prefer pushing the backup branch when the user wants an off-machine copy; local-only backup is minimum.
- **Never delete remote branches** (including backup or feature branches) unless the user explicitly asks.
- One agent = one feature = one worktree = one branch = one issue = one PR. No cross-lane file ownership without re-planning.
- Do not merge PRs to main unless the user explicitly asks after review.
- Do not deploy, publish, or delete production resources as part of cleanup.
- Respect `AGENTS.md` / `CODE-STYLE.md` / ADRs; if they are missing or useless, run a **single** style grill first rather than N conflicting styles.

## Workflow

### 1. Scope the mess (orchestrator only)

1. Confirm repo root, remotes, default branch, dirty state. Stop if the main checkout has unrelated dirty work the user did not authorize folding in.
2. Read `AGENTS.md`, `CODE-STYLE.md`, `PROJECT.md` / `CONTEXT.md` when present.
3. Inventory **features/modules** from evidence (not vibes): app routes, `src/features/*`, packages in a monorepo, documented domains, or a user-provided list. Produce a table: `id | path globs | risk | suggested work (refactor|harden|deslop|fix|docs)`.
4. Present the table and get approval on **which lanes to open now** (batch size). Huge repos: wave 1 critical paths only.

### 2. Freeze a safe base

1. Create the **backup/** branch of `origin/<default>` (see Safety).
2. Ensure working policy: product commits only on topic branches; PRs target default branch.
3. If CODE-STYLE is missing and the user wants consistency across lanes, run `grill-me-code-style-with-docs` **once** on the main checkout (or a single docs-only branch) before fan-out so agents share one `## Never` list.

### 3. Fan out lanes (delegate to coordinate-worktrees setup-lanes)

For each approved feature, follow `coordinate-worktrees` **setup-lanes** with these defaults:

| Item | Default |
|------|---------|
| Worktree root | `REPO/.worktrees/` |
| Branch | `refactor/<issue>-<slug>` or `fix/…` / `feat/…` by work type |
| Issue | `gh issue create` with acceptance criteria + path globs + out-of-scope |
| Agent brief | **Only** that feature’s paths, backup SHA, default branch name, style doc paths, “no main commits”, “open PR with Fixes #n”, “do not merge”, “do not delete remote” |
| Host | Agent-agnostic: host spawn/subagent when available; else one terminal + written brief per lane |

### 4. Per-agent mandate (paste into every lane brief)

Each sub-agent must:

1. `cd` into its worktree only; never edit other worktrees or the main checkout.
2. Implement the scoped remediation (refactor / harden / deslop / fix) inside its path globs.
3. Follow repo `CODE-STYLE.md` / `AGENTS.md`; use `deslop-v2` / `deslop` when the job is lean/readability.
4. Run the repo’s narrow checks for touched areas, then the full documented gate when feasible.
5. Commit with `organized-commits` on its topic branch; close the loop with `finish-and-ship` (push branch, not main).
6. Open a PR **into the default branch** with:

   - title that names the feature;
   - body starting with `Fixes #<issue>` or `Closes #<issue>`;
   - **Review summary** (required sections):

     ```markdown
     ## Summary
     What was messy and what changed (3–8 bullets).

     ## Scope
     Paths owned by this lane. Explicit non-goals.

     ## Risk
     What could break; migration notes.

     ## Test plan
     - [ ] commands run + results
     - [ ] manual/UI checks if any

     ## Main safety
     - Base: <default> @ <sha>
     - Backup branch: backup/<default>-…
     - This PR does not modify history of main.
     ```

7. Stop at open PR. Do not merge. Do not delete remote branches.

### 5. Orchestrator review pack (for you)

After lanes report, produce one matrix for the human:

| Feature | Issue | Branch | Worktree | PR | Head SHA | Verify | Notes |
|---------|-------|--------|----------|----|----------|--------|-------|

Plus:

- backup branch name + SHA;
- default branch still pointing at pre-fan-out tip (or only intentionally advanced if user merged something);
- recommended review order (low-risk first, or dependency order);
- which PRs block others (shared contracts, migrations).

If two PRs conflict, do **not** force-resolve on main. Prefer rebasing the later PR onto updated default after earlier merges, or run `coordinate-worktrees` **land-lanes** with backups when the user wants a single integration branch—still no silent main rewrite.

### 6. After human review

- Merge only when the user says so (GitHub UI or authorized `gh pr merge`).
- Leave feature and backup remotes unless the user explicitly authorizes deletion.
- Optional: next wave of features once wave 1 is merged.

## Verification

Do not claim the messy repo is “cleaned” until:

- backup of default branch exists and is recorded (and pushed if requested);
- every started lane has issue + topic branch + PR into default with `Fixes`/`Closes` link;
- no product commits were made on the default branch by this run;
- no remote branches were deleted unless explicitly requested;
- each PR body includes Summary / Scope / Risk / Test plan / Main safety;
- orchestrator matrix lists SHA + verify status per lane;
- handoff states what remains messy and what was deferred.

“Agents ran” is not success. **Reviewable PRs against an undamaged main, with a restore point**, is success.
