# PROJECT.md Format

`PROJECT.md` holds the project's **purpose and direction** — the "why we're building this and where it's going" — for agents. `README.md` is the human-facing version; `PROJECT.md` is what an agent reads to understand *intent* before writing code.

It is **not** a glossary (that's `CONTEXT.md`), **not** individual decisions (those are ADRs), and **not** current structure (that's `AGENTS.md`).

Create it lazily when purpose/direction is being pinned down — or by **extracting it from an overloaded `CONTEXT.md`**: problem statements, core insight, and roadmap belong here; the glossary stays in `CONTEXT.md`.

## Structure

```md
# {Project} — Purpose & Direction

## The problem
{What problem this solves, and for whom. 2-4 sentences.}

## Who it's for
{The primary user/persona — and who is explicitly NOT the audience.}

## The core insight
{The key idea that makes this the right solution, and why now.}

## Goals
- {What success looks like, as an outcome.}

## Non-goals
- {What this deliberately does NOT do — the explicit out-of-scope.}

## Direction
- **Built:** {what exists today}
- **Next:** {decided but not built — link the ADRs}
- **Maybe:** {options still on the table}

## Guiding principles
- {Non-negotiables that shape decisions — values, platform/budget limits. Deep rationale → an ADR.}
```

## What to ask

`grill-with-docs` owns PROJECT.md for every repo — new or existing. Walk these seven one at a time, each with a recommended default pulled from the repo, `README`, or the conversation (same as any grill). Skip a question only when the docs already answer it unambiguously.

1. **Problem & status quo** — What problem does this solve, for whom, and what does someone do today without it? → *The problem.*
2. **Who it's for / who it's not** — The primary user, and who is explicitly out of audience. Turn "everyone" into a real persona. → *Who it's for.*
3. **Core insight — why this, why now** — The key bet: why this approach beats the obvious alternatives, and why now is the moment. → *The core insight.*
4. **Goals as outcomes** — What is true when this is "working"? Push for outcomes ("a lead gets a scored PDF in one run"), not feature lists. → *Goals.*
5. **Non-goals** — What it deliberately will NOT do; what you'll say no to. Highest-leverage section for keeping agents in scope. → *Non-goals.*
6. **Direction** — What's Built, what's Next (decided — link the ADR), what's Maybe (still open). No aspirational fiction. → *Direction.*
7. **Guiding principles & hard constraints** — The values and non-negotiables shaping every decision (SSOT/KISS, platform limits, budget). → *Guiding principles*; deep rationale for any one choice still becomes an ADR.

## Rules

- **Purpose and direction only.** Link to ADRs for the "why" of specific decisions; don't restate them.
- **No glossary.** Domain terms belong in `CONTEXT.md`.
- **No current structure.** Repo layout / module ownership belongs in `AGENTS.md`.
- **Honest roadmap.** Mark Built / Next / Maybe. No aspirational fiction — if it doesn't exist and isn't decided, it's "Maybe" or it's absent.
- **Keep it short.** A page, not an essay. It's an orientation, not a spec.
