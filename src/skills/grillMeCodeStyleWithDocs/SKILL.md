---
name: grill-me-code-style-with-docs
description: >
  Grill an EXISTING codebase for code style, structure docs, and CLI — using real
  code as evidence — then render an HTML plan and, on approval, write/update
  CODE-STYLE.md + formatter config and refresh the AGENTS.md digest. Also runs
  read-only compliance audit when the user already has docs and wants to check
  slices/files against CODE-STYLE / PROJECT / AGENTS without rewriting them.
  Use when: grill-me-code-style-with-docs, $grill, gridme, rebuild CODE-STYLE,
  audit CODE-STYLE compliance, docs vs code, ban generic names (result/payload),
  full-repo deslop that starts by deciding style, or "from the beginning" style
  grill on a repo with meaningful code. Fans out sub-agents for repeated patterns
  including ceremony/tool-slop; ships deterministic inventory + naming scanners.
  Greenfield → grill-me-code-style; mass kill after guide exists → deslop-v2.
---

<what-to-do>

Pick a mode from the user request, then execute only that mode:

| Mode | When | Writes files? |
| --- | --- | --- |
| **Grill** (default) | Decide / rebuild style with me using real code as evidence | Only after planpage approval |
| **Audit** | Docs already exist; check whether code + slices follow them | **Never** — report only; hand cleanup to `deslop-v2` |

### Mode: Grill

Interview me relentlessly about **how this codebase is built** — its code style, its structure docs, and its CLI — until we reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each before continuing.

My **taste is the source of truth**; the existing code is **evidence, not gospel** — much of it may be the slop I want gone. When code and my stated taste conflict, my taste wins and `CODE-STYLE.md` records the DESIRED end-state, not the current one.

**Nothing is written to disk until I approve.** You scan and grill (Steps 1–4) — the code-style grill is a **pick-the-code gallery**: you show me real code variants and I pick what I like, dimension by dimension (Step 3) — then compose the **golden path for adding a unit + its slop guard** from those picks and the evidence (Step 6). You render an **interactive HTML plan** as the review gate (Step 7, built with the **planpage** kit — I approve, adjust, or flip any decision right in the browser and it posts back), write the files on approval (Step 8), then run one **structure-review capstone** (Step 9) that can reorganize the tree and open a PR.

### Mode: Audit (read-only compliance)

When I already have `CODE-STYLE.md` / structure docs and want confirmation that the tree follows them (including mechanical bans like `result` / `payload` / vague `to*`·`build*`·`resolve*` mappers):

1. Resolve the package/repo root.
2. Run mechanical inventory + scan from this skill directory (paths relative to the installed skill root):

   ```bash
   node scripts/inventory-repository.mjs --root <repo> --out /tmp/style-inventory.json
   node scripts/scan-style-compliance.mjs --root <repo> --out /tmp/style-findings.json
   ```

3. Map apps, packages, feature slices, and cross-slice imports from the inventory.
4. Compare docs (AGENTS, CODE-STYLE, PROJECT, CONTEXT, LANGUAGE, README, ADRs) for missing files, nested contradictions, and path drift.
5. Publish evidence-first findings (`ruleId`, path, symbol, line, evidence, severity, confidence, remediation). Taxonomy: [references/finding-taxonomy.md](references/finding-taxonomy.md). Defaults informed by [references/research-principles.md](references/research-principles.md); **project CODE-STYLE wins**.
6. If findings are **persisted** (not chat-only): write **`docs/agent/style-audit/FINDINGS.md`** only — `mkdir -p docs/agent/style-audit` first. Never write `*AUDIT*.md` / compliance reports at the repository root. Migrate any legacy root audit files into that dir.
7. Do **not** rewrite CODE-STYLE or rename symbols in audit mode. Approved cleanup → `deslop-v2`; structural prove-outs → `lean-prove`.

