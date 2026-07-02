---
name: grill-me-code-style
description: Grill the user on how a NEW/greenfield project is built — code style, structure docs, and CLI — then render an HTML plan and, on approval, write CODE-STYLE.md + a formatter config and refresh the AGENTS.md digest. Ensures PROJECT.md/CONTEXT.md/LANGUAGE.md exist (create if missing, validate if present) and grills real code idioms + formatting, not just architecture. Use when setting up or reorganizing a new project, when there is little/no code, or when defining coding style, structure, or CLI conventions from scratch. For an existing codebase, use grill-me-code-style-with-docs instead.
---

<what-to-do>

Interview me relentlessly about **how this project is built** — its code style, its structure docs, and its CLI — until we reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each before continuing.

This is the **greenfield** variant: there is little or no code to read. Your source of truth is my **taste** (grill me) plus the project's **purpose** and its **language/framework** conventions. Never write generic advice ("use clear names", "keep functions small") — every rule must be a real, load-bearing decision for THIS project. If the project already has meaningful code, stop and use `grill-me-code-style-with-docs` instead.

**Nothing is written to disk until I approve.** You grill (Steps 1–5) — the code-style grill is a **pick-the-code gallery**: I pick from illustrative code variants shown in the TUI, dimension by dimension (Step 2). You render an **interactive HTML plan** as the review gate (Step 6, built with the **planpage** kit — I approve, adjust, or flip any decision in the browser), and only then write the files (Step 7).

</what-to-do>

<supporting-info>

## Step 1 — Ensure the structure docs (create if missing, validate if present)

