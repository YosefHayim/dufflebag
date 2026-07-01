# CODE-STYLE.md

How code is written in **dufflebag**. Prescriptive (how to write), not
descriptive (what exists — that's `../../AGENTS.md`). This file lives at
`templates/mdFiles/CODE-STYLE.md` and is the **SSOT for style**; the rules digest is
mirrored into `../../AGENTS.md` — **edit here, not there.** Between runs, the
`deslop` skill reads this file to enforce style per-diff.

> **Style refresh landed 2026-07-02** ([ADR 0012](../../docs/adr/current/0012-tsdoc-on-the-exported-surface.md),
> [ADR 0013](../../docs/adr/current/0013-style-refresh-colocated-tests-single-command-autorun-templates.md)).
> Two reversals from the earlier doctrine: **the exported surface now requires TSDoc**
> (was "minimal comments, strip JSDoc"), and **biome is the linter as well as the
> formatter** (the linter was off). Tests co-locate (no `test/` dir), the autonomous
> loop is one `autorun` command with verbs, and `workflow-templates/` is now
> `templates/workflows/`. A follow-on consolidation ([ADR 0014](../../docs/adr/current/0014-consolidate-under-src-and-templates.md))
> then moved **all source under `src/`** (`src/skills/`, `src/scripts/`) and **all copyable
> templates under `templates/`** (this guide now lives at `templates/mdFiles/`). Where a diff
> drifts from a rule below, **the rule wins** and
> `deslop` flags it; the architectural *why* lives in `../../docs/adr/current/`.

## Scope

One strict style bar for **all TypeScript** — the CLI engine (`src/`), every
feature's engine (`src/skills/<feature>/{hooks,lib,command}`) *and* the dev-only png
harness (`src/skills/png-to-code/scripts/`). Nothing is exempt from the *style* bar
([ADR 0004](../../docs/adr/current/0004-unified-style-and-error-model-by-role.md)).
The one structural exception is the harness's **own `tsconfig`** (see "Single
tsconfig root" below) — a separate build, not a separate style.

## Stack & framework practices

There is no framework here to defer to — this is Node + TypeScript. Point each
concern at the skill that owns it; do not restate them:

- **Authoring skill content** (`src/skills/**/SKILL.md`, `png-to-code` docs) → `write-a-skill`.
- **Comment / readability enforcement per diff** → `deslop` (reads this file).
- **CLI/TUI UX review** (flows, prompts, states) → `interactive-cli-reviewer` (advisory).
- **TSDoc authoring / cleanup** → `jsdoc-editor`.

`commander`, `@clack/prompts`, `picocolors`, `playwright`, `pixelmatch`, `pngjs`,
`svgo`, `biome`, and `vitest` have **no official skill** — their usage rules live
in this file. Dependency choices are governed by
[ADR 0006](../../docs/adr/current/0006-lean-dependency-stance.md).

---

## Rules

Load-bearing, project-specific rules only. Each is a one-line rule plus a real
before/after.

### TSDoc on the exported surface — mandatory

Every **exported** function and type carries TSDoc: a one-line summary, `@param`
for **each** parameter, `@returns` for every non-`void` return, and one doc line
per `interface`/`type` **property**. Non-exported one-liner helpers are **exempt**
(a summary only when the name isn't self-evident). This is a **reversal** of the
old minimal-comments stance ([ADR 0012](../../docs/adr/current/0012-tsdoc-on-the-exported-surface.md)):
the boundary is documented; the anti-noise spirit survives only *inside* a module.

```ts
// before — src/commands/scaffoldCi.ts (prose header, no tags)
/** Fill the publish copy-template's {{OWNER}}/{{REPO}}/{{PACKAGE}} placeholders. */
export function fillPublishTemplate(template: string, inputs: ScaffoldInputs): string { … }

// after — summary + @param each + @returns
/**
 * Fill the publish copy-template's `{{OWNER}}`/`{{REPO}}`/`{{PACKAGE}}` placeholders.
 * @param template - raw `publish.yml` text containing the placeholders.
 * @param inputs - repo identity (owner, repo, package name) to substitute in.
 * @returns the filled YAML, ready to write to `.github/workflows/`.
 */
export function fillPublishTemplate(template: string, inputs: ScaffoldInputs): string { … }
```

```ts
// before — an exported interface with a single header
/** Repo identity the publish copy-template needs filled in. */
export interface ScaffoldInputs { owner: string; repo: string; packageName: string; }

// after — one doc line per property
export interface ScaffoldInputs {
  /** GitHub org/user that owns the target repo. */
  owner: string;
  /** Target repository name. */
  repo: string;
  /** npm package name to publish as. */
  packageName: string;
}
```

_Why:_ this is a library-shaped CLI — an agent or human reading a single signature
should get the contract without opening the body. Internal one-liners stay bare so
the noise `deslop` used to strip never returns *inside* a module.

### Readable over clever — the boring version wins

Prefer explicit, skimmable code to a dense one-liner. Behavior lives in **data
tables and guard clauses**, not metaprogramming. If a reader has to decode it, it's
wrong even when it's shorter.

```ts
// before — "clever": a comma-operator reduce, write-once/read-never
export const skillsFor = (ids: FeatureId[]): string[] =>
  [...ids.reduce((s, id) => (FEATURES[id].skills.forEach((k) => s.add(k)), s), new Set<string>())];

// after — src/core/catalog/features.ts (the real code)
export function skillsFor(ids: FeatureId[]): string[] {
  return [...new Set(ids.flatMap((id) => FEATURES[id].skills))];
}
```

_Why:_ the whole `FEATURES` catalog is this principle — behavior is **data**, not
branches. `classifyAgents` returns an explicit array rather than a clever map;
hooks early-exit with named guard clauses rather than nested ternaries.

### Single tsconfig root — one config per deployable unit

There is **one `tsconfig.json` at the repo root** (`rootDir: "."`) governing the
whole main project — `src/` and every shipped skill's `hooks`/`lib`/`command`. Do
not scatter configs within a unit. The **only** sanctioned second tsconfig is
`src/skills/png-to-code/scripts/tsconfig.json`, because the harness is a physically
separate sub-package (its own `package.json`, its own deps, its own install/build
lifecycle) — [ADR 0013](../../docs/adr/current/0013-style-refresh-colocated-tests-single-command-autorun-templates.md).

```jsonc
// tsconfig.json (root) — the one config; tests are excluded from emit
{
  "compilerOptions": { "rootDir": ".", "outDir": "dist", "strict": true, /* … */ },
  "include": ["src/**/*.ts"],                 // src/** now covers the kernel, every skill, and the build script
  "exclude": ["node_modules", "dist", "src/skills/png-to-code", "**/*.test.ts"]
}
```

_Why:_ a scattered tsconfig is how the harness drifted into its own quote style once
([ADR 0004](../../docs/adr/current/0004-unified-style-and-error-model-by-role.md)); one
config per unit keeps the bar single.

### biome is the linter AND the formatter — `recommended` on

`biome.json` runs the **linter** (`recommended`) *and* the formatter *and*
organize-imports over `src/**` (which now holds the kernel, every skill, and the harness). `biome check --write` is the local
fixer; `biome ci` is the one gate (lint + format + imports in a single pass — no
separate `lint.yml`/`format.yml`; that split is only for ESLint + Prettier). A rule
that fights an intentional pattern is disabled in `biome.json` — currently only
`style/noNonNullAssertion` (non-null assertions are deliberate at controlled sites:
regex match groups, `ts!` after a resolve guard, in the zero-dep hooks + png harness).
Keep `biome.json` **strict JSON — no comments**: a stray `//` silently invalidates the
config and biome falls back to scanning `dist/` + everything else, so document
suppression reasons *here*, not inline.

```json
// before — linter off, half the skill TS not even covered
{ "files": { "includes": ["src/**/*.ts", "test/**/*.ts", "src/skills/png-to-code/scripts/**/*.ts"] },
  "linter": { "enabled": false } }

// after — one bar over all TS (src/** = kernel + skills + harness), correctness rules on
{ "files": { "includes": ["src/**/*.ts"] },
  "linter": { "enabled": true, "rules": { "recommended": true, "style": { "noNonNullAssertion": "off" } } } }
```

_Why:_ "biome as the eslinter and prettier" means both jobs. Formatting-only let
real bugs through; the linter is the correctness half.

### Tests co-locate — no `test/` dir

A unit test sits **beside its source** as `foo.test.ts` next to `foo.ts`.
Cross-cutting tests that don't map to a single source file (the install/uninstall
round-trip; the workflow drift check) live in `src/commands/` as
`*.integration.test.ts`. `vitest` discovers `src/**/*.test.ts` (skills included, since they live under `src/`);
the root tsconfig excludes `**/*.test.ts` from emit and the npm tarball excludes
them too ([ADR 0013](../../docs/adr/current/0013-style-refresh-colocated-tests-single-command-autorun-templates.md)).

```
// before (a separate tree)         // after (beside the source)
test/features.test.ts               src/core/catalog/features.test.ts
test/dupIndex.test.ts               src/skills/dedup-guard/lib/dupIndex.test.ts
test/settings.test.ts               src/core/settings/settings.test.ts
test/commands.integration.test.ts   src/commands/commands.integration.test.ts   (cross-cutting → commands/)
test/workflowTemplates.test.ts      src/commands/workflowTemplates.integration.test.ts
```

_Why:_ a test next to its source is found, run, and updated together with it;
the two orphans that span many files get an explicit `*.integration.test.ts` home.

### Pure core, imperative shell — split with a divider

Any module that touches disk / env / process separates **pure transformers**
(top) from **effects** (bottom) with a literal `// --- IO layer ---` divider.
Tests hit the pure half; this is what makes the risky settings surgery unit-
testable without disk. **Hard rule.** Folders group **by purpose** — `src/core/`
by domain (`catalog`/`settings`/`wiring`/`host`), each feature vertical under
`src/skills/<feature>/` — and the pure/effects split stays *within* each module
([ADR 0010](../../docs/adr/current/0010-core-grouped-by-domain.md)).

```ts
// core/settings/settings.ts
export function mergeManagedHooks(input: ClaudeSettings, hooks: RenderedHook[]): ClaudeSettings { … } // pure: clone in → clone out
export function mergeEnv(input: ClaudeSettings, envMap: Record<string, string>): ClaudeSettings { … }  // pure
// --- IO layer ---------------------------------------------------------------
export function readSettings(file: string): ClaudeSettings { … }   // disk
export function writeSettings(file: string, s: ClaudeSettings): void { … } // disk
```

_Why:_ `src/core/settings/settings.test.ts` exercises the merge logic with plain
objects and never touches a file.

### Error handling is chosen by role, not by locale

Three modes, picked by what a module **is**
([ADR 0004](../../docs/adr/current/0004-unified-style-and-error-model-by-role.md)):

```ts
// HOOK — fail-open. A guard bug must NEVER block the user's edit.  (src/skills/dedup-guard/hooks/dedupGuard.ts)
try { main(); } catch (e) { if (readConfig().debugEnabled) writeSync(2, `…${e}`); process.exit(0); }

// CLI — throw an actionable Error, caught once at the top.  (cli.ts + core/config.ts)
throw new Error(`contextWarnFraction (${w}) must be below contextBlockFraction (${b})`);
program.parseAsync(process.argv).catch((err) => { fail(String(err)); process.exitCode = 1; });

// GATE / HARNESS — fail-closed, exit code IS the product.  (src/skills/dedup-guard/command/dedupCheck.ts, png harness bin/*)
process.exitCode = 1;   // duplicates found
process.exit(2);        // usage / IO error
```

_Why:_ a hook that throws would brick editing; a CI gate that swallows its exit
code is useless.

### Hooks are fail-open and go through `allow()` / `emit()`

Every hook is a `main()` wrapped in a top-level `try/catch → process.exit(0)`,
with guard-clause early-exits via `src/payload/io.ts`. `stderr` only when
`debugEnabled`. Never bundle a runtime dep into the payload
([ADR 0001](../../docs/adr/current/0001-zero-dependency-hook-payload.md)).

```ts
// src/skills/dedup-guard/hooks/dedupGuard.ts
if (mode === "off") allow();                 // early-exit, not `return`
if (!isSourcePath(filePath)) allow();
if (hits.length === 0) allow();
emit({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", … } });
```

_Why:_ `allow`/`emit` are typed `never` and flush synchronously — a hook must
write its decision before exit or a pipe drops it.

### Declare a shared contract once, re-export it — never re-declare

Anything the CLI and the payload must agree on lives in **one** module; the other
side imports and re-exports
([ADR 0003](../../docs/adr/current/0003-config-ssot-inside-payload.md)).

```ts
// SSOT — src/payload/config.ts (inside the zero-dep payload kernel)
export const ENV_KEYS = { contextWarnFraction: "dufflebagContextWarnFraction", … } as const;
// CLI re-exports, never re-declares — core/config.ts
export { DEFAULTS, ENV_KEYS, ENV_PREFIX, … } from "../payload/config.js";
```

_Why:_ a divergent key name would silently disable the guardrail.

### Pure mutators clone in, clone out — never mutate an argument

Settings/JSON transformers take a value and return a new one via `structuredClone`.

```ts
// core/settings/settings.ts
const clone = <T>(value: T): T => structuredClone(value);
export function removeManagedHooks(input: ClaudeSettings): ClaudeSettings {
  const settings = clone(input);   // never touch `input`
  …
  return settings;
}
```

_Why:_ callers chain these (`removeManagedEnv(removeManagedHooks(…))`); in-place
mutation would make ordering load-bearing and tests brittle.

### Bag-owned entries are identified only by their marker

Everything the installer owns is recognized by the `/dufflebag/` path marker (in
hook commands) or the `dufflebag` env prefix — never by position or count. This is
what makes uninstall surgical.

```ts
// core/settings/paths.ts
export const isBagCommand = (command: string): boolean => command.includes(PATH_MARKER);
```

_Why:_ the user hand-maintains `settings.json`; we must take back **exactly** what
we added and nothing else.

### Layout: vertical per feature; the shared kernel stays in `src/`

Each feature owns **one folder** — `src/skills/<feature>/` holds its engine (hook
sources, feature-local libs, its command) *and* its shipped content. The
irreducible shared kernel stays in `src/`, split by dependency reach: `src/core/`
(CLI kernel — may use `commander`/clack) and `src/payload/` (zero-dep hook
kernel: the `config` SSOT + `io`). Sources are vertical; the build gathers hooks
into a **flat** `dist/hooks/` payload ([ADR 0008](../../docs/adr/current/0008-vertical-per-feature-layout.md)).

```
// before (layered)              // after (vertical per feature)
src/hooks/dedupGuard.ts          src/skills/dedup-guard/hooks/dedupGuard.ts
src/hooks/lib/dupIndex.ts        src/skills/dedup-guard/lib/dupIndex.ts        (feature-local — moves down)
src/commands/dedup.ts            src/skills/dedup-guard/command/dedupCheck.ts
src/hooks/lib/config.ts (SSOT)   src/payload/config.ts                     (shared kernel — stays up)
```

_Why:_ features share a zero-dep config SSOT — a kernel can't live inside one
feature. Only the truly shared stays up; anything one feature owns moves into its
folder.

### One command per tool surface — the autonomous loop is `autorun`

A tool with several verbs is **one skill/command**, not one-per-verb, when a single
engine backs them. The autonomous loop ships **one** `autorun` skill:
`/autorun <n>` arms, `/autorun stop` pauses, `/autorun exit` shuts the daemon down —
all routed to the single `ctxLoopCtl.js` control plane (`arm|stop|exit`)
([ADR 0013](../../docs/adr/current/0013-style-refresh-colocated-tests-single-command-autorun-templates.md)).

```ts
// before — three sibling skills, one engine
FEATURES["autonomous-loop"].skills = ["autorun", "autostop", "autoexit"];
// after — one skill, verbs routed by the skill's argument
FEATURES["autonomous-loop"].skills = ["autorun"];   // /autorun · /autorun stop · /autorun exit
```

_Why:_ the three skills were thin shells over the same `ctl` subcommands; one
command matches the engine and the user's mental model. The `--features
autonomous-loop` id is an external CLI contract and is unchanged.

### Ship boundary: the catalog declares what ships

`src/skills/<feature>/` mixes engine `.ts` with shipped content, so the installer must
never copy build-only source into a user's `~/.claude`. The `FEATURES` catalog's
**`ships`** list is the allowlist; the installer copies **only** those paths (and
the npm tarball excludes co-located `*.test.ts`).

```ts
// install.ts — copy only the catalog-declared paths (unlisted ships nothing)
for (const rel of feature.ships) copyDir(path.join(src, rel), path.join(dest, rel));
```

_Why:_ fail-safe — a build-only `dedupGuard.ts` never leaks because it isn't
listed; a forgotten path ships *nothing*, not everything
([ADR 0008](../../docs/adr/current/0008-vertical-per-feature-layout.md)).

### Workflows: single-purpose legs under `templates/workflows/`, copied per repo

CI is a set of single-purpose `workflow_call` legs (`biome` / `typecheck` / `test`
/ `build` / `report-failure` / opt-in `e2e`) composed by a `ci.yml` gate through
`./` local refs. `dufflebag scaffold-ci` **copies** the whole set from
**`templates/workflows/`** into a target repo, so each repo **owns** its CI
(`--force` resyncs). Only `publish.yml` is templated — OIDC binds per repo +
filename, so its `{{OWNER}}/{{REPO}}/{{PACKAGE}}` are filled in. The scaffolder
writes YAML as text — no YAML dep
([ADR 0006](../../docs/adr/current/0006-lean-dependency-stance.md), [ADR 0009](../../docs/adr/current/0009-reusable-workflows-and-cli-scaffolding.md)).

```yaml
# a scaffolded ci.yml composes local legs — copied, not referenced:
jobs:
  biome:
    uses: ./.github/workflows/biome.yml
```

_Why:_ a personal toolbelt shouldn't couple every repo to dufflebag as a live
workflow host; self-contained copies (resynced on demand) win. **Every project
should adopt this set** via `dufflebag scaffold-ci`. **A private repo simply omits
`publish.yml`** (nothing to publish) — the rest of the set stands alone. The shared
legs ship in both `.github/workflows/` and `templates/workflows/`, kept
byte-identical by a test. `biome ci` is one gate (lint + format); matrix only on
`test` + `build`.

### Naming

| Category | Case | Example |
|---|---|---|
| Files | `camelCase` | `agentWiring.ts`, `contextGuard.ts`, `pixelDiff.ts` |
| Functions / variables | `camelCase` | `resolveFeatures`, `repoRoot` |
| Constants (hardcoded values) | `SCREAMING_SNAKE` | `INSTALL_DIR_NAME`, `ENV_KEYS`, `OUT_HOOKS` |
| Types / interfaces | `PascalCase` | `Feature`, `BagConfig`, `DedupMode` |
| Feature IDs · skill dirs · CLI flags | `kebab-case` | `png-to-code`, `--dedup-mode` |

_Why:_ the last row is an **external contract** — `npx dufflebag install --features
png-to-code` and existing installs depend on it; never casing-convert product IDs.

### Types & contracts

`interface` for object shapes, `type` for unions/aliases. **Explicit return types**
on every exported function. Prefer string-literal unions over enums.

```ts
export type FeatureId = "context-guard" | "autonomous-loop" | "speak-response" | "dedup-guard" | "png-to-code";
export interface Feature { id: FeatureId; requires: FeatureId[]; hooks: ManagedHook[]; … }
export function resolveFeatures(requested: FeatureId[]): FeatureId[] { … }
```

### Imports: `node:` prefix, barrels per directory

Node builtins use the `node:` prefix. The CLI-kernel directories — `core/`,
`commands/`, and the harness `lib/` — expose an `index.ts` barrel, and
cross-directory consumers import from it, not the file. The **zero-dep payload**
(`src/payload/`) and **feature libs** (`src/skills/<feature>/lib/`) expose **no**
barrel: their few consumers import the specific file (`../../../payload/config.js`,
`../lib/state.js`), so the flat-payload assembler can rewrite those exact
specifiers to `./lib/` deterministically.

```ts
// before — install.ts
import { resolveLayout } from "../core/paths.js";
import { readSettings } from "../core/settings.js";  // …and ~8 more
// after
import { resolveLayout, readSettings, /* … */ } from "../core/index.js";
```

_Barrels use NodeNext `.js` re-exports and must not introduce an import cycle._

---

## Recipes

### How to add a feature

1. Create `src/skills/<feature-id>/` — the feature's one folder (engine + content).
2. Add the id to the `FeatureId` union and `ALL_FEATURES` in `core/catalog/features.ts`,
   and its entry to the `FEATURES` catalog: `title`, `summary`, `requires`,
   `platform`, `skills`, `hooks` (via the `HOOK` map), and **`ships`** — the exact
   paths copied into a user's install (`[]` for a pure-hook feature).
3. Hooks → `src/skills/<feature-id>/hooks/<name>.ts` (see next recipe); register in
   the `HOOK` map. Feature-local helpers → `src/skills/<feature-id>/lib/`.
4. A feature command → `src/skills/<feature-id>/command/`, wired in `cli.ts`.
5. Shipped content (`SKILL.md`, `references/`) → the same folder; list it in `ships`.
6. **TSDoc every exported function/type** you add (summary + `@param`/`@returns` +
   per-prop). Tests co-locate: put `foo.test.ts` next to `foo.ts`; a cross-cutting
   test goes in `src/commands/*.integration.test.ts`.

### How to add a hook

1. `src/skills/<feature>/hooks/<name>.ts` — a `main()` wrapped in `try { main() } catch { process.exit(0) }`.
2. Read stdin with `JSON.parse(readFileSync(0, "utf8"))` inside a `try` that
   falls to `allow()`. Emit decisions with `allow()` / `emit()` from `src/payload/io.ts`.
3. Import **only** `node:*`, `src/payload/*`, and the feature's own files
   ([ADR 0001](../../docs/adr/current/0001-zero-dependency-hook-payload.md)). Cross into `core` only via `import type`.
4. Register it in the `HOOK` map; the build gathers it into the flat `dist/hooks/` payload.

### How to add a harness script

1. `src/skills/png-to-code/scripts/src/bin/<name>.ts` — a runnable entrypoint.
2. Parse args with `lib/argv.ts`; fail with `fail(msg): never` (`console.error` +
   `process.exit(2)`). Emit results as JSON on stdout; **exit code is the
   contract** (0 pass / 1 fail / 2 usage-IO).
3. Shared logic goes in `lib/` / `png/` / `verify/`, not in the entrypoint.

### How to wire a repo's CI/publish

1. CI is **copied**: `dufflebag scaffold-ci` copies the whole workflow set from
   `templates/workflows/` into a repo's `.github/workflows/` (`--force` to resync).
   To change a leg, edit BOTH `.github/workflows/<leg>.yml` and
   `templates/workflows/<leg>.yml` — a drift test keeps the shared legs
   byte-identical. Keep `biome` + `typecheck` single-leg; `test` + `build` on the
   os × Node matrix. Add a purpose = one new `templates/workflows/*.yml` (+ a leg
   in the `ci.yml` gate).
2. Publish is **templated**: `scaffold-ci` fills `publish.yml`'s
   `{{OWNER}}/{{REPO}}/{{PACKAGE}}` from the target's git remote + `package.json`.
   Never turn it into a `workflow_call` reference — OIDC binds to the repo + filename
   ([ADR 0009](../../docs/adr/current/0009-reusable-workflows-and-cli-scaffolding.md)).
3. **Private repo?** Omit or delete `publish.yml` — there's nothing to publish; the
   rest of the CI set stands alone.

---

## Exemplars

Write new code like these files:

- `src/core/settings/settings.ts` — pure/IO split, clone-in-clone-out, surgical + idempotent mutation.
- `src/payload/config.ts` — the config SSOT; a self-contained, dependency-free payload module.
- `src/commands/scaffoldCi.ts` — pure/IO split + fully-TSDoc'd exported surface (the target for TSDoc).
- `src/skills/dedup-guard/hooks/dedupGuard.ts` — the fail-open hook shape (`main()` + top-level catch + `allow`/`emit` guard clauses).
- `src/core/catalog/features.ts` — catalog-driven design: behavior is **data** (the `FEATURES` table), not branches.
- `src/skills/dedup-guard/lib/dupIndex.ts` — the AST engine; fail-soft at every entry point.

---

## Never

- **Never** leave an **exported** function or type without TSDoc (`@param` each + `@returns` + per-prop) ([ADR 0012](../../docs/adr/current/0012-tsdoc-on-the-exported-surface.md)).
- **Never** add a name-restating comment to **internal** (non-exported) code — the exemption for the exported surface stops at the boundary.
- **Never** let a hook throw past its top-level catch — fail-open is inviolable.
- **Never** `console.*` in the CLI — go through `core/ui.ts` (the clack wrapper). Harness scripts may use `console.*` as their output contract.
- **Never** make a runtime dependency reachable from the hook payload (`node:*` + `src/payload/*` + the feature's own `lib/` only).
- **Never** re-declare a shared contract — re-export the SSOT ([ADR 0003](../../docs/adr/current/0003-config-ssot-inside-payload.md)).
- **Never** mutate a settings/JSON argument in place — clone in, clone out.
- **Never** write an empty/noise env key — skip empty strings.
- **Never** entangle pure logic with IO in one function — split with the `// --- IO layer ---` divider.
- **Never** casing-convert a product ID (feature id, skill dir, CLI flag) — they are external contracts.
- **Never** scatter a second `tsconfig.json` within the main project — one config per deployable unit; the png harness is the single exception.
- **Never** ship a `test/` dir — tests co-locate beside their source (cross-cutting → `src/commands/*.integration.test.ts`).
- **Never** turn biome's linter back off — biome is the linter *and* formatter; suppress a specific rule in `biome.json` (reason recorded here) instead.
- **Never** put a comment in `biome.json` — it must be strict JSON; a stray `//` silently makes biome scan `dist/` and everything else.
- **Never** identify bag-owned entries by anything but the `/dufflebag/` path marker or `dufflebag` env prefix.
- **Never** add a dependency without a justification note ([ADR 0006](../../docs/adr/current/0006-lean-dependency-stance.md)).
- **Never** ship build-only `.ts` into a user's install — the catalog `ships` allowlist is the boundary ([ADR 0008](../../docs/adr/current/0008-vertical-per-feature-layout.md)).
- **Never** make `publish.yml` a referenced `workflow_call` — OIDC binds per repo + filename; it is copied + templated, never referenced ([ADR 0009](../../docs/adr/current/0009-reusable-workflows-and-cli-scaffolding.md)).
- **Never** edit a shared workflow leg in only one of `.github/workflows/` or `templates/workflows/` — they must stay byte-identical (the drift test enforces it).

---

## Refresh log

- **2026-07-02** ([ADR 0014](../../docs/adr/current/0014-consolidate-under-src-and-templates.md)): source consolidation into two top-level buckets — `skills/` → `src/skills/`, `scripts/` → `src/scripts/` (all source under `src/`), and `mdFiles/` → `templates/mdFiles/` (all copyable templates under `templates/`, joining `templates/workflows/`). `rootDir: "."` keeps the `dist/src/**` layout; skill→kernel imports drop the now-redundant segment (`../../../src/payload/` → `../../../payload/`). Personal-skill symlinks re-pointed; the catalog ship-path + `bundledSkillsDir()` follow to `src/skills`.
- **2026-07-02** ([ADR 0012](../../docs/adr/current/0012-tsdoc-on-the-exported-surface.md), [ADR 0013](../../docs/adr/current/0013-style-refresh-colocated-tests-single-command-autorun-templates.md)): TSDoc mandatory on the exported surface (reverses the old minimal-comments rule); biome linter on (`recommended`); tests co-located, `test/` removed; the autonomous loop collapsed to one `autorun` command with `stop`/`exit` verbs; `workflow-templates/` → `templates/workflows/`; this guide moved to `mdFiles/CODE-STYLE.md`.
- **2026-07-01** ([ADR 0007](../../docs/adr/current/0007-rename-to-dufflebag-broadened-remit.md)–[0010](../../docs/adr/current/0010-core-grouped-by-domain.md)): the dufflebag pivot — rename across four contracts (clean break, no back-compat), vertical per-feature layout, catalog ship-allowlist, reusable workflows, core grouped by domain.
