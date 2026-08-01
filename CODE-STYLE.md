# Dufflebag code style

This file is the **project dialect** (prescriptive SSOT) for maintained code in this repository. Workspace philosophy is the Uncle Bob distillation shipped as `templates/mdFiles/CODE-STYLE.md`. When mechanism conflicts with philosophy (e.g. Schema vs interfaces), **this file wins**; philosophy still binds on intent (small functions, honest names, dependency direction, tests as courage).

The codebase is migrating to this contract; a rule describes the required destination even when a later refactor task still owns existing violations. `pnpm style` prints the outstanding count.

Generated provider projections and `dist/` are not authored source. The three named make-a-trailer files in `code-style.rules.json` are the only temporary maintained-source exception. Never broaden them to a directory or wildcard.

## How to read a rule

Every rule is one card with the same five slots in the same order. The shape is machine-checked by `scripts/checkStyleGuide.ts`, so a card that drifts fails `pnpm verify`:

| Slot | Content |
| --- | --- |
| `###` heading | Short human name |
| Metadata line | `[rule:<id>] · verify: <command or `judgment`>` |
| Assertion | **Exactly one sentence** — the whole rule, phrased so a diff either satisfies it or does not |
| `ts` block | A `// ✓` case and a `// ✗` case, so both sides are concrete |
| `Why:` | One line of rationale |

Two consequences worth knowing when you audit an agent's work:

- **The assertion is the verdict.** It is one sentence on purpose. If you need a second sentence, that is a second rule with its own ID.
- **Every ID appears exactly once here and exactly once in `code-style.rules.json`, and the assertion text must match that file's `statement` byte for byte.** So the JSON is always an accurate index of this document — audit from whichever is easier.

`verify:` names the command that actually proves the rule. `judgment` means no detector exists and a reviewer owns it; it is not a synonym for "unimportant".

## Rules

### Capability-owned paths
[rule:path.capability-layout] · verify: `pnpm style`

Behavior lives in the named capability directory that owns it.

```ts
// ✓ src/install/applyArtifactPlan.ts — the capability that owns applying plans
export const applyArtifactPlan = (request: ApplyArtifactPlanRequest) => Effect.gen(function* () {});

// ✗ src/core/services/planService.ts — technical layer, retired tree
export const planService = { apply: (request: ApplyArtifactPlanRequest) => Effect.void };
```

Why: a reader finds behavior by the capability it belongs to, not by guessing which technical tier it landed in.

### No generic bucket files
[rule:path.no-generic-bucket] · verify: `pnpm style`

Every authored file name states the domain job it performs.

```ts
// ✓ src/install/artifactReceipt.ts
export const writeArtifactReceipt = (request: WriteReceiptRequest) => Effect.void;

// ✗ src/install/utils.ts — also types.ts, helpers.ts, common.ts, misc.ts
export const doStuff = (input: unknown) => input;
```

Why: bucket files collect unrelated code forever, because nothing in the name says what does not belong.

### Authored path casing
[rule:path.source-directory-case] · verify: `pnpm style`

Authored source directories use camelCase.

```ts
// ✓ src/hookIsland/dedupGuard/hooks/dedupGuard.js — public ID stays hyphenated data
export const featureId = "dedup-guard";

// ✗ src/hookIsland/dedup-guard/... or src/skills/DedupGuard/...
```

Why: the public hyphenated ID is decoded catalog data; letting it dictate directory names makes the authored tree inconsistent with UI files, which are PascalCase.

### Payload and runtime live in different trees
[rule:path.payload-runtime-split] · verify: `pnpm style`

Executable feature runtime lives under `src/hookIsland/`, never under `src/skills/`.

```ts
// ✓ src/hookIsland/contextGuard/hooks/ctxWatch.ts — compiled, assembled, installed
// ✓ src/skills/pngToCode/scripts/src/bin/pixelDiff.ts — copied verbatim into the skill

// ✗ src/skills/contextGuard/hooks/ctxWatch.ts — runtime hiding in the payload tree
```

Why: the two trees ship by different mechanisms and answer to different rules, so mixing them is what let application rules be applied to standalone scripts and let an entry hook importing its own `lib/` look like an island breach.

