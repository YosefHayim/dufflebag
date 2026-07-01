# 0010 — `src/core/` grouped by domain; the pure/IO split stays within each module

- **Status:** Accepted (2026-07-01)
- **Scope:** `src/core/**`, the `core/index.ts` barrel
- **Related:** [0004 — Unified style + error model by role](0004-unified-style-and-error-model-by-role.md), [0008 — Vertical per-feature layout](0008-vertical-per-feature-layout.md)

## Context

`src/core/` had grown to eleven flat modules — `agents`, `agentWiring`,
`envConfig`, `features`, `fsUtils`, `manifest`, `paths`, `platform`, `settings`,
`types`, `ui` — with no grouping, and several mixed pure logic with effects only
by *position* (a `// --- IO layer ---` comment), not by any real boundary:
`agents.ts` even had its pure `classifyAgents` at the *bottom*, under the probes.
"Too many orphan files; make purity real."

## Decision

**Group `src/core/` by domain, and keep the pure/effects split *within* each
module** — the functional-core / imperative-shell divider from
[0004](0004-unified-style-and-error-model-by-role.md), not a folder split:

```
src/core/
  catalog/   features.ts  manifest.ts  types.ts     # what a user can install
  settings/  settings.ts  paths.ts                  # settings.json surgery + path layout
  wiring/    agentWiring.ts  agents.ts              # multi-agent wiring + detection
  host/      platform.ts                            # host capability probes
  config.ts  fs.ts  ui.ts  index.ts                 # cross-cutting + the barrel
```

Two renames drop the grab-bag names: `envConfig.ts → config.ts`,
`fsUtils.ts → fs.ts`. The `index.ts` barrel re-exports every module, so the
command layer keeps importing from `../core/index.js` unchanged. Each mixed
module was tightened to the divider discipline — pure on top, one canonical
`// --- IO layer ---` divider, effects below (`agents`, `manifest`, and
`agentWiring` were the drifting ones).

## Considered options

- **`pure/` + `effects/` folders (split every mixed module across two dirs):**
  makes purity an importable boundary, but scatters one domain (e.g. settings
  surgery) across two folders and inflates the file count. Rejected — cohesion by
  domain is worth more than purity-as-foldering; the within-module divider
  already makes the pure half unit-testable without disk.
- **Flat `*.ts` + `*Io.ts` siblings (no subfolders):** real separation, but the
  orphan-file count goes *up*, which was the complaint. Rejected.
- **Group by domain, keep the divider (chosen):** fewer top-level entries,
  cohesive folders, and the pure/effects boundary stays where the tests already
  rely on it.

## Consequences

- **+** `src/core/` reads as four domains + the barrel instead of eleven loose
  files; the pure half of each module is still testable without disk.
- **+** No churn at the call sites — the barrel absorbs the moves.
- **−** Purity stays a *convention by position* inside each module, enforced by
  the divider + `deslop`, not by the module system. Accepted:
  [0004](0004-unified-style-and-error-model-by-role.md) already owns that rule.
- **−** Three cross-cutting files (`config`, `fs`, `ui`) sit at the core root
  rather than in a domain folder — they're genuinely shared, so a `misc/` bucket
  would be worse.
