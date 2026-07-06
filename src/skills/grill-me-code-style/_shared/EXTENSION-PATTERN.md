# Compose the golden path + slop guard

The capstone of the grill. After the style picks, the CLI, the structure, and the dependency policy are settled — and the **canonical example** is composed — turn all of it into the one artifact a future contributor (human or agent) actually reaches for: **"if tomorrow we add a thing, how do we add it, and how do we not slop it up?"**

This step is **identical for both variants** — greenfield derives from picks (illustrative), existing derives from picks **plus** evidence of how units were really added. It runs **after the dependency step and before the plan renders**, so the path can reference the approved libs. Its output is a `## Golden path` section in `CODE-STYLE.md`, a tight mirror in the `AGENTS.md` digest, and lint rules for the machine-catchable tells. Nothing is written until Step 7.

---

## Step A — Name the unit of extension

The golden path is a path for adding **one thing**. That thing is not always a "feature" — grill/detect the project's real **unit of extension** and name everything after it:

- Detect candidates from the structure scan / picks: `feature`, `endpoint`, `screen`, `component`, `route`, `Actor`, `command`, `module`, `package`.
- A repo may have **more than one** unit (e.g. an API with both `endpoint` and `job`). Grill: is there one paved road, or one per unit? Default to **the single most-added unit**; add a second path only if a real second unit exists.
- The chosen word templates the section title `## Golden path — adding a {unit}` and every step's prose. Never leave it as the generic "feature" if the project's real word is `endpoint`/`screen`/etc.

> **Terminology guard:** in some repos "feature" is already a loaded, specific term (e.g. an installable, catalog-registered thing). Don't reuse it for the generic unit — pick the word that reads natively in THIS repo.

---

## Step B — Compose the draft golden path (derive, don't ask)

Do **not** ask "what's your process?" — that yields aspirational prose. Instead **derive a concrete draft** and make me react to it.

Compose an ordered, numbered draft from what's already decided:

- **The picks** — style rules, error handling, test placement, naming.
- **The CLI** — if there's a scaffold command, step 1 is usually "run it".
- **The structure** — where the new unit's files live (folder, barrel, registration point).
- **The dependencies** — how an approved lib is added/used, if the unit needs one.
- **The canonical example** — the path's steps are literally "produce something shaped like the canonical example". Cross-link them.

**Existing repos — mine the real path first.** Before drafting, reconstruct the **de-facto** path from evidence (the scan's "how a {unit} gets added" angle — see `SCAN.md`): the last 1–3 units added (git history / recent slices), the ordered seams each touched (route table, DI registration, migration, test, docs). Present the draft as **"this is how the last {unit}s were actually added — is this the path you WANT, or the slop you want gone?"** Code is evidence, not gospel; my taste decides the end-state. If units were added ad-hoc with **no** consistent path, that's a finding — say so, and the golden path becomes the paved road that didn't exist yet.

Each draft step is **concrete and project-specific**: real file paths, real registration points, the real test command — never "write clean code" or "add tests" in the abstract.

---

## Step C — Grill the path step-by-step

Present the numbered draft and grill it as **keep / adjust / reorder / cut**, one step at a time — the same react-to-a-concrete-artifact discipline as the pick-the-code gallery, not a blank prompt. Fold each reaction back into the ordered list. When a step encodes a real trade-off with genuine alternatives (e.g. "register in a central manifest" vs "convention-based auto-discovery"), that's ADR-worthy — offer one.

End the path with a short **definition of done** checklist — the last gate before a unit is "in". Derive it from the picks; keep it to what's actually load-bearing for THIS repo. Typical entries (grill each in/out, don't paste them all):

- Shaped like the **canonical example** / follows the golden-path steps.
- Tests **co-located** and green (the repo's real test command).
- The unit is **registered / wired** at its real seam (route table, catalog, DI) — not orphaned.
- Docs updated **only when they must** — `LANGUAGE.md` if a new term entered the vocabulary; `CONTEXT.md`/`AGENTS.md` layout if the shape changed; the framework skill's practices followed.
- **No `## Never` tells** introduced (see the guard below).

---

## Step D — Wire the slop guard (layered)

The guard is what keeps the path paved as the project is maintained. Slop is defined as **"off the golden path"**. Build it in three layers, strongest first — this **complements** the `## Never` fingerprint the STYLE-CATALOG round already produced; it doesn't re-grill it.

1. **Mechanical → lint config (CI blocks it).** Every `## Never` tell that a linter *can* catch (banned micro-helpers, redundant guards, nested ternaries, generic names via naming rules, one-use wrappers) gets a real rule in the committed `biome`/`eslint` config from [FORMATTERS.md](FORMATTERS.md). Its `CODE-STYLE.md` entry flips from `[taste]` to `[lint: <rule>]`. A tell that CI blocks can't regress silently — this is the primary guard.
2. **Taste → `deslop` per-diff.** Tells a linter can't catch (locality, over-abstraction, drift from the canonical example) stay `[taste]` and are enforced by `deslop`, which reads `CODE-STYLE.md` (the `## Never` list + the `## Golden path`) on every diff. Confirm `deslop` is installed/available; if not, flag it — the taste layer has no teeth without it.
3. **Human/agent → the done-checklist.** The definition of done from Step C is the last-mile gate the golden path itself carries.

Record which tells landed in which layer — the plan's guard block shows the split (lint rules added vs taste/deslop), so I see exactly what CI will now catch.

---

## Step E — Feed the plan and the write-list

This step contributes to the **single planpage plan** (rendered in the shared plan step — no separate gate):

- A new **first-class block after the CLI block**: the numbered `## Golden path — adding a {unit}` as **flippable steps** (`data-id` each), the **done-checklist**, and the **guard split** (which `## Never` tells became lint rules vs stay taste/`deslop`).

And to the **Step 7 write-list**:

- `CODE-STYLE.md` gains a first-class **`## Golden path — adding a {unit}`** (numbered steps + done-checklist + a cross-link to the `## Canonical example`). The pre-existing `## Recipes` **stays** for secondary how-tos (add-a-CLI-command, etc.) — the golden path is the one paved road; recipes are the side-tasks.
- The `AGENTS.md` `## Conventions` digest gains a **tight** mirror — one line per golden-path step + the done-checklist — since "how to add a {unit} here" is exactly what an agent needs before touching code. Full prose + ✓/✗ examples stay in `CODE-STYLE.md`.
- The **lint config** gains the rules from layer 1; any **ADR** offered in Step C.
