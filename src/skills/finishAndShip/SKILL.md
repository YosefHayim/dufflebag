---
name: finish-and-ship
description: Use when the user wants completed work closed out end-to-end — including freeform "git commit push", "git commit push to main", "ok nice git commit push", "fix then commit push", wrap up after fixes, finish what was asked, prepare a branch for handoff, or ship the local change set with verify + handoff. Always land product work on a feature-related branch (feat/fix/refactor/chore)—never ship from main/default by default. Never delete remote branches unless the user explicitly asks. Prefer this over bare commit-only when they imply gates, leftovers, or done after finishing all work. Hand pure commit-splitting to organized-commits; multi-lane worktrees to coordinate-worktrees; redeploy/live prove to deploy-and-prove; local browser proof to preview-and-prove. Anti-triggers: "no commit", "do not commit", "NO git commit/add/push".
type: flow
---

# Finish and Ship

Close the whole delivery loop from the repository's real state. “Done” means the requested outcome is implemented, verified, recorded on a **feature-related branch**, pushed when authorized, and handed off without hidden leftovers.

## Safety

- Read repository instructions and identify the requested scope before changing, staging, or discarding anything.
- Treat existing dirty changes as user-owned until proven otherwise. Never hide them with a broad stash, reset them, or fold them into the task silently.
- **Feature branch by default:** product commits live on a named topic branch (`feat/…`, `fix/…`, `refactor/…`, `chore/…`, or repo convention)—including refinements and improvements to an existing feature. If HEAD is the default branch (`main`/`master`/detected default) with task work, **create or switch to a feature branch first**. Do not commit or push ship work from the default branch unless the user explicitly orders main-only commits.
- **Never delete remote branches** (or remote tags) unless the user explicitly requests it. Local branch/worktree cleanup only with care after reachability is clear—and still not as silent post-ship default.
- Do not lower a quality gate, skip failing checks, expose secrets, rewrite published history, force-push a protected branch, or trigger a deployment unless the request includes it.
- A request to “commit and push” authorizes those actions for the completed scope on the **current feature branch**; it does not authorize releases, merges to default, remote branch deletion, or unrelated cleanup.

## Workflow

1. Inspect repository instructions, branch/upstream, worktrees, status, recent commits, and the complete diff. Build an explicit ledger of requested work, user-owned changes, generated changes, and unresolved items.
2. If on the default branch with product changes (or about to make them), cut a topic branch from an up-to-date default tip before committing. Name it for the job (feature, fix, refactor, chore). Multi-lane parallel work → `coordinate-worktrees` **setup-lanes**.
3. Trace the changed behavior through its real entrypoints and tests. Search for placeholders, disabled checks, temporary debug code, stale docs, and unhandled call sites.
4. Run the narrowest relevant checks first. Fix failures within scope, then run the repository's full documented gate from a fresh command.
5. Exercise the real behavior when the task has a user-visible or integration surface. Use `preview-and-prove` for browser flows and `deploy-and-prove` only when deployment is authorized.
6. Review the final diff for correctness, scope, secrets, accidental generated files, and migration or compatibility consequences.
7. Use `organized-commits` when available. Otherwise apply the same essentials: stage by intent, inspect the index, write why/what/impact messages, and re-check status after hooks. Freeform “git commit push” still routes here as the outer loop; do not skip gates for short wording.
8. Push only when requested (including implied by “git commit push” / “push to main” meaning **push the feature branch toward main**, not necessarily commit on main). Confirm the remote ref resolves to the shipped local commit. Open or update a PR to the default branch when that is the user's ship definition; link issues with `Fixes #n` when an issue exists. Monitor required hosted checks when ship includes them.
9. Leave a compact handoff: outcome, evidence, branch name, commits (SHAs), remote state, PR URL if any, remaining work, and any action requiring different authority. Completion means SHA + remote + gates — not “files changed.” Do not delete the remote feature branch after push/PR.

If a gate cannot run, say exactly why and downgrade the completion claim. Do not replace current evidence with an older successful run.

## Verification

Before claiming completion, confirm all of these from fresh evidence:

- requested behavior and acceptance criteria are covered;
- work landed on a feature-related branch (not default-by-accident);
- narrow checks and the full repository gate passed;
- real UI, API, CLI, or integration behavior was exercised where relevant;
- committed files match the reviewed diff and hooks did not leave surprise changes;
- the pushed remote SHA matches local HEAD when push was requested;
- no remote branch was deleted unless explicitly requested;
- remaining worktree, worktree-list, stash, and branch state is clean or explicitly explained.

Report the exact commands, outcomes, commit SHAs, branch/remote, PR if any, and any unverified surface. “Should work” is not shipped.
