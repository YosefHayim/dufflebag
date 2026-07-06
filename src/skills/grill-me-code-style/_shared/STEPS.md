# Shared Procedures — the back half of the grill

These steps are identical for both grill variants (greenfield and existing-codebase). Each SKILL.md references this file rather than duplicating the procedures. (Formerly `STEPS-5-8.md`; renamed range-free so inserting a step never renames the file again.)

---

## Step 5 — Audit dependencies (existing) / Establish dependency policy (greenfield)

### Existing codebase

Read the package manifest. Flag unmaintained / unstable / duplicative deps and suggest alternatives. Record any library decision (keep / add / replace) + rationale as an **ADR** (`docs/adr/current/`). `CODE-STYLE.md` documents only how to USE libraries.

### Greenfield

Grill a dependency policy (2–3 quick picks):

- Pin exact versions or allow ranges? (Recommend: pin exact)
- Prefer zero-dep / minimal-dep where feasible? (Recommend: yes)
- Bundled vs peer vs dev-only boundaries.
- Acceptable license set — MIT/Apache/ISC only, or wider? (Recommend: MIT/Apache/ISC)
- "One job per dep" rule — no kitchen-sink frameworks unless the project IS that framework.

Record the policy as an **ADR**. When a library choice comes up, research + recommend a stable option (WebSearch / the `deep-research` skill), then record the choice + rationale as a separate ADR.

`CODE-STYLE.md` documents only how to USE the chosen libraries — never the choice rationale.

---

## Step 6 — Compose the golden path + slop guard

The capstone of the grill, run **after dependencies are settled and before the plan renders** so the path can reference the approved libs. Turn every pick — style, CLI, structure, deps, and the composed canonical example — into the one artifact a future contributor reaches for: **"if tomorrow we add a thing, how do we add it, and how do we not slop it up?"**

See **[EXTENSION-PATTERN.md](EXTENSION-PATTERN.md)** for the full procedure. In brief:

- **Name the unit of extension** (feature / endpoint / screen / component / Actor / module) — parameterize everything to the project's real word; don't hardcode "feature".
- **Derive a draft golden path** from the picks (existing repos also mine how the last 1–3 units were really added — see [SCAN.md](../../grill-me-code-style-with-docs/SCAN.md)), then grill it **step-by-step** (keep / adjust / reorder / cut) — react to a concrete draft, never a blank prompt.
- End it with a short **definition of done** checklist.
- **Wire the slop guard** in three layers: machine-catchable `## Never` tells → **lint config** (CI blocks, flips `[taste]`→`[lint]`); taste tells → **`deslop` per-diff**; the done-checklist → the human/agent gate. Slop is "off the golden path".

Feeds a new **golden-path block** into the Step 7 plan and a `## Golden path` section (+ tight `AGENTS.md` digest mirror + lint rules) into the Step 8 write-list.

---

## Step 7 — Reference framework practices, then render the plan (the review gate)

Detect the stack (from answers / manifest / auto-detect) and point each framework/library to the official skill that owns its best-practices:
- Workers code → `workers-best-practices`
- Cloudflare platform → `cloudflare`
- Wrangler CLI → `wrangler`
- Durable Objects → `durable-objects`
- Agents SDK → `agents-sdk`
- Expo UI → `building-native-ui`
- Expo data → `native-data-fetching`
- Expo modules → `expo-module`
- (Add others as detected)

Reference them in CODE-STYLE.md; never restate their content.

### Litmus first

The **canonical example** composed in the grill step (a real feature slice rewritten in the agreed style, or a representative feature for greenfield) is the litmus — show it to me. Seeing the whole style produce actual code catches surprises now, not at PR review; fold my reactions back into the rules before rendering.

### Render the plan

