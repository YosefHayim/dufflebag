---
name: coordinate-worktrees
description: Use when the user asks to set up multi-agent worktrees, fire one feature per agent/lane, spawn parallel task worktrees under .worktrees/, open a cmux terminal per lane, or coordinate/consolidate/merge/salvage/land work from multiple branches or Git worktrees (dirty, overlapping, stale, concurrent agents). Modes: setup-lanes (create isolated lanes + issue/branch/PR) and land-lanes (integrate existing lanes).
type: flow
---

# Coordinate Worktrees

Two modes share one safety model:

| Mode | When | Outcome |
|------|------|---------|
| **setup-lanes** | Fan out parallel features/fixes/refactors | One worktree + branch + issue + PR path per task |
| **land-lanes** | Existing concurrent lanes need integration | Reachable merge onto the default branch without lost work |

A clean integration branch is not proof that every worktree's progress remains reachable. Opening a PR is not a merge. Deleting a remote branch is never default cleanup.

## Safety

- Freeze or explicitly coordinate active writers before **land-lanes**. A status snapshot is immediately stale while another agent continues editing.
- Never use broad reset, clean, checkout-overwrite, blanket stash, forced branch switch, rebase of shared work, or `ours`/`theirs` conflict strategy.
- **Never delete remote branches, tags, or PRs** unless the user explicitly asks. Local worktree/branch cleanup only after reachability is proven and still requires explicit authorization.
- Treat untracked, ignored-but-important, symlink, mode, submodule, sparse-checkout, detached-HEAD, and sequencer state as first-class data.
- **Own-lane isolation:** each agent edits only its worktree and branch. Foreign dirty trees are user-owned until proven otherwise.
- Use `organized-commits` for dirty lanes when available. Preserve unrelated user changes and stop when intent is ambiguous.
- Do not merge to the default branch, force-push protected refs, deploy, or close/delete issues unless the request authorizes that step.
- Agent host is **agnostic**: use the host's multi-agent tool when available; **cmux terminal per lane** when the user wants visible/joinable sessions; otherwise prepare worktrees + written task briefs for separate terminals.

## Workflow

### Choose mode

- **setup-lanes** if the user wants parallel features, “set worktrees”, “fire agents”, or one-task-per-agent isolation.
- **land-lanes** if the user wants to consolidate, salvage, merge, or land existing worktrees/branches.
- If both appear, finish setup for unfinished lanes, then land only what is ready.

### Mode: setup-lanes

One **task** = one **agent** = one **worktree** = one **branch** = one **issue** = one **PR** (issue linked).

1. Read repository instructions (`AGENTS.md`, `CODE-STYLE.md`, ADRs). Discover default branch (`main`/`master` from remote). `git fetch` without mutating other worktrees.
2. Split the user request into **independent** tasks. Reject or sequence tasks that share the same files/schemas until land policy is clear. Name each task with a short kebab slug.
3. For each task, create a GitHub issue (`gh issue create`) with title, acceptance criteria, and out-of-scope notes. Record the issue number.
4. Create an isolated worktree under the **repository root** (not `~/.grok/worktrees` unless the user overrides):

   ```bash
   # from repo root, default branch at origin tip
   git fetch origin
   git worktree add ".worktrees/<type>-<issue>-<slug>" -b "<type>/<issue>-<slug>" "origin/<default>"
   ```

   - **Branch:** `<type>/<issue>-<short-slug>` where `type` is `feat` | `fix` | `refactor` | `chore` | `docs` (or repo convention).
   - **Worktree dir:** `.worktrees/<type>-<issue>-<slug>` (slashes → dashes). Ensure `.worktrees/` is gitignored if the repo agrees.
