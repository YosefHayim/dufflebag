---
name: grill-me-code-style
description: Grill the user on how a NEW/greenfield project is built — code style, structure docs, and CLI — then render an HTML plan and, on approval, write CODE-STYLE.md + a formatter config and refresh the AGENTS.md digest. Ensures PROJECT.md/CONTEXT.md/LANGUAGE.md exist (create if missing, validate if present) and grills real code idioms + formatting, not just architecture. Use when setting up or reorganizing a new project, when there is little/no code, or when defining coding style, structure, or CLI conventions from scratch. For an existing codebase, use grill-me-code-style-with-docs instead.
---

<what-to-do>

Interview me relentlessly about **how this project is built** — its code style, its structure docs, and its CLI — until we reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each before continuing.

This is the **greenfield** variant: there is little or no code to read. Your source of truth is my **taste** (grill me) plus the project's **purpose** and its **language/framework** conventions. Never write generic advice ("use clear names", "keep functions small") — every rule must be a real, load-bearing decision for THIS project. If the project already has meaningful code, stop and use `grill-me-code-style-with-docs` instead.

**Nothing is written to disk until I approve.** You grill (Steps 0–5) — the code-style grill is a **pick-the-code gallery**: I pick from illustrative code variants shown in the TUI, dimension by dimension (Step 2); then you compose the **golden path for adding a unit + its slop guard** (Step 5). You render an **interactive HTML plan** as the review gate (Step 6, built with the **planpage** kit — I approve, adjust, or flip any decision in the browser), and only then write the files (Step 7).

</what-to-do>

<supporting-info>

## Step 0 — Detect language and runtime

Before anything else, establish the two most load-bearing facts about this project:

### Q0 — Primary language

Ask: **"What's the primary language for this project?"**

Recommend **TypeScript** as the default. Accept any of: TypeScript, JavaScript, Rust, Go, Python, Swift, Kotlin, Dart, Java, Ruby, PHP, C#, Elixir, or another.

The answer gates:
- Which language-conditional sections of [STYLE-CATALOG.md](_shared/STYLE-CATALOG.md) apply.
- Which formatter/linter to scaffold (see [FORMATTERS.md](_shared/FORMATTERS.md)).
- Which framework skills to reference.

### Q1 — Runtime target

Ask: **"Where does this run?"**

Options (pick one or more):
- **Node server** — backend, CLI, scripts
- **Edge / worker** — Cloudflare Workers, Deno Deploy, Vercel Edge
- **Browser SPA** — React, Vue, Svelte, etc.
- **Native app** — React Native / Expo, Swift (iOS), Kotlin (Android)
- **CLI tool** — developer tooling, scripts
- **Library** — consumed by other packages
- **Multi-target** — e.g. a monorepo spanning several of the above

The answer gates:
- Which catalog rounds to skip (no UI → skip Round 5; no HTTP surface → trim Round 4).
- Which APIs/patterns are legal (no `fs` on the edge; no DOM on a server).
- Framework skill references.

---

## Step 1 — Ensure the structure docs (create if missing, validate if present)

