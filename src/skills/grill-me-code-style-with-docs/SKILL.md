---
name: grill-me-code-style-with-docs
description: Grill the user on how an EXISTING codebase is built — code style, structure docs, and CLI — using the real code as evidence, then render an HTML plan and, on approval, write/update CODE-STYLE.md + a formatter config and refresh the AGENTS.md digest. Ensures PROJECT.md/CONTEXT.md/LANGUAGE.md exist (create if missing, validate if present), fans out sub-agents for the most-repeated patterns, grills real code idioms + formatting with before/after, audits deps, and references official framework skills. Use when defining/updating style, structure, or CLI conventions for a repo with meaningful code. For a brand-new or empty project, use grill-me-code-style instead.
---

<what-to-do>

Interview me relentlessly about **how this codebase is built** — its code style, its structure docs, and its CLI — until we reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each before continuing.

My **taste is the source of truth**; the existing code is **evidence, not gospel** — much of it may be the slop I want gone. When code and my stated taste conflict, my taste wins and `CODE-STYLE.md` records the DESIRED end-state, not the current one.

**Nothing is written to disk until I approve.** You scan and grill (Steps 1–5), render an **HTML plan** as the review gate (Step 6), and only then write the files (Step 7).

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

## Step 3 — Grill, one question at a time

For each load-bearing dimension, show what the code currently does and ask: **keep it, or is this the slop to kill?** Recommend an answer. Every kept-or-changed rule gets a real **before/after** from the repo.

- structure, module boundaries, data vs side effects, error handling, naming, types & contracts, tests, the "how to add a feature" recipe, anti-patterns — as before, and additionally:
- **Code idioms (the micro-style)** — **grill this explicitly; it's the layer the old skill skipped.** The judgment calls a formatter can't make: function form (arrow vs declaration), body length, single- vs multi-return, early-return vs nesting, named vs default exports, class vs function/facade, casts & immutability, comment density, file-size cap, component/hook order. Grill each against the code's current habit.
- **Formatting** — quotes/semis/width/trailing-commas/import-order: grill my preference but land it as a **formatter config** (`biome.json` / `.prettierrc` / eslint), recorded as an ADR — not prose. Reconcile with any config already in the repo.

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

Then, **before writing anything**, render the plan as a single self-contained HTML file to the OS temp dir (nothing lands in the repo). Resolve `$TMPDIR` (fall back to `/tmp`, or `%TEMP%` on Windows), write `<tmpdir>/code-style-plan-<timestamp>.html`, open it (`open` / `xdg-open` / `start`), and tell me the absolute path.

Self-contained, CDN-only — no repo assets, no app code:

- Load **Tailwind** (`https://cdn.tailwindcss.com`) and **Mermaid** (`https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs`, `mermaid.initialize({ startOnLoad: true, theme: "neutral" })`) from CDN. No other scripts.
- Three sections: **① Doc scaffold** — PROJECT / CONTEXT / LANGUAGE as cards tagged `create` · `validate ✓` · `drift`. **② Code style** — the rules, each with a real **before/after from the repo**, plus the chosen **formatter config** as a code block. **③ CLI** — the command surface + dual-mode routing as a Mermaid `flowchart`.
- End with the **write-list**: every file to be created/edited.

(For richer diagram patterns and styling, the `improve-codebase-architecture` skill's HTML report is a good exemplar — reuse its conventions, don't reinvent them.)

Then ask: **approve, or adjust?** Write nothing until I approve.

## Step 7 — On approval, write the files

1. Write/update `CODE-STYLE.md` per [CODE-STYLE-FORMAT.md](CODE-STYLE-FORMAT.md): rules (each with before/after from real files), recipes (incl. add-a-**CLI-command**), exemplar-file pointers, a "Never" list, and the framework-skill references. This file is the **SSOT for style**.
2. The **formatter config** chosen in Step 3.
3. The **structure docs** flagged `create` in Step 1 (PROJECT.md via `grill-with-docs`' flow; CONTEXT.md orientation; LANGUAGE.md names-only glossary); any **ADRs** from Steps 4–5 into `docs/adr/current/`.
4. Refresh the `## Conventions` section in `AGENTS.md` — a short digest of only the load-bearing rules, marked `<!-- rules digest — full guide in CODE-STYLE.md; edit there -->`.
5. **Edit, don't replace** — preserve my voice and existing content.

## Re-running & drift

Idempotent — on re-run, re-scan, re-render the plan, and refresh in place. When code has drifted from `CODE-STYLE.md`, surface the conflict and ask: **fix the code, or evolve the guide?** My taste decides. Between runs, `deslop` reads `CODE-STYLE.md` to enforce style per-diff.

</supporting-info>
