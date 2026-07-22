# dufflebag — Language

Names-only glossary: human↔agent bridge for the domain vocabulary used in code, docs, and CLI output.

| Term | Definition | Aliases to avoid |
|---|---|---|
| **bag** / **bag-owned** | Anything the installer manages, identified by the `/dufflebag/` path marker or receipt ownership. | "owned", "managed" (without marker context) |
| **feature** | An installable unit such as `context-guard`, `dedup-guard`, `autonomous-loop`, `speak-response`, or `png-to-code` (public kebab-case IDs). | "plugin", "extension" |
| **sourceDirectory** | Authored camelCase directory under `src/skills/` (e.g. `contextGuard`, `pngToCode`). Distinct from the public feature ID. | "skill folder name" when used as public ID |
| **skill** | Agent instruction set under `src/skills/<sourceDirectory>/`. Installed directory names stay kebab-case data. | "prompt", "instruction file" |
| **hook** | Zero-dependency runtime script that runs on an agent hook event. Must be **fail-open**. | "callback", "handler" (imprecise) |
| **runtime** | Dependency-free hook kernel under `src/runtime/` and the flat `dist/hooks/` output. | "payload" (legacy), "bundle", "binary" |
| **catalog** | The allowlist in `src/catalog/featureCatalog.ts` that declares every feature and what it ships. | "registry", "manifest", "`FEATURES`" alone |
| **receipt** | Ownership record at `.claude/dufflebag/receipt.json` authorizing install/update/uninstall mutations. | "manifest" (legacy) |
| **ships / shippedPaths** | Per-feature allowlist of paths copied into a user's install. Fail-safe: unlisted paths ship nothing. | "includes", "files" |
| **surgical install / uninstall** | Receipt-authorized edits that restore prior bytes on uninstall. | "merge", "patch" |
| **context-guard** | Nudge `/handoff` at the warn fraction and hard-deny new code edits near the cap. | "context manager" |
| **idle auto-compact** | Optional native-hook loop that submits one idle draft, waits for any resulting turn, compacts once, then parks. | "autorun" (different context-budget loop), "timer wrapper" |
| **native hook adapter** | Catalog evidence that an agent's lifecycle events, config path, and compact command were verified. | "supported" without evidence |
| **terminal claim** | Session-start proof binding automation to one stable Ghostty terminal ID, including tabs and splits. | "focused pane", "front window" |
| **dedup-guard** | DRY guard that blocks duplicate function/type bodies at write time. | "duplicate checker" |
| **autonomous-loop / `autorun`** | Skill that arms the context-guard SessionStart daemon for hands-free compact/resume (`stop`/`exit` verbs). Hook runtime is owned by **context-guard**. | "auto-compact", "daemon" (alone) |
| **speak-response** | Stop hook that speaks Claude prose via macOS `say`. | "TTS", "voice" |
| **png-to-code** | PNG → measured pixel-perfect code skill (SVG/HTML/CSS) with screenshot-diff harness. | "image-to-code" |
| **scaffold-workflows** | CLI command that copies the reusable workflow set into another repo. | "scaffold-ci" (legacy name), "ci-setup" |
| **fail-open** | Hooks must exit successfully on any error so a guard bug never blocks the user. | "graceful degrade" |
| **capability layout** | Folders group by product capability (`cli`, `catalog`, `config`, `install`, `runtime`, `skills`). | "src/core layers", pure-core/imperative-shell folders |
| **biome** | Linter and formatter; `biome ci` is the lint half of the gate. | "linter", "prettier" (only half) |
| **co-located tests** | `foo.test.ts` beside `foo.ts`. | "test/ dir" |
| **vertical per feature** | Each feature owns one `src/skills/<sourceDirectory>/` folder. | "horizontal layers" |
| **single command per tool surface** | One `autorun` skill with verbs instead of multiple thin skills. | "one skill per verb" |
| **SSOT** | Single source of truth; app config schema lives in `src/config/bagConfigSchema.ts`; hook defaults in `src/runtime/config.ts`. | "source of truth" (ok, but acronym is used) |
| **clean break** | No back-compat shims on renames/pivots. | "migration", "deprecation" |
| **verify** | The one aggregate gate: `biome ci && typecheck && test && build`. | "qa", "validate" |
