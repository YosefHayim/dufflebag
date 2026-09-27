# ADR Format

ADRs live under `docs/adr/`, split by lifecycle into two folders:

- `docs/adr/current/` — active decisions
- `docs/adr/archived/` — superseded decisions (kept for the record)

Filename: `NNNN-YYYY-MM-DD-HHMM-slug.md` — e.g. `0012-2026-07-01-1430-widget-gate.md`. The `NNNN` is the **permanent citation ID** (it never changes, so an `ADR-0012` reference survives the file moving between folders); the date-time records when the decision was authored.

Create `docs/adr/current/` lazily — only when the first ADR is needed. (Legacy flat `docs/adr/*.md` from before this convention can stay put or be moved into `current/`; new ADRs go into `current/`.)

## Template

```md
---
Supersedes:            # optional: NNNN of the ADR this replaces
---

# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it. An ADR can be a single paragraph. The value is in recording *that* a decision was made and *why* — not in filling out sections.

## Optional sections

Only include these when they add genuine value. Most ADRs won't need them.

- **Considered Options** — only when the rejected alternatives are worth remembering
- **Consequences** — only when non-obvious downstream effects need to be called out

## Lifecycle

The folder is the primary status signal — `current/` vs `archived/`. When a decision is superseded:

1. Write the new ADR into `docs/adr/current/` with `Supersedes: MMMM` in its frontmatter.
2. Move the old ADR's file into `docs/adr/archived/` and add `Superseded-by: NNNN` to its frontmatter.

The `NNNN` never changes, so citations like `ADR-0012` keep resolving (look in `current/`, then `archived/`). These frontmatter links carry the "what changed" trail without duplicating files — git holds the full diff history, so there is no need for `original/` or `modified/` folders.

## Numbering

Scan **both** `docs/adr/current/` and `docs/adr/archived/` (and any legacy flat `docs/adr/*.md`) for the highest existing `NNNN` and increment by one. Numbers are never reused, even after a decision is archived.

## When to offer an ADR

All three of these must be true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If a decision is easy to reverse, skip it — you'll just reverse it. If it's not surprising, nobody will wonder why. If there was no real alternative, there's nothing to record beyond "we did the obvious thing."

### What qualifies

- **Architectural shape.** "We're using a monorepo." "The write model is event-sourced, the read model is projected into Postgres."
- **Integration patterns between contexts.** "Ordering and Billing communicate via domain events, not synchronous HTTP."
- **Technology choices that carry lock-in.** Database, message bus, auth provider, deployment target. Not every library — just the ones that would take a quarter to swap out. (This is the home for library-selection rationale.)
- **Boundary and scope decisions.** "Customer data is owned by the Customer context; other contexts reference it by ID only." The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path.** "We're using manual SQL instead of an ORM because X." Anything where a reasonable reader would assume the opposite. These stop the next engineer from "fixing" something that was deliberate.
- **Constraints not visible in the code.** "We can't use AWS because of compliance requirements." "Response times must be under 200ms because of the partner API contract."
- **Rejected alternatives when the rejection is non-obvious.** If you considered GraphQL and picked REST for subtle reasons, record it — otherwise someone will suggest GraphQL again in six months.