### No wrapper layers
[rule:architecture.no-wrapper-layer] · verify: judgment

A repository-owned layer exists only when it owns policy the official service does not.

```ts
// ✓ src/install/stageArtifacts.ts — owns real policy: validate every replacement before the first write
const stageArtifacts = (request: StageRequest) =>
  Effect.gen(function* () {
    const file = yield* FileSystem.FileSystem;
    return yield* validateStagedBytes(yield* file.readFileString(request.source));
  });

// ✗ a pass-through that only renames methods
export const fileSystemManager = {
  read: (path: string) => FileSystem.FileSystem.pipe(Effect.flatMap((file) => file.readFileString(path))),
};
```

Why: a wrapper that owns no policy adds a name to learn, a file to open, and nothing else.

### Arrow constants
[rule:function.arrow-only] · verify: `pnpm style`

Named functions are arrow constants declared before first use.

```ts
// ✓ src/config/bagConfig.ts
const decodeConfig = (input: unknown) => Schema.decodeUnknown(bagConfigSchema)(input);

// ✗ hoisted declaration, plus function expressions and object methods
function decodeConfig(input: unknown) {
  return Schema.decodeUnknown(bagConfigSchema)(input);
}
```

Why: one declaration form, and declaration order that reads from primitives into orchestration without relying on hoisting.

### Effect generator exception
[rule:function.effect-generator] · verify: `pnpm style`

The only generator is an anonymous callback passed directly to `Effect.gen`.

```ts
// ✓ src/config/loadConfig.ts
export const loadConfig = Effect.gen(function* () {
  const file = yield* FileSystem.FileSystem;
  return yield* file.readFileString("config.json");
});

// ✗ named, or assigned and forwarded
const readConfig = function* () {};
export const loadConfig = Effect.gen(readConfig);
```

Why: `Effect.gen` is the one place a generator earns its keyword; anywhere else it is control flow the reader has to unwind by hand.

### Cohesive inputs
[rule:function.input-shape] · verify: `pnpm style`

A function takes one cohesive input, or two only as a natural pair.

```ts
// ✓ a natural pair, and a named request for anything wider
export const joinPath = (root: string, relative: string) => `${root}/${relative}`;
export const applyArtifactPlan = (request: ApplyArtifactPlanRequest) => Effect.void;

// ✗ three positionals, a rest parameter, or a positional boolean flag
export const write = (path: string, bytes: string, mode: string) => Effect.void;
export const render = (value: string, enabled: boolean) => (enabled ? value : "");
```

Why: a named request survives new fields without churning every call site, and a boolean at a call site tells the reader nothing about what it switches.

### One visible job
[rule:function.one-job] · verify: judgment

A function performs one job its name fully describes.

```ts
// ✓ the name covers the whole body
const writeArtifactReceipt = (request: WriteReceiptRequest) =>
  Effect.gen(function* () {
    const file = yield* FileSystem.FileSystem;
    yield* file.writeFileString(request.path, formatReceipt(request.artifacts));
  });

// ✗ policy + I/O + presentation + persistence under one name
const installFeature = (request: InstallRequest) =>
  Effect.gen(function* () {
    const resolved = resolveDependencies(request.features);
    yield* writeFiles(resolved);
    console.log(`installed ${resolved.length}`);
    yield* writeReceipt(resolved);
  });
```

Why: when the name stops covering the body, every future reader has to read the body to learn what the call does. Splitting straight-line code into pass-through one-liners is the opposite failure and is equally unwanted.

### Blank lines between functions
[rule:function.blank-line] · verify: `pnpm style`

Adjacent function declarations are separated by exactly one blank line.

```ts
// ✓
const decodeConfig = (input: unknown) => Schema.decodeUnknown(bagConfigSchema)(input);

const formatConfig = (config: BagConfig) => JSON.stringify(config, null, 2);

// ✗ no gap between declarations, or vertical noise inside a body
const decodeConfig = (input: unknown) => Schema.decodeUnknown(bagConfigSchema)(input);
const formatConfig = (config: BagConfig) => JSON.stringify(config, null, 2);
```

Why: the blank line is the boundary between units; spending it between every statement instead removes the only vertical cue the reader has.

