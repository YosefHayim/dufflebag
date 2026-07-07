# AGENTS.md

**This file is the single source of truth for the rules of working in this repository** — for any coding agent (Claude Code, Cursor, etc.) and for humans. `CLAUDE.md` and `GEMINI.md` are symlinks to this file.

## What this is

**dufflebag** — a one-command installer for a personal bag of Claude Code skills, hooks, **and reusable CI/publish workflow templates**: context guard, dedup guard, autonomous loop, speak-response, the **png-to-code** skill (PNG → measured pixel-perfect code), **github-repo-metadata** (GitHub description + topics), **readme-editor**, **refresh-agent-docs**, and `scaffold-ci` (copy the CI + publish workflows into any repo).

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

- **Shipped features** — `autorun`, `png-to-code`, `github-repo-metadata`, `write-a-post`, `readme-editor`, and `refresh-agent-docs` are registered in the CLI (`src/core/catalog/features.ts`) and **copied** into `~/.claude/skills/` by `npx dufflebag install` when their feature is selected.
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

<!-- dufflebag:skills start -->
## autorun

# autorun

One command drives the **autonomous loop** for the current session. The argument
selects the verb:

| You type | Meaning |
|---|---|
| `/autorun <n>` (or bare `/autorun`) | **arm** — allow up to **N** auto-compact cycles (bare = configured default) |
| `/autorun stop` | **pause** — stop compacting but keep the daemon observing (re-arm later) |
| `/autorun exit` | **shut down** — disarm and tell the daemon to self-terminate |

Once armed, the `ctx-watch` daemon watches context occupancy. Each time the session
nears the guardrail (the configured warn %) **and** a fresh handoff doc exists **and**
the turn is idle **and** Ghostty is frontmost, it types `/compact`, then a continuation
prompt — so the work carries across resets hands-free. It pauses after **N** cycles,
on `/autorun stop`, or when the task is marked done.

## Quick start

Read the argument and shell out to the one control plane:

```bash
# arm (bare or a number N)
node "/Users/yosefhayimsabag/Desktop/Code/dufflebag/.claude/dufflebag/hooks/ctxLoopCtl.js" arm "$N"
# pause
node "/Users/yosefhayimsabag/Desktop/Code/dufflebag/.claude/dufflebag/hooks/ctxLoopCtl.js" stop
# shut the daemon down
node "/Users/yosefhayimsabag/Desktop/Code/dufflebag/.claude/dufflebag/hooks/ctxLoopCtl.js" exit
```

- If the argument is a number (e.g. `/autorun 5`), run `arm 5`. Bare `/autorun` → `arm`
  with no number (uses the configured default).
- If the argument is `stop` → run `stop`. If it is `exit` → run `exit`.

Then relay the script's confirmation/report to the user **verbatim** (the report shows
the cycle paused/exited at, budget, session tokens in/out, wall-time, live 5h + weekly
usage, and the last auto-halt reason if any).

## Your responsibility while armed

The daemon only presses keys — **you** make each compact safe and productive:

- As you approach the guardrail, **run `/handoff`** to save a resume doc *before* the
  daemon compacts. No fresh handoff → it waits and never compacts (by design).
- When the task is **genuinely, fully complete** — nothing left to do — create the
  done-marker the daemon halts on (the context-guard message tells you the exact path,
  `~/.claude/.ctx-loop-state/<session-id>.done`) **instead of** another handoff, then
  stop. Do **not** invent busy-work to keep the loop alive.

## Notes

- **Requires macOS + Ghostty.** The daemon types only into THIS session's Ghostty window
  (located by title, idle state only), only when Ghostty is frontmost and the turn is
  idle; a global keystroke mutex serializes injection; a hard cycle cap applies
  regardless of N; global kill switch `touch ~/.claude/.ctx-guard-off`.
- `/autorun stop` is a **pause** (re-armable); `/autorun exit` shuts the daemon down for
  this session — re-enabling then needs a fresh `/autorun`, which re-spawns it.
- Tune the warn %, budget, and hard cap with `dufflebag config`.


---

## png-to-code

# PNG → Pixel-Perfect Code

Reproduce a PNG (illustration, logo, UI screen, or full mockup) as code that matches the original **1:1**. Go slowly: build one region at a time and **re-measure after every change**. The agent reaches pixel-perfect the same way a designer did with a PerfectPixel overlay — except the overlay is a **measured pixel diff**, not a human eye.

## Ground rule

