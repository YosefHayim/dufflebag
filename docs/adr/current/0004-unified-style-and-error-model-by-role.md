# 0004 — One strict style bar, error model chosen by role

- **Status:** Accepted (2026-07-01) — **comment stance superseded by [0012](0012-tsdoc-on-the-exported-surface.md)** (2026-07-02); the error-model-by-role decision below still stands.
- **Scope:** all TypeScript — `src/**` and `src/skills/png-to-code/scripts/**` (harness path relocated by [0014](0014-consolidate-under-src-and-templates.md))

## Context

The repo grew two style regimes: production-grade `src/` (double quotes,
fail-open `main()` hooks, WHY-first docs, strict `tsconfig`) and a pragmatic
dev-only harness under `skills/png-to-code/scripts/` (single quotes, top-level
runnable scripts, `console.*`, terse pixel-loop names, looser `tsconfig`). With
no committed formatter and no CI style gate, the two drifted — e.g. double vs
single quotes purely because a manual `biome format` touched one tree and not
the other.

## Decision

**One strict style bar for all TypeScript.** The harness is migrated up to the
`src/` bar (see `CODE-STYLE.md` for the concrete rules). Style is **enforced**,
not merely documented: a committed `biome.json` (double quotes, organized
imports) covers both trees, and `biome ci` runs in the CI matrix so drift cannot
silently return.

Error handling is **not** relaxed by locale — it is chosen by a module's
**role**:

| Role | Model | Example |
|------|-------|---------|
| **Hook** (`src/hooks/*`) | **fail-open** — a guard bug must never block the user's edit | `try { main() } catch { process.exit(0) }` |
| **CLI** (`src/commands/*`, `cli.ts`) | **throw an actionable `Error`**, caught once at the top → `fail()` | `throw new Error("warn must be below block")` |
| **Gate / harness** (`dedup check`, `scripts/bin/*`) | **fail-closed with meaningful exit codes** — a non-zero exit *is* the product | `process.exitCode = 1`; `process.exit(2)` |

`CODE-STYLE.md` (now `mdFiles/CODE-STYLE.md`) records the **desired end-state**.
Note: the original "minimal comments / strip name-restating JSDoc" stance recorded
here was reversed by [0012](0012-tsdoc-on-the-exported-surface.md) — the exported
surface now requires TSDoc. Everything else here (the error model by role) stands.

## Consequences

- **+** Uniform, enforceable style across the whole repo; predictable failure
  semantics per role.
- **−** A one-time migration of the harness and a filename rename sweep
  (kebab → camelCase). Tracked as follow-up work.