A project can't have a code style before it has a spine. Before grilling code, **ensure the three structure docs** — gather the missing ones' content now, validate the present ones, and **never restructure a doc that already exists** (report drift, don't rewrite it). Defer the actual file writes to Step 7 so the plan can show them.

- **PROJECT.md** — purpose & direction. Missing/thin → gather it via `grill-with-docs`' PROJECT.md flow (its seven-part checklist in [PROJECT-FORMAT.md](_shared/PROJECT-FORMAT.md)). Don't write your own purpose questions — `grill-with-docs` owns PROJECT.md.
- **CONTEXT.md** — orientation: what the project is, its actors, and how it's shaped (NOT a glossary). Model it on the Oly-App `CONTEXT.md` convention.
- **LANGUAGE.md** — the glossary / human↔agent bridge: **names only** (term → one-line definition + aliases to avoid), grouped by area. This is the shared vocabulary so I and the agent decode the same jargon. Model it on the Oly-App `LANGUAGE.md` convention (`CONTEXT.md` = orientation, `LANGUAGE.md` = glossary).

Record each doc's state — `create` · `validate ✓` · `drift` (with the gap) — for the Step 6 plan.

---

## Step 2 — Grill the code style as a pick-the-code gallery

The code-style grill runs as **pick-the-code**, not prose. For each dimension I show you code **variants in the TUI** (`AskUserQuestion` — the code goes in each option's `preview`) and you **pick**. With no repo to read, variants are **illustrative**: variant **A** is the default idiom for this language + framework (what the agent would reach for), variant **B** the alternative — both concrete to THIS project's domain, never `foo`/`bar`. Recommend one from the purpose + framework, but the pick is mine.

Run the full catalog: **[STYLE-CATALOG.md](_shared/STYLE-CATALOG.md)** — all language-conditional sections filtered by the Q0 answer, all new dimensions included.

Key behaviors:
- **Each pick → a rule.** Chosen variant = the `✓` example; rejected variant = a plausible `✗ not this`. Every rule carries an **enforced-vs-taste tag** (`[lint: <rule>]` / `[taste]`).
- **Formatting** — quotes, semicolons, line width, trailing commas, import order. Grill my preference, but **the answer becomes a formatter config, not prose**: pick and scaffold the appropriate config per [FORMATTERS.md](_shared/FORMATTERS.md), and record the choice as an ADR.
- **Anti-patterns / AI-slop fingerprint** — the explicit "never do this here" list. Grill the recognizable AI tells up front so generated code avoids them from day one. Each becomes a concrete `Never` entry (an illustrative snippet, since there's no code yet) with an enforced-vs-taste tag.
- **Over-engineering (the "too much" fingerprint)** — run [STYLE-CATALOG.md](_shared/STYLE-CATALOG.md) **Round 7**: grill each over-engineering family (needless indirection, fake robustness, control-flow contortion, shape noise, dead space, and structural too-much/too-little) against the one test — *an abstraction earns its place only with a second real caller or a genuine domain concept*. Illustrative before/after snippets live in the `deslop-v2` skill's references. Killed families fold into `Never`; point ongoing enforcement at `deslop-v2` per-diff.
- **Compose the canonical example.** After the rounds, assemble every pick into one **canonical example** — a representative feature for this project written in the agreed style — so I see the whole pattern together. It becomes the Step 6 litmus and the `## Canonical example` block of `CODE-STYLE.md`; with no code yet, it's the single clearest picture of what "good" looks like here.

---

## Step 3 — Grill the CLI

In the agent era every project earns a **CLI that both humans and agents drive**. Grill it:

- **Have/need one?** Default to yes — a dev+ops CLI (scaffold, run, check, deploy). A pure library or Worker may lean on its framework CLI instead — if so, say why and skip.
- **Command surface** — the verbs/nouns and their shape.
- **Dual-mode contract** — one code path serves both audiences: a bare invocation in a TTY opens an interactive menu; any flag or non-TTY stdin defers to flags and **never hangs**; both routes call the **same functions** (the `dufflebag` ADR 0011 "interactive front door" pattern). Prompt wrappers return a fallback off-TTY so scripts don't block.

Record the command surface as an **ADR** (the "why this surface"); the CLI conventions become `CODE-STYLE.md` rules + a recipe.

---

## Step 4 — Establish dependency policy & research libraries

Grill the dependency policy (2–3 quick picks — see [STEPS.md](_shared/STEPS.md) § "Greenfield" for the questions). Record it as an ADR.

When a library choice comes up, research + recommend a stable option (WebSearch / the `deep-research` skill), then record the choice + rationale as a separate ADR. `CODE-STYLE.md` documents only how to USE the chosen library — never the choice rationale.

---

## Step 5 — Compose the golden path + slop guard

With the picks, CLI, structure, and dependency policy settled, compose the one artifact a future contributor reaches for: **"if tomorrow we add a thing, how do we add it, and how do we not slop it up?"** See **[EXTENSION-PATTERN.md](_shared/EXTENSION-PATTERN.md)** for the full procedure. Greenfield-specific: with no code yet, the path is **derived from the picks** (illustrative, not mined from history) — but still concrete to THIS project, never abstract "add tests" prose.

- **Name the unit** of extension (feature / endpoint / screen / component / Actor / module) — parameterize the section to the project's real word.
- **Derive a draft numbered path** from the picks + canonical example, then grill it **step-by-step** (keep / adjust / reorder / cut); end with a **definition-of-done** checklist.
- **Wire the guard** in layers: machine-catchable `## Never` tells → the **lint config** (CI blocks; flips `[taste]`→`[lint]`); taste tells → **`deslop` per-diff**; the checklist → the human/agent gate. Slop is "off the golden path".

Lands a first-class `## Golden path — adding a {unit}` in `CODE-STYLE.md` + a tight mirror in the `AGENTS.md` digest.

---

## Steps 6–8 — Framework references, plan, write, re-run

See **[STEPS.md](_shared/STEPS.md)** for the shared procedures (the golden-path step above is shared Step 6; greenfield handles dependencies as its Step 4):

- **Step 6** → Reference framework practices (detect stack, point to official skills), then render the interactive planpage plan (the review gate) — including the **golden-path + guard block**.
- **Step 7** → On approval, write the files (CODE-STYLE.md incl. `## Golden path`, formatter + lint config, structure docs, ADRs, AGENTS.md digest incl. the tight golden-path mirror).
- **Re-running** → Idempotent refresh; once real code exists, hand off to `grill-me-code-style-with-docs`.

> **Step 8 (capstone reorg) does not apply to greenfield** — there's no code to reorganize.

</supporting-info>