A project can't have a code style before it has a spine. Before grilling code, **ensure the three structure docs** — gather the missing ones' content now, validate the present ones, and **never restructure a doc that already exists** (report drift, don't rewrite it). Defer the actual file writes to Step 7 so the plan can show them.

- **PROJECT.md** — purpose & direction. Missing/thin → gather it via `grill-with-docs`' PROJECT.md flow (its seven-part checklist in `PROJECT-FORMAT.md`). Don't write your own purpose questions — `grill-with-docs` owns PROJECT.md.
- **CONTEXT.md** — orientation: what the project is, its actors, and how it's shaped (NOT a glossary). Model it on the Oly-App `CONTEXT.md` convention.
- **LANGUAGE.md** — the glossary / human↔agent bridge: **names only** (term → one-line definition + aliases to avoid), grouped by area. This is the shared vocabulary so I and the agent decode the same jargon. Model it on the Oly-App `LANGUAGE.md` convention (`CONTEXT.md` = orientation, `LANGUAGE.md` = glossary).

Record each doc's state — `create` · `validate ✓` · `drift` (with the gap) — for the Step 6 plan.

## Step 2 — Grill the code style as a pick-the-code gallery

The code-style grill runs as **pick-the-code**, not prose. For each dimension I show you code **variants in the TUI** (`AskUserQuestion` — the code goes in each option's `preview`) and you **pick**. With no repo to read, variants are **illustrative**: variant **A** is the default idiom for this language + framework (what the agent would reach for), variant **B** the alternative — both concrete to THIS project's domain, never `foo`/`bar`. Recommend one from the purpose + framework, but the pick is mine.

- **Walk the whole catalog.** Run **[STYLE-CATALOG.md](STYLE-CATALOG.md)** — ~25 dimensions (structure, boundaries, data vs side-effects, errors, naming, types & contracts, control flow, async, the API/IO and UI surfaces, tests, the "add a feature" recipe) in **6 grouped rounds**, with a **checkpoint between rounds** (keep going · go deeper · skip the rest) and whole rounds skipped when they don't apply. Covering every dimension is how the generated code won't surprise me.
- **Each pick → a rule.** Chosen variant = the `✓` example; rejected variant = a plausible `✗ not this`. Every rule carries an **enforced-vs-taste tag** (`[lint: <rule>]` / `[taste]`).
- **Formatting** — quotes, semicolons, line width, trailing commas, import order. Grill my preference, but **the answer becomes a formatter config, not prose**: pick and scaffold `biome.json` / `.prettierrc` / an eslint config, and record the choice as an ADR. `CODE-STYLE.md` references the formatter; it never restates its rules. The **machine-catchable slop tells** land here too as **linter rules** (`no-nested-ternary`, complexity/length caps, `no-restricted-syntax` for banned identifiers/shapes) — prevented, not just documented.
- **Anti-patterns / AI-slop fingerprint** — the explicit "never do this here" list. Grill the recognizable AI tells up front so generated code avoids them from day one: giveaway micro-helpers (`isRecord`, `isObject`, `isNonEmptyString`, `isDefined`, `ensureArray`, `noop`), defensive over-guards (redundant null/type checks the types already prove), nested or duplicated ternaries, one-use wrapper functions, copy-pasted boilerplate, and generic names (`handleData`, `processItem`, `result`, `temp`). Each becomes a concrete `Never` entry (an illustrative snippet, since there's no code yet) with an enforced-vs-taste tag.
- **Compose the canonical example.** After the rounds, assemble every pick into one **canonical example** — a representative feature for this project written in the agreed style — so I see the whole pattern together. It becomes the Step 6 litmus and the `## Canonical example` block of `CODE-STYLE.md`; with no code yet, it's the single clearest picture of what "good" looks like here.

## Step 3 — Grill the CLI

In the agent era every project earns a **CLI that both humans and agents drive**. Grill it:

- **Have/need one?** Default to yes — a dev+ops CLI (scaffold, run, check, deploy). A pure library or Worker may lean on its framework CLI instead — if so, say why and skip.
- **Command surface** — the verbs/nouns and their shape.
- **Dual-mode contract** — one code path serves both audiences: a bare invocation in a TTY opens an interactive menu; any flag or non-TTY stdin defers to flags and **never hangs**; both routes call the **same functions** (the `dufflebag` ADR 0011 "interactive front door" pattern). Prompt wrappers return a fallback off-TTY so scripts don't block.

Record the command surface as an **ADR** (the "why this surface"); the CLI conventions become `CODE-STYLE.md` rules + a recipe.

## Step 4 — Libraries → research, then ADR

When a library choice comes up, research + recommend a stable option (WebSearch / the `deep-research` skill), then record the choice + rationale as an **ADR** (`docs/adr/current/`). `CODE-STYLE.md` documents only how to USE the chosen library — never the choice rationale.

## Step 5 — Layer framework practices by reference, not copy

Detect the stack from my answers / package manifest. For each framework/library, point to the official skill that owns its best-practices (e.g. `workers-best-practices`, `cloudflare`, `wrangler`, `durable-objects`, `agents-sdk`, the `expo-*` family, `building-native-ui`, `native-data-fetching`, `claude-api`). `CODE-STYLE.md` references those skills; it never restates their content.

## Step 6 — Render the plan as an HTML report (the review gate)

When decisions are settled, the **canonical example** composed in Step 2 (a representative feature in the target style) is the litmus — show it to me. With no code to read, seeing the whole style *as code* is the surest way to catch surprises before approval. Fold my reactions back into the rules.

Then, **before writing anything**, render the plan through the **planpage** kit as a single self-contained, **interactive** HTML file. Build it from planpage's components, write it to `<tmpdir>/code-style-plan-<timestamp>.html` (resolve `$TMPDIR`; fall back to `/tmp` or `%TEMP%`; nothing lands in the repo), then **serve it for a live decision** on a **safe ephemeral port** (`planpage serve` binds an OS-assigned high port — never 3000 / 5173 / 8000 / 8080 / 8787 / 19006):

```bash
npx planpage serve <tmpdir>/code-style-plan-<ts>.html <tmpdir>/code-style-decision-<ts>.json
```

It opens the browser and blocks until I click **Approve** or **Adjust**; read the decision JSON — `{ approved, flips, revisit, notes }` — and act on it (`flips` re-open those picks, `revisit` re-grills them). (No Node / headless / port blocked? `open` the file directly; the page's **Copy decision** button hands me the same JSON to paste back — never a hang.)

Self-contained, CDN-only — no repo assets, no app code:

- **The planpage shell is the page** — it loads Tailwind + Mermaid from CDN, carries the theme, and wires the submit-bar + post-back. Plug content into its components; don't re-derive the HTML.
- Sections: **① Doc scaffold** — PROJECT / CONTEXT / LANGUAGE as `section-card`s tagged `create` · `validate ✓` · `drift`. **② Code style** — each rule as a **`pick-block`** (✓ chosen / ✗ rejected, flippable, `data-id`) with its enforced-vs-taste tag; the chosen **formatter + linter config** as a `code-block`; the **`Never` fingerprint** (the banned tells); and the composed **`## Canonical example`** as a headlined `code-block`. **③ CLI** — the command surface + dual-mode routing as a Mermaid `flow`.
- Then the **write-list**: every file to be created/edited.
- **Review the exact writes** — below the write-list, inline the proposed content for **CODE-STYLE.md** and **AGENTS.md** (full content when new, a diff if the file already exists) as `diff-block`s, so nothing lands sight-unseen.

(The planpage kit owns the shell, components, theme, and post-back — reference it and plug in content; don't reinvent the HTML.)

The interactive plan **is** the ask — I approve or adjust in the browser and it posts back. Write nothing until the decision reads `approved: true`; on adjust, fold in `flips` / `revisit` / `notes` and re-render.

## Step 7 — On approval, write the files

1. `CODE-STYLE.md` — the **SSOT for style** (greenfield shape): Stack & framework references · Rules (rule + **✓ chosen / ✗ rejected** illustrative snippets + one-line _Why_ + enforced-vs-taste tag) · the **`## Canonical example`** (the composed feature from Step 2) · Recipes (add a feature/module/**CLI command**) · the **`Never` fingerprint** (the banned tells, illustrative snippets).
2. The **formatter + linter config** (`biome.json` / `.prettierrc` / eslint) chosen in Step 2 — including the lint rules for the machine-catchable tells.
3. The **structure docs** flagged `create` in Step 1 — PROJECT.md (via `grill-with-docs`' flow), CONTEXT.md (orientation), LANGUAGE.md (names-only glossary).
4. Any **ADRs** from Steps 3–4 into `docs/adr/current/`.
5. Refresh the `## Conventions` section in `AGENTS.md` — a short digest of only the load-bearing rules, marked `<!-- rules digest — full guide in CODE-STYLE.md; edit there -->`. `CODE-STYLE.md` stays the source.

## Re-running

Idempotent — re-run to refresh in place (merge, keep my edits, re-render the plan showing drift). Once the project has real code, hand off to `grill-me-code-style-with-docs`, which reads it as evidence and adds before/after. Between runs, `deslop` reads `CODE-STYLE.md` to enforce style per-diff.

</supporting-info>
