# dufflebag — Context

## What this is

`dufflebag` is a personal toolbelt, not a platform: a Node-only TypeScript CLI that installs, updates, and surgically uninstalls a curated bag of Claude Code guardrails, agent skills, and copyable CI/publish workflow templates.

## Actors

- **The owner / user** — runs `npx ys-dufflebag install` to wire guardrails into `~/.claude` (global) or `./.claude` (project).
- **Claude Code** — the primary install target; installed hooks run inside Claude's hook lifecycle.
- **Other agents** (Cursor, Codex, and more) — detected and wired through catalog-driven agent formats.
- **CI / `scaffold-workflows` consumers** — repos that copy the reusable workflow set from `templates/workflows/`.

## Shape (capability layout)

Application code is grouped by capability, not by technical layer:

- `src/cli/` — Effect CLI edge (`main`, commands, `TerminalUI`, package staging)
- `src/catalog/` — feature and agent catalogs (decoded data is the SSOT)
- `src/config/` — managed configuration schema, file IO, and planning
- `src/install/` — artifact plans, receipts, transactional apply, lifecycle
- `src/runtime/` — dependency-free hook kernel (`config` + `io`)
- `src/skills/<sourceDirectory>/` — authored skills (camelCase directories) and feature-local hooks
- `src/doctor.ts` / `src/scaffoldWorkflows.ts` — doctor and workflow scaffolding capabilities
- `scripts/` — package build and repository verification tooling (not product runtime)
- `scripts/` — outer-ring maintainer tooling (build, README generation, style contract); never imported by product code
- `templates/` — copyable workflows and markdown guides
- `dist/hooks/` — flat, compiled, zero-dep hook payload assembled at build time
- `dist/staged/` — catalog-closed staged package for install/update/doctor

`src/core/`, `src/commands/`, `src/payload/`, and `src/scripts/` are **not** part of the current tree (see ADR 0016; tooling lives under root `scripts/`).

## Key constraints

- Hooks must be **fail-open** — any internal error allows the tool through.
- Ownership is receipt-based: install/update/uninstall apply only receipt-authorized artifacts.
- Managed config lives at `.claude/dufflebag/config.json` and is schema-owned.
- Authored skill directories use **camelCase**; public feature IDs and installed skill IDs remain **kebab-case** data.
- One strict style bar across maintained TypeScript, enforced by Biome + `scripts/checkCodeStyle.ts` and documented in root `CODE-STYLE.md`.
