---
name: grill-me-code-style-with-docs
description: Grill the user on how an EXISTING codebase is built — code style, structure docs, and CLI — using the real code as evidence, then render an HTML plan and, on approval, write/update CODE-STYLE.md + a formatter config and refresh the AGENTS.md digest. Ensures PROJECT.md/CONTEXT.md/LANGUAGE.md exist (create if missing, validate if present), fans out sub-agents for the most-repeated patterns, grills real code idioms + formatting with before/after, audits deps, and references official framework skills. Use when defining/updating style, structure, or CLI conventions for a repo with meaningful code. For a brand-new or empty project, use grill-me-code-style instead.
---

<what-to-do>

Interview me relentlessly about **how this codebase is built** — its code style, its structure docs, and its CLI — until we reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each before continuing.

My **taste is the source of truth**; the existing code is **evidence, not gospel** — much of it may be the slop I want gone. When code and my stated taste conflict, my taste wins and `CODE-STYLE.md` records the DESIRED end-state, not the current one.

**Nothing is written to disk until I approve.** You scan and grill (Steps 1–5) — the code-style grill is a **pick-the-code gallery**: you show me real code variants and I pick what I like, dimension by dimension (Step 3). You render an **interactive HTML plan** as the review gate (Step 6, built with the **planpage** kit — I approve, adjust, or flip any decision right in the browser and it posts back), write the files on approval (Step 7), then run one **structure-review capstone** (Step 8) that can reorganize the tree and open a PR.

</what-to-do>

<supporting-info>

## Step 1 — Ensure the structure docs (create if missing, validate if present)

Read whatever exists first so you grill about CODE, not product. Then **ensure the three structure docs** — gather the missing ones' content, validate the present ones against their role, and **never restructure a doc that already exists** (report drift, don't rewrite it). Defer file writes to Step 7 so the plan can show them.

- **PROJECT.md** — purpose & direction. Missing/thin → gather via `grill-with-docs`' PROJECT.md flow (seven-part checklist in `PROJECT-FORMAT.md`). `grill-with-docs` owns PROJECT.md.
- **CONTEXT.md** — orientation (what it is, actors, shape — NOT a glossary). Model on the Oly-App `CONTEXT.md` convention.
- **LANGUAGE.md** — glossary / human↔agent bridge: **names only** (term → definition + aliases to avoid). Validate an existing one against the code's real vocabulary; model on the Oly-App `LANGUAGE.md` convention.

Record each doc's state — `create` · `validate ✓` · `drift` — for the Step 6 plan.

## Step 2 — Scan the code with sub-agents

Fan out read-only sub-agents to survey the codebase and report the **most-repeated** patterns — dominant reality, not a file dump. See [SCAN.md](SCAN.md) for the fan-out strategy. Bring back a compact "current reality" brief to drive the grill.

## Step 3 — Grill the code as a pick-the-code gallery