Honest limit: mechanical scanners prove banned names, missing docs, and path patterns — not whether a name truly captures a business concept (`confidence: judgment` for those).

</what-to-do>

<supporting-info>

## Mechanical pre-scan (both modes)

Before sub-agent fan-out (grill Step 2) or as the core of audit mode, run the zero-dep scripts shipped with this skill. They give prevalence counts and concrete `file:symbol` offenders for generic locals and vague mappers without inventing taste.

Research defaults (Uncle Bob + Matt Pocock caption corpus): [references/research-principles.md](references/research-principles.md).

## Step 1 — Detect language and runtime, then ensure the structure docs

### Auto-detect language and runtime

Before scanning, auto-detect from the codebase:

- **Language** — from file extensions, package manifest (`package.json` → TS/JS, `Cargo.toml` → Rust, `go.mod` → Go, `pyproject.toml`/`setup.py` → Python, etc.), and build config (`tsconfig.json`, `.swiftpm`). Report: "Detected: **{language}** via `{evidence}`". Confirm with the user. If ambiguous (e.g. a repo with both Python and TypeScript), ask which is primary.
- **Runtime target** — from the manifest/config (e.g. `wrangler.toml` → edge/worker, `expo` in package.json → native app, `bin` field → CLI tool, browser entry → SPA). Report and confirm.

These gate which [STYLE-CATALOG.md](../grill-me-code-style/_shared/STYLE-CATALOG.md) sections apply and which [FORMATTERS.md](../grill-me-code-style/_shared/FORMATTERS.md) row to use.

### Ensure the three structure docs

Read whatever exists first so you grill about CODE, not product. Then **ensure the three structure docs** — gather the missing ones' content, validate the present ones against their role, and **never restructure a doc that already exists** (report drift, don't rewrite it). Defer file writes to Step 7 so the plan can show them.

- **PROJECT.md** — purpose & direction. Missing/thin → gather via `grill-with-docs`' PROJECT.md flow ([PROJECT-FORMAT.md](../grill-me-code-style/_shared/PROJECT-FORMAT.md)). Title: `# PROJECT.md — {Project}`. `grill-with-docs` owns PROJECT.md.
- **CONTEXT.md** — orientation only. Validate against [CONTEXT-FORMAT.md](../grillWithDocs/CONTEXT-FORMAT.md) (exemplar: `ai-browser-bridge/CONTEXT.md`). Title: `# CONTEXT.md — {Project}`. Flag `## Language` / glossary `_Avoid_:` blocks as **drift** → migrate to `LANGUAGE.md`.
- **LANGUAGE.md** — glossary / human↔agent bridge: **names only**. Validate against [LANGUAGE-FORMAT.md](../grill-me-code-style/_shared/LANGUAGE-FORMAT.md) and the code's real vocabulary (exemplar: `ai-browser-bridge/LANGUAGE.md`). Flag tables / bullet glossaries / colon-on-bold as **drift**.

Record each doc's state — `create` · `validate ✓` · `drift` — for the Step 6 plan.

---

## Step 2 — Scan the code with sub-agents

Fan out read-only sub-agents to survey the codebase and report the **most-repeated** patterns — dominant reality, not a file dump. See [SCAN.md](SCAN.md) for the fan-out strategy (**includes a mandatory ceremony & tool-slop angle** — tool wrappers, house typegen, scripts layout, orphan generated files). Bring back a compact "current reality" brief + **ceremony kill list** to drive the grill.

---

## Step 3 — Grill the code as a pick-the-code gallery

