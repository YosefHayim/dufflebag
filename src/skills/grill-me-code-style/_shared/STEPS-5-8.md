# Shared Procedures — Steps 5–8

These steps are identical for both grill variants (greenfield and existing-codebase). Each SKILL.md references this file for Steps 5–8 rather than duplicating the procedures.

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

## Step 6 — Reference framework practices, then render the plan (the review gate)

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
- **① Doc scaffold** — PROJECT / CONTEXT / LANGUAGE as `section-card`s tagged `create` · `validate ✓` · `drift`.
- **② Code style** — each rule as a **`pick-block`** (✓ chosen / ✗ rejected, flippable, `data-id`) with its enforced-vs-taste tag and `file:symbol` (existing) or illustrative snippet (greenfield); the chosen **formatter + linter config** as a `code-block`; the **`Never` fingerprint** (banned tells + real offenders for existing, illustrative for greenfield); the **Exemplars** (the golden files — existing only); and the composed **`## Canonical example`** as a headlined `code-block`.
- **③ CLI** — the command surface + dual-mode routing as a Mermaid `flowchart`.
- **④ Structure (before → after)** — [existing only] a directory tree and a module graph **scoped to the moved modules**, produced by `ascii-architecture-flow-mapper` (ASCII in `<pre>`; the CLI chart stays Mermaid). Render each half **only when it changed** — else a compact "✓ unchanged" chip. This reflects only incidental moves implied by the style decisions; the deep reorg is the Step 8 capstone.
- Then the **write-list**: every file to be created/edited.
- **Review the exact writes** — below the write-list, inline what will actually land for **CODE-STYLE.md** and **AGENTS.md** (both the `## Conventions` digest and `## Repo layout`), rendered as a **diff when the file exists** (green/red `<pre>` lines) or **full proposed content when new**. Other writes (ADRs, created structure docs) stay summarized in ①/②. Nothing lands sight-unseen.

(The planpage kit owns the shell, components, theme, and post-back — reference it and plug in content; don't reinvent the HTML. For richer diagram patterns, the `improve-codebase-architecture` report remains a good styling reference.)

The interactive plan **is** the ask — I approve or adjust in the browser and it posts back. Write nothing until the decision reads `approved: true`; on adjust, fold in `flips` / `revisit` / `notes` and re-render.

---

## Step 7 — On approval, write the files

1. Write/update **`CODE-STYLE.md`** per [CODE-STYLE-FORMAT.md](CODE-STYLE-FORMAT.md): rules (each with **✓ chosen / ✗ rejected** + an enforced-vs-taste tag), recipes (incl. add-a-**CLI-command**), the **Exemplars** (the golden files — existing only; greenfield flags "none yet" as a finding), the **`## Canonical example`** (the composed feature slice), the **`Never` fingerprint** (concrete banned tells), and the framework-skill references. This file is the **SSOT for style**.
2. The **formatter + linter config** chosen in the grill (see [FORMATTERS.md](FORMATTERS.md)) — including the lint rules for the machine-catchable tells.
3. The **structure docs** flagged `create` in Step 1 (PROJECT.md via `grill-with-docs`' flow per [PROJECT-FORMAT.md](PROJECT-FORMAT.md); CONTEXT.md orientation; LANGUAGE.md names-only glossary); any **ADRs** from the CLI and dependency steps into `docs/adr/current/`.
4. Refresh the `## Conventions` digest in **`AGENTS.md`** — a short digest of only the load-bearing rules, marked `<!-- rules digest — full guide in CODE-STYLE.md; edit there -->` — **and, when §④ recorded structure moves (existing only), the `## Repo layout`** to the approved "after".
5. **Edit, don't replace** — preserve the user's voice and existing content.

---

## Step 8 — Structure review & reorg (the capstone) [existing codebase only]

> **Greenfield projects skip this step** — there's no code to reorganize.

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

---

## Re-running & drift

Idempotent — on re-run, re-scan (existing) or re-grill (greenfield), re-render the plan, and refresh in place. When code has drifted from `CODE-STYLE.md`, surface the conflict and ask: **fix the code, or evolve the guide?** The user's taste decides. The Step 8 capstone re-runs too (existing only) — on a clean structure it just reports ✓. Between runs, `deslop` reads `CODE-STYLE.md` to enforce style per-diff.

Once a greenfield project has real code, hand off to `grill-me-code-style-with-docs`, which reads it as evidence and adds before/after.
