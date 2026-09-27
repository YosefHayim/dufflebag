---
name: code-style-review
description: Use when you want to check a big change (a branch, a PR, or AI-written code) against the project style rules without reading every file. It fixes simple problems, checks the rest with helper agents, and lists only the real problems. Say "review this" or "can I trust this diff". To learn while you build, use code-style-teach-me.
---

<what-to-do>

I changed a lot of files and I want to **trust the batch without reading every diff** — and come
out **understanding what changed**, not alienated from my own code. So collapse the diff into a
short, teaching report: let the machine carry the mechanical load, and spend judgment (and my
attention) only where a machine can't.

**Read first:** the repo's rules — `code-style.rules.json` when it exists, otherwise the `[rule:<id>] · verify:` cards in `CODE-STYLE.md` (each rule's `verify` command + exemplars) — plus `CODE-STYLE.md`,
`PROJECT.md`/`CONTEXT.md`, and **my original prompt/intent** (ask me for it if you don't have it —
Tier 3 checks the diff *did what I asked* and flags scope creep). No ruleset? Offer
`code-style-new-project` or `code-style-existing-project` first.

**Scope the diff** (ask if unclear): `git diff <base>...HEAD` (branch/PR), the uncommitted working
tree, or a named PR. That file list is the review surface.

</what-to-do>

<supporting-info>

## The three tiers — cheapest enforcement first

Walk **every** rule in the ruleset by its `verify` command. Most never reach me:

1. **Tier 1+2 — deterministic, whole-tree, auto-fix (every rule with a real `verify` command).**
   Run the repo's gate: `biome ci .` / `lint:fix`, then `verify` (biome + tsc + tests + build), plus
   any repo style script a rule points at (e.g. `pnpm style`). Those rules **all** run here — across
   all files at once. **Auto-fix everything safe**, re-run to green. I read **nothing** for this tier.
   Never weaken a rule/test to go green — fix the code.
2. **Tier 3 — judgment, fanned out over the diff.** For rules whose `verify` is `judgment` (taste,
   architecture, placement) + **my intent**, split the changed files into slices and dispatch
   read-only sub-agents (see below). Each returns **only deviations** — never a file dump.

## Fan-out (Tier 3)

Group the changed files into coherent slices (by layer/feature/directory). For each slice, launch a
`subagent_explore` with: the slice's file list, the repo's rules (`code-style.rules.json` or the
`CODE-STYLE.md` cards — the `judgment` rules + exemplars), the relevant `CONTEXT.md` terms, and **my original prompt**. Ask each to report, per
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