**The diff score is the source of truth.** Never call something "done" or "1:1" from looking at it. Render it, screenshot it, diff it against the target PNG with `scripts/src/bin/pixelDiff.ts`, and drive the mismatch ratio toward zero. If you cannot measure it, say so plainly. Use a second agent or browser model as a **visual judge** for detailed feedback on what to change, but never let that replace the measured score.

## The loop

Step 0 runs once at the start; repeat steps 4–6 until converged.

0. **Intake — align on intent before measuring.** A PNG is one frozen frame; what the user wants in *motion* and *fidelity* is not in the pixels, so ask (a short `AskUserQuestion` is ideal). Cover: static reproduction or animated? if animated, which parts move and how big a gesture (subtle idle vs hero wave)? strict 1:1, or "inspired-by / make it prettier"? reduced-motion fallback? And **proactively suggest the life a static PNG cannot depict** — most often a living/animated background (drifting aurora, floating blobs) — and confirm the vibe before building. Never infer animation scope from a still. → `reference/decompose.md` (§0)
1. **Frame** — read target dimensions with `scripts/src/bin/inspectPng.ts`. The render viewport is the target's pixel size.
2. **Decompose** — split the image into ordered regions; mark each *raster* (export/slice) vs *reproducible in code* (CSS/SVG). Extract exact specs (color, type, spacing). **If anything will animate, plan the rig now** — decompose into the skeleton of named, joint-pivoted, parented parts before acquiring geometry. → `reference/decompose.md`, `reference/rigging.md`
3. **Reuse or build** — search existing SVG libraries first and customize; trace or hand-build only the gap. For animated parts, build to rig (**reuse > hand-build > per-part masked trace > never one flat trace**). → `reference/svg-illustration.md`, `reference/rigging.md`
4. **Build one region** — structural/largest first. Match the target repo's stack; if none, vanilla HTML/CSS/SVG. Order within a region: layout → typography → color → effects.
5. **Measure + judge** — run the diff. Read the ratio and the **hotspot grid** (where the biggest differences are). When the diff stalls or the mismatch is easier to describe visually than numerically, ask a separate visual judge to compare target/current/diff and return concrete deltas. → `reference/verification.md`
6. **Refine** — fix the single biggest hotspot or judge-identified delta, re-run, and ask again only after measuring. One change per iteration so each diff is attributable. Continue until `ratio < 0.1%`, the judge finds no meaningful visual delta, or the developer approves the match — then report the final number.
7. **Optimize + animate last** — SVGO the vectors (`scripts/svgo.config.mjs`); add animation only after the static match holds and (for figures) the rig passes its crux test. → `reference/animation.md`

## Stack detection (step 4)

Detect before writing code, in order: (1) the target repo's framework/styling (`package.json`, existing components, Tailwind / CSS modules / styled-components) → match it; (2) no repo or greenfield → framework-agnostic **vanilla HTML + CSS + inline SVG**. Add a library (GSAP, Lottie, anime.js) only for a concrete need (complex morph, After-Effects export) and note why near the import.

## Reuse before building (step 3)

Always check for an existing vector before tracing: SVGRepo, unDraw, Heroicons, Feather, Phosphor, Lucide, Iconify, Noun Project. Recolor/resize to match. Trace (potrace / AutoTrace / Inkscape) only what you cannot find, then simplify nodes. Details + sources in `reference/svg-illustration.md`.

## First-time setup (verification harness)

The diff loop needs Node. From the skill's `scripts/`:

```
npm install
npx playwright install chromium
```

Then, per iteration (from `scripts/`):

```
npx tsx src/bin/pixelDiff.ts --target design.png --input build/index.html
```

Or: `npm run diff -- --target design.png --input build/index.html`

Optional visual judge loop:

```
bridge ask "Compare design.png, current.png, and diff.png. List the exact visual changes needed next; do not rewrite code." --provider chatgpt --attach design.png current.png diff.png --json
```

Use `bridge --help` / `bridge ask --help` for the installed syntax. If bridge is unavailable, compare the images yourself and say the judge step was skipped. `current.png` can be a browser screenshot of the rendered build at the target dimensions.

If Node/Playwright is unavailable, use the manual overlay method in `reference/verification.md` and state the match is eyeballed, not measured.

## Convergence checklist

- [ ] Confirmed intent first (static vs animated, fidelity bar, optional living enhancements) — not inferred from the still
- [ ] Viewport set to the target's exact pixel dimensions
- [ ] Fonts loaded and animations frozen before each screenshot
- [ ] Fixed the biggest hotspot, not random tweaks
- [ ] One change per measured iteration
- [ ] When using a judge, fed it target/current/diff and turned only one concrete delta into the next edit
- [ ] Reported the final mismatch ratio honestly (no unmeasured 1:1 claims)

