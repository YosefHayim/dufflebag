---
name: finish-and-ship
description: Use when implementation is complete and the user asks to finish, ship, wrap up, commit and push, prepare a branch for handoff, or ensure nothing remains unfinished.
---

# Finish and Ship

Close the whole delivery loop from the repository's real state. “Done” means the requested outcome is implemented, verified, recorded, pushed when authorized, and handed off without hidden leftovers.

## Safety

- Read repository instructions and identify the requested scope before changing, staging, or discarding anything.
- Treat existing dirty changes as user-owned until proven otherwise. Never hide them with a broad stash, reset them, or fold them into the task silently.
- Do not lower a quality gate, skip failing checks, expose secrets, rewrite published history, force-push a protected branch, or trigger a deployment unless the request includes it.
- A request to “commit and push” authorizes those actions for the completed scope; it does not authorize releases, merges, branch deletion, or unrelated cleanup.

## Workflow

1. Inspect repository instructions, branch/upstream, worktrees, status, recent commits, and the complete diff. Build an explicit ledger of requested work, user-owned changes, generated changes, and unresolved items.
2. Trace the changed behavior through its real entrypoints and tests. Search for placeholders, disabled checks, temporary debug code, stale docs, and unhandled call sites.
3. Run the narrowest relevant checks first. Fix failures within scope, then run the repository's full documented gate from a fresh command.
4. Exercise the real behavior when the task has a user-visible or integration surface. Use `preview-and-prove` for browser flows and `deploy-and-prove` only when deployment is authorized.
5. Review the final diff for correctness, scope, secrets, accidental generated files, and migration or compatibility consequences.
6. Use `organized-commits` when available. Otherwise apply the same essentials: stage by intent, inspect the index, write why/what/impact messages, and re-check status after hooks.
7. Push only when requested. Confirm the remote ref resolves to the shipped local commit and monitor required hosted checks when the user's definition of ship includes them.
8. Leave a compact handoff: outcome, evidence, commits, remote state, remaining work, and any action requiring different authority.

If a gate cannot run, say exactly why and downgrade the completion claim. Do not replace current evidence with an older successful run.

## Verification

Before claiming completion, confirm all of these from fresh evidence:

- requested behavior and acceptance criteria are covered;
- narrow checks and the full repository gate passed;
- real UI, API, CLI, or integration behavior was exercised where relevant;
- committed files match the reviewed diff and hooks did not leave surprise changes;
- the pushed remote SHA matches local HEAD when push was requested;
- remaining worktree, worktree-list, stash, and branch state is clean or explicitly explained.

Report the exact commands, outcomes, commit SHAs, branch/remote, and any unverified surface. “Should work” is not shipped.
