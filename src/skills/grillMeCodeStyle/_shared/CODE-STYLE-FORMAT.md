# CODE-STYLE.md Format

`CODE-STYLE.md` is the single source of truth for **how** code is written in this project. It is **prescriptive** (how to write), not **descriptive** (what exists — that's `AGENTS.md`). Keep it concrete and project-specific. No generic advice a reader could guess — only load-bearing decisions.

Every repository uses the **same** structure, so a reader who knows one project's guide can audit another's. The structure is **machine-checked**, not merely recommended — see `## Enforce the format` below.

## The rule card

Every rule is one card with the same five slots in the same order. Nothing else goes in `## Rules`.

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
| `###` heading | Short human name. No ID, no tags. |
| Metadata line | First non-blank line under the heading. Exactly `[rule:<id>] · verify: \`<command>\`` — or `· verify: judgment` when no detector exists. |
| Assertion | **Exactly one sentence, ending in a period.** Must match the machine mirror's `statement` byte for byte. |
| Example | One fenced block containing both a `// ✓` and a `// ✗` case. |
| `Why:` | One line. Rationale, not restatement. |

Rules for the slots:

- **One assertion per ID.** If the rule needs a second sentence, it is a second rule with its own ID. This is the whole point: a multi-clause paragraph cannot be given a yes/no verdict against a diff, so it cannot be audited.
- **Push the sub-cases into the `// ✗` block.** When one detector legitimately covers several shapes (three positionals, a rest parameter, a positional boolean), the assertion states the intent once and the rejected block enumerates the shapes as code.
- **`verify:` names a command that really exists.** Run it before writing it down. `judgment` means a reviewer owns the rule; it is not a synonym for "unimportant", and it is not a place to park rules you could mechanize.
- **✓ / ✗ come from real code where possible** — cite the real path in the ✓ comment. A greenfield project may use illustrative snippets.
- **IDs are stable.** Renaming an ID breaks any detector that emits it and every cross-reference. Prefer adding an ID over renaming one.

## The machine mirror

`code-style.rules.json` sits beside the guide and mirrors it exactly:

```json
{
  "version": 3,
  "guide": "CODE-STYLE.md",
  "rules": [
    {
      "id": "function.arrow-only",
      "statement": "Named functions are arrow constants declared before first use.",
      "verify": "pnpm style"
    }
  ]
}
```

- `statement` is byte-identical to the card's assertion. This makes the JSON a **guaranteed-accurate index** of the guide, so an audit can start from either file with no drift risk.
- `verify` is byte-identical to the card's command, or `judgment`.
- Every ID appears exactly once in each file, in the same order.
- A project may add its own top-level keys (allowlists, protected paths). Keep them out of `rules[]`.

Exemplar to copy: `code-style.rules.json` in dufflebag.

## Required sections

In this order. The linter requires all five to be present:

1. `## Rules` — the cards. Nothing else.
2. `## Canonical example` — every rule composed on **one real feature slice**, so the whole style is legible at a glance rather than atomized. Illustrative documentation, not shipping code, and the positive target `deslop` steers toward.
3. `## Golden path — adding a {unit}` — THE paved road for the project's real unit of extension (feature / endpoint / screen / component / module), never the generic "feature" unless that is the real word. Numbered, concrete steps with real paths and real registration seams — never abstract "add tests" prose. Ends in a **Definition of done** checklist and cross-links the canonical example. One per project.
4. `## Exemplars` — real "write new code like this" files, one line each. Mandatory: if no file qualifies yet, that is a finding to surface, not an empty section.
5. `## Never` — the AI-slop fingerprint for THIS repo. Concrete banned shapes, each cross-referencing the rule that owns it (`[rule:<id>]`). Name the actual tells (`isRecord`-style micro-helpers, defensive over-guards, nested ternaries, one-use wrappers, generic names), never an abstract prohibition.

A preamble before `## Rules` (precedence, SSOT pointers, migration status) and trailing sections (formatting, verification commands) are allowed and encouraged.

Optional but recommended: a short `## How to read a rule` table after the preamble, so a human auditing an agent's diff knows what each slot means without opening this spec.

## Enforce the format

A documented format that only agents are asked to follow is the format that 18 of 24 repositories ignored. Wire it to the gate instead:

- Copy `scripts/checkStyleGuide.ts` from dufflebag. It is a pure function over `(guide text, rules)` with no repo-specific assumptions, so it drops into any project.
- Add a test that runs it against the repo's **real** `CODE-STYLE.md` and asserts zero violations. Because the test suite is part of the verify gate, a malformed guide then fails CI.
- Check any repository from dufflebag without installing anything: `pnpm style:guide /path/to/repo`.

The linter catches: a missing or malformed metadata line, a multi-sentence assertion, an assertion that drifts from the machine `statement`, a `verify` that drifts from the mirror, a missing ✓ or ✗ case, a missing `Why:` line, a duplicated card, a rule with no card, a card with no machine entry, and a missing required section. It deliberately ignores `###`/`##` lines inside fenced examples.

## Stack and framework practices

For framework/library best-practices, reference the owning skill instead of restating it, so its SSOT cannot go stale:

```md
## Stack & framework practices

- {Workers code} → `workers-best-practices`
- {Expo UI} → `building-native-ui`

This file covers only what is specific to THIS project on top of those.
```

## Rules for writing it

- **Prescriptive, not descriptive.** How to write, not what exists.
- **Project-specific only.** If a rule applies to every project in the language, it is generic — cut it or defer to the framework skill.
- **Slop is "off the golden path" — guard it in layers.** Every machine-catchable `## Never` tell becomes a real detector that CI blocks (primary guard); taste-only tells stay `judgment` for `deslop` per-diff; the done-checklist is the human gate. Move a rule from `judgment` to a real command the moment it becomes mechanically checkable.
- **Keep it tight.** The `AGENTS.md` digest holds the always-loaded summary; depth lives here, read on-demand and by `deslop`. Length comes from the number of real rules, not from prose around them.