### Maximum nesting
[rule:function.nesting] · verify: `pnpm style`

Control flow nests at most two levels deep.

```ts
// ✓ guard clause keeps the body flat
const itemAt = (items: ReadonlyArray<string>, index: number) => {
  if (index < 0 || index >= items.length) {
    return Option.none();
  }

  // The guard above proves this index is in bounds.
  return Option.some(items[index]!);
};

// ✗ third level
const scan = (features: ReadonlyArray<Feature>) => {
  for (const feature of features) {
    if (feature.enabled) {
      if (feature.runtime) {
        stage(feature);
      }
    }
  }
};
```

Why: past two levels the reader has to hold the accumulated conditions in their head to know when a line runs.

### Tagged errors are the only classes
[rule:class.tagged-error-only] · verify: `pnpm style`

The only authored class directly extends `Schema.TaggedError`.

```ts
// ✓ src/install/installError.ts
export class InstallError extends Schema.TaggedError<InstallError>()("InstallError", {
  path: Schema.String,
}) {}

// ✗ a plain class, or any other base
export class InstallManager {
  apply(request: InstallRequest) {}
}
```

Why: failures need a tag the Effect layer can match on; everything else is better served by data, schemas, and arrow functions.

### Loop intent
[rule:comment.loop-intent] · verify: `pnpm style`

Every explicit loop carries an intent comment on the line directly above it.

```ts
// ✓ no blank line between comment and loop
// Preserve catalog order in the generated output.
for (const feature of featureCatalog) {
  sections.push(renderFeature(feature));
}

// ✗ no comment — and prefer an operator when it states the transformation better
for (const feature of featureCatalog) {
  sections.push(renderFeature(feature));
}
```

Why: an explicit loop is a choice over a collection operator, so it should say what the operator could not express.

### Indexed-access proof
[rule:comment.index-proof] · verify: `pnpm style`

Every indexed non-null access carries a bounds proof comment directly above it.

```ts
// ✓ the proof names the guard that makes the access safe
if (index < 0 || index >= items.length) {
  return Option.none();
}

// The guard above proves this index is in bounds.
return Option.some(items[index]!);

// ✗ unproven, and the proof never licenses unrelated assertions
return Option.some(items[index]!);
```

Why: `!` on an index is a claim about runtime state that the type system cannot see, so the claim has to be written down where it is made.

### Ordered pipeline contracts
[rule:comment.pipeline-contract] · verify: judgment

A multi-phase pipeline states its contract above the orchestration and numbers each phase inside it.

```ts
// ✓ src/install/applyArtifactPlan.ts
// Apply one validated artifact plan atomically: stage first, write the receipt last, roll back in reverse order.
export const applyArtifactPlan = (request: ApplyArtifactPlanRequest) =>
  Effect.gen(function* () {
    // 1. Inspect current destinations without changing disk state.
    const inspection = yield* inspectArtifactDestinations(request);

    // 2. Stage and validate every replacement before the first destination write.
    const staged = yield* stageArtifacts({ request, inspection });

    // 3. Persist the ownership receipt only after every destination is durable.
    return yield* writeArtifactReceipt(staged);
  });

// ✗ decorative numbering on an ordinary function
const formatTitle = (feature: FeatureDefinition) => {
  // 1. Read the title.
  const title = feature.title;
  // 2. Return it.
  return title;
};
```

Why: the numbers exist to record order and failure ownership; on a function with neither, they are noise that future edits will silently invalidate.

### Schema owns runtime objects
[rule:type.schema-owned-runtime] · verify: `pnpm style`

Data crossing a runtime, persistence, CLI, environment, catalog, or agent-format boundary is defined as Effect Schema first, with its TypeScript type derived.

