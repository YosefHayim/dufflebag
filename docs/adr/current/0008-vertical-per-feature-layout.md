# 0008 — Vertical per-feature layout, catalog-declared ship boundary

- **Status:** Accepted (2026-07-01) — **directory paths relocated by [0014](0014-consolidate-under-src-and-templates.md)** (2026-07-02): `skills/` → `src/skills/`. The vertical-per-feature *decision* below is unchanged; read `skills/` as `src/skills/` throughout.
- **Scope:** `src/**` (incl. `src/skills/**`), the build, and the install copy step
- **Related:** [0001 — Zero-dependency hook payload](0001-zero-dependency-hook-payload.md), [0003 — Config SSOT inside payload](0003-config-ssot-inside-payload.md), [0014 — Consolidate under src/ and templates/](0014-consolidate-under-src-and-templates.md)


> **Current map (0016):** features still live under `src/skills/<sourceDirectory>/` (camelCase). The former `src/core`/`src/commands`/`src/payload` split is gone.

## Context

The engine was layered: `src/core/`, `src/hooks/`, `src/commands/`. The owner
wants everything about a feature in **one folder** — for navigability and a
copy-paste portability story. But the features are not independent programs: they
share a pure CLI core (`settings.ts`, `paths.ts`, `features.ts`) and a
**zero-dep** hook kernel whose config is a hard SSOT ([0001](0001-zero-dependency-hook-payload.md),
[0003](0003-config-ssot-inside-payload.md)). A pure per-feature split is
therefore impossible — a shared kernel cannot live inside any one feature.

## Decision

Go **vertical per feature**, with an explicit shared kernel:

- **`skills/<feature>/` holds both** that feature's engine (hook sources,
  feature-local libs, its own command) **and** its shipped content (`SKILL.md`,
  `references/`, `scripts/`). Feature-local hook libs move down: `state.ts` +
  `transcript.ts` → `context-guard/`; `dupIndex.ts` → `dedup-guard/`.
- **The irreducible kernel stays in `src/`**, split by dependency reach:
  `src/core/` is the CLI kernel (may use `commander`/clack); `src/payload/` is the
  zero-dep hook kernel (`config` SSOT + `io`) — the *only* thing a feature hook
  imports besides `node:*` and its own files.
- **Sources are vertical; the build output is flat.** The build gathers every
  feature's hook into one flat `dist/hooks/` payload, so install/uninstall, the
  `PATH_MARKER`, and the `HOOK` map are **unchanged**. Source structure ≠ output
  structure.

**The ship boundary is a catalog allowlist.** The `FEATURES` catalog declares
each feature's shipped paths (e.g. `png-to-code → [SKILL.md, references/, scripts/]`;
`dedup-guard → []`). The installer copies **only** listed paths into
`~/.claude/skills/<feature>/`. This is **fail-safe**: a build-only `.ts`
(`dedupGuard.ts`, `dupIndex.ts`) never leaks into a user's install because it
isn't listed — a forgotten path ships *nothing*, not everything, preserving the
"surgical, touch nothing extra" guarantee.

## Considered options

- **Full vertical, no shared kernel:** impossible — `settings.ts`/`config.ts`
  can't be split into feature folders.
- **`src/features/<feature>/`** (engine grouped, content in `skills/`): cleaner
  engine/artifact line, but rejected — the owner wants a single unified folder.
- **Denylist ship boundary** (ship all but reserved `hooks/`/`lib/` names):
  rejected — fails *open*; a new build subdir forgotten in the denylist leaks raw
  `.ts` into every install.

## Consequences

- **+** Everything about a feature in one folder; real portability for
  content-bearing features.
- **−** Pure-hook features (`context-guard`, `dedup-guard`, `speak-response`) sit
  under `skills/` but ship **no** content — build-input-only folders.
- **−** `cli.ts` / `commands` now reach *into* `skills/<feature>/` for a feature's
  command — an inward dependency on a leaf, mirroring the accepted inversion in
  [0003](0003-config-ssot-inside-payload.md). Documented so it isn't "fixed."
- **−** The root `tsconfig` must include `skills/**/{hooks,lib,command}` while
  excluding `png-to-code/scripts/**` (own toolchain) and content-only skills.
