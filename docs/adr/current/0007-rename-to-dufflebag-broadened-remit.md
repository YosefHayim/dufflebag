# 0007 — Rename to `dufflebag`, broadened remit

- **Status:** Accepted (2026-07-01); revised the same day to a **clean break** — the one-release back-compat below was dropped per owner directive before it shipped.
- **Scope:** whole repo — GitHub repo name, npm package + `npx` bin, payload marker (`INSTALL_DIR_NAME` / `PATH_MARKER`), env prefix (`ENV_PREFIX`)
- **Related:** [0003 — Config SSOT inside payload](0003-config-ssot-inside-payload.md), [0008 — Vertical per-feature layout](0008-vertical-per-feature-layout.md)

## Context

`skills-bag` outgrew its name. It no longer installs only Claude Code *skills*:
it installs skills **and** hooks, and it is becoming the home for the reusable
CI/publish **workflow templates** the owner copies into every repo
([0009](0009-reusable-workflows-and-cli-scaffolding.md)). Across ~18 personal
repos the same setup is re-pasted by hand; the tool's real job is "scaffold my
personal dev infrastructure into any repo," and "skills-bag" undersells that.

## Decision

Rename the project to **`dufflebag`** — a bag you pack once and carry into every
repo, holding skills, hooks, *and* workflows. The rename is **total**, across all
four independent contracts (they were considered separately and all move):

| Contract | Before | After |
|---|---|---|
| GitHub repo | `YosefHayim/skills-bag` | `YosefHayim/dufflebag` (GitHub 301-redirects the old URL) |
| npm package + bin | `skills-bag` / `npx skills-bag` | `dufflebag` / `npx dufflebag` |
| Payload marker | `~/.claude/skills-bag/`, `PATH_MARKER = "/skills-bag/"` | `~/.claude/dufflebag/`, `"/dufflebag/"` |
| Env prefix | `skillsBag*` (`ENV_PREFIX`) | `dufflebag*` |

The rename is a **clean break, not a migration release.** An earlier draft of this
ADR carried one-release back-compat — dual `/skills-bag/`+`/dufflebag/` marker
recognition (`LEGACY_PATH_MARKERS`) and a `skillsBag* → dufflebag*`
env-migration generation (`core/envMigrate.ts`). The owner **rejected that**:
`dufflebag` never shipped under a published name, so there is no in-the-wild
install to bridge, and carrying transitional shims for a non-existent upgrade path
is dead weight. dufflebag therefore recognizes **only** its own `/dufflebag/`
marker and `dufflebag*` env prefix — no `LEGACY_*` constants, no `envMigrate` step,
zero `skills-bag`/`skillsBag*`/`SKILLS_BAG_*` strings in the tree. The only
follow-ups are operational, not code:

1. **New OIDC trusted publisher.** Register the `dufflebag` package's trusted
   publisher (repo + `publish.yml`); deprecate the old `skills-bag` npm package
   with a pointer to `dufflebag`.
2. **Fresh install for any old user.** Anyone still on a hand-installed
   `skills-bag` removes it with the old binary (or deletes `~/.claude/skills-bag/`)
   and runs `npx dufflebag install` — a one-time manual step, by design.

## Considered options

- **Repo + brand only** (keep npm/marker/env as `skills-bag`): zero breakage, but
  leaves a permanent repo-name ≠ package-name split and a stale internal name.
  Rejected — the owner wants full coherence under one name.
- **Keep `skills-bag`:** rejected — the name is narrower than the tool's remit.

## Consequences

- **+** One coherent name matching the broadened remit; every surface a user
  touches says `dufflebag`.
- **+** The clean break keeps the code honest: **zero** `skills-bag`/`skillsBag*`/
  `SKILLS_BAG_*` strings survive — no `LEGACY_*` markers, no env-migration path,
  nothing transitional to "clean up later."
- **−** No automatic upgrade from a pre-rename `skills-bag` install: a prior user
  uninstalls the old one and re-installs `dufflebag` once. Acceptable because
  `dufflebag` never shipped under the old name — there is no published upgrade path
  to protect.
- **−** Still a real cut over: an npm re-publish under a new trusted-publisher
  config and a doc/README sweep.