The code-style grill runs as **pick-the-code**, not prose. For each dimension I show you real code **variants in the TUI** (`AskUserQuestion` — the code goes in each option's `preview`) and you **pick**; your pick is recorded verbatim. Variant **A** is the repo's actual incumbent (pulled verbatim by the scan, `file:symbol`-cited — you react to *your* code, warts and all); variant **B** is the de-slopped rewrite; an **uncontested** dimension collapses to a single **keep/kill** rather than a fabricated choice.

Run the full catalog: **[STYLE-CATALOG.md](../grill-me-code-style/_shared/STYLE-CATALOG.md)** — all language-conditional sections filtered by the auto-detected language, all new dimensions included.

Key behaviors:
- **Each pick → a rule card.** Chosen variant = the `✓` example; rejected variant = the `✗` case. Every card follows the fixed five-slot anatomy in [CODE-STYLE-FORMAT.md](../grill-me-code-style/_shared/CODE-STYLE-FORMAT.md): heading, `[rule:<id>] · verify: <command>` metadata line, **one-sentence** assertion, ✓/✗ block, `Why:` line. `verify:` names a real command, or `judgment`.
- **Formatting** — quotes/semis/width/trailing-commas/import-order: grill my preference but land it as a **formatter config** (per [FORMATTERS.md](../grill-me-code-style/_shared/FORMATTERS.md)), recorded as an ADR — not prose. Reconcile with any config already in the repo. The **machine-catchable slop tells** land here too as **linter rules** — prevented, not just documented.
- **AI-slop fingerprint (the tells)** — the scan's fingerprint angle brings back the recognizable AI tells **with counts**; grill each **keep or kill**. A high count is *not* a free pass — repeated slop is still slop. Killed tells become the concrete `## Never` list, each with its real `file:symbol` offender and a cross-reference to the owning `[rule:<id>]` (whose `verify:` is a real command or `judgment` — never a heading tag like `[taste]` / `[lint: …]`).
- **Over-engineering (the "too much" fingerprint)** — run [STYLE-CATALOG.md](../grill-me-code-style/_shared/STYLE-CATALOG.md) **Round 7**: grill each over-engineering family (needless indirection, fake robustness, control-flow contortion, shape noise, dead space, structural too-much/too-little — `ls`/tree the repo first — **and ceremony C1–C8** from the mandatory SCAN angle) as **keep/kill against real `file:symbol` / path offenders**. Tests: *abstraction earns its place only with a second real caller or a genuine domain concept*; *tool-first — if the CLI already does it, no house wrapper; generated orphans die with dead scripts*. Before/after: `deslop-v2` references (`line-smells`, `structure-smells`, **`ceremony-smells`**). Killed families fold into `## Never`; ceremony hits become a **kill list** in the plan (path → replace with tool / delete). Wire machine-catchable ones into lint; point mass cleanup at `deslop-v2` (“kill ceremony”).
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

## Steps 5–9 — Dependencies, golden path, framework refs, plan, write, capstone

See **[STEPS.md](../grill-me-code-style/_shared/STEPS.md)** for the shared procedures:

- **Step 5** → Audit dependencies (flag unmaintained/unstable/duplicative, record ADRs).
- **Step 6** → Compose the **golden path + slop guard** (see [EXTENSION-PATTERN.md](../grill-me-code-style/_shared/EXTENSION-PATTERN.md)) — name the unit of extension, **mine how the last 1–3 units were really added** (the `SCAN.md` "how a {unit} gets added" angle) and grill the derived numbered path step-by-step, end with a definition-of-done checklist, and wire the guard (machine-catchable `## Never` tells → the lint config that CI blocks; taste → `deslop` per-diff; ceremony → `deslop-v2` kill list).
- **Step 7** → Reference framework practices, then render the interactive planpage plan (the review gate) — including the **golden-path + guard block** and the **ceremony kill list** (paths to delete/replace with official tools) when the scan found hits.
- **Step 8** → On approval, write the files (CODE-STYLE.md incl. `## Golden path`, formatter + lint config, structure docs, ADRs, AGENTS.md digest incl. the tight golden-path mirror).
- **Step 9** → Structure review & reorg capstone (judge organization, propose moves, open PR on approval).
- **Re-running** → Idempotent; surface drift and ask "fix the code, or evolve the guide?"

</supporting-info>
