---
name: organized-commits
description: Use when the user asks to commit, push, ship, organize commits, clean up Git history, consolidate branches or worktrees, or salvage stale work without losing progress.
---

# Organized Commits

Make Git history a debug timeline: one intent per commit, useful messages, and no stranded work. Run only on an explicit commit, push, ship, or consolidation request.

## Safety

- Read repository instructions and inspect status, branch, upstream, recent history, staged/unstaged diffs, untracked files, worktrees, and stashes before staging.
- Preserve user-owned and unrelated changes. Stop if secrets, credentials, unexplained generated files, or ambiguous overlapping intent appear.
- Never change Git configuration, rewrite published history, force-push a protected branch, or delete branches, tags, stashes, or worktrees without explicit authorization.
- Push only when requested. Existing approval remains valid when the user already asked for commit and push in the same task.
- Use merge, not rebase, to consolidate shared work. Create backup refs before integration.

## Workflow

1. Classify every changed path by intent: feature, fix, refactor, reorganization, removal, docs, test, build, CI, performance, style, or chore.
2. Group changes so each commit is independently understandable and does not leave the repository knowingly broken. Split mixed files by hunk only when the boundary is real.
3. Present the commit sequence when approval has not already been given. Include subject, intent, files, rationale, verification, and whether push is authorized.
4. Stage explicit paths or hunks. Audit `git diff --cached` before every commit.
5. Use an imperative conventional subject and a body that records motivation, concrete change, and impact:

   ```text
   type(scope): short subject

   Why: <motivation>
   What: <concrete change>
   Impact: <behavior, risk, or none>
   ```

6. Inspect status and the index after each commit because hooks may regenerate or stage files. Keep hook-produced changes with the intent that owns them.
7. Run the repository's fresh verification gate before shipping non-trivial work.
8. Immediately before push, fetch or inspect the remote relationship, confirm no secret entered the outgoing range, and push without force.

For classification, split, push, and consolidation examples, read [REFERENCE.md](REFERENCE.md).

## Verification

Report:

- every new commit SHA and subject;
- the fresh verification commands and outcomes;
- local branch, upstream, ahead/behind state, and pushed remote SHA;
- remaining staged, unstaged, untracked, stashed, branch, or worktree state.

Do not call history clean if work remains unexplained, and do not call a push complete until the remote contains the reported commit.
