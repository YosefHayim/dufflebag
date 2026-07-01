# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`src/skills/png-to-code/CONTEXT.md`** — domain vocabulary and workflow contract for the png-to-code skill
- **`src/skills/png-to-code/TECH-GLOSSARY.md`** — technical term glossary (tools and concepts)
- **`src/skills/png-to-code/docs/adr/`** — read ADRs that touch the area you're about to work in

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront.

## File structure

Single-context layout for png-to-code:

```
src/skills/png-to-code/
├── CONTEXT.md
├── TECH-GLOSSARY.md
├── docs/adr/
│   └── (architectural decisions)
└── scripts/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 — but worth reopening because…_
