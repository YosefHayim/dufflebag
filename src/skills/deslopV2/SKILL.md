---
name: deslop-v2
description: Reviews code and repo structure for over-engineering and tool-ceremony, then removes the excess so the code does exactly what it needs and no more. Companion to deslop (readable) — this skill makes it lean. Use when the user says plain "deslop", "full deslop", "0 AI slop", "100% desloped", "make it lean", "ai slop", "deslop-v2", "over-engineered", "too much abstraction", "over-abstracted", "simplify this", "flatten this", "kill ceremony", "tool slop", "delete noisy scripts", ban generic names (payload/result/data/raw/isRecord/resolve*), avoid `??`/nested ternaries, delete stale/single-use files, or cut needless wrappers/layers/folders/typegen/scripts that only shell wrangler/biome/drizzle. After a grill locks CODE-STYLE ## Never, apply this; if they want style docs from scratch first, prefer grill-me-code-style-with-docs.
---

# Deslop v2 — kill over-engineering

Make code and structure do exactly what the job needs — no more. Where `deslop` makes the pipeline *readable* (naming, ordering, splitting for clarity), `deslop-v2` makes it *lean*: it deletes abstractions, layers, folders, packages, **and tool-ceremony** that carry their weight in process instead of product. The two are complementary — run `deslop` for comprehension, `deslop-v2` for over-engineering. When both apply, deslop-v2 removes the excess first, then deslop names what remains.

**Pairing with the grill:** `grill-me-code-style` / `grill-me-code-style-with-docs` **detect** these families (mandatory scan + Round 7) and lock kills into `CODE-STYLE.md` `## Never`. This skill **applies** the kill list (delete wrappers, typegen theater, orphan generated files). Prefer running after a grill when the repo has no `## Never` yet; when the guide exists, enforce it first.

Default mode is **review-first**: show the current shape, the excess, and concrete before/after examples before changing files. Do not apply edits until the user approves, unless the user says to apply immediately.

## The one test

> An abstraction — a wrapper, a layer, a helper, a folder, a package — **earns its place only if it has a second real caller or names a genuine domain concept.** Otherwise inline it or flatten it.

## The tool-first test (ceremony)

> If the framework, SDK, package manager, or cloud CLI **already does the job**, do not write a house script, typegen, wrapper, or parallel type system. Call the tool. Custom code earns a place only when it adds **product-specific glue** the tool cannot express. When a custom script dies, its **generated-only artifacts die with it**.

Everything below is those tests applied to a specific shape. More code, more indirection, and more nesting are costs; they must buy something real.

## Style source (read first)

Before proposing anything, read the repo's own guide if present: `CODE-STYLE.md` (the SSOT) and the `## Conventions` digest in `AGENTS.md`. Their `## Never` / anti-pattern lists are the **authoritative** over-engineering targets for this repo — call those out first. You **enforce** the guide, you never edit it; if a rule is itself over-engineered, flag it and point the user to `grill-me-code-style-with-docs`. If neither file exists, use the three axes below.

## Three axes of over-engineering

Walk all three (scale to the target — full-repo ceremony scan when the user asks to kill noise / scripts / typegen).

1. **Line-level smells** — indirection, fake robustness, control-flow contortion, shape noise, and dead space *inside* the code. Full catalog: [references/line-smells.md](references/line-smells.md).
2. **Structural smells** — folders, files, layers, and packages that out-number the code they hold. Full catalog: [references/structure-smells.md](references/structure-smells.md).
3. **Ceremony & tool-slop** — house wrappers around official CLIs, typegen/drift theater, wrong tool for the type job, scripts outside product lifecycle folders, orphan generated files, parallel vendor schemas, scattered `console.*`. Full catalog: [references/ceremony-smells.md](references/ceremony-smells.md).

The five line families:

- **Needless indirection** — pass-through wrappers, one-line helpers, identity functions, single-implementation interfaces.
- **Fake robustness** — swallowed errors, hand-rolled type guards, scattered `??` fallbacks, deep optional chaining, speculative unused knobs (YAGNI).
- **Control-flow contortion** — nested ternaries, conditions that restate themselves (`=== true`, `? true : false`), boolean flag params, redundant `async`/Promise wrapping.
- **Shape noise** — pointless from→to remaps, grab-bag object returns, intermediate `data`/`result`/`temp` variable soup.
- **Dead space** — narration comments that restate code, and function bodies with no breathing room (or several jobs crammed into one).

The structural families (S1–S7): deep nesting for few files, one-export-per-file explosion, layer-first folders for a tiny app, single-implementation interface folders, `utils/helpers/common/misc` dumping grounds, package/module-itis, and the opposite extreme — the **god-file** that should split.

The ceremony families (C1–C8): tool-wrapper scripts, house typegen/drift theater, wrong tool for the type job (e.g. wrangler for row types vs ORM infer), scripts dump outside `scripts/{dev,production}`, orphan generated artifacts, parallel type/schema systems, `console.*` scatter, micro-files/generic locals as folder noise.

## Review first

1. Identify the target from the user's paths, `git diff`, recent edits, or the nearest entrypoint. For "kill ceremony / noisy scripts", tree `scripts/`, `src/scripts/`, `package.json` scripts, and `*.generated.*` first.
2. Read the files (and `ls`/tree the relevant folders — structure is in scope).
3. Map what the code actually does vs. how many layers it takes to do it. For each script/typegen hit, name the **official tool that replaces it**.
4. Flag every hit against the three axes, `CODE-STYLE.md` `## Never` items first.
5. Show a **kill list** (path → replace with / delete orphans) plus 2–4 before/after examples.
6. State the risk (public API, imports, tests, CI that invokes the dead script) and ask for approval.

## Apply after approval

1. Edit only the approved scope; preserve behavior unless a behavior change was approved.
2. Prefer the **smallest deletion** that removes the excess — inline the wrapper, flatten the folder, collapse the ternary, **delete the tool-wrapper and point package.json at the CLI**, delete orphan generated files with the script.
3. Before removing a shared export or moving a folder, map its usages (and CI / `pnpm` script references).
4. Run the repo's typecheck / test / lint gate.
5. Summarize what was removed and why it was safe.

## Stop conditions

Stop and ask before editing when:

- removing an abstraction crosses a public API or package boundary
- the "excess" is a real extension point with a second caller on the way (ask)
- flattening structure would collide with a framework's required layout
- a script still injects product secrets/env that the bare CLI cannot load (keep a **thin** env→tool file under `scripts/production/`, do not keep a fat orchestrator)
- tests are missing and the change is broad
- the code is already lean — say so and stop
