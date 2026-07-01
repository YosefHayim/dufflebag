---
name: grill-me-code-style
description: Grill the user on how a NEW/greenfield project is built — code style, structure docs, and CLI — then render an HTML plan and, on approval, write CODE-STYLE.md + a formatter config and refresh the AGENTS.md digest. Ensures PROJECT.md/CONTEXT.md/LANGUAGE.md exist (create if missing, validate if present) and grills real code idioms + formatting, not just architecture. Use when setting up or reorganizing a new project, when there is little/no code, or when defining coding style, structure, or CLI conventions from scratch. For an existing codebase, use grill-me-code-style-with-docs instead.
---

<what-to-do>

Interview me relentlessly about **how this project is built** — its code style, its structure docs, and its CLI — until we reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each before continuing.

This is the **greenfield** variant: there is little or no code to read. Your source of truth is my **taste** (grill me) plus the project's **purpose** and its **language/framework** conventions. Never write generic advice ("use clear names", "keep functions small") — every rule must be a real, load-bearing decision for THIS project. If the project already has meaningful code, stop and use `grill-me-code-style-with-docs` instead.

**Nothing is written to disk until I approve.** You grill (Steps 1–5), render an **HTML plan** as the review gate (Step 6), and only then write the files (Step 7).

</what-to-do>

<supporting-info>

## Step 1 — Ensure the structure docs (create if missing, validate if present)

A project can't have a code style before it has a spine. Before grilling code, **ensure the three structure docs** — gather the missing ones' content now, validate the present ones, and **never restructure a doc that already exists** (report drift, don't rewrite it). Defer the actual file writes to Step 7 so the plan can show them.

- **PROJECT.md** — purpose & direction. Missing/thin → gather it via `grill-with-docs`' PROJECT.md flow (its seven-part checklist in `PROJECT-FORMAT.md`). Don't write your own purpose questions — `grill-with-docs` owns PROJECT.md.
- **CONTEXT.md** — orientation: what the project is, its actors, and how it's shaped (NOT a glossary). Model it on the Oly-App `CONTEXT.md` convention.
- **LANGUAGE.md** — the glossary / human↔agent bridge: **names only** (term → one-line definition + aliases to avoid), grouped by area. This is the shared vocabulary so I and the agent decode the same jargon. Model it on the Oly-App `LANGUAGE.md` convention (`CONTEXT.md` = orientation, `LANGUAGE.md` = glossary).

Record each doc's state — `create` · `validate ✓` · `drift` (with the gap) — for the Step 6 plan.

## Step 2 — Grill the code-style decision tree

Cover only load-bearing, project-specific dimensions. For each, recommend an answer derived from the purpose + language/framework:

- **Structure** — folder/module layout for this project type (feature- vs layer-based; where new code goes).
- **Module boundaries** — what a unit is, what's shared, allowed dependency direction.
- **Data vs side effects** — how they're separated (pure core vs I/O edges).
- **Error handling** — throw vs return, error types, boundary validation.
- **Naming** — conventions that encode behavior / return shape.
- **Types & contracts** — where shared contracts live; validation at boundaries.
- **Code idioms (the micro-style)** — **grill this explicitly; it's the layer the old skill skipped.** The judgment calls a formatter can't make: function form (arrow vs declaration), body length, single- vs multi-return, early-return vs nesting, named vs default exports, class vs function/facade, casts & immutability policy, comment density, file-size cap, and (for UI) component/hook order. Each becomes a `CODE-STYLE.md` rule.
- **Formatting** — quotes, semicolons, line width, trailing commas, import order. Grill my preference, but **the answer becomes a formatter config, not prose**: pick and scaffold `biome.json` / `.prettierrc` / an eslint config, and record the choice as an ADR. `CODE-STYLE.md` references the formatter; it never restates its rules.
- **Tests** — what's tested, where they live, style.
- **How to add a feature** — the canonical end-to-end recipe.
- **Anti-patterns** — the explicit "never do this here" list.

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

When decisions are settled, **before writing anything**, render a single self-contained HTML file to the OS temp dir so nothing lands in the repo. Resolve the temp dir from `$TMPDIR` (fall back to `/tmp`, or `%TEMP%` on Windows) and write `<tmpdir>/code-style-plan-<timestamp>.html`; open it (`open` on macOS, `xdg-open` on Linux, `start` on Windows) and tell me the absolute path.

Self-contained, CDN-only — no repo assets, no app code:

- Load **Tailwind** (`https://cdn.tailwindcss.com`) and **Mermaid** (`https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs`, `mermaid.initialize({ startOnLoad: true, theme: "neutral" })`) from CDN. No other scripts.
- Three sections: **① Doc scaffold** — PROJECT / CONTEXT / LANGUAGE as cards tagged `create` · `validate ✓` · `drift`. **② Code style** — the rules (each a one-line rule + a short snippet), plus the chosen **formatter config** rendered as a code block. **③ CLI** — the command surface + dual-mode routing as a Mermaid `flowchart`.
- End with the **write-list**: every file to be created/edited.

(For richer diagram patterns and styling, the `improve-codebase-architecture` skill's HTML report is a good exemplar — reuse its conventions, don't reinvent them.)

Then ask: **approve, or adjust?** Write nothing until I approve.

## Step 7 — On approval, write the files

1. `CODE-STYLE.md` — the **SSOT for style** (greenfield shape, no before/after): Stack & framework references · Rules (rule + snippet + one-line _Why_) · Recipes (add a feature/module/**CLI command**) · a "Never" list.
2. The **formatter config** (`biome.json` / `.prettierrc` / eslint) chosen in Step 2.
3. The **structure docs** flagged `create` in Step 1 — PROJECT.md (via `grill-with-docs`' flow), CONTEXT.md (orientation), LANGUAGE.md (names-only glossary).
4. Any **ADRs** from Steps 3–4 into `docs/adr/current/`.
5. Refresh the `## Conventions` section in `AGENTS.md` — a short digest of only the load-bearing rules, marked `<!-- rules digest — full guide in CODE-STYLE.md; edit there -->`. `CODE-STYLE.md` stays the source.

## Re-running

Idempotent — re-run to refresh in place (merge, keep my edits, re-render the plan showing drift). Once the project has real code, hand off to `grill-me-code-style-with-docs`, which reads it as evidence and adds before/after. Between runs, `deslop` reads `CODE-STYLE.md` to enforce style per-diff.

</supporting-info>
