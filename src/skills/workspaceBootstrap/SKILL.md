---
name: workspace-bootstrap
description: Use when the user asks to duplicate or clone every GitHub repo into a Code folder, sync org repos (e.g. personal + vybekiit + genshot), bulk pnpm install across sibling repos, pull all remotes and report deltas, or bootstrap a multi-repo workspace without installs first.
type: flow
---

# Workspace Bootstrap

Bootstrap or refresh a multi-repo coding workspace (typically `~/Desktop/Code`) from GitHub user and org remotes, with optional bulk package installs.

## Safety

- Confirm destination root, GitHub scopes (user + named orgs), and whether **clone-only** vs **clone + install** is authorized.
- Never overwrite an existing dirty repo. Skip, report, or ask — do not `rm -rf` or force-reset without explicit approval.
- Prefer `gh` authenticated as the current user. Do not embed tokens in commands or logs.
- Respect package-manager identity: if a repo is npm-only (or forbids pnpm), do not force `pnpm i`.
- Do not run post-install servers, deploys, or migrations during bootstrap unless the user asked.

## Workflow

1. Resolve destination (`CODE_ROOT`, default `~/Desktop/Code`) and target remotes (user login + optional orgs). List existing children of `CODE_ROOT`.
2. Enumerate remote repos with `gh repo list` (user and each org). Build a plan: clone missing, skip present, note renames/forks.
3. Present the plan (counts + sample names). On approval, clone with `gh repo clone <owner/name> <dest>` into `CODE_ROOT/<name>` without installing unless requested.
4. When bulk install is requested: for each cloned/local repo with a lockfile, detect package manager (`pnpm-lock.yaml` → pnpm, `package-lock.json` without pnpm workspace → npm unless user said pnpm-for-all-except-npm-only, `yarn.lock` → yarn). Run install only where allowed; capture failures per repo.
5. Optional pull-all: for each git repo under `CODE_ROOT`, `git fetch --all --prune` and report ahead/behind / dirty / fail.
6. Write a short matrix: repo → action (cloned/skipped/pulled) → install status → notes.

## Verification

Report:

- destination root and auth identity (`gh api user` login);
- repos cloned, skipped (already present), failed;
- install successes/failures by package manager;
- pull/delta summary when requested;
- anything left requiring user secrets or interactive login.

Do not claim “all repos duplicated” if enumeration or clones failed, or “installed” when only clones ran.
