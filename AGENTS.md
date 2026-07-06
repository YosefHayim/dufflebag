# AGENTS.md

**This file is the single source of truth for the rules of working in this repository** — for any coding agent (Claude Code, Cursor, etc.) and for humans. `CLAUDE.md` and `GEMINI.md` are symlinks to this file.

## What this is

**dufflebag** — a one-command installer for a personal bag of Claude Code skills, hooks, **and reusable CI/publish workflow templates**: context guard, dedup guard, autonomous loop, speak-response, the **png-to-code** skill (PNG → measured pixel-perfect code), **readme-editor**, **refresh-agent-docs**, and `scaffold-ci` (copy the CI + publish workflows into any repo).

> **Renamed `skills-bag → dufflebag` (landed 2026-07-01).** A **clean break** — total across four contracts (repo, npm + bin, payload marker `/dufflebag/`, env prefix `dufflebag*`), **no back-compat shim**, and the code is now vertical per feature. See [`templates/mdFiles/CODE-STYLE.md` → refresh log](templates/mdFiles/CODE-STYLE.md) and ADRs [0007](docs/adr/current/0007-rename-to-dufflebag-broadened-remit.md)–[0009](docs/adr/current/0009-reusable-workflows-and-cli-scaffolding.md). No `skills-bag`/`skillsBag*`/`SKILLS_BAG_*` strings remain anywhere in the tree.

Install features with:

```bash
npx ys-dufflebag install --features png-to-code
```

Feature docs live under `src/skills/<feature>/`. The png-to-code harness is TypeScript under `src/skills/png-to-code/scripts/`.

## Repo layout

| Path | Purpose |
|------|---------|
| `src/core/` | CLI kernel (may use deps), grouped by domain — `catalog/` · `settings/` · `wiring/` · `host/`, plus `config`/`fs`/`ui` + the `index.ts` barrel |
| `src/payload/` | zero-dep hook kernel (`config` SSOT + `io`), assembled into the flat payload |
| `src/skills/<feature>/` | each feature's engine (`hooks/`, `lib/`, `command/`) **and** its shipped content |
| `src/scripts/` | build-time only — `assembleHooks.mjs` flattens the per-feature hooks into `dist/hooks/` (not shipped) |
| `templates/workflows/` | the CI + publish workflow set the CLI copies into any repo (`scaffold-ci`) |
| `templates/mdFiles/` | authored long-form guides — `CODE-STYLE.md` (style SSOT) + `PROJECT.md` (purpose & direction) |
| `.husky/pre-commit` | regenerates `README.md` from source (`pnpm generate-readme`) and stages it |
| `.github/workflows/` | dufflebag's own CI: single-purpose `workflow_call` legs composed by `ci.yml` (mirrored into `templates/workflows/`) |
| `*.test.ts` (co-located) | tests sit beside their source; cross-cutting ones in `src/commands/*.integration.test.ts` |

**Two kinds of skill live under `src/skills/`:**

- **Shipped features** — `autorun`, `png-to-code`, `write-a-post`, `readme-editor`, and `refresh-agent-docs` are registered in the CLI (`src/core/catalog/features.ts`) and **copied** into `~/.claude/skills/` by `npx dufflebag install` when their feature is selected.
- **Personal skills** — `grill-me`, `grill-with-docs`, `grill-me-code-style`, `grill-me-code-style-with-docs`, `deslop`, and `planpage` (the `planpage`-package consumer skill) are the owner's own skills: git-tracked here as their SSOT but not registered CLI features. Edit them here; installation/symlink behavior is handled outside the catalog.

## Conventions

<!-- rules digest — full guide in templates/mdFiles/CODE-STYLE.md; edit there. Architectural "why" in docs/adr/current/. -->

