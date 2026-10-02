# LANGUAGE.md — dufflebag

The human↔agent glossary: names only. Use these exact terms in code, comments,
commits, and docs; avoid the listed aliases. Orientation lives in `CONTEXT.md`.

Names are plain English, one word per idea. A file is named after what is inside it,
and a command file is named after its command.

## Terms

**owned file**
A file the installer manages, recorded in the receipt or marked by the `/dufflebag/` path.
_Avoid_: "managed" (without receipt context).

**feature**
An installable unit such as `context-guard`, `duplicate-code-guard`, `autorun`, `voice`, or `image-to-code` (public kebab-case IDs).
_Avoid_: "plugin", "extension".

**sourceDirectory**
Authored camelCase directory naming a feature under `src/skills/` (payload) or `src/hooks/` (hook code) — e.g. `contextGuard`, `duplicateCodeGuard`, `imageToCode`. Distinct from the public feature ID.
_Avoid_: "skill folder name" when used as public ID.

**skill**
Agent instruction set under `src/skills/<sourceDirectory>/`. Installed directory names stay kebab-case data.
_Avoid_: "prompt", "instruction file".

**skill payload**
Approved compound for authored content under `src/skills/` copied verbatim into an installed skill directory, including its `scripts/` and `templates/`.
_Avoid_: standalone "payload", "skill code".

**hook code**
Executable dependency-free code under `src/hooks/<sourceDirectory>/` plus the shared `src/hooks/lib/`. Compiled and installed to `.claude/dufflebag/hooks/`.
_Avoid_: "skills", "payload".

**hook**
Zero-dependency script that runs on an agent hook event. Must be **fail-open**.
_Avoid_: "callback", "handler" (imprecise).

**hook library**
Dependency-free code every hook feature shares (`hookConfig`, `hookOutput`) under `src/hooks/lib/`, copied into each hook feature's `lib/` at install.
_Avoid_: "payload", "bundle", "binary".

**watcher**
Background Node process a hook starts so it can act later: the autorun watcher and the idle compact watcher.
_Avoid_: "service", "background job".

**worker**
Background process of the Rust voice binary: the dictation worker and the narration worker.
_Avoid_: "service", "background job".

**decision**
Pure function that says what should happen next (`autorunDecision`, `idleCompactDecision`, `duplicateDecision`), kept apart from the code that acts on it.
_Avoid_: "policy engine", "rule engine".

**catalog**
The allowlist in `src/catalog/featureCatalog.ts` that declares every feature and what it ships.
_Avoid_: "registry", "manifest", "`FEATURES`" alone.

**receipt**
Ownership record at `.claude/dufflebag/receipt.json` authorizing install/update/uninstall changes.
_Avoid_: "manifest".

**ships / shippedPaths**
Per-feature allowlist of paths copied into a user's install. Fail-safe: unlisted paths ship nothing.
_Avoid_: "includes", "files".

**surgical install / uninstall**
Receipt-authorized edits that restore prior bytes on uninstall.
_Avoid_: "merge", "patch".

**setting**
One `config.json` key defined in `src/config/configSchema.ts`. The key starts with its area word (`contextWarnPercent`); the CLI name is its kebab-case form (`context-warn-percent`).
_Avoid_: "option", "flag" (those are CLI arguments).

**environment variable**
A `DUFFLEBAG_<AREA>_<SETTING>` name listed in `src/config/environmentVariables.ts`, for example `DUFFLEBAG_IDLE_COMPACT_AFTER`.
_Avoid_: "env key".

**context-guard**
Nudge `/handoff` at the warn percent and hard-deny new code edits at the block percent.
_Avoid_: "context manager".

**idle compact**
Optional native-hook loop that submits one idle draft, waits for any resulting turn, compacts once, then parks.
_Avoid_: "autorun" (different context-budget loop), "timer wrapper".

**native hook adapter**
Catalog evidence that an agent's lifecycle events, config path, and compact command were verified.
_Avoid_: "supported" without evidence.

**terminal claim**
Session-start proof binding automation to one stable Ghostty terminal ID, including tabs and splits.
_Avoid_: "focused pane", "front window".

**duplicate-code-guard**
Guard that blocks a copied function body or type shape at write time. `dufflebag duplicates` runs the same check from the CLI or CI.
_Avoid_: "duplicate checker".

**scratch-folder-guard**
Guard that denies agent writes into system temporary folders and deletes an ended Claude Code session's own scratch folder. Code names say "scratch" because `temp`/`tmp` are forbidden name tokens.
_Avoid_: "temp guard", "tmp hook".

**session-rehome**
Feature that moves an ended Claude Code session or Codex thread into the local repo its work was about, so that repo's `/resume` or `codex resume` lists it. "Rehome" is the verb for that move; a session's **home** is the folder its agent lists it under.
_Avoid_: "migrate", "relocate" (Claude Code's own word for its worktree moves).

**ledger**
session-rehome's append-only record of every decision (moved, stayed, uncertain, no-signal, deleted, conflict); the newest line for a session wins.
_Avoid_: "log", "history" (Claude Code's `history.jsonl` is a different file).

**autorun**
Feature and skill that arms the context-guard autorun watcher for hands-free compact/resume (`stop`/`exit` verbs). Its hook code is owned by **context-guard**.
_Avoid_: "auto-compact", "autopilot".

**voice**
Public feature ID for local voice: the stop hook that reads a complete agent reply aloud, dictation, and prompt refinement. Internal code uses domain terms such as `agentReply`.
_Avoid_: standalone "response" in authored identifiers.

**image-to-code**
Image (PNG, screenshot, design) → measured pixel-perfect code skill (SVG/HTML/CSS) with screenshot-diff harness.

**workflow scaffold**
CLI command that copies the owned single-gate CI/publish set into another repository.
_Avoid_: "ci-setup".

**fail-open**
Hooks must exit successfully on any error so a guard bug never blocks the user.
_Avoid_: "graceful degrade".

**capability layout**
Folders group by product capability (`cli`, `catalog`, `config`, `install`, `hooks`, `skills`, `doctor`, `workflows`, `voiceControl`, `providerRouting`).
_Avoid_: "src/core layers", pure-core/imperative-shell folders.

**biome**
Linter and formatter; `biome ci` is the lint half of the gate.
_Avoid_: "linter", "prettier" (only half).

**co-located tests**
`foo.test.ts` beside `foo.ts`.
_Avoid_: "test/ dir".

**vertical per feature**
Each feature owns one folder named for its `sourceDirectory` — under `src/skills/` when it ships payload, under `src/hooks/` when it ships hook code.
_Avoid_: "horizontal layers".

**single command per tool surface**
One `autorun` skill with verbs instead of multiple thin skills.
_Avoid_: "one skill per verb".

**agent root contract**
Root `AGENTS.md`, authoritative for agent behavior and the routing map to delegated subject SSOTs.
_Avoid_: "agent digest" when implying it is non-authoritative.

**SSOT**
Single source of truth; the full managed-configuration contract lives in `src/config/configSchema.ts`, every environment variable in `src/config/environmentVariables.ts`, while `src/hooks/lib/hookConfig.ts` holds only the dependency-free hook projection.
_Avoid_: "source of truth" (acceptable, but the acronym is established).

**clean break**
No back-compat shims on renames/pivots. Old installs upgrade by uninstalling with the old version, then installing the new one.
_Avoid_: "migration", "deprecation".

**verify**
The one aggregate script that owns every repository check required by CI.
_Avoid_: "qa", "validate".
