# LANGUAGE.md — dufflebag

The human↔agent glossary: names only. Use these exact terms in code, comments,
commits, and docs; avoid the listed aliases. Orientation lives in `CONTEXT.md`.

## Terms

**bag** / **bag-owned**
Anything the installer manages, identified by the `/dufflebag/` path marker or receipt ownership.
_Avoid_: "owned", "managed" (without marker context).

**feature**
An installable unit such as `context-guard`, `dedup-guard`, `autonomous-loop`, `speak-response`, or `png-to-code` (public kebab-case IDs).
_Avoid_: "plugin", "extension".

**sourceDirectory**
Authored camelCase directory naming a feature under `src/skills/` (payload) or `src/hookIsland/` (runtime) — e.g. `contextGuard`, `pngToCode`. Distinct from the public feature ID.
_Avoid_: "skill folder name" when used as public ID.

**skill**
Agent instruction set under `src/skills/<sourceDirectory>/`. Installed directory names stay kebab-case data.
_Avoid_: "prompt", "instruction file".

**skill payload**
Approved compound for authored content under `src/skills/` copied verbatim into an installed skill directory, including its `scripts/` and `templates/`.
_Avoid_: standalone "payload", "skill code".

**hook island**
Executable dependency-free runtime under `src/hookIsland/<sourceDirectory>/` plus the shared `src/runtime/` kernel. Compiled, assembled flat, installed to `.claude/dufflebag/runtime/`.
_Avoid_: "skills", "payload".

**hook**
Zero-dependency runtime script that runs on an agent hook event. Must be **fail-open**.
_Avoid_: "callback", "handler" (imprecise).

**runtime**
Dependency-free hook kernel under `src/runtime/` and the flat `dist/hooks/` output.
_Avoid_: "payload" (legacy), "bundle", "binary".

**catalog**
The allowlist in `src/catalog/featureCatalog.ts` that declares every feature and what it ships.
_Avoid_: "registry", "manifest", "`FEATURES`" alone.

**receipt**
Ownership record at `.claude/dufflebag/receipt.json` authorizing install/update/uninstall mutations.
_Avoid_: "manifest" (legacy).

**ships / shippedPaths**
Per-feature allowlist of paths copied into a user's install. Fail-safe: unlisted paths ship nothing.
_Avoid_: "includes", "files".

**surgical install / uninstall**
Receipt-authorized edits that restore prior bytes on uninstall.
_Avoid_: "merge", "patch".

**context-guard**
Nudge `/handoff` at the warn fraction and hard-deny new code edits near the cap.
_Avoid_: "context manager".

**idle auto-compact**
Optional native-hook loop that submits one idle draft, waits for any resulting turn, compacts once, then parks.
_Avoid_: "autorun" (different context-budget loop), "timer wrapper".

**native hook adapter**
Catalog evidence that an agent's lifecycle events, config path, and compact command were verified.
_Avoid_: "supported" without evidence.

**terminal claim**
Session-start proof binding automation to one stable Ghostty terminal ID, including tabs and splits.
_Avoid_: "focused pane", "front window".

**dedup-guard**
DRY guard that blocks duplicate function/type bodies at write time.
_Avoid_: "duplicate checker".

**autonomous-loop / `autorun`**
Skill that arms the context-guard SessionStart daemon for hands-free compact/resume (`stop`/`exit` verbs). Hook runtime is owned by **context-guard**.
_Avoid_: "auto-compact", "daemon" (alone).

**speak-response**
Public feature ID for the stop hook that narrates a complete agent reply locally. Internal code uses domain terms such as `agentReply`.
_Avoid_: standalone "response" in authored identifiers.

**png-to-code**
PNG → measured pixel-perfect code skill (SVG/HTML/CSS) with screenshot-diff harness.
_Avoid_: "image-to-code".

**workflow scaffold**
CLI command that copies the owned single-gate CI/publish set into another repository.
_Avoid_: "scaffold-ci", "scaffold-workflows", "ci-setup".

**fail-open**
Hooks must exit successfully on any error so a guard bug never blocks the user.
_Avoid_: "graceful degrade".

**capability layout**
Folders group by product capability (`cli`, `catalog`, `config`, `install`, `runtime`, `skills`, `hookIsland`).
_Avoid_: "src/core layers", pure-core/imperative-shell folders.

**biome**
Linter and formatter; `biome ci` is the lint half of the gate.
_Avoid_: "linter", "prettier" (only half).

**co-located tests**
`foo.test.ts` beside `foo.ts`.
_Avoid_: "test/ dir".

**vertical per feature**
Each feature owns one folder named for its `sourceDirectory` — under `src/skills/` when it ships payload, under `src/hookIsland/` when it ships runtime.
_Avoid_: "horizontal layers".

**single command per tool surface**
One `autorun` skill with verbs instead of multiple thin skills.
_Avoid_: "one skill per verb".

**agent root contract**
Root `AGENTS.md`, authoritative for agent behavior and the routing map to delegated subject SSOTs; `CLAUDE.md` and `GEMINI.md` are symlinks to it.
_Avoid_: "agent digest" when implying it is non-authoritative.

**SSOT**
Single source of truth; the full managed-configuration contract lives in `src/config/bagConfigSchema.ts`, while `src/runtime/config.ts` holds only the dependency-free hook projection.
_Avoid_: "source of truth" (acceptable, but the acronym is established).

**clean break**
No back-compat shims on renames/pivots.
_Avoid_: "migration", "deprecation".

**verify**
The one aggregate script that owns every repository check required by CI.
_Avoid_: "qa", "validate".
