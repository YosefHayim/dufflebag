---
name: restructure-repo
description: Use when a whole repo needs a better structure — folders, file names, function, variable, and type names, function bodies, import order, repeated code, comments, and dependencies — checked against the official docs of every framework it uses (Expo, React, Cloudflare, Express…) and the repo's own PROJECT.md, README.md, and LANGUAGE.md. Cheap read-only scout agents scan; the main agent decides, asks targeted questions, shows each phase for approval, and makes the changes on a branch. Say "restructure this repo", "better project structure", "rename across the codebase", or "which deps do we not need". Not for one file or folder; use make-code-readable or simplify-code.
type: flow
---

# Restructure repo

Bring a whole repo in line with what it is for, in the fewest lines that do the job. Scouts read, the main agent decides and edits, and the user approves every phase.

## Rules

Measure every finding against these, in order:

1. **The repo's docs.** `CODE-STYLE.md` wins when present. `PROJECT.md` says what the project is for, `LANGUAGE.md` gives its words, `README.md` describes it. Anything that does not fit what they describe, or does not use their words, is a finding.
2. **Official docs** of each framework and library in use, for the installed version.
3. **Minimal.** The fewest lines, files, and layers that do the job. There is no line cap per file; the test is that adding or changing one feature means reading only that feature's files.
4. **Simple.** When the docs allow several ways, pick the one a person can debug by hand.
5. **Names over comments.** Rename until a comment on a function, prop, or type is not needed, then delete the comment. Keep tool directives (`@ts-expect-error`, `biome-ignore`, `eslint-disable`), a comment that links the issue behind a workaround, license headers, and doc comments that generate published API docs.

## Safety

- Never commit on main or the default branch. Stop if tracked files have uncommitted changes.
- Change no tracked file until the user approves a phase. Before that, write only the run folder.
- At the first approved change, create `refactor/<goal>` in this checkout: 2–4 words that say why, no date (`refactor/split-app-and-api`).
- Move files with `git mv`. Make one commit per phase, or one per app or package when a phase is large.
- Keep behavior. A change to an API response, route, env var, or public export gets its own question.
- Ask before a major version upgrade, a deploy, a secret change, or a paid service.
- Check deploy config (`wrangler.*`, `eas.json`, `app.json`) with dry runs only.
- Expo Router files are routes: each rename gets its own question.
- Use plain pnpm or npm workspaces. Never add Turborepo or Nx; flag an existing one only when it adds nothing.
- Add a shared abstraction only when it has two or more real callers and removes lines.
- Scouts never edit, commit, or decide. A finding reaches a question card only after the main agent has read it at its `file:line`.
- Every finding names its source: an official doc URL, a line in the repo's docs, or `judgment`. Never cite a doc from memory.

## Who does the work

