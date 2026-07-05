---
name: grill-me-code-style-with-docs
description: Grill the user on how an EXISTING codebase is built — code style, structure docs, and CLI — using the real code as evidence, then render an HTML plan and, on approval, write/update CODE-STYLE.md + a formatter config and refresh the AGENTS.md digest. Ensures PROJECT.md/CONTEXT.md/LANGUAGE.md exist (create if missing, validate if present), fans out sub-agents for the most-repeated patterns, grills real code idioms + formatting with before/after, audits deps, and references official framework skills. Use when defining/updating style, structure, or CLI conventions for a repo with meaningful code. For a brand-new or empty project, use grill-me-code-style instead.
---

<what-to-do>

Interview me relentlessly about **how this codebase is built** — its code style, its structure docs, and its CLI — until we reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each before continuing.

My **taste is the source of truth**; the existing code is **evidence, not gospel** — much of it may be the slop I want gone. When code and my stated taste conflict, my taste wins and `CODE-STYLE.md` records the DESIRED end-state, not the current one.

**Nothing is written to disk until I approve.** You scan and grill (Steps 1–4) — the code-style grill is a **pick-the-code gallery**: you show me real code variants and I pick what I like, dimension by dimension (Step 3). You render an **interactive HTML plan** as the review gate (Step 6, built with the **planpage** kit — I approve, adjust, or flip any decision right in the browser and it posts back), write the files on approval (Step 7), then run one **structure-review capstone** (Step 8) that can reorganize the tree and open a PR.

</what-to-do>

<supporting-info>

## Step 1 — Detect language and runtime, then ensure the structure docs

### Auto-detect language and runtime

Before scanning, auto-detect from the codebase:

- **Language** — from file extensions, package manifest (`package.json` → TS/JS, `Cargo.toml` → Rust, `go.mod` → Go, `pyproject.toml`/`setup.py` → Python, etc.), and build config (`tsconfig.json`, `.swiftpm`). Report: "Detected: **{language}** via `{evidence}`". Confirm with the user. If ambiguous (e.g. a repo with both Python and TypeScript), ask which is primary.
- **Runtime target** — from the manifest/config (e.g. `wrangler.toml` → edge/worker, `expo` in package.json → native app, `bin` field → CLI tool, browser entry → SPA). Report and confirm.

These gate which [STYLE-CATALOG.md](../grill-me-code-style/_shared/STYLE-CATALOG.md) sections apply and which [FORMATTERS.md](../grill-me-code-style/_shared/FORMATTERS.md) row to use.

### Ensure the three structure docs

Read whatever exists first so you grill about CODE, not product. Then **ensure the three structure docs** — gather the missing ones' content, validate the present ones against their role, and **never restructure a doc that already exists** (report drift, don't rewrite it). Defer file writes to Step 7 so the plan can show them.

- **PROJECT.md** — purpose & direction. Missing/thin → gather via `grill-with-docs`' PROJECT.md flow (its seven-part checklist in [PROJECT-FORMAT.md](../grill-me-code-style/_shared/PROJECT-FORMAT.md)). `grill-with-docs` owns PROJECT.md.
- **CONTEXT.md** — orientation (what it is, actors, shape — NOT a glossary). Model on the Oly-App `CONTEXT.md` convention.
- **LANGUAGE.md** — glossary / human↔agent bridge: **names only** (term → definition + aliases to avoid). Validate an existing one against the code's real vocabulary; model on the Oly-App `LANGUAGE.md` convention.

Record each doc's state — `create` · `validate ✓` · `drift` — for the Step 6 plan.

---

## Step 2 — Scan the code with sub-agents

Fan out read-only sub-agents to survey the codebase and report the **most-repeated** patterns — dominant reality, not a file dump. See [SCAN.md](SCAN.md) for the fan-out strategy. Bring back a compact "current reality" brief to drive the grill.

---

## Step 3 — Grill the code as a pick-the-code gallery

The code-style grill runs as **pick-the-code**, not prose. For each dimension I show you real code **variants in the TUI** (`AskUserQuestion` — the code goes in each option's `preview`) and you **pick**; your pick is recorded verbatim. Variant **A** is the repo's actual incumbent (pulled verbatim by the scan, `file:symbol`-cited — you react to *your* code, warts and all); variant **B** is the de-slopped rewrite; an **uncontested** dimension collapses to a single **keep/kill** rather than a fabricated choice.

Run the full catalog: **[STYLE-CATALOG.md](../grill-me-code-style/_shared/STYLE-CATALOG.md)** — all language-conditional sections filtered by the auto-detected language, all new dimensions included.

Key behaviors:
- **Each pick → a rule.** Chosen variant = the `✓` example on a `CODE-STYLE.md` rule; rejected variant = the `✗ not this` line. Every rule carries an **enforced-vs-taste tag** (`[lint: <rule>]` / `[taste]`).
- **Formatting** — quotes/semis/width/trailing-commas/import-order: grill my preference but land it as a **formatter config** (per [FORMATTERS.md](../grill-me-code-style/_shared/FORMATTERS.md)), recorded as an ADR — not prose. Reconcile with any config already in the repo. The **machine-catchable slop tells** land here too as **linter rules** — prevented, not just documented.
- **AI-slop fingerprint (the tells)** — the scan's fingerprint angle brings back the recognizable AI tells **with counts**; grill each **keep or kill**. A high count is *not* a free pass — repeated slop is still slop. Killed tells become the concrete `## Never` list, each with its real `file:symbol` offender and an enforced-vs-taste tag.
- **Golden exemplars** — grill me to name **1–3 real files** that best embody the agreed style ("write new code exactly like these"). They anchor `CODE-STYLE.md`'s Exemplars and give `deslop` a concrete target. If nothing qualifies yet, flag it — that's a finding.
- **Compose the canonical example.** After the rounds, assemble every pick into one **canonical example** — a real feature slice from this repo rewritten in the agreed style — so I see the whole pattern working together, not just atomized picks. It becomes the Step 6 litmus and the `## Canonical example` block of `CODE-STYLE.md`.

---

## Step 4 — Grill the CLI

Every project earns a **CLI both humans and agents drive**. If the repo already has one, hand the deep audit to the `interactive-cli-reviewer` skill and fold its findings back here; otherwise grill it fresh:

- **Have/need one?** Default yes — a dev+ops surface.
- **Command surface** — verbs/nouns.
- **Dual-mode contract** — a bare invocation in a TTY opens a menu; flags or non-TTY defer and **never hang**; both routes call the **same functions** (the `dufflebag` ADR 0011 "interactive front door" pattern).

Record the command surface as an **ADR**; the conventions become `CODE-STYLE.md` rules + a recipe.

---

## Steps 5–8 — Dependencies, framework refs, plan, write, capstone

See **[STEPS-5-8.md](../grill-me-code-style/_shared/STEPS-5-8.md)** for the shared procedures:

- **Step 5** → Audit dependencies (flag unmaintained/unstable/duplicative, record ADRs).
- **Step 6** → Reference framework practices, then render the interactive planpage plan (the review gate).
- **Step 7** → On approval, write the files (CODE-STYLE.md, formatter config, structure docs, ADRs, AGENTS.md digest).
- **Step 8** → Structure review & reorg capstone (judge organization, propose moves, open PR on approval).
- **Re-running** → Idempotent; surface drift and ask "fix the code, or evolve the guide?"

</supporting-info>