**Before writing anything**, render the plan through the **planpage** kit as a single self-contained, **interactive** HTML file. Build it from planpage's components, write it to `<tmpdir>/code-style-plan-<timestamp>.html` (resolve `$TMPDIR`; fall back to `/tmp` or `%TEMP%`; nothing lands in the repo), then **serve it for a live decision** on a **safe ephemeral port** (`planpage serve` binds an OS-assigned high port — never 3000 / 5173 / 8000 / 8080 / 8787 / 19006 or other dev-server ports):

```bash
npx planpage serve <tmpdir>/code-style-plan-<ts>.html <tmpdir>/code-style-decision-<ts>.json
```

It opens the browser and blocks until I click **Approve** or **Adjust**. Read the decision JSON — `{ approved, flips, revisit, notes }` — and act on it: `flips` re-open those picks, `revisit` re-grills them, `notes` is free feedback. (No Node / headless / port blocked? `open` the file directly; the page's **Copy decision** button hands me the same JSON to paste back — never a hang.)

Self-contained, CDN-only — no repo assets, no app code:

- **The planpage shell is the page** — it loads Tailwind + Mermaid from CDN, carries the theme, and wires the submit-bar + post-back. Plug content into its components; don't re-derive the HTML.
- **① Doc scaffold** — PROJECT / CONTEXT / LANGUAGE as `SectionCard`s tagged `create` · `validate ✓` · `drift`.
- **② Code style** — each rule as a **`PickBlock`** (✓ chosen / ✗ rejected, flippable, `data-id`) with its enforced-vs-taste tag and `file:symbol` (existing) or illustrative snippet (greenfield); the chosen **formatter + linter config** as a `CodeBlock`; the **`Never` fingerprint** (banned tells + real offenders for existing, illustrative for greenfield); the **Exemplars** (the golden files — existing only); and the composed **`## Canonical example`** — a single-file slice as a headlined `CodeBlock`, or a **multi-file** slice as a **`CodeExplorer`** (IDE file tree + editor pane; give each touched file a `before` so the reader flips old→new per file). All code is syntax-highlighted with real VSCode colour at render time — render through `renderHighlighted()` / `npx planpage render`.
- **③ CLI** — the command surface + dual-mode routing as a Mermaid `flowchart`.
- **④ Golden path + guard** — the numbered `## Golden path — adding a {unit}` as **flippable steps** (`data-id` each), the **definition-of-done** checklist, and the **guard split** (which `## Never` tells became lint rules that CI now blocks vs which stay taste/`deslop`). Derived from ②/③ and the dependency step — approved together with them.
- **⑤ Structure (before → after)** — [existing only] a directory tree and a module graph **scoped to the moved modules**, produced by `ascii-architecture-flow-mapper` (ASCII in `<pre>`; the CLI chart stays Mermaid). Render each half **only when it changed** — else a compact "✓ unchanged" chip. This reflects only incidental moves implied by the style decisions; the deep reorg is the Step 9 capstone.
- Then the **write-list**: every file to be created/edited.
- **Review the exact writes** — below the write-list, inline what will actually land for **CODE-STYLE.md** and **AGENTS.md** (both the `## Conventions` digest and `## Repo layout`), rendered as a **diff when the file exists** (green/red `<pre>` lines) or **full proposed content when new**. Other writes (ADRs, created structure docs) stay summarized in ①/②/④. Nothing lands sight-unseen.

(The planpage kit owns the shell, components, theme, and post-back — reference it and plug in content; don't reinvent the HTML. For richer diagram patterns, the `improve-codebase-architecture` report remains a good styling reference.)

The interactive plan **is** the ask — I approve or adjust in the browser and it posts back. Write nothing until the decision reads `approved: true`; on adjust, fold in `flips` / `revisit` / `notes` and re-render.

---

## Step 8 — On approval, write the files

1. Write/update **`CODE-STYLE.md`** per [CODE-STYLE-FORMAT.md](CODE-STYLE-FORMAT.md): rules (each with **✓ chosen / ✗ rejected** + an enforced-vs-taste tag), the first-class **`## Golden path — adding a {unit}`** (numbered steps + definition-of-done checklist + a cross-link to the `## Canonical example`), the secondary **`## Recipes`** (add-a-**CLI-command**, etc.), the **Exemplars** (the golden files — existing only; greenfield flags "none yet" as a finding), the **`## Canonical example`** (the composed feature slice), the **`Never` fingerprint** (concrete banned tells), and the framework-skill references. This file is the **SSOT for style**.
2. The **formatter + linter config** chosen in the grill (see [FORMATTERS.md](FORMATTERS.md)) — including the lint rules for the machine-catchable tells (the Step 6 guard's layer 1: every tell that flipped `[taste]`→`[lint]` must have a real rule here).
3. The **structure docs** flagged `create` in Step 1 (PROJECT.md via `grill-with-docs`' flow per [PROJECT-FORMAT.md](PROJECT-FORMAT.md); CONTEXT.md orientation; LANGUAGE.md names-only glossary); any **ADRs** from the CLI, dependency, and golden-path steps into `docs/adr/current/`.
4. Refresh the `## Conventions` digest in **`AGENTS.md`** — a short digest of only the load-bearing rules, marked `<!-- rules digest — full guide in CODE-STYLE.md; edit there -->`, **including the tight golden-path mirror** (one line per step + the done-checklist) — **and, when §⑤ recorded structure moves (existing only), the `## Repo layout`** to the approved "after".
5. **Edit, don't replace** — preserve the user's voice and existing content.

---

## Step 9 — Structure review & reorg (the capstone) [existing codebase only]

> **Greenfield projects skip this step** — there's no code to reorganize.

After the docs land, run one capstone pass: judge whether the codebase is **organized by purpose/job/role** and holds a **pure core / imperative shell**, using the just-written `CODE-STYLE.md` + `CONTEXT.md` as the rubric. It runs **inline and portable** — no dependency on any other skill — but it **borrows the lenses** of `improve-codebase-architecture` (cite it): the **deletion test** (would deleting this module concentrate complexity, or just move it?), **deep-vs-shallow** modules, and its caution that **pure functions extracted only for testability can lose locality** — so don't over-purify.

Present the proposal as its **own interactive planpage page** — the §⑤ renderer (before/after `TreePanel` + a neighborhood-scoped module graph via `ascii-architecture-flow-mapper`) with its **own approve/adjust gate** (a second `npx planpage serve` run on its own safe port, a separate decision file). If the structure already holds up, render **"✓ clean"** and stop — "make sure" is a valid outcome.

**On approval, execute and ship** — the one place this skill moves files:

1. Require a **clean working tree** (else stop, or cut the branch first).
2. Branch `reorg/organize-by-purpose`.
3. `git mv` the files and **rewrite every import** that referenced a moved module; update the ADR + the AGENTS.md `## Repo layout`.
4. Run the repo's **own validation gate** (typecheck + tests + formatter — e.g. `npm test` / `biome ci`). **Never push red** — red → stop and offer to roll back (`git reset --hard`).
5. `git push`, then `gh pr create` (body = the §⑤ before/after + rationale + ADR link).
6. `gh pr merge --auto --squash` — GitHub merges to `main` once required checks pass; branch protection requiring a review naturally holds it for you.
7. **No remote / CI / `gh`?** Stop at the local branch and print the exact PR command — never fake the ship.

---

## Re-running & drift

Idempotent — on re-run, re-scan (existing) or re-grill (greenfield), re-render the plan, and refresh in place. When code has drifted from `CODE-STYLE.md`, surface the conflict and ask: **fix the code, or evolve the guide?** The user's taste decides. The golden path re-derives too — if the way units get added has drifted from the recorded path, that's drift to reconcile (fix the code, or evolve the path). The Step 9 capstone re-runs too (existing only) — on a clean structure it just reports ✓. Between runs, `deslop` reads `CODE-STYLE.md` (the `## Never` list + the `## Golden path`) to enforce style per-diff.

Once a greenfield project has real code, hand off to `grill-me-code-style-with-docs`, which reads it as evidence and adds before/after.
