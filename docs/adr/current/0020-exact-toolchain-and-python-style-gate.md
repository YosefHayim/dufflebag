# 0020 — Exact toolchain and Python style gate

- **Status:** Accepted (2026-08-02)
- **Scope:** package manifests, lockfiles, Python verification, and dependency installation policy
- **Supersedes:** [0006 — Lean dependency stance](0006-lean-dependency-stance.md)
- **Related:** [0001 — Zero-dependency hook payload](0001-zero-dependency-hook-payload.md)

## Context

The dependency stance correctly kept installed hooks free of third-party packages, but
its package inventory and paths predated Effect CLI, capability folders, and the PNG
harness split. Several direct development dependencies also used semver ranges, so the
manifest did not state the exact toolchain represented by its lockfile. Python code had
no formatter or linter in the repository gate.

## Decision

**Pin every direct runtime and development dependency exactly, retain one lockfile per
independent package lifecycle, and make exact Ruff checks part of `pnpm verify`.**

- Root TypeScript dependencies use exact versions in `package.json` and one pnpm lockfile.
- The independent PNG harness uses exact versions in its package file and its own npm lockfile.
- Installed hook JavaScript remains dependency-free; Python voice packages remain locked by uv.
- Python linting and formatting run through `uvx ruff@0.16.0`; the repository-owned name
  checker runs with Python 3.10 through uv.
- Native install scripts remain denied unless `pnpm-workspace.yaml` names the exact
  package and version that requires one.
- A dependency addition requires a new or superseding ADR explaining why current code,
  a Node built-in, or an existing package cannot own the job.

## Consequences

- **+** The manifests, lockfiles, formatter, and CI gate identify one reproducible toolchain.
- **+** Python and TypeScript now share a fail-fast formatting and declaration-name contract.
- **+** Native lifecycle scripts remain an explicit, reviewable supply-chain choice.
- **−** Dependency upgrades require deliberate manifest, lockfile, native-build allowlist,
  audit, and verification changes.
- **−** Contributors need uv when changing or verifying Python code.
