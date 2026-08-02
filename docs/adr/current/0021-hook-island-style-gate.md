# 0021 — Hook-island findings gate verification

- **Status:** Accepted (2026-08-02)
- **Scope:** `src/hookIsland/`, `src/runtime/`, and `pnpm style`
- **Supersedes:** the deferred-migration consequence in [0017 — Skill payload and hook runtime are separate trees](0017-payload-and-runtime-are-separate-trees.md)
- **Related:** [0001 — Zero-dependency hook payload](0001-zero-dependency-hook-payload.md), [0004 — Unified style and error model by role](0004-unified-style-and-error-model-by-role.md)

## Context

ADR 0017 separated copied skill content from executable hook code, but initially
reported hook-island style findings without failing verification. That temporary state
protected fail-open behavior while declarations, boundary decoders, imports, and tests
were migrated deliberately.

The migration is now complete. A permanent report-only category would let the installed
runtime drift away from the code style agents are told to follow.

## Decision

**Gate hook-island findings together with application and tooling findings.**

- `pnpm style` fails for violations in `src/hookIsland/` and `src/runtime/`.
- The island keeps its distinct dependency boundary: plain Node or Python, fail-open,
  and no Effect imports.
- One private decoder normalizes each external hook protocol boundary into domain names.
- Co-located tests may import test dependencies because they are excluded from shipped output.
- Copied skill content remains outside application architecture rules and answers to Biome
  plus its own harness.

## Consequences

- **+** The maintained application, tooling, and installed runtime have one enforceable style bar.
- **+** New hook code cannot reintroduce the migration backlog silently.
- **+** Runtime boundary and fail-open exceptions remain explicit instead of broad allowlists.
- **−** Hook changes must satisfy both dependency-island constraints and repository style checks.
