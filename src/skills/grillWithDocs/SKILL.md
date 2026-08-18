---
name: grill-with-docs
description: Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (LANGUAGE.md glossary, CONTEXT.md orientation, PROJECT.md purpose, ADRs) inline as decisions crystallise. Use when user wants to stress-test a plan against their project's language and documented decisions.
---

<what-to-do>

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. If a question can be answered by exploring the codebase, explore the codebase instead.

Fire every remaining question in **one** `AskUserQuestion` (the host TUI question card). Recommended option first, marked `(Recommended)`. Do not drip questions one-by-one. A second card is only for questions that could not exist until these answers landed. If the host rejects the card for size, split into the fewest cards that fit — still never one question per turn. If the host has no question tool, dump the same form as one numbered list in a single message.

</what-to-do>

<supporting-info>

## Domain awareness

During codebase exploration, also look for existing documentation:

### File structure

Most repos have a single context:

```
/
├── PROJECT.md
├── CONTEXT.md
├── LANGUAGE.md
├── docs/
│   └── adr/
│       ├── current/
│       │   ├── 0001-2026-01-04-0900-event-sourced-orders.md
│       │   └── 0002-2026-02-11-1030-postgres-for-write-model.md
│       └── archived/
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```
/
├── PROJECT.md
├── CONTEXT-MAP.md
├── LANGUAGE.md                        ← one shared glossary (sections per context)
├── docs/
│   └── adr/current|archived/          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/current|archived/ ← context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/current|archived/
```

Create files lazily — only when you have something to write. If no `LANGUAGE.md` exists, create one when the first **term** is resolved (format in [LANGUAGE-FORMAT.md](./LANGUAGE-FORMAT.md)). If no `CONTEXT.md` exists, create orientation when actors/shape need documenting — not as a glossary. If no `PROJECT.md` exists, create one when the project's purpose/direction is being pinned down (format in [PROJECT-FORMAT.md](../grill-me-code-style/_shared/PROJECT-FORMAT.md)). If no `docs/adr/` exists, create `docs/adr/current/` when the first ADR is needed.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `LANGUAGE.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update LANGUAGE.md inline (glossary)

When a term is resolved, update `LANGUAGE.md` right there. Don't batch these up — capture them as they happen. Use the format in [LANGUAGE-FORMAT.md](./LANGUAGE-FORMAT.md) (canonical exemplar: `ai-browser-bridge/LANGUAGE.md`):

```md
**Order**
A customer's request to purchase one or more items.
_Avoid_: Purchase, transaction.
```

Never write glossary tables, bullet glossaries, or colon-on-bold (`**Term**:`). Never dump terms into `CONTEXT.md`.

Matt Pocock's upstream domain-modeling skill keeps this anatomy inside `CONTEXT.md` under `## Language`. **This stack splits the concerns:** glossary → `LANGUAGE.md`; orientation → `CONTEXT.md`. Do not re-merge them.

### Keep CONTEXT.md as orientation

`CONTEXT.md` is **orientation** (what the project is, actors, shape) — not a glossary and not a spec. Keep it free of term blocks. If you find a `## Language` glossary section inside `CONTEXT.md`, migrate those terms into `LANGUAGE.md` using [LANGUAGE-FORMAT.md](./LANGUAGE-FORMAT.md) and leave orientation prose in `CONTEXT.md`.

### Capture purpose in PROJECT.md

Purpose, goals, and product direction do NOT belong in `LANGUAGE.md` (glossary), `CONTEXT.md` (orientation), or ADRs (individual decisions) — they live in `PROJECT.md`. When the project's "why" or "where it's going" comes up — or when you notice a `CONTEXT.md` that has bloated into problem statements and roadmaps — capture/extract it into `PROJECT.md` using the format in [PROJECT-FORMAT.md](../grill-me-code-style/_shared/PROJECT-FORMAT.md).

This skill is the **single owner of PROJECT.md** — for any repo, new or existing. When purpose is thin or absent, fire the seven-part **"What to ask"** checklist in [PROJECT-FORMAT.md](../grill-me-code-style/_shared/PROJECT-FORMAT.md) as **one** `AskUserQuestion`, each with a recommended default, to produce a professional PROJECT.md. Other skills (the `grill-me-code-style` pair) don't write their own purpose questions — they offer to run this flow and hand off here.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md) — new ADRs go into `docs/adr/current/`; when one supersedes another, move the old file into `docs/adr/archived/` and cross-link them.

</supporting-info>