```ts
// ✓ src/catalog/featureCatalog.ts — checks, messages, and descriptions live on the property
export const featureDefinitionSchema = Schema.Struct({
  id: Schema.NonEmptyTrimmedString.pipe(
    Schema.pattern(FEATURE_ID_PATTERN, { message: () => "Feature IDs use lowercase kebab-case." }),
    Schema.annotations({ description: "Stable public feature ID." }),
  ),
  selectedByDefault: Schema.Boolean.annotations({ description: "Whether a fresh install preselects it." }),
});

export type FeatureDefinition = Schema.Schema.Type<typeof featureDefinitionSchema>;

// ✗ a handwritten type beside a validator, with parallel default and description maps
export type FeatureDefinition = { id: string; selectedByDefault: boolean };
const FEATURE_DEFAULTS = { selectedByDefault: false };
```

Why: one executable definition cannot drift from itself, and every derived concern — decoding, defaults, messages, docs — stays attached to the property it governs. The dependency-free hook island is the narrow exception, because Effect does not ship there.

### No hand-rolled parse helpers
[rule:type.no-handrolled-parser] · verify: judgment

Schema owns validation, and no exported type-guard or parse helper duplicates it.

```ts
// ✓ application: Schema owns the mode. Hook island: a private switch inside the only reader.
export const dedupModeSchema = Schema.Literal("deny", "warn", "off");

const dedupModeFromEnv = (raw: string | undefined): DedupMode => {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "warn":
      return "warn";
    default:
      return "deny";
  }
};

// ✗ a parallel validation surface next to Schema
export const isDedupMode = (value: string): value is DedupMode => DEDUP_MODES.some((mode) => mode === value);
export const parseDedupMode = (raw?: string): DedupMode => (isDedupMode(raw ?? "") ? "warn" : "deny");
```

Why: two validators for one value eventually disagree, and the exported pair invites the rest of the package to reimplement the check a third time.

### No interfaces
[rule:type.no-interface] · verify: `pnpm style`

Interfaces appear only in declaration-file augmentation.

```ts
// ✓ src/types/environment.d.ts
declare global {
  interface ProcessEnv {
    DUFFLEBAG_HOME?: string;
  }
}

// ✗ an authored interface in source
export interface BagConfig {
  debug: boolean;
}
```

Why: augmentation is the one job only an interface can do; for everything else a schema-derived type keeps validation and shape together.

### No enums
[rule:type.no-enum] · verify: `pnpm style`

Unions derived from schema literals replace enums.

```ts
// ✓
export const scopeSchema = Schema.Literal("global", "project");
export type Scope = Schema.Schema.Type<typeof scopeSchema>;

// ✗
export enum Scope {
  Global,
  Project,
}
```

Why: an enum invents a runtime value that no boundary can decode, while a schema literal both decodes input and produces the type.

### No conditional or infer machinery
[rule:type.no-conditional] · verify: `pnpm style`

Types are derived from schemas, never computed with conditional or `infer` machinery.

```ts
// ✓
export type FeatureDefinition = Schema.Schema.Type<typeof featureDefinitionSchema>;

// ✗ recovering a type from an object descriptor
export type ElementOf<Value> = Value extends ReadonlyArray<infer Item> ? Item : Value;
```

Why: when the schema is the source of truth there is nothing to recover, so the machinery is solving a problem the design should not have.

### No assertions
[rule:type.no-assertion] · verify: `pnpm style`

Unknown input is decoded or narrowed, never asserted.

```ts
// ✓
const config = yield * Schema.decodeUnknown(bagConfigSchema)(input);

// ✗ as, angle-bracket, as const, and general non-null
const config = input as BagConfig;
const required = value!;
```

Why: an assertion tells the compiler to stop checking exactly where untrusted data enters. The documented indexed-access proof is the sole non-null exception.

### No suppression directives
[rule:type.no-suppression] · verify: `pnpm style`

No suppression directive silences a type, lint, format, or coverage error.

```ts
// ✓ fix the boundary
const config = yield * Schema.decodeUnknown(bagConfigSchema)(input);

// ✗ @ts-ignore, @ts-expect-error, @ts-nocheck, biome-ignore, eslint-disable, c8 ignore
// @ts-expect-error the shape is close enough
const config: BagConfig = input;
```

Why: a suppression turns a caught error into an invisible one, and the boundary it hides is usually the thing worth changing.

### Wildcard-only barrels
[rule:barrel.direct-wildcard] · verify: `pnpm style`

Every statement in a barrel is a direct wildcard export.