- **One strict style bar for all TypeScript** — `src/` *and* the png harness (`src/skills/png-to-code/scripts/`). **biome is the linter (`recommended`) *and* formatter** (double quotes), committed as `biome.json` with `biome ci` the one CI gate. One root `tsconfig` governs the project; the png harness's own `tsconfig` is the single sanctioned exception ([ADR 0013](docs/adr/current/0013-style-refresh-colocated-tests-single-command-autorun-templates.md)).
- **Pure core, imperative shell** — any module that touches disk/env/process splits pure transformers (top) from effects (bottom) with a `// --- IO layer ---` divider; tests hit the pure half. **Hard rule.** Core is grouped by domain (`catalog`/`settings`/`wiring`/`host`); the split stays *within* each module ([ADR 0010](docs/adr/current/0010-core-grouped-by-domain.md)).
- **Errors by role** — hooks **fail-open** (`try { main() } catch { exit(0) }`); CLI **throws an actionable `Error`** caught once at the top → `fail()`; gates/harness use **exit codes** (0/1/2).
- **Interactive front door** — bare `dufflebag` in a TTY opens a menu (`src/commands/menu.ts`) that **routes into the same command functions** the flags drive (never a second implementation); any argument or a non-TTY stdin defers to commander. New prompts go through the `ui` wrappers (`select`/`text`/`confirm`/`multiselect`), which return a fallback **without prompting** off-TTY so nothing scripted hangs ([ADR 0011](docs/adr/current/0011-interactive-menu-entry.md)).
- **Zero-dep hook payload** — each feature's `hooks/**` imports only `node:*` + `src/payload/*` + its own `lib/`; cross into `core` via `import type` only.
- **Shared contracts: declare once, re-export** — never re-declare (config SSOT lives in `src/payload/config.ts`).
- **Pure mutators clone in → clone out**; bag-owned entries are identified **only** by the `/dufflebag/` path marker or `dufflebag` env prefix.
- **TSDoc on the exported surface** — every exported function/type carries a summary + `@param` each + `@returns` + one line per prop; internal one-liners stay bare (no name-restating there). `deslop` enforces per-diff ([ADR 0012](docs/adr/current/0012-tsdoc-on-the-exported-surface.md)).
- **Naming** — files `camelCase` · fns/vars `camelCase` · constants `SCREAMING_SNAKE` · types `PascalCase` · feature IDs / skill dirs / CLI flags `kebab-case` (external contracts — never convert).
- **Types** — `interface` for object shapes, `type` for unions; explicit return types on exports; `node:` prefix; `index.ts` barrel per CLI-kernel dir (`core/`, `commands/`); the zero-dep payload + feature libs are imported by specific file (no barrel).
- **Tests co-locate** — `foo.test.ts` beside `foo.ts`; **no `test/` dir**. Pure modules get no-disk unit tests; cross-cutting/integration tests live in `src/commands/*.integration.test.ts` (the install/uninstall round-trip byte-restores `settings.json`) ([ADR 0013](docs/adr/current/0013-style-refresh-colocated-tests-single-command-autorun-templates.md)).
- **Layout: everything source-y under `src/`, copyable templates under `templates/`** — `src/skills/<feature>/` holds a feature's engine (hooks, feature-local libs, its command) **and** its shipped content; the irreducible shared kernel stays in `src/core/` (CLI) + `src/payload/` (zero-dep hooks); the build script sits in `src/scripts/`. `templates/` holds what `scaffold-ci` copies into other repos — `workflows/` + `mdFiles/`. Sources vertical, build output a **flat** `dist/hooks/` payload ([ADR 0008](docs/adr/current/0008-vertical-per-feature-layout.md), [ADR 0014](docs/adr/current/0014-consolidate-under-src-and-templates.md)).
- **One command per tool surface** — the autonomous loop is a single `autorun` skill with `stop`/`exit` verbs (`/autorun` · `/autorun stop` · `/autorun exit`), all routed to the one `ctxLoopCtl.js` engine ([ADR 0013](docs/adr/current/0013-style-refresh-colocated-tests-single-command-autorun-templates.md)).
- **Ship boundary: catalog allowlist** — the `FEATURES` catalog declares each feature's shipped paths; the installer copies **only** those, so build-only `.ts` never leaks into a user's install (fail-safe).
- **Workflows** — CI is single-purpose `workflow_call` legs (biome/typecheck/test/build/report-failure/e2e) composed by `ci.yml` via `./` refs; the CLI **copies** the whole set from `templates/workflows/` into a repo so each owns its CI (`scaffold-ci`; `--force` to resync). `publish.yml` is filled per repo (OIDC binds repo + filename); **a private repo omits it**. The shared legs are byte-identical in `.github/workflows/` + `templates/workflows/` — a test enforces it ([ADR 0009](docs/adr/current/0009-reusable-workflows-and-cli-scaffolding.md)).
- **README regeneration on commit** — the `.husky/pre-commit` hook runs `pnpm generate-readme` and stages `README.md`, so the `AUTO:FEATURES`/`AUTO:SKILLS` tables never drift from `features.ts` and `src/skills/*/SKILL.md`. Run `pnpm prepare` (or `pnpm install`) after cloning to activate the hook.
- **Scripts — one shared `package.json` surface** — the same script *names* across every owned repo in the workspace: biome `lint` (`biome check .`) / `lint:fix` (`biome check --write .`) / `format`; vitest `test` (`vitest run`) / `test:watch`; `tsc --noEmit` `typecheck`; `tsx` `cli` (the interactive front door — bare = menu, `-- <sub>` = direct); `husky` `prepare`; and a single `verify` gate = `check:ci && typecheck && test && build` (replacing `qa`/`quality`/`validate`). Variants nest under `:`; **names are the contract — only `dev`/`build`/`start` bend to the stack**. Full table + recipe in `templates/mdFiles/CODE-STYLE.md → Scripts`.

