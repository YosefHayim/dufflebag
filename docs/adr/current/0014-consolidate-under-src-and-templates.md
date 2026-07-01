# 0014 — Consolidate: all source under `src/`, all copyable templates under `templates/`

- **Status:** Accepted (2026-07-02)
- **Scope:** top-level directory layout, the build-script path, the config globs (`tsconfig`/`biome`/`vitest`), the npm ship-list, and skill→kernel import depth
- **Related:** [0008](0008-vertical-per-feature-layout.md), [0009](0009-reusable-workflows-and-cli-scaffolding.md), [0013](0013-style-refresh-colocated-tests-single-command-autorun-templates.md)
- **Supersedes:** the *directory-path* portions of [0008](0008-vertical-per-feature-layout.md) (`skills/` → `src/skills/`) and [0013](0013-style-refresh-colocated-tests-single-command-autorun-templates.md) (`mdFiles/` → `templates/mdFiles/`). The reasoning in both is unchanged — only the base paths move.

## Context

After the dufflebag pivot (0008) and the style refresh (0013), the repo root held six meaningful
directories that split three ways with no single organising axis: `src/` (kernel), `skills/`
(feature engines + content), `scripts/` (the build-time hook assembler), `templates/workflows/`
(copyable CI), `mdFiles/` (authored guides), and `docs/`. "Where does a thing live?" had no
one-line answer — feature code sat outside `src/`, a build script sat at the root, and two
different folders (`templates/`, `mdFiles/`) both held copyable artifacts.

The owner's taste: **the top level should read as two buckets** — *source* (everything the
project is made of) and *templates* (everything the project hands to other repos) — plus the
irreducible `docs/`, `public/`, and host-anchored root files (`README.md`, `package.json`, …).

## Decision

Consolidate to two buckets:

- **`src/` holds all source.** `skills/` → **`src/skills/`** (feature engines + personal skills),
  `scripts/` → **`src/scripts/`** (the `assembleHooks.mjs` build step). The kernel (`src/core/`,
  `src/payload/`) is unchanged. Vertical-per-feature (0008) is preserved — only the base path
  gains a `src/` prefix.
- **`templates/` holds everything `scaffold-ci`-style copying hands to other repos.**
  `mdFiles/` → **`templates/mdFiles/`** joins `templates/workflows/`. `CODE-STYLE.md` and
  `PROJECT.md` are both this repo's own guides *and* the reference copies a new project should
  start from — the dual role is intentional (dogfooding).

## Consequences

- **`rootDir: "."` is load-bearing, not cosmetic.** With every TypeScript input now under `src/`,
  tsc would infer `rootDir` as `src/` and emit `dist/cli.js` / `dist/payload/*` — breaking the
  `bin` (`dist/src/cli.js`) and the payload dir the assembler reads. The pre-existing
  `"rootDir": "."` pins output to `dist/src/**`, so the only shift is `dist/skills/**` →
  `dist/src/skills/**`. The assembler's `DIST_SKILLS` and its `ROOT` hop (`..` → `../..`, since
  the script moved a level deeper) track that.
- **Skill→kernel imports lose a segment, not a level.** A hook at `src/skills/<f>/hooks/` reaches
  the kernel three-up — but three-up now lands in `src/`, so `../../../src/payload/` becomes
  `../../../payload/` (and `../../../src/core/` → `../../../core/`). The assembler's flatten
  rewrite (`../../../payload/` → `./lib/`) matches. Feature-local `../lib/` imports are unchanged.
- **Ship-list narrows to the new path.** `package.json#files` ships `src/skills` (not `skills`);
  `bundledSkillsDir()` resolves `packageRoot()/src/skills`. Install **dest** paths
  (`~/.claude/skills/<feature>/`) are unchanged — only the package **source** moved.
- **Personal-skill symlinks re-point.** The five symlinked skills (`grill-*`, `deslop`) install
  from `~/.claude/skills/<name>` → `…/src/skills/<name>`; the symlink targets were updated in
  place, so edits stay live.
- **The single-command-per-tool, ship-allowlist, fail-open, and TSDoc rules are untouched** — this
  is a location change, not a contract change. No feature IDs, env keys, or the `/dufflebag/`
  marker move (external contracts, per naming rule).
- **−** Older ADRs (0004/0006/0008/0009/0012/0013) reference the pre-move paths in their bodies;
  their Scope lines are annotated to point here, but their prose is left as historical record.
