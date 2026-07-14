# AGENTS.md

This is the repository entrypoint for coding agents and maintainers. `CLAUDE.md` and `GEMINI.md` are symlinks to this file.

## What this is

**dufflebag** installs and reconciles an owned set of agent skills, dependency-free hooks, agent configuration, and reusable CI/publish workflow templates. Its public CLI installs, updates, uninstalls, diagnoses, configures, and scaffolds those artifacts.

Install one feature with:

```bash
npx ys-dufflebag install --features png-to-code
```

## Read before changing code

- [`PROJECT.md`](PROJECT.md) defines product scope and direction.
- [`CONTEXT.md`](CONTEXT.md) explains runtime and operational boundaries.
- [`LANGUAGE.md`](LANGUAGE.md) owns domain terms.
- [`CODE-STYLE.md`](CODE-STYLE.md) is the prescriptive style source of truth.
- [`code-style.rules.json`](code-style.rules.json) is the machine-readable rule map.
- `docs/adr/current/` records architectural decisions; do not rewrite historical bodies.

Feature documentation lives with its authored source under `src/skills/<sourceDirectory>/`. Public feature and installed-skill IDs are decoded data and can differ from the authored directory name.

## Repo layout

| Path | Ownership |
| --- | --- |
| `src/cli/` | Effect CLI definitions, command capabilities, and `TerminalUI` presentation |
| `src/catalog/` | Decoded feature and agent catalogs |
| `src/config/` | Schema-owned managed configuration and migration |
| `src/install/` | Artifact planning, transactional application, receipts, and agent formats |
| `src/runtime/` | Dependency-free transport shared by installed hooks |
| `src/skills/<sourceDirectory>/` | Authored skill content and feature-local dependency-free runtime |
| `src/doctor.ts` | Structured installation diagnostics |
| `src/scaffoldWorkflows.ts` | Workflow-template scaffolding capability |
| `scripts/` | Repository build, generation, contract, shipping, and smoke tooling |
| `templates/` | Files intentionally copied into another repository |
| `docs/adr/current/` | Current architectural decisions |
| `.husky/pre-commit` | README regeneration before commits |

This layout is the approved destination. During the migration, legacy technical-layer directories and hyphenated authored directories may still exist; do not add new behavior there when the owning migration task has a target capability.

## Working contract

This is a routing digest. [`CODE-STYLE.md`](CODE-STYLE.md) is authoritative and every enforceable rule maps to [`code-style.rules.json`](code-style.rules.json). Architectural reasons belong in `docs/adr/current/`.

- **One strict style bar for all TypeScript** — `src/` *and* the png harness (`src/skills/png-to-code/scripts/`). **biome is the linter (`recommended`) *and* formatter** (double quotes), committed as `biome.json` with `biome ci` the one CI gate. One root `tsconfig` governs the project; the png harness's own `tsconfig` is the single sanctioned exception ([ADR 0013](docs/adr/current/0013-style-refresh-colocated-tests-single-command-autorun-templates.md)).
- **Effect application** — capabilities return Effect values. Only `src/cli/main.ts` starts the runtime. Use official platform services directly; do not add pass-through tags, layers, managers, helpers, or utility wrappers.
- **Schema-owned data** — runtime, persisted, catalog, CLI, environment, and agent-format objects begin as Effect Schema. Derive types with `Schema.Schema.Type`; keep descriptions, defaults, checks, messages, and legacy transformations on their properties.
- **Tagged errors** — application failures use `Schema.TaggedError`. Installed hooks remain dependency-free plain Node and keep their explicit fail-open behavior where the event contract requires it.
- **One command path** — interactive and explicit commands invoke the same capability. `TerminalUI` owns presentation. A non-TTY process never prompts and missing input becomes a structured usage error.
- **Dependency-free hook island** — hook graphs import only `node:*`, shared `src/runtime/**`, and their own feature runtime subtree. Application code never imports installed hook code.
- **Functions** — named functions are arrow constants declared before use. Prefer one cohesive input, allow two only as a natural pair, and use a named request for three or more. Do not add ceremonial one-property requests or positional boolean behavior flags.
- **Readable bodies** — one visible job per function, no input mutation, no builder `reduce`, no `Promise.all`, and at most two control-flow nesting levels. Keep one blank line between functions.
- **Comments with evidence** — explicit loops have a short intent comment; indexed non-null access has a proof comment; real ordered pipelines have one contract plus numbered phase comments.
- **Names and exports** — authored paths use `camelCase`, UI files use `PascalCase`, and public IDs/flags remain hyphenated data. Optional barrels contain only direct wildcard exports. Avoid vague manager/helper/utils/data/info buckets and names.
- **No type escape hatches** — no authored interfaces outside declaration augmentation, enums, conditional/infer machinery, assertions, or suppression directives.
- **Tests co-locate** — keep `foo.test.ts` beside `foo.ts`; root repository-tool tests live under `scripts/`. Use behavior-level fixtures and integration tests for transaction, migration, shipping, and CLI boundaries.
- **Transactional writes** — inspect, plan, validate, apply, then write the receipt last. Roll back in reverse order. A receipt is the only deletion authority; detection may inform migration but never authorize deletion.
- **Catalog-closed shipping** — the decoded feature catalog owns exact shipped paths and runtime entrypoints. Build and packed-tarball verification reject missing, duplicate, extra, rewritten, or uncataloged content.
- **README regeneration** — the pre-commit hook regenerates README content. After committing, inspect the index and commit scope because the hook may stage `README.md`.

> **Migration in progress.** The root style contract describes the approved destination. Keep changed code moving toward it, but do not hide legacy violations behind a broad allowlist or mix unrelated migration work into a focused slice.

### `scripts/dev/` — local-only tooling (gitignored)

Scripts for local debugging, one-off experiments, or personal dev utilities go in `scripts/dev/`. This folder is gitignored. Maintained production, build, CI, and verification tools live directly under root `scripts/`.

When creating a new script, ask: _"Would CI, the build, or the shipped CLI need this?"_ If **no** → `scripts/dev/`.

## Validate changes

Run the narrow suite for the changed capability, then the repository gate from the root:

```bash
pnpm test
pnpm typecheck
pnpm verify
```

For png-to-code script changes:

```bash
pnpm --dir src/skills/png-to-code/scripts typecheck
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
