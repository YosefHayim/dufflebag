# dufflebag — Context

## What this is

`dufflebag` is a personal toolbelt, not a platform: a Node-only TypeScript CLI that installs, updates, and surgically uninstalls a curated bag of Claude Code guardrails, agent skills, and copyable CI/publish workflow templates.

## Actors

- **The owner / user** — runs `npx ys-dufflebag install` to wire guardrails into `~/.claude` (global) or `./.claude` (project).
- **Claude Code** — the primary install target; the hook payload runs inside Claude's hook lifecycle.
- **Other agents** (Cursor, Codex) — detected but not actively wired today; adapters are tracked in GitHub issue #5.
- **CI / `scaffold-ci` consumers** — repos that copy the reusable workflow set from `templates/workflows/`.

## Shape

- `src/core/` — CLI kernel grouped by domain: `catalog/`, `settings/`, `wiring/`, `host/`, plus shared `config`/`fs`/`ui` and barrel `index.ts`.
- `src/payload/` — zero-dependency hook kernel (`config` SSOT + `io`).
- `src/skills/<feature>/` — vertical per-feature layout: each feature's engine (`hooks/`, `lib/`, `command/`) and its shipped content live together.
- `src/scripts/` — build-time scripts, e.g. `assembleHooks.mjs` and `generateReadme.mjs`.
- `templates/` — copyable templates: `templates/workflows/` (CI set) and `templates/mdFiles/` (guides).
- `dist/hooks/` — flat, compiled, zero-dep hook payload assembled at build time.

## Key constraints

- Hooks must be **fail-open** — any internal error allows the tool through.
- The bag owns only what is path-identified by `/dufflebag/` or prefix-identified by `dufflebag*`; uninstall byte-restores `settings.json`.
- One strict style bar across all TypeScript, enforced by `biome` and documented in `templates/mdFiles/CODE-STYLE.md`.
- The codebase follows **pure core, imperative shell**: pure transformers sit above a `// --- IO layer ---` divider, effects below.
