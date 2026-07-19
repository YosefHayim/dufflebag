# 0001 — Zero-dependency hook payload

- **Status:** Accepted (2026-07-01)
- **Scope:** `src/hooks/**` → compiled to `dist/hooks` and copied into `~/.claude/skills-bag/hooks`

> **Live tree:** prefer [0016](0016-capability-layout-replaces-core.md) + root `CONTEXT.md`. Historical path names (`src/core`, `src/payload`, `src/commands`) in this body are not the current layout.


> **Current map (0016):** the zero-dependency hook kernel lives at `src/runtime/` (not `src/payload/`). The rule is unchanged.

## Context

Hooks fire on the hot path of every tool call (`PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `SessionStart`, `Stop`). They must start **instantly** — no
`npm install`, no `node_modules` resolution cost — and they are **copied
verbatim** out of the package into the user's `~/.claude`. Bundling third-party
runtime dependencies would mean shipping a `node_modules` tree (or adding a
bundler step), risking version skew, and slowing cold start on every keystroke
the guard inspects.

## Decision

The hook payload imports **only Node builtins (`node:*`) and its own
`hooks/lib/*`**. No third-party runtime dependency may be reachable from
`src/hooks/**`. The TypeScript compiles 1:1 to `dist/hooks`, and the installer
drops a `{ "type": "module" }` marker `package.json` beside it so the ESM files
run as bare Node. Imports from `../core` are **type-only** (erased at build).

## Consequences

- **+** Fires instantly; no install step; no version skew; uninstall is a
  directory removal.
- **+** The payload is auditable at a glance — every import is a `node:` builtin
  or a sibling `lib/` file.
- **−** Logic the CLI *also* needs cannot simply live in `core/` and be imported
  by a hook; it must live inside the payload and be re-exported by the CLI (see
  [0003](0003-config-ssot-inside-payload.md)).
- **−** Richer libraries (`@clack/prompts`, `commander`) stay CLI-only; the
  payload hand-rolls the little it needs (`hooks/lib/io.ts`).

## Enforced by

`hooks/*` never import a non-`node:` package; the only cross-boundary import
into `core` is `import type`. Reviewed on every hook change.