| Role | Model | Does |
|---|---|---|
| Scout | The model the user picks in step 1, read-only | Runs tools, reads files, fetches doc pages, and returns the table in [EXAMPLES.md → Scout brief](EXAMPLES.md#scout-brief) |
| Main agent | The session model | Checks and ranks findings, writes question cards and tables, edits, runs checks, commits |

- Spawn scouts explicitly; some hosts delegate only when asked.
- One scout per app or package per phase; batch small ones together.
- Save each scout report to `$RUN/scans/<phase>-<area>.md` and reuse it on resume.
- On a host without subagents, scan in the main agent and tell the user this run costs more.

## Workflow

Copy this checklist into `$RUN/PLAN.md` and tick it as you go:

```text
- [ ] 1. Start
- [ ] 2. Read
- [ ] 3. Official docs
- [ ] 4. Baseline
- [ ] Phase 1: Dead weight
- [ ] Phase 2: Structure
- [ ] Phase 3: Code
- [ ] Phase 4: Names
- [ ] Phase 5: Deps
- [ ] Phase 6: Best practices
- [ ] 6. Wrap up
```

### 1. Start

Find the models this host offers right now, as [REFERENCE.md → Scout models](REFERENCE.md#scout-models) describes. Never assume a model name.

Ask one card before any scout runs:

- **Scout model:** the fastest, cheapest model the host offers first, marked `(Recommended)`, then the stronger ones, each with its cost and care trade-off. The main agent stays on the session model.
- **Resume:** only when `docs/agent/restructure-repo/CURRENT` exists; resume from the first unticked line of its `PLAN.md`.

Otherwise start a run, and write the picked models to `PLAN.md`:

```bash
RUN_ID=$(date -u +%Y-%m-%dT%H%M%SZ)
RUN="docs/agent/restructure-repo/$RUN_ID"
mkdir -p "$RUN/scans"
printf '%s\n' "$RUN_ID" > docs/agent/restructure-repo/CURRENT
```

### 2. Read

Scouts read `git ls-files`, every package manifest, the workspace and framework configs, CI, and the repo's docs. Write to `PLAN.md`: each framework with its installed version, and each surface (client, server, shared, deploy) with its path.

If `PROJECT.md` or `LANGUAGE.md` is missing, offer `question-plan-with-docs` to write them first. If the user declines, use `README.md` and the words the code already uses most.

### 3. Official docs

For each framework and main library from step 2, a scout fetches its structure, best-practice, and style pages for the installed version and returns quotes with URLs. Start from [REFERENCE.md → Official docs](REFERENCE.md#official-docs); for anything not listed, find the official site.

### 4. Baseline

Run typecheck, lint, build, and tests, and start each app. Write each command and result to `PLAN.md`. If tests are thin, say so, offer `find-missing-tests`, and continue.

### 5. Phases

Run each phase in this loop. [EXAMPLES.md](EXAMPLES.md) shows every step for every phase.

1. Scouts scan the phase's targets and return findings.
2. The main agent reads each finding at its `file:line`, drops the wrong ones, and ranks the rest.
3. Ask one `AskUserQuestion` card with the decisions (at most 4 questions, recommended option first and marked `(Recommended)`). The user can answer "skip" to skip the phase.
4. Show the before/after table: up to 15 rows in chat, every row in `PLAN.md`.
5. Wait for approval.
6. Apply. Re-run the baseline; when a check fails, fix it or revert the phase before going on.
7. Commit `refactor(<phase>): <what changed>`, then append the result and SHA to `PLAN.md` and tick the checklist.

| Phase | Targets |
|---|---|
| 1. Dead weight | Unused files, exports, and deps (`npx knip`), and code or folders unrelated to what `PROJECT.md` and `README.md` describe |
| 2. Structure | Folders: current tree vs proposed tree, a move table (from → to → why → source), and the risks (imports, Metro and EAS config, wrangler paths) |
| 3. Code | Apply `simplify-code`, then `make-code-readable`, across the repo: function bodies (one job, flat, early returns), repeated code merged into one shared version, and import order from the repo's formatter or linter |
| 4. Names | Files, functions, variables, types, interfaces, and props: each says what it does, in `LANGUAGE.md`'s words and the framework's casing. Delete the comments the new names replace (Rules → 5) |
| 5. Deps | Wrong section, duplicates, replaceable by a built-in, version mismatches, outdated majors (report only), and one line on why each remaining dep exists. Commands: [REFERENCE.md → Dependency checks](REFERENCE.md#dependency-checks) |
| 6. Best practices | Each framework against its step 3 docs. Each finding gives `file:line`, doc URL, fix, and effort; the user picks which to apply. Send env and secret findings to `fix-env-config` |

The order is delete, move, rewrite, then name, so each phase leaves less work for the next.

### 6. Wrap up

- Add a short "Project structure" section to `README.md`. Update the `AGENTS.md` layout table when there is one, or offer `update-agent-docs`.
- When the repo has no `CODE-STYLE.md`, offer `code-style-existing-project` to record the decisions.
- Push and open a PR only when the user asks, through `finish-and-push`.

For a big rewrite that needs tests first, hand off to `simplify-repo-with-tests`. For why a framework is used at all, hand off to `explain-my-stack`.

## Verification

Report:

- the branch, the `PLAN.md` path, and the commit SHAs;
- for each phase, the counts and the table of what was deleted, moved, rewritten, or renamed, with sources;
- the baseline and final check results side by side;
- skipped phases and remaining risks.

The run is done when every approved phase is committed and the final checks match or beat the baseline.