```ts
// ✓ src/install/index.ts
export * from "./artifactPlan.js";
export * from "./artifactReceipt.js";

// ✗ selective exports, aliases, logic, or a chain through another barrel
export { applyArtifactPlan as apply } from "./artifactPlan.js";
export * from "./index.js";
```

Why: a flat wildcard manifest has one meaning and no ordering hazards; anything else makes the barrel a module with behavior of its own.

### Domain-specific names
[rule:name.domain-specific] · verify: `pnpm style`

Every identifier names its domain job or value.

```ts
// ✓
const artifactReceipt = yield * writeArtifactReceipt(request);
const featureCatalog = yield * decodeFeatureCatalog(input);

// ✗ vague roles and suffixes: Manager, Helper, Utils, Data, Info, Common, Misc
const dataManager = new InstallManager();
const info = getData();
```

Why: a vague name defers the reader to the body, and a role suffix attracts unrelated code because nothing contradicts it.

### Never mutate inputs
[rule:mutation.no-input] · verify: `pnpm style`

A function never mutates a value it received.

```ts
// ✓ return a new value, or mutate only what the function created
const withFeature = (features: ReadonlyArray<Feature>, feature: Feature) => [...features, feature];

// ✗
const addFeature = (features: Array<Feature>, feature: Feature) => {
  features.push(feature);
};
```

Why: every input is borrowed, and the caller has no way to see that a callee rewrote it.

### No builder reduce
[rule:collection.no-builder-reduce] · verify: `pnpm style`

Collections are built with `map`, `filter`, `flatMap`, or `Object.fromEntries`, never `reduce`.

```ts
// ✓ scalar reductions such as totals stay fine
const byId = Object.fromEntries(features.map((feature) => [feature.id, feature]));
const totalBytes = artifacts.reduce((total, artifact) => total + artifact.size, 0);

// ✗ building a collection
const byId = features.reduce((accumulator, feature) => ({ ...accumulator, [feature.id]: feature }), {});
```

Why: a builder `reduce` hides a simple shape change behind an accumulator the reader has to simulate.

### No Promise.all in the application
[rule:effect.no-promise-all] · verify: `pnpm style`

Application code composes concurrency with Effect operators, never `Promise.all`.

```ts
// ✓ sequential by default; bounded concurrency is opted into explicitly
const staged = yield * Effect.forEach(artifacts, stageArtifact);
const fetched = yield * Effect.forEach(sources, readSource, { concurrency: 4 });

// ✗
const staged = yield * Effect.promise(() => Promise.all(artifacts.map(stageArtifact)));
```

Why: `Promise.all` leaves the Effect world, so interruption, typed failures, and the concurrency bound all stop applying.

### One runtime edge
[rule:effect.runtime-edge] · verify: `pnpm style`

Only `src/cli/main.ts` starts the Effect runtime.

```ts
// ✓ src/cli/main.ts
Effect.runPromise(cli(process.argv));

// ✗ a capability starting its own nested runtime
export const install = (request: InstallRequest) => Effect.runSync(applyArtifactPlan(request));
```

Why: capabilities that return Effect values stay composable and testable; a nested runtime severs them from the caller's context and interruption.

### Official services directly
[rule:effect.official-services] · verify: judgment

Capabilities call official Effect platform services directly.

```ts
// ✓
const contents = yield * (yield * FileSystem.FileSystem).readFileString(path);

// ✗ a repository service that only forwards
const fileReader = { read: (path: string) => readFileString(path) };
```

Why: the official service is already the abstraction; a second one owns no policy and only hides which library is really in use. Add a repository-owned service when it owns real policy or a stable external boundary.

### Dependency-free hook island
[rule:import.hook-runtime] · verify: `pnpm style`

An installed hook imports only `node:*` builtins, shared `src/runtime/**`, and its own feature runtime.

```ts
// ✓ src/hookIsland/dedupGuard/hooks/dedupGuard.js
import { readFileSync } from "node:fs";
import { readTransport } from "../../../runtime/transport.js";
import { buildIndex } from "../lib/dupIndex.js";

// ✗ Effect, third-party packages, CLI, catalog, or install code
import { Effect } from "effect";
```

