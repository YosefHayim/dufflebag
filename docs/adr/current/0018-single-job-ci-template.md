# 0018 — Single-job CI template

- **Status:** Accepted (2026-08-02)
- **Scope:** `.github/workflows/ci.yml`, `templates/workflows/`, `scaffold-ci`, and the Node support floor
- **Supersedes in part:** [0009 — CI + publish copied per repo by the CLI](0009-reusable-workflows-and-cli-scaffolding.md) (replaces the single-purpose CI decomposition; preserves owned copies and local publishing)
- **Related:** [0005 — CI failure opens an issue with the captured error](0005-ci-failure-opens-issue-with-captured-error.md), [0006 — Lean dependency stance](0006-lean-dependency-stance.md)

## Context

The copied CI set ran formatting, type checking, tests, and builds as separate reusable workflows. Test and build matrices then repeated those checks across Node 20, 22, and 24 on Linux, macOS, and Windows. A normal change could start fifteen verification runners, repeat dependency installation fifteen times, and launch a final aggregation runner even though `pnpm verify` already defines the repository's complete gate.

Node 20 is end-of-life. Supporting three runtimes in every pull request no longer represents the product contract, and the broad operating-system matrix has not been justified by platform-specific failures.

## Decision

**The default copied CI is one Ubuntu job on Node 22 that installs once and runs `pnpm verify` once.** The job keeps the stable `CI Gate` name used by branch protection. pnpm's store cache is keyed from `pnpm-lock.yaml`, redundant in-progress runs are cancelled per ref, and a timeout bounds stuck jobs.

`scaffold-ci` now copies three files:

- `ci.yml` — the single verification job and the main-branch failure hook;
- `report-failure.yml` — reusable issue reporting retained from ADR 0005;
- `publish.yml` — the per-repository npm OIDC workflow retained from ADR 0009.

The generic templates are Node-only. A consumer adds Python, browsers, databases, or another runtime to its owned `ci.yml` only when its verification script actually needs them. Dufflebag's active CI adds Python and uv because its shipped voice integration test executes `voice.py`; that project-specific setup does not leak into the template.

Publishing remains a separate workflow because it has different triggers, permissions, Node/npm requirements, and npm provenance binding. It verifies the release candidate once before publishing and does not create a normal pull-request matrix.

Dufflebag's supported Node floor moves to 22. Broader compatibility is tested deliberately before a release when needed, rather than paid for on every push.

## Consequences

- **+** A normal CI run uses one verification runner, installation, cache restore, and gate execution instead of fifteen verification runners plus aggregation.
- **+** `pnpm verify` is the executable source of truth for repository checks; workflow files no longer restate its phases.
- **+** Scaffolded repositories receive three purposeful files instead of eight workflow files.
- **+** Branch protection continues to require `CI Gate`, and main-branch failure reporting remains intact.
- **−** Node and operating-system compatibility beyond Ubuntu/Node 22 is no longer exercised on every pull request. A repository with a demonstrated compatibility contract must add a focused scheduled or release-time matrix to its owned copy.
- **−** Dufflebag's active `ci.yml` and the generic template are intentionally not byte-identical because only Dufflebag needs uv.
