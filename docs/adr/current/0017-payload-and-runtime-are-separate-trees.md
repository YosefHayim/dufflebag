# 0017 — Skill payload and hook runtime are separate trees

- **Status:** Accepted (2026-08-02)
- **Scope:** `src/skills/`, `src/hookIsland/`, and the `pnpm style` contract
- **Amends:** [0016 — Capability layout replaces `src/core`](0016-capability-layout-replaces-core.md) (adds `src/hookIsland/` to the map), [0008 — Vertical per-feature layout](0008-vertical-per-feature-layout.md) (a feature is still one folder, but in whichever of the two trees fits it)
- **Related:** [0001 — Zero-dependency hook payload](0001-zero-dependency-hook-payload.md), [0004 — Unified style and error model by role](0004-unified-style-and-error-model-by-role.md)

## Context

`src/skills/<sourceDirectory>/` held two kinds of code with opposite constraints:

- **Payload** — `SKILL.md`, `reference/`, and a feature's own `scripts/` and `templates/`, copied *verbatim* into an installed skill directory. It is authored for other repositories, may carry its own dependencies (the png harness needs Playwright), and cannot import anything of ours.
- **Runtime** — `hooks/`, `lib/`, and `command/`, which this repository compiles, assembles flat into `dist/hooks/`, and installs to `.claude/dufflebag/runtime/<sourceDirectory>/`. It must stay dependency-free and fail open.

One directory name covered both, so the style checker could only guess with a regex over `src/skills/<x>/(hooks|runtime)/`. That guess was wrong three ways, and the resulting noise — 776 of 880 findings sat in payload — trained everyone to ignore the report:

- payload was linted as application code, so a standalone dependency-free script was told to route output through `TerminalUI`, which it cannot import;
- `lib/` and `command/` fell outside the regex and were treated as application, so an entry hook importing its own sibling `lib/` was reported as an island breach;
- co-located tests were treated as shipped hook code, so importing `vitest` was a violation.

The catalog already drew the line cleanly: `contextGuard`, `dedupGuard`, and `speakResponse` declare a hook runtime and no installed skill; the other 33 features declare an installed skill and no runtime. No feature is both.

## Decision

**Give each kind of code its own tree, and let the style contract follow the tree.**

```text
src/
├── skills/<camelCase>/      # payload only — shipped verbatim into a skill directory
└── hookIsland/<camelCase>/  # runtime only — hooks/, lib/, command/ (+ shipped assets)
```

`sourceDirectory` still names the feature and is still the leaf segment of the installed runtime path, so installed paths and existing receipts are unchanged by the move.

The checker classifies every file into exactly one of four categories — `application`, `hookIsland`, `skillPayload`, `tooling` — and applies the rules that category answers to. Skill payload is **outside** the `pnpm style` contract; it answers to Biome and to its own harness, because it is authored for other repositories and follows the destination repo's idioms.

Two rules encode the boundary:

- `path.payload-runtime-split` — executable runtime lives under `src/hookIsland/`, never under `src/skills/`. Checked from the directory shape, since payload is excluded from the per-file scan.
- `import.application-boundary` — application code reaches the island only through a feature `command/` module. Hooks and their libraries stay closed; a `command/` module is the one surface deliberately built to be called by our CLI *and* by the user's CI, which is why it is dependency-free.

Two exemptions are stated rather than implied: co-located tests never ship, and a type-only import of a bare package is erased before emit, so neither can break the island.

## Consequences

- **+** `pnpm style` fell from 880 findings to 379, and every remaining one is real. Both import rules are clean.
- **+** The hand-maintained exemption list for `assembleCut.mjs` became unnecessary — the category answers what the exception used to.
- **+** A misplaced hook is now a failing rule instead of a silent regression.
- **−** The 283 findings left in `src/hookIsland/` are a genuine un-migrated idiom (75 `function` declarations, 17 `interface`s — both zero in the application tree). They are reported but **not** gated, because converting a `function` declaration to an arrow constant changes hoisting and this is fail-open code that runs inside the user's agent. That migration is deliberate follow-up work, not a codemod.
- **−** A feature that ever needs both payload and runtime would live in two directories. None does today, and the catalog would make it obvious.