Why: installed hooks run inside the user's agent with no install step of ours, so any import beyond this set is a runtime failure on their machine. Hooks also fail open. Co-located tests never ship, and a type-only import of a bare package is erased before emit, so neither can break the island.

### Application enters the island only at a command surface
[rule:import.application-boundary] · verify: `pnpm style`

Application code reaches the hook island only through a feature `command/` module.

```ts
// ✓ shared transport parsing lives under src/runtime and is imported by both sides
import { parseTransportLine } from "../runtime/transport.js";
// ✓ a CLI command wrapping the island's own runnable surface
import { dedupCheck } from "../hookIsland/dedupGuard/command/dedupCheck.js";

// ✗ reaching into an installed hook or its feature library from a capability
import { readDedupState } from "../hookIsland/dedupGuard/hooks/dedupGuard.js";
```

Why: hooks and their libraries are shipped code the user's agent owns at runtime, so importing them back couples our orchestration to them; a `command/` module is the one surface built to be called from both sides, which is why it stays dependency-free.

### TerminalUI owns application output
[rule:presentation.terminal-ui] · verify: `pnpm style`

Application code returns structured results and leaves terminal output to `TerminalUI`.

```ts
// ✓ the capability returns data; src/cli/TerminalUI.ts renders it
export const install = (request: InstallRequest) => Effect.succeed({ installed: request.features });

// ✗ a capability printing directly
export const install = (request: InstallRequest) => Effect.sync(() => console.log("installed"));
```

Why: one presentation owner is what makes non-TTY behavior, quiet modes, and structured errors possible at all. Root tooling and hook diagnostics may write to their own process streams.

## Canonical example

Every rule above, composed on one real slice — a capability that decodes input, applies an ordered pipeline, and returns data for `TerminalUI` to render.

```ts
// src/install/applyArtifactPlan.ts
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";

export const applyArtifactPlanRequestSchema = Schema.Struct({
  scope: Schema.Literal("global", "project"),
  artifacts: Schema.Array(artifactSchema).annotations({ description: "Planned destinations, in apply order." }),
});

export type ApplyArtifactPlanRequest = Schema.Schema.Type<typeof applyArtifactPlanRequestSchema>;

export class ApplyArtifactPlanError extends Schema.TaggedError<ApplyArtifactPlanError>()("ApplyArtifactPlanError", {
  path: Schema.String,
}) {}

const stageArtifact = (artifact: Artifact) =>
  Effect.gen(function* () {
    const file = yield* FileSystem.FileSystem;
    const bytes = yield* file.readFileString(artifact.source);
    return { artifact, bytes };
  });

// Apply one validated plan atomically: stage first, write the receipt last, roll back in reverse order.
export const applyArtifactPlan = (request: ApplyArtifactPlanRequest) =>
  Effect.gen(function* () {
    // 1. Inspect current destinations without changing disk state.
    const inspection = yield* inspectArtifactDestinations(request);

    // 2. Stage and validate every replacement before the first destination write.
    const staged = yield* Effect.forEach(request.artifacts, stageArtifact);

    // 3. Commit destination changes in plan order.
    const committed = yield* Effect.forEach(staged, commitArtifact);

    // 4. Persist the ownership receipt only after every destination is durable.
    yield* writeArtifactReceipt({ scope: request.scope, artifacts: committed });

    return { installed: committed.map((entry) => entry.artifact.id), inspection };
  });
```

One cohesive request decoded by Schema, an arrow constant per job, a tagged error, a numbered pipeline with a contract line, Effect operators instead of `Promise.all`, no runtime start, and data returned rather than printed.

## Golden path — adding a feature

A **feature** is dufflebag's unit of extension: a catalog entry plus the artifacts it installs.

1. Add the authored content under `src/skills/<sourceDirectory>/` in camelCase (`SKILL.md`, plus `hooks/` and `runtime/` when it ships a hook).
2. Register it in `src/catalog/featureCatalog.ts` with a hyphenated public `id`, its `sourceDirectory`, and the exact `shippedPaths`. The catalog is closed: an artifact that is not listed does not ship.
3. Keep any hook dependency-free and fail-open — `node:*`, `src/runtime/**`, and its own feature runtime only.
4. If it adds managed configuration, extend the schema in `src/config/` with the description, default, and checks inline on the property.
5. Co-locate tests as `*.test.ts` beside the code, and cover install, update, and uninstall for a feature that writes artifacts.
6. Run `pnpm verify`, then `pnpm style` to confirm you added no new contract violations.