The code-style grill runs as **pick-the-code**, not prose. For each dimension I show you real code **variants in the TUI** (`AskUserQuestion` — the code goes in each option's `preview`) and you **pick**; your pick is recorded verbatim. Variant **A** is the repo's actual incumbent (pulled verbatim by the scan, `file:symbol`-cited — you react to *your* code, warts and all); variant **B** is the de-slopped rewrite; an **uncontested** dimension collapses to a single **keep/kill** rather than a fabricated choice.

- **Walk the whole catalog.** Run **[STYLE-CATALOG.md](STYLE-CATALOG.md)** — ~25 dimensions (structure, boundaries, data vs side-effects, errors, naming, types & contracts, control flow, async, the API/IO and UI surfaces, tests, the "add a feature" recipe) in **6 grouped rounds**, with a **checkpoint between rounds** (keep going · go deeper · skip the rest) and whole rounds auto-skipped when they don't apply. Covering every dimension is the point — it's how you're never surprised by what the agent writes.
- **Each pick → a rule.** Chosen variant = the `✓` example on a `CODE-STYLE.md` rule; rejected variant = the `✗ not this` line. Every rule carries an **enforced-vs-taste tag** (`[lint: <rule>]` / `[taste]`).
- **Formatting** — quotes/semis/width/trailing-commas/import-order: grill my preference but land it as a **formatter config** (`biome.json` / `.prettierrc` / eslint), recorded as an ADR — not prose. Reconcile with any config already in the repo. The **machine-catchable slop tells** land here too as **linter rules** (`no-nested-ternary`, complexity/length caps, `no-restricted-syntax` for banned identifiers/shapes) — prevented, not just documented.
- **AI-slop fingerprint (the tells)** — the scan's fingerprint angle brings back the recognizable AI tells **with counts**; grill each **keep or kill**. A high count is *not* a free pass — repeated slop is still slop. Killed tells become the concrete `## Never` list, each with its real `file:symbol` offender and an enforced-vs-taste tag. (`isRecord`-style micro-helpers, defensive over-guards, nested/duplicated ternaries, one-use wrappers, boilerplate clones, generic names.)
- **Golden exemplars** — grill me to name **1–3 real files** that best embody the agreed style ("write new code exactly like these"). They anchor `CODE-STYLE.md`'s Exemplars and give `deslop` a concrete target. If nothing qualifies yet, flag it — that's a finding.
- **Compose the canonical example.** After the rounds, assemble every pick into one **canonical example** — a real feature slice from this repo rewritten in the agreed style — so I see the whole pattern working together, not just atomized picks. It becomes the Step 6 litmus and the `## Canonical example` block of `CODE-STYLE.md`.

## Step 4 — Grill the CLI

Every project earns a **CLI both humans and agents drive**. If the repo already has one, hand the deep audit to the `interactive-cli-reviewer` skill and fold its findings back here; otherwise grill it fresh:

- **Have/need one?** Default yes — a dev+ops surface.
- **Command surface** — verbs/nouns.
- **Dual-mode contract** — a bare invocation in a TTY opens a menu; flags or non-TTY defer and **never hang**; both routes call the **same functions** (the `dufflebag` ADR 0011 "interactive front door" pattern).

Record the command surface as an **ADR**; the conventions become `CODE-STYLE.md` rules + a recipe.

## Step 5 — Audit dependencies

Read the package manifest. Flag unmaintained / unstable / duplicative deps and suggest alternatives. Record any library decision (keep / add / replace) + rationale as an **ADR** (`docs/adr/current/`). `CODE-STYLE.md` documents only how to USE libraries.

## Step 6 — Reference framework practices, then render the plan (the review gate)

Detect the stack and point each framework/library to the official skill that owns its best-practices (`workers-best-practices`, `cloudflare`, `wrangler`, `durable-objects`, `agents-sdk`, the `expo-*` family, `building-native-ui`, `native-data-fetching`, `claude-api`, …). Reference them; never restate their content.

**Litmus first:** the **canonical example** composed in Step 3 (a real feature from this repo rewritten in the target style) is the litmus — show it to me. Seeing the whole style produce actual code catches surprises now, not at PR review; fold my reactions back into the rules before rendering.

Then, **before writing anything**, render the plan through the **planpage** kit as a single self-contained, **interactive** HTML file. Build it from planpage's components, write it to `<tmpdir>/code-style-plan-<timestamp>.html` (resolve `$TMPDIR`; fall back to `/tmp` or `%TEMP%`; nothing lands in the repo), then **serve it for a live decision** on a **safe ephemeral port** (`planpage serve` binds an OS-assigned high port — never 3000 / 5173 / 8000 / 8080 / 8787 / 19006 or other dev-server ports):

```bash
npx planpage serve <tmpdir>/code-style-plan-<ts>.html <tmpdir>/code-style-decision-<ts>.json
```

It opens the browser and blocks until I click **Approve** or **Adjust**. Read the decision JSON — `{ approved, flips, revisit, notes }` — and act on it: `flips` re-open those picks, `revisit` re-grills them, `notes` is free feedback. (No Node / headless / port blocked? `open` the file directly; the page's **Copy decision** button hands me the same JSON to paste back — never a hang.)

Self-contained, CDN-only — no repo assets, no app code:

- **The planpage shell is the page** — it loads Tailwind + Mermaid from CDN, carries the theme, and wires the submit-bar + post-back. Plug content into its components; don't re-derive the HTML.
- **① Doc scaffold** — PROJECT / CONTEXT / LANGUAGE as `section-card`s tagged `create` · `validate ✓` · `drift`.
- **② Code style** — each rule as a **`pick-block`** (✓ chosen / ✗ rejected, flippable, `data-id`) with its enforced-vs-taste tag and `file:symbol`; the chosen **formatter + linter config** as a `code-block`; the **`Never` fingerprint** (banned tells + real offenders); the **Exemplars** (the golden files); and the composed **`## Canonical example`** as a headlined `code-block`.
- **③ CLI** — the command surface + dual-mode routing as a Mermaid `flowchart`.
- **④ Structure (before → after)** — a directory tree and a module graph **scoped to the moved modules**, produced by `ascii-architecture-flow-mapper` (ASCII in `<pre>`; the CLI chart stays Mermaid). Render each half **only when it changed** — else a compact "✓ unchanged" chip. This reflects only incidental moves implied by the style decisions; the deep reorg is the Step 8 capstone.
- Then the **write-list**: every file to be created/edited.
- **Review the exact writes** — below the write-list, inline what will actually land for **CODE-STYLE.md** and **AGENTS.md** (both the `## Conventions` digest and `## Repo layout`), rendered as a **diff when the file exists** (green/red `<pre>` lines) or **full proposed content when new**. Other writes (ADRs, created structure docs) stay summarized in ①/②. Nothing lands sight-unseen.

(The planpage kit owns the shell, components, theme, and post-back — reference it and plug in content; don't reinvent the HTML. For richer diagram patterns, the `improve-codebase-architecture` report remains a good styling reference.)

The interactive plan **is** the ask — I approve or adjust in the browser and it posts back. Write nothing until the decision reads `approved: true`; on adjust, fold in `flips` / `revisit` / `notes` and re-render.

## Step 7 — On approval, write the files

1. Write/update `CODE-STYLE.md` per [CODE-STYLE-FORMAT.md](CODE-STYLE-FORMAT.md): rules (each with **✓ chosen / ✗ rejected** from real files + an enforced-vs-taste tag), recipes (incl. add-a-**CLI-command**), the **Exemplars** (the golden files you named), the **`## Canonical example`** (the composed feature slice from Step 3), the **`Never` fingerprint** (concrete banned tells, each with its real `file:symbol` offender), and the framework-skill references. This file is the **SSOT for style**.
2. The **formatter + linter config** chosen in Step 3 — including the lint rules for the machine-catchable tells (`no-nested-ternary`, complexity/length caps, `no-restricted-syntax` for banned identifiers/shapes).
3. The **structure docs** flagged `create` in Step 1 (PROJECT.md via `grill-with-docs`' flow; CONTEXT.md orientation; LANGUAGE.md names-only glossary); any **ADRs** from Steps 4–5 into `docs/adr/current/`.
4. Refresh the `## Conventions` digest in `AGENTS.md` — a short digest of only the load-bearing rules, marked `<!-- rules digest — full guide in CODE-STYLE.md; edit there -->` — **and, when §④ recorded structure moves, the `## Repo layout`** to the approved "after".
5. **Edit, don't replace** — preserve my voice and existing content.

## Step 8 — Structure review & reorg (the capstone)

After the docs land, run one capstone pass: judge whether the codebase is **organized by purpose/job/role** and holds a **pure core / imperative shell**, using the just-written `CODE-STYLE.md` + `CONTEXT.md` as the rubric. It runs **inline and portable** — no dependency on any other skill — but it **borrows the lenses** of `improve-codebase-architecture` (cite it): the **deletion test** (would deleting this module concentrate complexity, or just move it?), **deep-vs-shallow** modules, and its caution that **pure functions extracted only for testability can lose locality** — so don't over-purify.

Present the proposal as its **own interactive planpage page** — the §④ renderer (before/after `tree-panel` + a neighborhood-scoped module graph via `ascii-architecture-flow-mapper`) with its **own approve/adjust gate** (a second `npx planpage serve` run on its own safe port, a separate decision file). If the structure already holds up, render **"✓ clean"** and stop — "make sure" is a valid outcome.

**On approval, execute and ship** — the one place this skill moves files:

1. Require a **clean working tree** (else stop, or cut the branch first).
2. Branch `reorg/organize-by-purpose`.
3. `git mv` the files and **rewrite every import** that referenced a moved module; update the ADR + the AGENTS.md `## Repo layout`.
4. Run the repo's **own validation gate** (typecheck + tests + formatter — e.g. `npm test` / `biome ci`). **Never push red** — red → stop and offer to roll back (`git reset --hard`).
5. `git push`, then `gh pr create` (body = the §④ before/after + rationale + ADR link).
6. `gh pr merge --auto --squash` — GitHub merges to `main` once required checks pass; branch protection requiring a review naturally holds it for you.
7. **No remote / CI / `gh`?** Stop at the local branch and print the exact PR command — never fake the ship.

## Re-running & drift

Idempotent — on re-run, re-scan, re-render the plan, and refresh in place. When code has drifted from `CODE-STYLE.md`, surface the conflict and ask: **fix the code, or evolve the guide?** My taste decides. The Step 8 capstone re-runs too — on a clean structure it just reports ✓. Between runs, `deslop` reads `CODE-STYLE.md` to enforce style per-diff.

</supporting-info>
