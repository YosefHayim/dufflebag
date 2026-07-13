---
name: grill-me-code-style-review
description: >
  Review a large changeset (a branch, working tree, or PR — tens to hundreds of files) against a
  repo's code-style.rules.json so the user can trust it WITHOUT reading every diff, and LEARN the
  architecture from a short teaching report instead. Runs Biome (+ its grit plugins) to auto-fix the
  mechanical/structural channels across all files, then fans out sub-agents over the diff to check
  only the judgment-channel rules + the user's original intent, and returns a deviations-only report
  that opens with a layer/flow map of what changed and teaches the "why" behind each finding. Use
  when reviewing/auditing a big diff, a PR, or an AI-generated changeset, or the user says "review
  this", "can I trust this diff", "audit these changes". To coach while building, use
  grill-me-code-style-coach; to create the ruleset, grill-me-code-style.
---

<what-to-do>

I changed a lot of files and I want to **trust the batch without reading every diff** — and come
out **understanding what changed**, not alienated from my own code. So collapse the diff into a
short, teaching report: let the machine carry the mechanical load, and spend judgment (and my
attention) only where a machine can't.

**Read first:** the repo's `code-style.rules.json` (channels + exemplars), `CODE-STYLE.md`,
`PROJECT.md`/`CONTEXT.md`, and **my original prompt/intent** (ask me for it if you don't have it —
Tier 3 checks the diff *did what I asked* and flags scope creep). No ruleset? Offer
`grill-me-code-style(-with-docs)` first.

**Scope the diff** (ask if unclear): `git diff <base>...HEAD` (branch/PR), the uncommitted working
tree, or a named PR. That file list is the review surface.

</what-to-do>

<supporting-info>

## The three tiers — cheapest enforcement first

Walk **every** rule in the ruleset by its `channel`. Most never reach me:

1. **Tier 1+2 — deterministic, whole-tree, auto-fix (all Biome channels).**
   Run the repo's gate: `biome ci .` / `lint:fix`, then `verify` (biome + tsc + tests + build).
   The `biome-builtin`, `biome-builtin-scoped`, `biome-restricted-import`, and `biome-grit-plugin`
   rules **all** run here — across all files at once. **Auto-fix everything safe**, re-run to green.
   I read **nothing** for this tier. Never weaken a rule/test to go green — fix the code.
2. **Tier 3 — judgment, fanned out over the diff.** For the `judgment`-channel rules (taste,
   architecture, placement) + **my intent**, split the changed files into slices and dispatch
   read-only sub-agents (see below). Each returns **only deviations** — never a file dump.

## Fan-out (Tier 3)

Group the changed files into coherent slices (by layer/feature/directory). For each slice, launch a
`subagent_explore` with: the slice's file list, `code-style.rules.json` (the `judgment` rules +
exemplars), the relevant `CONTEXT.md` terms, and **my original prompt**. Ask each to report, per
finding: `file:line` · which rule/intent it breaks · the one-line fix · the exemplar it should
mirror. Tell them explicitly: **report deviations only; stay silent on conforming code.** Aggregate,
dedupe, and rank (intent-misses and architectural breaks first, nits last).

## The report — teaching, deviations-only

Open with **orientation, then findings**:

- **Layer/flow map** — an ASCII map (via `ascii-architecture-flow-mapper`) of the layers/modules the
  diff touched and **how the change blended in** (new module → which layer, who calls it). This is
  the lesson: I see the shape of what changed, not 300 diffs.
- **Intent check** — one line: did the diff do what I asked? Any scope creep?
- **Findings** — each: `file:line`, the rule/intent broken, **why it matters** (the rationale /
  ADR / the pattern it protects — this is how I learn), the fix, and the exemplar to imitate.
  Clean slices get a one-line "✓ conforms" — never a diff dump.
- **Verdict** — `verify` state + counts per tier. Auto-fixed (Tier 1+2) items are summarized, not
  itemized.

**Friction:** auto-fix everything the Biome tiers own; for each **judgment** finding, don't silently
rewrite architecture — surface it and **make me decide** (keep / fix / accept). That decision is
where I learn. Render the report as an interactive **planpage** (`before-after` / `plan-brief`) when
I want to approve/reject findings in the browser; otherwise ASCII inline.

## Never

- Never claim the batch is clean from reading alone — Tier 1+2 must be green (run it).
- Never weaken a Biome rule, edit the config, or skip/loosen a test to reach green — fix the code.
- Never dump conforming diffs — the report is deviations + the teaching map only.
- Never rewrite a `judgment`-level architectural choice without my decision.
- Never review a `judgment` rule from memory — read it (and its exemplar) from the ruleset.

</supporting-info>
