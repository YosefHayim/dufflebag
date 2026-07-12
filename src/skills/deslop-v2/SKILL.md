---
name: deslop-v2
description: Reviews code and repo structure for over-engineering, then removes the excess so the code does exactly what it needs and no more. The over-engineering companion to deslop (deslop makes code readable; deslop-v2 makes it lean). Use when the user says "deslop-v2", "over-engineered", "too much abstraction", "over-abstracted", "simplify this", "why is this so complicated", "flatten this", "too many wrappers/layers/folders", "this feels like too much", or asks to cut needless indirection, `??` fallbacks, nested ternaries, pass-through wrappers, single-use helpers, grab-bag returns, or deep folder/package nesting.
---

# Deslop v2 — kill over-engineering

Make code and structure do exactly what the job needs — no more. Where `deslop` makes the pipeline *readable* (naming, ordering, splitting for clarity), `deslop-v2` makes it *lean*: it deletes abstractions, layers, folders, and packages that carry their weight in ceremony instead of meaning. The two are complementary — run `deslop` for comprehension, `deslop-v2` for over-engineering. When both apply, deslop-v2 removes the excess first, then deslop names what remains.

Default mode is **review-first**: show the current shape, the excess, and concrete before/after examples before changing files. Do not apply edits until the user approves, unless the user says to apply immediately.

## The one test

> An abstraction — a wrapper, a layer, a helper, a folder, a package — **earns its place only if it has a second real caller or names a genuine domain concept.** Otherwise inline it or flatten it.

Everything below is that test applied to a specific shape. More code, more indirection, and more nesting are costs; they must buy something real.

## Style source (read first)

Before proposing anything, read the repo's own guide if present: `CODE-STYLE.md` (the SSOT) and the `## Conventions` digest in `AGENTS.md`. Their `## Never` / anti-pattern lists are the **authoritative** over-engineering targets for this repo — call those out first. You **enforce** the guide, you never edit it; if a rule is itself over-engineered, flag it and point the user to `grill-me-code-style-with-docs`. If neither file exists, use the two axes below.

## Two axes of over-engineering

Over-engineering shows up at two scales. Walk both.

1. **Line-level smells** — indirection, fake robustness, control-flow contortion, shape noise, and dead space *inside* the code. Full catalog with plain + Effect before/after: [references/line-smells.md](references/line-smells.md).
2. **Structural smells** — folders, files, layers, and packages that out-number the code they hold. Full catalog with tree before/after: [references/structure-smells.md](references/structure-smells.md).

The five line families:

- **Needless indirection** — pass-through wrappers, one-line helpers, identity functions, single-implementation interfaces.
- **Fake robustness** — swallowed errors, hand-rolled type guards, scattered `??` fallbacks, deep optional chaining, speculative unused knobs (YAGNI).
- **Control-flow contortion** — nested ternaries, conditions that restate themselves (`=== true`, `? true : false`), boolean flag params, redundant `async`/Promise wrapping.
- **Shape noise** — pointless from→to remaps, grab-bag object returns, intermediate `data`/`result`/`temp` variable soup.
- **Dead space** — narration comments that restate code, and function bodies with no breathing room (or several jobs crammed into one).

The structural families (S1–S7): deep nesting for few files, one-export-per-file explosion, layer-first folders for a tiny app, single-implementation interface folders, `utils/helpers/common/misc` dumping grounds, package/module-itis, and the opposite extreme — the **god-file** that should split.

## Review first

1. Identify the target from the user's paths, `git diff`, recent edits, or the nearest entrypoint.
2. Read the files (and `ls`/tree the relevant folders — structure is in scope).
3. Map what the code actually does vs. how many layers it takes to do it.
4. Flag every hit against the two axes, `CODE-STYLE.md` `## Never` items first.
5. Show 2–4 before/after examples in the proposed leaner style.
6. State the risk (public API, imports, tests) and ask for approval.

## Apply after approval

1. Edit only the approved scope; preserve behavior unless a behavior change was approved.
2. Prefer the **smallest deletion** that removes the excess — inline the wrapper, flatten the folder, collapse the ternary.
3. Before removing a shared export or moving a folder, map its usages.
4. Run the repo's typecheck / test / lint gate.
5. Summarize what was removed and why it was safe.

## Stop conditions

Stop and ask before editing when:

- removing an abstraction crosses a public API or package boundary
- the "excess" is a real extension point with a second caller on the way (ask)
- flattening structure would collide with a framework's required layout
- tests are missing and the change is broad
- the code is already lean — say so and stop
