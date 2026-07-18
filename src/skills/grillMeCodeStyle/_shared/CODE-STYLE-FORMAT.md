# CODE-STYLE.md Format

`CODE-STYLE.md` is the single source of truth for **how** code is written in this project. It is **prescriptive** (how to write), not **descriptive** (what exists — that's `AGENTS.md`). Keep it concrete and project-specific. No generic advice a reader could guess — only load-bearing decisions.

## Structure

```md
# CODE-STYLE.md

How code is written in {project}. Prescriptive. The rules digest is mirrored into
AGENTS.md; this file is the source — edit here.

## Stack & framework practices

For framework/library best-practices, follow these skills (do not restate them here):
- {Workers code} → `workers-best-practices`
- {Expo UI}      → `building-native-ui`
- ...
This file covers only what's specific to THIS project on top of those.

## Rules

Load-bearing, project-specific rules only. Each: a one-line rule + the **✓ chosen / ✗ rejected** pair from the pick-the-code grill + an enforcement tag (`[lint: <rule>]` if a linter catches it, else `[taste]`).

### {Rule name} · {[lint: rule] | [taste]}
{One line: the rule.}
```ts
// ✓ chosen  (src/real/file.ts)
...
// ✗ not this
...
```
_Why:_ {one line; tie to purpose where relevant.}

## Canonical example

The agreed style assembled on one real feature slice — every rule working together, so a reader (human or agent) sees the whole pattern at a glance, not just atomized rules. Illustrative documentation, not shipping code; it's the litmus shown in the plan and a positive target for `deslop`.

```ts
// src/orders/create-order.ts — the composed style, every pick together
...
```

## Golden path — adding a {unit}

THE paved road for adding this project's main **unit of extension** — use the project's real word ({feature / endpoint / screen / component / Actor / module}), not the generic "feature". Numbered, **concrete, project-specific** steps — real paths and real registration seams, never abstract "add tests" prose. Following it produces something shaped like the `## Canonical example` (cross-link it). One golden path per project (a second only if a real second unit exists).

1. {create the files at `src/{unit}/…`}
2. {register/wire it at its real seam — route table / catalog / DI / manifest}
3. {write the co-located test; run `<the repo's real test command>`}
4. …

**Definition of done** — the last gate before a {unit} is "in":
- [ ] Shaped like the `## Canonical example` / follows the steps above.
- [ ] Tests co-located and green.
- [ ] Registered/wired at its real seam (not orphaned).
- [ ] Docs updated only where they must — `LANGUAGE.md` for a new term; `CONTEXT.md`/`AGENTS.md` layout if the shape changed.
- [ ] No `## Never` tells introduced.

## Recipes

Secondary how-tos — side-tasks, not the main paved road:

### How to add a {CLI command / smaller module}
1. ...
2. ...

## Exemplars

Write new code like these files:
- `src/x.ts` — {what it exemplifies}

## Never
The AI-slop fingerprint for THIS repo — concrete banned patterns, each with a real offender and how it's caught:
- {anti-pattern} — {one-line reason} · {`file:symbol` offender} · {[lint: rule] | [taste]}
```

## Rules for writing it

- **Prescriptive, not descriptive.** How to write, not what exists.
- **Project-specific only.** If a rule applies to every project in the language, it's generic — cut it or defer to the framework skill.
- **✓ chosen / ✗ rejected from real code** in existing repos (cite `file:symbol`) — the two variants I picked between in the gallery, so the rule shows both what to write and what to avoid. The greenfield variant has no real code — an illustrative chosen snippet plus a plausible rejected one instead.
- **The `## Canonical example` is mandatory** — compose every pick into one real feature slice so the whole style is legible at a glance. It's the litmus shown in the plan and a positive target `deslop` can steer toward.
- **The `## Golden path` is THE paved road** — one per project, parameterized to the real unit of extension, its steps concrete (real paths/seams, never "add tests" in the abstract), ending in a definition-of-done checklist and cross-linking the `## Canonical example` (the path's output). Mirrored **tight** into the `AGENTS.md` digest, since "how to add a {unit} here" is what an agent needs before touching code. `## Recipes` stays for secondary side-tasks.
- **Slop is "off the golden path" — guard it in layers.** Every machine-catchable `## Never` tell becomes a real `[lint]` rule that CI blocks (primary guard); taste-only tells stay `[taste]` for `deslop` per-diff; the done-checklist is the human/agent gate. Prefer moving a tell up a layer (taste → lint) whenever it becomes mechanically checkable.
- **The `Never` list is the AI-slop fingerprint, made concrete.** Name the actual tells (`isRecord`-style micro-helpers, defensive over-guards, nested/duplicated ternaries, one-use wrappers, boilerplate clones, generic names) — each with a real `file:symbol` offender from the scan, never an abstract prohibition.
- **Tag every rule enforced-vs-taste.** `[lint: <rule>]` when a linter catches it (and that rule must exist in the committed biome/eslint config), else `[taste]`. Move a taste rule to `[lint]` whenever it becomes mechanically checkable.
- **Exemplars are mandatory** — name at least one real "write new code like this" file; if none qualifies yet, that's a finding to surface, not an empty section.
- **Reference framework skills; never copy them.** Their SSOT stays in the skill, so it can't go stale.
- **Keep it tight.** The `AGENTS.md` digest holds the always-loaded summary; depth lives here, read on-demand and by `deslop`.
