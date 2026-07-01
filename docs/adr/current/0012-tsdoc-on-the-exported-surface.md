---
Supersedes: 0004 (the comment stance only)
---

# 0012 — TSDoc on the exported surface

- **Status:** Accepted (2026-07-02)
- **Scope:** all TypeScript — every exported function and type in `src/**`, `src/skills/**/{hooks,lib,command}`, and `src/skills/png-to-code/scripts/**`
- **Supersedes:** the *minimal-comments* rule of [0004](0004-unified-style-and-error-model-by-role.md) — its error-model-by-role decision still stands.

## Context

The repo grew up under a **minimal-comments** doctrine: [0004](0004-unified-style-and-error-model-by-role.md)
and the old `CODE-STYLE.md` said "names + types carry meaning; keep a comment only for a
non-obvious WHY," and the `deslop` skill actively **stripped name-restating JSDoc**. The
result is a tree with ~160 `/**` prose headers but **zero** `@param`/`@returns` — the public
surface is under-documented for hover-docs and for an agent skimming a signature.

The owner's taste has shifted: a library-shaped CLI wants its **public contract documented**,
not inferred. A grill (2026-07-02) resolved the conflict in favour of documentation — the
owner's taste is the source of truth, so the guide now records the desired end-state.

## Decision

**Every *exported* function and type carries TSDoc.** Concretely:

- A one-line summary sentence.
- `@param` for **each** parameter.
- `@returns` for every non-`void` return.
- One doc line per `interface`/`type` **property**.

**Non-exported / local one-liner helpers are exempt** — they get a summary only when the
name isn't self-evident. This keeps the anti-noise spirit *inside* a module while making the
**boundary** fully documented.

`deslop` flips accordingly: its comment rule changes from "strip name-restating JSDoc" to
"**an exported symbol without TSDoc is a primary target**." At the public surface a `@param`
that restates a well-named parameter is acceptable — it is contract documentation, not noise.
The [0004](0004-unified-style-and-error-model-by-role.md) error-model-by-role table is
untouched.

## Consequences

- **+** A navigable, hover-documented public API; an agent reading a single signature gets
  the contract without opening the body.
- **+** One unambiguous rule `deslop` and reviewers can enforce per-diff (exported ⇒ TSDoc).
- **−** A one-time backfill of `@param`/`@returns` across the exported surface.
- **−** The "no name-restating comment" rule now applies **only to internal code**; at the
  boundary we accept some restatement as the price of a documented contract.
