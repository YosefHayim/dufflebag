# 0006 — Lean dependency stance

- **Status:** Accepted (2026-07-01)
- **Scope:** `package.json` (CLI) and `src/skills/png-to-code/scripts/package.json` (harness)
- **Related:** [0001 — Zero-dependency hook payload](0001-zero-dependency-hook-payload.md)

## Context

skills-bag is a small CLI plus a dev-only diff harness. Every dependency is
supply-chain surface, install latency, and audit burden. The hook payload
already ships **zero** runtime dependencies ([0001](0001-zero-dependency-hook-payload.md)).

## Decision

Keep the dependency set intentionally small and each dependency load-bearing:

| Tree | Runtime deps | Why |
|------|--------------|-----|
| **CLI** (`src/`) | `commander` · `@clack/prompts` · `picocolors` | arg parsing · interactive UX · color. All isolated to `cli.ts` / `core/ui.ts`. |
| **Hook payload** (`src/hooks/`) | **none** | ships self-contained; see [0001](0001-zero-dependency-hook-payload.md). |
| **Harness** (`scripts/`) | `playwright` · `pixelmatch` · `pngjs` · `svgo` | headless render · pixel diff · PNG codec · SVG optimize. |

`@clack/prompts` is **pre-1.0 (0.x)** — accepted, with the risk contained to
`core/ui.ts`, so a breaking change is a single-file fix. No duplicative deps
(one color lib, one arg parser, one prompt lib); prefer a hand-rolled helper over
a new dependency for something small (e.g. the harness's own `parseArgs` instead
of a second arg parser).

## Rule this establishes

**A new dependency requires justification** — a note here (or a new ADR) stating
why an existing dependency or a Node builtin will not do. Nothing new may be
reachable from the hook payload.

## Consequences

- **+** Tiny surface, fast installs, trivial audit.
- **−** Occasionally more hand-rolled code instead of a library.
