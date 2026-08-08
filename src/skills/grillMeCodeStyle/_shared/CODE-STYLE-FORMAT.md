# CODE-STYLE.md Format

`CODE-STYLE.md` is the single source of truth for **how** code is written in this
project. It is **prescriptive** (how to write), not **descriptive** (what exists —
that's `AGENTS.md`). Keep it concrete and project-specific. No generic advice a
reader could guess — only load-bearing decisions.

Every repository uses the **same** structure, so a reader who knows one project's
guide can audit another's. The structure is **machine-checked**, not merely
recommended — see `## Enforce the format` below.

**SSOT root (this package only — never a product repo):**

| Layer | Path in dufflebag |
| --- | --- |
| Format (how to write the guide) | this file — `CODE-STYLE-FORMAT.md` |
| Living exemplar (real project guide) | repo root `CODE-STYLE.md` + `code-style.rules.json` |
| Scaffold for new projects | `templates/mdFiles/CODE-STYLE.md` + `templates/mdFiles/code-style.rules.json` |
| Machine checker | `scripts/checkStyleGuide.ts` (`pnpm style:guide`) |

When in doubt, copy **this package’s** root guide and scaffold — not an older product
guide that uses `[taste]` / `[lint: …]` tags or multi-paragraph rules. Do **not**
pin the format to any external repository.

## Forbidden shapes (historical drift — convert on sight)

| Forbidden | Why |
| --- | --- |
| `### Title · [taste]` / `### Title · [lint: …]` / `### Title · [CI: …]` | Tags belong on the metadata line as `verify:`, never in the heading |
| `_Why:` / `_Why:_` / `**Why:**` | The slot is plain `Why:` |
| `// [GOOD]` / `// Good` / `// chosen` / `// BAD` / `// not this` | Markers are exactly `// ✓` and `// ✗` |
| Multi-sentence / multi-paragraph rule bodies under `## Rules` | One assertion sentence per card; extra clauses are new cards or live in the ✗ block |
| Prose sections instead of rule cards (`## Naming`, `## Shape`, bullet lists of rules) | Everything enforceable is a five-slot card under `## Rules` |
| `code-style.rules.json` with `channel` / `enforcedBy` / `summary` as the primary fields | v3+ mirror is only `{ id, statement, verify }` per rule (extra top-level keys ok) |
| Uncle Bob / generic clean-code scaffolds as the project guide | Project-specific decisions only; philosophy books are not this file |

## The rule card

Every rule is one card with the same five slots in the **same order**. Nothing else
goes in `## Rules`.

```md
### {Short human name}
[rule:{dotted.id}] · verify: `{command}`

{Exactly one sentence stating the whole rule.}

```ts
// ✓ {real/path.ts}
{the chosen code}

// ✗ {short reason}
{the rejected code}
```

Why: {one line}
```

| Slot | Requirement |
| --- | --- |
| `###` heading | Short human name only. No ID, no tags, no `· [taste]`. |
| Metadata line | First non-blank line under the heading. Exactly `[rule:<id>] · verify: \`<command>\`` — or `· verify: judgment` when no detector exists. |
| Assertion | **Exactly one sentence, ending in a period.** Must match the machine mirror's `statement` byte for byte. |
| Example | One fenced block containing both a `// ✓` and a `// ✗` case. |
| `Why:` | One line. Rationale, not restatement. |

Rules for the slots:

- **One assertion per ID.** If the rule needs a second sentence, it is a second rule
  with its own ID. A multi-clause paragraph cannot get a yes/no verdict against a
  diff, so it cannot be audited.
- **Push sub-cases into the `// ✗` block.** When one detector covers several shapes,
  the assertion states the intent once and the rejected block enumerates the shapes.
- **`verify:` names a command that really exists.** Run it before writing it down.
  `judgment` means a reviewer owns the rule; it is not a synonym for "unimportant",
  and it is not a place to park rules you could mechanize.
- **✓ / ✗ come from real code where possible** — cite the real path in the ✓ comment.
  A greenfield project may use illustrative snippets.
- **IDs are stable.** Renaming an ID breaks any detector that emits it and every
  cross-reference. Prefer adding an ID over renaming one.
- **Dotted IDs preferred** (`functions.arrow-constants`, `names.domain-specific`).
  Hyphenated legacy IDs may stay if already wired to detectors.

## The machine mirror

`code-style.rules.json` sits beside the guide and mirrors it exactly:

```json
{
  "version": 3,
  "guide": "CODE-STYLE.md",
  "rules": [
    {
      "id": "functions.arrow-constants",
      "statement": "Named non-framework functions are arrow constants declared before first use.",
      "verify": "npm run style:code"
    }
  ]
}
```

- `statement` is byte-identical to the card's assertion.
- `verify` is byte-identical to the card's command, or `judgment`.
- Every ID appears exactly once in each file, **in the same order**.
- A project may add its own top-level keys (allowlists, protected paths). Keep them
  out of `rules[]`.
- Do **not** use the old channel schema (`channel`, `enforcedBy`, `summary`,
  `docSection`) as the primary rule object — those are obsolete. If a repo still has
  them, convert to `{ id, statement, verify }` on the next rewrite.

Exemplar to copy: this package’s root `code-style.rules.json`. For a greenfield
scaffold, start from `templates/mdFiles/code-style.rules.json`.

## Required document shape

### Title + preamble

```md
# {Project} code style

This guide is prescriptive for {project}-owned code. {Optional one-line scope note.}

Precedence: product boundaries in PROJECT.md, system orientation in CONTEXT.md
(or docs/reference/CONTEXT.md), product vocabulary in LANGUAGE.md (or
docs/reference/LANGUAGE.md), then this guide.
```

Keep the preamble short. Migration status, allowlists, and long toolchain essays go
in trailing sections — not before the rule cards absorb all attention.

### Required sections (this order)

The linter requires the five core sections. Agents **must** also emit the full
document shape below (matching this package’s root `CODE-STYLE.md`):

1. **`## How to read a rule`** — short table of the five slots (required for agents;
   recommended in CI until every repo is converted).
2. **`## Rules`** — the cards only. Nothing else.
3. **`## Canonical example`** — every rule composed on **one real feature slice**, so
   the whole style is legible at a glance. Illustrative documentation, not shipping
   code; the positive target `deslop` steers toward.
4. **`## Golden path — adding a {unit}`** — THE paved road for the project's real unit
   of extension (feature / endpoint / screen / component / module), never the generic
   "feature" unless that is the real word. Numbered, concrete steps with real paths
   and real registration seams. Ends in a **Definition of done** checklist and
   cross-links the canonical example. One primary path per project.
5. **`## Exemplars`** — real "write new code like this" files, one line each. If no
   file qualifies yet, that is a finding to surface, not an empty section.
6. **`## Never`** — the AI-slop fingerprint for THIS repo. Concrete banned shapes,
   each cross-referencing the rule that owns it (`[rule:<id>]`). Name the actual
   tells, never an abstract prohibition.

### Allowed trailing sections

After `## Never`, these are allowed and encouraged:

- **`## Stack and framework practices`** (or `## Stack & framework practices`) —
  pointers to skills only; never restate their content.
- **`## Recipes`** — secondary how-tos (add a CLI command, etc.), not the golden path.
- **`## Verification`** (or `## Formatting and verification`) — real commands that
  prove the guide.

A short preamble before `## How to read a rule` is allowed. Do **not** invent alternate
primary structures (`## Shape`, `## TypeScript Shape`, `## Core rules` as the home of
rules). Convert those into rule cards under `## Rules`.

### `## How to read a rule` (copy this table)

```md
## How to read a rule

| Slot | Meaning |
| --- | --- |
| rule ID | Stable review and detector key |
| verify | Cheapest command that proves the rule, or judgment |
| chosen / rejected | The local idiom and the concrete failure shape |
```

## Enforce the format

A documented format that only agents are asked to follow is the format that most
repositories ignore. Wire it to the gate:

- Copy `scripts/checkStyleGuide.ts` from dufflebag. It is a pure function over
  `(guide text, rules)` with no repo-specific assumptions.
- Add a test that runs it against the repo's **real** `CODE-STYLE.md` and asserts
  zero violations.
- Check any repository from dufflebag without installing anything:
  `pnpm style:guide /path/to/repo`.

The linter catches: a missing or malformed metadata line, a multi-sentence assertion,
an assertion that drifts from the machine `statement`, a `verify` that drifts from the
mirror, a missing ✓ or ✗ case, a missing `Why:` line, a duplicated card, a rule with
no card, a card with no machine entry, and a missing required section. It deliberately
ignores `###`/`##` lines inside fenced examples.

## Stack and framework practices

For framework/library best-practices, reference the owning skill instead of restating
it, so its SSOT cannot go stale:

```md
## Stack and framework practices

- {Workers code} → `workers-best-practices`
- {Expo UI} → `building-native-ui`

This file covers only what is specific to THIS project on top of those.
```

## Rules for writing it

- **Prescriptive, not descriptive.** How to write, not what exists.
- **Project-specific only.** If a rule applies to every project in the language, it is
  generic — cut it or defer to the framework skill.
- **Slop is "off the golden path" — guard it in layers.** Every machine-catchable
  `## Never` tell becomes a real detector that CI blocks (`verify:` names that
  command); taste-only tells stay `verify: judgment` for `deslop` per-diff; the
  done-checklist is the human gate. Move a rule from `judgment` to a real command the
  moment it becomes mechanically checkable.
- **Keep it tight.** The `AGENTS.md` digest holds the always-loaded summary; depth
  lives here, read on-demand and by `deslop`. Length comes from the number of real
  rules, not from prose around them.

## Who writes this file

| Skill | Role |
| --- | --- |
| `grill-me-code-style` | Greenfield — write the full guide on approval |
| `grill-me-code-style-with-docs` | Existing codebase — rewrite/refresh from evidence |
| `grill-me-code-style-coach` / `grill-me-code-style-review` | **Read** `code-style.rules.json` + cards; do not invent alternate formats |
| `deslop` / `deslop-v2` | Enforce `## Never` + golden path per-diff |

When refreshing an existing guide that uses a forbidden shape, **convert it** to this
format. Do not leave hybrid cards (`### Title · [taste]` with a partial metadata line).
