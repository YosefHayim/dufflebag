# 0003 — Config SSOT lives inside the hook payload

- **Status:** Accepted (2026-07-01)
- **Scope:** `src/payload/config.ts` (SSOT) ← re-exported by `src/core/config.ts`
- **Related:** [0001 — Zero-dependency hook payload](0001-zero-dependency-hook-payload.md)

> **Live tree:** prefer [0016](0016-capability-layout-replaces-core.md) + root `CONTEXT.md`. Historical path names (`src/core`, `src/payload`, `src/commands`) in this body are not the current layout.


> **Current map (0016):** app config SSOT is `src/config/bagConfigSchema.ts`; installed hooks read `src/runtime/config.ts`. The no-drift rule is unchanged.

## Context

The tunables (`dufflebagContextWarnFraction`, block fraction, autorun budget,
TTS voice, dedup mode, …) are **written** by the CLI into `settings.json`'s `env`
map and **read** by the hooks from `process.env`. If the key names and defaults
were declared in two places — once for the write side, once for the read side —
a rename on one side would silently disable the guardrail while looking correct.

## Decision

`src/payload/config.ts` is the **single source of truth** for the env key names
(`ENV_KEYS`), the defaults (`DEFAULTS`), and the reader (`readConfig`). It lives
**inside the payload** so it ships self-contained ([0001](0001-zero-dependency-hook-payload.md)).
The CLI's `core/config.ts` **imports and re-exports** these constants rather
than re-declaring them, and layers on only the CLI-only concerns (validation,
clamping, rendering a patch to the string map).

This means `core` depends on `payload` — an "upward" dependency that inverts
the usual `hooks → core` direction. We accept it deliberately: the alternative
(SSOT in `core`, hooks importing it) would drag `core` into the copied-out
payload and break its self-containment.

## Consequences

- **+** The write side and the read side **cannot drift** — a typo is a compile
  error, not a silently disabled guardrail.
- **+** The payload stays self-contained.
- **−** The layering looks inverted at a glance; documented here so it is not
  "fixed" into a regression.

## Rule this establishes

**Never re-declare a shared contract — re-export the SSOT.** Applies to any
value both the CLI and the payload must agree on.
