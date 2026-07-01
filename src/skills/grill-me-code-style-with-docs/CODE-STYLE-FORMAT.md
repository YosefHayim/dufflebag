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

Load-bearing, project-specific rules only. Each: a one-line rule + a real before/after.

### {Rule name}
{One line: the rule.}
```ts
// before  (src/real/file.ts)
...
// after
...
```
_Why:_ {one line; tie to purpose where relevant.}

## Recipes

### How to add a {feature / module / endpoint}
1. ...
2. ...

## Exemplars

Write new code like these files:
- `src/x.ts` — {what it exemplifies}

## Never
- {anti-pattern} — {one-line reason}
```

## Rules for writing it

- **Prescriptive, not descriptive.** How to write, not what exists.
- **Project-specific only.** If a rule applies to every project in the language, it's generic — cut it or defer to the framework skill.
- **Before/after from real code** in existing repos (cite `file:symbol`). The greenfield variant has no before/after — a short illustrative snippet instead.
- **Reference framework skills; never copy them.** Their SSOT stays in the skill, so it can't go stale.
- **Keep it tight.** The `AGENTS.md` digest holds the always-loaded summary; depth lives here, read on-demand and by `deslop`.