5. Hand each agent **only its task brief**: worktree path, branch, issue URL/number, acceptance criteria, required style docs, and “do not touch other lanes.” Write the brief to `<worktree>/LANE-BRIEF.md`. Prefer the host mode the user chose (or that the calling skill asked for):
   - **Host subagent:** spawn API with cwd = that worktree.
   - **cmux terminal per lane:** `cmux new-workspace --name "lane:<issue>-<slug>" --cwd <worktree> --command "<agent-cli…>" --focus false` so the human can watch, jump in, and continue tasks in that terminal (see `messy-repo-orchestrator` §1b / Host B).
   - **Briefs only:** print paths + suggested start command; do not claim agents are running.
6. Each lane implements, verifies (narrow then full gate), and commits via `organized-commits` / `finish-and-ship` on **its** branch — never on the default branch.
7. Each lane pushes its branch and opens a PR to the default branch with the issue linked:

   ```bash
   gh pr create --base <default> --head <type>/<issue>-<slug> \
     --title "…" --body "Fixes #<issue>

   ## Summary
   …

   ## Test plan
   - [ ] …"
   ```

   Use `Fixes #<n>` or `Closes #<n>` so the issue links to the PR. **Do not merge** unless asked. **Do not delete** the remote branch after open.
8. Orchestrator reports a matrix: task → worktree → branch → issue → PR URL → SHA → verify status. Unfinished lanes stay open; do not delete them.

### Mode: land-lanes

1. Identify the integration target from remote/default-branch evidence and fetch current refs without changing worktrees.
2. Inventory every worktree: path, branch/HEAD, upstream, ahead/behind, merge-base, staged/unstaged/untracked state, ignored-but-important files, stash references, and merge/rebase/cherry-pick state. Include `.worktrees/*` when present.
3. Classify each lane as clean committed work, dirty-only work, already reachable, patch-equivalent duplicate, divergent, or active/blocked. Use patch-ID plus history and semantic inspection; subjects alone do not prove duplication.
4. Map path overlap and cross-file semantic overlap such as schema/consumer, API/caller, migration/model, or generated-source relationships.
5. Agree on ownership/order when writers overlap. Create backup refs for target and every committed source. Preserve dirty-only and untracked bytes with an explicit, verified method appropriate to their file types.
6. Make each source lane reviewable and verified. Commit its own coherent work before integration when authorized (`organized-commits`).
7. Create a fresh integration candidate from current remote target. Merge or cherry-pick one logical lane at a time according to repository policy; prefer merges for shared branch history. Prefer landing via already-open PRs when they exist.
8. Resolve mechanical conflicts only when intent is evident. For competing logic, show both sides and stop for a decision. Regenerate lockfiles and derived files from their source rather than hand-merging output.
9. Run focused checks after each lane and the full repository gate after convergence. Push through the authorized path and monitor required hosted checks.
10. Prove every original commit and preserved dirty artifact is reachable or intentionally retained **before proposing** local cleanup. Remote branch deletion remains forbidden unless the user explicitly asks after that proof.

## Verification

### setup-lanes

Report:

- default branch and base SHA used for each worktree;
- per lane: path, branch, issue number/URL, host mode, agent/terminal assignment (cmux workspace ref/name when used), `LANE-BRIEF.md` path, PR URL, head SHA, verify outcome;
- confirmation no lane committed on the default branch;
- confirmation no remote branches were deleted;
- leftover unassigned tasks or blocked overlaps.

### land-lanes

Provide a final matrix with:

- every worktree/branch, original HEAD, backup ref, dirty-artifact location, and disposition;
- merge-base, unique commits, patch-equivalent duplicates, and overlap decisions;
- integration commit order and conflict resolutions;
- focused and full verification outcomes;
- local target, remote target, and hosted-check SHAs/status;
- remaining worktrees, branches, stashes, backups, and explicit cleanup authorization state (local vs remote called out separately).

“Everything landed” requires reachability and byte-preservation evidence, not merely an empty `git status` on the target branch. “Agents fired” requires issue + branch + PR linkage per lane, not only created directories.
