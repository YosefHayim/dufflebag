# 0002 — dedup-guard resolves the guarded repo's own TypeScript

- **Status:** Accepted (2026-07-01)
- **Scope:** `src/hooks/lib/dupIndex.ts` and its consumers (the Claude/Cursor hooks, `dedup check`)
- **Related:** [0001 — Zero-dependency hook payload](0001-zero-dependency-hook-payload.md)

## Context

A rename-proof duplicate fingerprint needs a **real TypeScript parse** (an
alpha-canonical AST walk, not a regex). But the hook payload must stay
dependency-free ([0001](0001-zero-dependency-hook-payload.md)), and `typescript`
is far too large to bundle anyway. Every TypeScript repo, however, already has
its own `typescript` installed — and dedup only makes sense in a TS repo.

## Decision

At runtime, resolve the **guarded repo's own** `typescript` via
`createRequire` against the repo root (`loadTypeScript`). Compile-time types
come from skills-bag's own `devDependency` through a **type-only import** (`import
type * as TS from "typescript"`), which is erased at build — so the shipped JS
carries no `typescript` reference of its own. If the repo has no resolvable
`typescript`, every entry point **fails open**: the live hooks allow the edit,
and `dedup check` reports "un-checkable" and exits 0 rather than failing CI.

## Consequences

- **+** Zero bundled parser; the fingerprint always matches the repo's own TS
  version and language features.
- **+** dedup runs exactly where it is meaningful (TS repos) and is inert
  elsewhere without breaking anything.
- **−** No dedup in non-TS or dependency-free repos — acceptable, as there is
  nothing to fingerprint.

## Provenance

Ported from Oly-App's `dupIndex.cjs` (its `docs/adr/0024` documents the
deliberate **max-recall** stance), generalized to any repo and to skills-bag's
ESM, zero-bundled-dependency payload model.