## Files

- `reference/decompose.md` — read the design, raster-vs-code triage, spec extraction, rig planning
- `reference/svg-illustration.md` — reuse sources, tracing, hand-building, SVGO
- `reference/rigging.md` — structure a figure to animate: slice at joints, pivot at joint, parent, overlap (do this at build time)
- `reference/animation.md` — motion that reads as alive: easing, act-then-hold, timing cheat-sheet, reduced motion, line-draw recipe
- `reference/verification.md` — the diff loop, thresholds, scale, manual fallback
- `scripts/src/bin/pixelDiff.ts` — render (Playwright) + pixel diff (pixelmatch) → ratio + hotspots
- `scripts/src/bin/inspectPng.ts` — target dimensions + color sampling / palette
- `scripts/src/bin/frames.ts` — contact sheet of animation frames by timeline-seeking (verify motion poses)
- `scripts/svgo.config.mjs` — safe SVGO config (keeps viewBox + IDs)
- `scripts/robot.svgo.config.mjs` — conservative SVGO for animated SVGs
- `README.md` — setup, script catalog, and canonical iteration example
- `CONTEXT.md` / `TECH-GLOSSARY.md` — domain vocabulary and technical glossary


---

## github-repo-metadata

# GitHub Repo Metadata

Create concise GitHub repository metadata that helps visitors understand what
the project is, who it is for, and how to find related projects.

## Sources

Use these official sources when explaining or defending recommendations:

- GitHub profile/resume guide: repository details should include a brief
  project description, a website/demo link, and topic tags.
  <https://docs.github.com/en/account-and-profile/tutorials/using-your-github-profile-to-enhance-your-resume>
- GitHub README docs: the README owns the deeper explanation: what the project
  does, why it is useful, how users get started, where users get help, and who
  maintains it.
  <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes>
- GitHub repository best practices: create a README for every repository.
  <https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories>
- GitHub topics docs: topics classify a repository by purpose, subject area,
  community, or language; use lowercase letters, numbers, and hyphens; keep each
  topic at 50 characters or less; add no more than 20 topics.
  <https://docs.github.com/articles/classifying-your-repository-with-topics>
- Open Source Guides: document status honestly, and update or mark stale docs.
  <https://opensource.guide/starting-a-project/>
  <https://opensource.guide/best-practices/>

## Workflow

1. Inspect before writing. Read the README, package metadata, primary source
   entry points, docs, and current GitHub metadata when available.
2. Draft one short description using this shape:

   ```text
   [Project type] for [specific user/use case] with [main capability or differentiator].
   ```

3. Draft topics, treating "tags" as GitHub topics. Prefer 6-12 high-signal
   topics over a full 20. Include purpose, domain, language/framework, runtime,
   and agent/tool ecosystem only when they are real signals.
4. Add a homepage/demo/docs URL only if it exists and helps someone inspect or
   use the project.
5. Show before/after before applying changes unless the user explicitly asked to
   apply immediately.

## Description Rules

- Specific beats generic: name the project type and job.
- Keep it one line; the README carries setup, architecture, and long context.
- Do not hype: avoid "awesome", "powerful", "best", "simple" unless the repo
  proves the claim.
- Do not overclaim production readiness. Put experimental, archived, internal,
  or not-production-ready status in the README.
- Match the repository contents. If the code and README disagree, say so and ask
  before publishing metadata.

## Topic Rules

- Use lowercase letters, numbers, and hyphens.
- Keep topics at 50 characters or less.
- Use no more than 20 topics.
- Avoid duplicates, vague tags, and private/internal terms that will not help
  discovery.
- Remember topic names are public, including on private repositories.

## Before/After Format

```md
Description
Before: My app
After: React Native app for tracking Olympic lifting workouts with offline history and progress charts.
Why: Names the app type, audience/use case, and differentiator in one line.

Topics
Before: app, react, project
After: react-native, expo, workout-tracker, olympic-weightlifting, offline-first, fitness
Why: Replaces vague tags with GitHub topics that describe purpose, stack, domain, and differentiator.
```

## Apply Changes

When the user asks to apply the metadata and GitHub CLI is available:

```bash
gh repo view --json description,homepageUrl,repositoryTopics,url
gh repo edit --description "TypeScript CLI for auditing GitHub repositories and generating maintenance reports." \
  --homepage "https://example.com/docs" \
  --add-topic typescript \
  --add-topic github \
  --add-topic repository-metadata
```

Use `--remove-topic <topic>` for stale topics. Do not change repository
visibility or merge settings while doing metadata work.

<!-- dufflebag:skills end -->
