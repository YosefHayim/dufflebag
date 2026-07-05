# dufflebag — Language

Names-only glossary: human↔agent bridge for the domain vocabulary used in code, docs, and CLI output.

| Term | Definition | Aliases to avoid |
|---|---|---|
| **bag** / **bag-owned** | Anything the installer manages, identified by the `/dufflebag/` path marker or the `dufflebag*` env prefix. | "owned", "managed" (without marker context) |
| **feature** | An installable unit such as `context-guard`, `dedup-guard`, `autonomous-loop`, `speak-response`, or `png-to-code`. | "plugin", "extension" |
| **skill** | Agent instruction set shipped under `src/skills/<skill>/`. May be *shipped* (registered in the CLI catalog) or *personal* (symlinked, owner-only). | "prompt", "instruction file" |
| **hook** | Zero-dependency payload script that runs on a Claude Code hook event. Must be **fail-open**. | "callback", "handler" (imprecise) |
| **payload** | The compiled, zero-dep hook kernel under `src/payload/` and the flat `dist/hooks/` output. | "bundle", "binary" |
| **catalog** / **`FEATURES`** | The allowlist in `src/core/catalog/features.ts` that declares every feature and what it ships. | "registry", "manifest" |
| **ships** | Per-feature allowlist of paths copied into a user's install. Fail-safe: unlisted paths ship nothing. | "includes", "files" |
| **surgical install / uninstall** | Path- and prefix-identified edits to `settings.json` that byte-restore on uninstall. | "merge", "patch" |
| **context-guard** | Nudge `/handoff` at the warn fraction and hard-deny new code edits near the cap. | "context manager" |
| **dedup-guard** | DRY guard that blocks duplicate function/type bodies at write time. | "duplicate checker" |
| **autonomous-loop / `autorun`** | macOS + Ghostty hands-free compact/resume loop; one skill with `stop`/`exit` verbs. | "auto-compact", "daemon" (alone) |
| **speak-response** | Stop hook that speaks Claude prose via macOS `say`. | "TTS", "voice" |
| **png-to-code** | PNG → measured pixel-perfect code skill (SVG/HTML/CSS) with screenshot-diff harness. | "image-to-code" |
| **scaffold-ci** | CLI command that copies the reusable workflow set into another repo. | "ci-setup" |
| **fail-open** | Hooks must `process.exit(0)` on any error so a guard bug never blocks the user. | "graceful degrade" |
| **pure core, imperative shell** | Pure transformers separated from effects by a `// --- IO layer ---` divider. | "clean architecture" (vague) |
| **biome** | Linter and formatter; `biome ci` is the single CI gate. | "linter", "prettier" (only half) |
| **co-located tests** | `foo.test.ts` beside `foo.ts`; cross-cutting tests as `src/commands/*.integration.test.ts`. | "test/ dir" |
| **vertical per feature** | Each feature owns one `src/skills/<feature>/` folder. | "horizontal layers" |
| **single command per tool surface** | One `autorun` skill with verbs instead of multiple thin skills. | "one skill per verb" |
| **SSOT** | Single source of truth; shared contracts live in `src/payload/config.ts`. | "source of truth" (ok, but acronym is used) |
| **clean break** | No back-compat shims on renames/pivots. | "migration", "deprecation" |
| **workflow_call legs** | Single-purpose reusable CI legs copied by `scaffold-ci`, not referenced. | "reusable workflows" (only when copied) |
| **verify** | The one aggregate gate: `check:ci && typecheck && test && build`. | "qa", "validate" |
