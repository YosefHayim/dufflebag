# 0016 — Capability layout replaces `src/core` / `src/commands` / `src/payload`

- **Status:** Accepted (2026-07-18)
- **Scope:** whole application tree under `src/`
- **Supersedes:** [0010 — `src/core/` grouped by domain](0010-core-grouped-by-domain.md) (as current layout guidance)
- **Related:** [0001 — Zero-dependency hook payload](0001-zero-dependency-hook-payload.md), [0008 — Vertical per-feature layout](0008-vertical-per-feature-layout.md), [0014 — Consolidate under src/ and templates/](0014-consolidate-under-src-and-templates.md)

## Context

Earlier ADRs described a three-layer application tree:

- `src/core/` — CLI kernel (catalog, settings, wiring, host, UI)
- `src/commands/` — commander/clack command handlers
- `src/payload/` — zero-dependency hook kernel

That layering was useful while the product was still layered by technical role. After the Effect CLI cutover, receipt-owned install, and catalog-driven staging, the maintained tree is organized by **capability**, and the old folders no longer exist.

## Decision

**Organize application code by the capability that owns the behavior:**

```text
src/
├── cli/                 # Effect CLI edge, TerminalUI, stagePackage
├── catalog/             # feature + agent catalogs
├── config/              # managed config schema + planning
├── install/             # plans, receipts, transactional apply, lifecycle
├── runtime/             # dependency-free hook kernel (replaces payload)
├── skills/<camelCase>/  # authored skills + feature-local hooks
├── doctor.ts
└── scaffoldWorkflows.ts
```

Rules that remain true from earlier ADRs:

- Hooks stay dependency-free (the former payload rule now lives under `src/runtime/`).
- Features stay vertical under `src/skills/<sourceDirectory>/` (0008).
- Public feature IDs and installed skill IDs stay kebab-case **data**; authored directories use camelCase.

Historical ADRs that name `src/core`, `src/commands`, or `src/payload` remain useful for *why* decisions were made; they are not a description of the current tree.

## Consequences

- **+** Agents and humans navigate by product capability instead of technical layer.
- **+** No dual SSOT between a layered `core` barrel and capability modules.
- **−** Older ADRs still use legacy path names in their historical context sections — readers must prefer this ADR + root `CODE-STYLE.md` / `CONTEXT.md` for the current map.
