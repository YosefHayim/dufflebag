# 0013 — Style refresh: co-located tests, single-command autorun, `templates/`, biome-as-linter

- **Status:** Accepted (2026-07-02) — the authored-docs dir moved once more by [0014](0014-consolidate-under-src-and-templates.md): `mdFiles/` → `templates/mdFiles/`, and the tsconfig/biome/vitest globs are now `src/**`-only (skills live under `src/`).
- **Scope:** test layout, the autonomous-loop skill surface, the workflow-template directory, the authored-docs layout, and the biome + tsconfig config
- **Related:** [0004](0004-unified-style-and-error-model-by-role.md), [0008](0008-vertical-per-feature-layout.md), [0009](0009-reusable-workflows-and-cli-scaffolding.md), [0012](0012-tsdoc-on-the-exported-surface.md), [0014](0014-consolidate-under-src-and-templates.md)

## Context

A code-style grill (2026-07-02) tightened several conventions that were either aspirational in
the guide or inconsistent with the owner's taste. They are batched here because they landed as
one coordinated refresh; each is small on its own.

## Decision

- **Tests co-locate; there is no `test/` dir.** A unit test sits beside its source as
  `foo.test.ts` next to `foo.ts`. Cross-cutting tests that don't map to a single source file
  (the install/uninstall round-trip, the workflow drift check) live in `src/commands/` as
  `*.integration.test.ts`. `vitest` discovers `src/**/*.test.ts` + `skills/**/*.test.ts`; the
  root `tsconfig` excludes `**/*.test.ts` from emit and the npm tarball excludes them too.

- **The autonomous loop is ONE command with verbs.** `skills/autorun/` ships a single
  `autorun` skill: `/autorun <n>` arms, `/autorun stop` pauses, `/autorun exit` shuts the
  daemon down — all routed to the one `ctxLoopCtl.js` control plane (`arm|stop|exit`), which
  was already the single engine behind the three old skills. The separate `/autostop` and
  `/autoexit` commands are dropped. The `--features autonomous-loop` id (an external CLI
  contract) is unchanged; it now ships `skills: ["autorun"]`.

- **`workflow-templates/` → `templates/workflows/`.** A `templates/` parent leaves room for
  other template kinds later; the CI/publish set moves under `templates/workflows/`. The
  `scaffold-ci` reader, the drift test, and the npm `files` list are repointed.

- **Authored long-form guides live under `mdFiles/`.** `CODE-STYLE.md` and `PROJECT.md` move
  into `mdFiles/`. Tool/host-anchored docs stay at the repo root: `README.md` (GitHub landing),
  `AGENTS.md` + its `CLAUDE.md`/`GEMINI.md` symlinks (agent entry points), and `LICENSE`.

- **biome is the linter AND the formatter.** `linter.enabled: true` with the `recommended`
  ruleset, covering `src/**` *and* `skills/**` (previously the linter was off and half the
  skill TypeScript wasn't even in biome's file set). A short list of rules is disabled where
  they fight intentional patterns (documented in `biome.json`).

- **One root tsconfig governs the project; the png harness is the single exception.**
  `skills/png-to-code/scripts/` keeps its own `tsconfig.json` because it is a physically
  separate sub-package with its own `package.json` and dependencies and its own install/build
  lifecycle. Everywhere else there is exactly one tsconfig at the root.

## Consequences

- **+** A test sits next to the code it covers; the loop presents one command surface; authored
  guides are grouped; biome enforces correctness, not just formatting.
- **−** The rename ripples through `scaffoldCi.ts`, the drift test, and npm `files`.
- **−** Turning the linter on surfaced a one-time fix pass plus a few documented rule
  suppressions.
- **−** `/autostop` and `/autoexit` are no longer discoverable top-level commands — they are
  `/autorun stop` and `/autorun exit` now.