> **Migrations landed.** The code conforms to the digest migration (camelCase filenames, barrels, harness restructure, biome-enforced lint+format), the **dufflebag pivot** (rename across four contracts, vertical per-feature layout, catalog ship-allowlist, reusable workflows), the **2026-07-02 style refresh** (TSDoc on the exported surface, biome linter on, co-located tests, single-command `autorun` — ADRs [0012](docs/adr/current/0012-tsdoc-on-the-exported-surface.md)–[0013](docs/adr/current/0013-style-refresh-colocated-tests-single-command-autorun-templates.md)), and the **source consolidation** (all source under `src/` — adding `src/skills/` + `src/scripts/` — and all copyable templates under `templates/` — `templates/workflows/` + `templates/mdFiles/`; [ADR 0014](docs/adr/current/0014-consolidate-under-src-and-templates.md)). Where code and this digest drift, the digest wins; the full guide is `templates/mdFiles/CODE-STYLE.md` and `deslop` enforces per-diff.

### `scripts/dev/` — local-only tooling (gitignored)

Scripts for local debugging, one-off experiments, or personal dev utilities go in `scripts/dev/`. This folder is **gitignored** — it never reaches the remote. Production/CI scripts stay in `src/scripts/` (committed).

When creating a new script, ask: _"Would CI, the build, or the shipped CLI need this?"_ If **no** → `scripts/dev/`.

## Validate changes

From repo root:

```bash
npm test
npm run build   # if applicable
```

For png-to-code script changes:

```bash
cd src/skills/png-to-code/scripts && npm run typecheck
```

## Agent skills

### Issue tracker

Issues for this repo live in GitHub (`YosefHayim/dufflebag`). See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

Five canonical triage roles mapped to GitHub label strings. See [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Single-context layout: read [`src/skills/png-to-code/CONTEXT.md`](src/skills/png-to-code/CONTEXT.md) and `src/skills/png-to-code/docs/adr/` when working on png-to-code. See [`docs/agents/domain.md`](docs/agents/domain.md).
