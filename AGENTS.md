# AGENTS.md

Entrypoint for coding agents and maintainers. `CLAUDE.md` and `GEMINI.md` are symlinks to this file so Claude, Gemini, Codex, Cursor, Kiro, and other AGENTS-aware tools share one contract.

## What this is

**dufflebag** is a TypeScript CLI that installs, updates, uninstalls, diagnoses, configures, and scaffolds an owned set of agent skills, dependency-free hooks, agent configuration, and reusable CI/publish workflow templates.

```bash
npx ys-dufflebag install --features png-to-code
```

## Source-of-truth map

Read these before changing code. This file is a routing digest — open the linked SSOT for details.

| Doc | Role |
| --- | --- |
| [`PROJECT.md`](PROJECT.md) | Product scope and direction |
| [`CONTEXT.md`](CONTEXT.md) | Runtime and operational boundaries |
| [`LANGUAGE.md`](LANGUAGE.md) | Domain terms |
| [`CODE-STYLE.md`](CODE-STYLE.md) | Prescriptive style SSOT for this repo |
| [`code-style.rules.json`](code-style.rules.json) | Rule id → enforcement channel |
| `docs/adr/current/` | Architectural decisions (do not rewrite historical bodies) |
| `src/skills/<sourceDirectory>/` | Authored feature docs and feature-local runtime |

Public feature and installed-skill IDs are decoded catalog data and can differ from the authored camelCase directory name.

**Style layers:** workspace philosophy at `~/Desktop/Code/code-style.md` (Uncle Bob distillation) → this repo’s [`CODE-STYLE.md`](CODE-STYLE.md) **wins on mechanism**. Philosophy still binds on intent (small functions, honest names, dependency direction, tests as courage). Do not restate style rules here.

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
| `scripts/` | Outer-ring tooling only: package build (`assembleHooks`, `generateReadme`), style contract (`checkCodeStyle`), never imported by `src/` |
| `templates/` | Files intentionally copied into another repository |
| `docs/adr/current/` | Current architectural decisions |
| `.husky/pre-commit` | README regeneration before commits |

Capability layout is current ([ADR 0016](docs/adr/current/0016-capability-layout-replaces-core.md)). Do not reintroduce `src/core/`, `src/commands/`, or `src/payload/`.

## Working contract

Hard rules agents must hold every turn. Full prescription: [`CODE-STYLE.md`](CODE-STYLE.md) and `docs/adr/current/`.

- **Verify gate** — `pnpm verify` = `biome ci` + typecheck + test + build. Biome is linter and formatter (double quotes). One root `tsconfig`; the png harness under `src/skills/pngToCode/scripts/` is the single sanctioned exception.
- **Effect / Schema** — capabilities return Effect; only `src/cli/main.ts` starts the runtime. Runtime, persisted, catalog, CLI, and agent-format data begin as Effect Schema. Application failures use `Schema.TaggedError`. No hand-rolled `isX` / `parseX` pairs for literals and numbers.
- **Hook island** — installed hooks stay dependency-free plain Node (`node:*`, `src/runtime/**`, own feature runtime only), **fail-open**. Application code never imports installed hook code.
- **Ownership** — inspect → plan → validate → apply → write receipt last. A receipt is the only deletion authority. Catalog-closed shipping: the feature catalog owns exact shipped paths.
- **Shape** — capability-owned paths; camelCase authored directories; PascalCase UI files; kebab-case public IDs/flags. One command path; `TerminalUI` owns presentation; non-TTY never prompts.
- **Local tooling** — gitignored `scripts/dev/` for personal/one-off scripts. All maintained build/verify tools live under root `scripts/` (not under `src/`).
- **README** — pre-commit may regenerate and stage `README.md`; inspect the index after committing.

## Validate changes

Run the narrow suite for the changed capability, then the repository gate:

```bash
pnpm test
pnpm typecheck
pnpm verify
```

For png-to-code script changes:

```bash
pnpm --dir src/skills/pngToCode/scripts typecheck
```

## Agent engineering config

| Topic | Doc |
| --- | --- |
| Issue tracker | [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) (GitHub `YosefHayim/dufflebag`) |
| Triage labels | [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md) |
| Domain docs | [`docs/agents/domain.md`](docs/agents/domain.md) — e.g. png-to-code: `src/skills/png-to-code/CONTEXT.md` |

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
