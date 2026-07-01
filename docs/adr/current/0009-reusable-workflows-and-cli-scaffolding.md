# 0009 — CI + publish copied per repo by the CLI

- **Status:** Accepted (2026-07-01) — revised the same day from a *reference* model to a *copy* model (see below). **Dir renamed `workflow-templates/` → `templates/workflows/` by [0013](0013-style-refresh-colocated-tests-single-command-autorun-templates.md)** (2026-07-02); the copy-model decision below is unchanged — read `workflow-templates/` as `templates/workflows/` throughout.
- **Scope:** `.github/workflows/**`, `templates/workflows/**` (was `workflow-templates/**`), the `scaffold-ci` CLI command
- **Related:** [0005 — CI failure opens an issue with the captured error](0005-ci-failure-opens-issue-with-captured-error.md), [0006 — Lean dependency stance](0006-lean-dependency-stance.md)

## Context

The same CI and publish YAML is re-pasted across ~18 repos — `dufflebag/publish.yml`
and `ebay-mcp/publish.yml` are ~95% identical (ebay's is a superset: it adds a
`workflow_run: [Release]` bridge and a job `if`-guard). The owner wants
single-purpose, DRY workflows the CLI can drop into any repo — installed globally,
stamped into a repo with one command, easy to extend one job at a time. Two forces
pull apart: **"pure by purpose" (many small files)** vs **"copy-paste one set that
just works."**

## Decision

**CI is decomposed into single-purpose workflows and COPIED per repo by the CLI.**
Each purpose is one file — `biome.yml`, `typecheck.yml`, `test.yml`, `build.yml`,
`report-failure.yml`, an opt-in `e2e.yml` (all `on: workflow_call`) — plus a
`ci.yml` gate that composes them through `./` local refs. `dufflebag scaffold-ci`
copies the whole set from `workflow-templates/` into a target repo's
`.github/workflows/`, so **every repo owns and can customize its CI**; re-running
with `--force` resyncs from dufflebag. Existing files are kept unless `--force`.

Two shipped locations, kept identical by a test:

- `.github/workflows/` is dufflebag's OWN active CI.
- `workflow-templates/` is the SHIPPED copy set the CLI reads (only this dir is in
  the npm `files`). The shared legs are byte-identical across the two — a unit test
  (`test/workflowTemplates.test.ts`) fails on drift. `ci.yml` / `e2e.yml` /
  `publish.yml` legitimately differ and are excluded.

Two disciplines carried over:

- **Biome is one gate.** `biome ci` does lint **and** format in one pass — there
  is no separate `lint.yml`/`format.yml` (that split only makes sense for
  ESLint + Prettier).
- **Matrix only where it earns it.** `biome` + `typecheck` are deterministic
  across OS/Node — single-leg (ubuntu, one Node). Only `test` + `build` run the
  os × Node matrix, where cross-env bugs surface.

**Publish is templated, not just copied.** npm OIDC trusted publishing binds
provenance to the caller repo **and the exact `publish.yml` filename**, so it can
never be a referenced `workflow_call`; its `{{OWNER}}/{{REPO}}/{{PACKAGE}}` are
filled per repo from the target's git remote + `package.json`.

The scaffolder writes YAML as **text** — **no YAML dependency** (respects
[0006](0006-lean-dependency-stance.md)).

### Why not the reference model (the first cut, reversed same day)

The first version of this ADR referenced a central gate — a thin scaffolded
`ci.yml` did `uses: YosefHayim/dufflebag/.github/workflows/ci.yml@v1`, and only
`publish.yml` was copied. It was reversed because it couples every consumer repo to
dufflebag being a **live, public, tag-versioned workflow host** forever: rename or
move dufflebag and every downstream CI breaks, and no repo can tweak a single leg
without forking anyway. For a personal toolbelt across ~18 repos, self-contained
copies (resynced on demand) are simpler and more robust than a central dependency —
the owner accepted losing auto-propagation to gain repo independence.

## Considered options

- **Reference a central `ci.yml@v1` (copy only publish):** one source of CI truth,
  auto-propagating — but couples every repo to dufflebag as a live workflow host and
  blocks per-repo tweaks. **Chosen first, then reversed.**
- **One self-contained `ci.yml` copied everywhere (no single-purpose split):**
  simplest to copy, but a monolith is hard to extend one purpose at a time.
  Rejected — the split into pure legs is what makes "add one more job" easy.
- **Publish as a reusable workflow:** rejected — OIDC provenance binding breaks.

## Consequences

- **+** Every repo owns a self-contained, customizable CI set with no runtime
  coupling to dufflebag. `report-failure`
  ([0005](0005-ci-failure-opens-issue-with-captured-error.md)) and the opt-in
  `e2e.yml` come along for free.
- **+** Adding a purpose = one new `*.yml` in `workflow-templates/` (+ a leg in the
  `ci.yml` gate); the CLI ships it on the next scaffold.
- **−** No auto-propagation: a fix to a leg reaches other repos only when they
  re-run `scaffold-ci --force`. Each repo is a fork by design.
- **−** dufflebag ships the shared legs twice (`.github/workflows/` +
  `workflow-templates/`); a drift test enforces byte-identity.