**Definition of done**

- [ ] Shaped like the `## Canonical example`.
- [ ] Registered in `featureCatalog.ts` with exact `shippedPaths`.
- [ ] Receipt written last; nothing deletes without receipt authority.
- [ ] Any hook imports only the dependency-free set and fails open.
- [ ] Tests co-located and green; `pnpm verify` passes.
- [ ] No `## Never` entry introduced.

## Recipes

### Adding a CLI command

1. Define the request schema and the command in `src/cli/`, returning an Effect.
2. Render results through `src/cli/TerminalUI.ts`; never `console.*` from the capability.
3. Keep `Effect.run*` in `src/cli/main.ts` only.
4. Make non-TTY invocation fail with a structured usage error instead of prompting.

### Adding a rule to this document

1. Add the card here with all five slots and a one-sentence assertion.
2. Add the same `id` to `code-style.rules.json` with a `statement` byte-identical to the assertion.
3. Point `verify` at a real command, or `judgment` if no detector exists.
4. Implement the detector in `scripts/checkCodeStyle.ts` when the shape is mechanically checkable.
5. Run `pnpm verify` — `scripts/checkStyleGuide.ts` fails the build if a slot is missing or the texts diverge.

## Exemplars

Write new code like these files:

- `src/catalog/featureCatalog.ts` — Schema-owned catalog data with checks, messages, and descriptions inline.
- `src/install/applyArtifactPlan.ts` — an ordered pipeline with a contract comment and receipt-last ownership.
- `src/cli/TerminalUI.ts` — the single presentation owner.
- `src/runtime/` — dependency-free transport shared by installed hooks.

## Never

The slop fingerprint for this repository. Each entry is a concrete shape, not an abstract warning:

- `src/core/`, `src/commands/`, `src/payload/` — retired technical layers · [rule:path.capability-layout]
- `types.ts`, `helpers.ts`, `utils.ts`, `common.ts`, `misc.ts` — buckets nothing is excluded from · [rule:path.no-generic-bucket]
- `Manager` / `Helper` / `Utils` wrappers that forward to an official service · [rule:architecture.no-wrapper-layer]
- `isX` + `parseX` pairs beside a schema that already decodes the value · [rule:type.no-handrolled-parser]
- A handwritten object type next to a validator, with parallel `DEFAULTS` / `ENV_KEYS` maps · [rule:type.schema-owned-runtime]
- `as`, `as const`, or `!` used to get past a boundary instead of decoding it · [rule:type.no-assertion]
- `@ts-expect-error` or `biome-ignore` left on a line that a design change would fix · [rule:type.no-suppression]
- `console.log` inside a capability · [rule:presentation.terminal-ui]
- `Promise.all` in application code · [rule:effect.no-promise-all]
- `reduce` used to build an array or object · [rule:collection.no-builder-reduce]
- Decorative numbered comments on a function with no ordering constraint · [rule:comment.pipeline-contract]
- `import { Effect }` anywhere in an installed hook graph · [rule:import.hook-runtime]

## Formatting and verification

Biome owns 2-space indentation, double quotes, semicolons, trailing commas, 120-column width, and organized imports across maintained TS, TSX, JS, MJS, JSON, and JSONC.

| Command | Covers |
| --- | --- |
| `pnpm verify` | `biome ci` → typecheck → tests → build. Includes the `checkStyleGuide` conformance test for this document. |
| `pnpm style` | The contract checker over the maintained tree: the AST, path, and import-graph rules above. |

The complete target verification order is:

```text
Biome → typecheck → code-style contract → tests → build → shipping verification → hook smoke
```

`pnpm style` is reported but not yet gating: the maintained tree still carries violations from before this contract, and a migration task owns them. The document's own format is gating today. Broad legacy allowlists are forbidden — the only exceptions are the three exact paths in `code-style.rules.json`.
