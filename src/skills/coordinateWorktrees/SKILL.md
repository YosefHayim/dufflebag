---
name: coordinate-worktrees
description: Use when the user asks to coordinate, consolidate, merge, salvage, or land work from multiple branches or Git worktrees, especially when they are dirty, overlapping, stale, or being used by concurrent agents.
---

# Coordinate Worktrees

Land independent work without losing bytes or silently choosing between competing product intents. A clean integration branch is not proof that every worktree's progress remains reachable.

## Safety

- Freeze or explicitly coordinate active writers before integration. A status snapshot is immediately stale while another agent continues editing.
- Never use broad reset, clean, checkout-overwrite, blanket stash, forced branch switch, rebase of shared work, or `ours`/`theirs` conflict strategy.
- Do not delete worktrees, branches, stashes, backup refs, or temporary evidence without explicit authorization after reachability is proven.
- Treat untracked, ignored-but-important, symlink, mode, submodule, sparse-checkout, detached-HEAD, and sequencer state as first-class data.
- Use `organized-commits` for dirty lanes when available. Preserve unrelated user changes and stop when intent is ambiguous.

## Workflow

1. Identify the integration target from remote/default-branch evidence and fetch current refs without changing worktrees.
2. Inventory every worktree: path, branch/HEAD, upstream, ahead/behind, merge-base, staged/unstaged/untracked state, ignored-but-important files, stash references, and merge/rebase/cherry-pick state.
3. Classify each lane as clean committed work, dirty-only work, already reachable, patch-equivalent duplicate, divergent, or active/blocked. Use patch-ID plus history and semantic inspection; subjects alone do not prove duplication.
4. Map path overlap and cross-file semantic overlap such as schema/consumer, API/caller, migration/model, or generated-source relationships.
5. Agree on ownership/order when writers overlap. Create backup refs for target and every committed source. Preserve dirty-only and untracked bytes with an explicit, verified method appropriate to their file types.
6. Make each source lane reviewable and verified. Commit its own coherent work before integration when authorized.
7. Create a fresh integration candidate from current remote target. Merge or cherry-pick one logical lane at a time according to repository policy; prefer merges for shared branch history.
8. Resolve mechanical conflicts only when intent is evident. For competing logic, show both sides and stop for a decision. Regenerate lockfiles and derived files from their source rather than hand-merging output.
9. Run focused checks after each lane and the full repository gate after convergence. Push through the authorized path and monitor required hosted checks.
10. Prove every original commit and preserved dirty artifact is reachable or intentionally retained before proposing cleanup.

## Verification

Provide a final matrix with:

- every worktree/branch, original HEAD, backup ref, dirty-artifact location, and disposition;
- merge-base, unique commits, patch-equivalent duplicates, and overlap decisions;
- integration commit order and conflict resolutions;
- focused and full verification outcomes;
- local target, remote target, and hosted-check SHAs/status;
- remaining worktrees, branches, stashes, backups, and explicit cleanup authorization state.

“Everything landed” requires reachability and byte-preservation evidence, not merely an empty `git status` on the target branch.
