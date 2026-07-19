# Dufflebag code style

This file is the **project dialect** (prescriptive SSOT) for maintained code in this repository. Workspace philosophy is the Uncle Bob distillation at `~/Desktop/Code/code-style.md` (same body ships as `templates/mdFiles/CODE-STYLE.md`). When mechanism conflicts with philosophy (e.g. Schema vs interfaces), **this file wins**; philosophy still binds on intent (small functions, honest names, dependency direction, tests as courage).

The codebase is migrating to this contract; a rule describes the required destination even when a later refactor task still owns existing violations.

`code-style.rules.json` mirrors every rule ID and records how each rule is checked. Biome owns formatting and general linting. `scripts/checkCodeStyle.ts` owns only the AST, import-graph, path, and comment rules that Biome cannot express.

Generated provider projections and `dist/` are not authored source. The three named make-a-trailer files in the machine contract are the only temporary maintained-source exception. Never broaden them to a directory or wildcard.

## Architecture

Keep one npm package. Organize application code by the capability that owns the behavior:

```text
src/
├── cli/
├── catalog/
├── config/
├── install/
├── runtime/
├── skills/
├── doctor.ts
└── scaffoldWorkflows.ts
```

`src/core`, `src/commands`, `src/payload`, technical-layer buckets, and mirrored wrapper hierarchies are not part of the target structure. Maintainer tooling lives under root `scripts/` (outer ring); application code never imports it.

### Capability-owned paths [rule:path.capability-layout]

Put behavior in the named capability that owns it. Do not create generic technical layers or a second abstraction tree around direct library APIs.

### No generic bucket files [rule:path.no-generic-bucket]

Name a file after its domain job. `types.ts`, `helpers.ts`, `utils.ts`, `common.ts`, and `misc.ts` are forbidden buckets.

### Authored path casing [rule:path.source-directory-case]

Authored source directories use `camelCase`. UI component files use `PascalCase`. Public feature IDs, installed IDs, and CLI flags remain hyphenated data; they do not dictate authored path casing.

### No wrapper layers [rule:architecture.no-wrapper-layer]

Call official Effect, platform, and filesystem services directly from the capability that owns the operation. Do not add `Manager`, `Helper`, `Utils`, pass-through service, `Context.Tag`, or `Layer` wrappers that do not own policy.

## Functions

### Arrow constants [rule:function.arrow-only]

Named functions are arrow constants declared before use.

```ts
const decodeConfig = (input: unknown) => Schema.decodeUnknown(bagConfigSchema)(input);
```

Do not write named function declarations. Declaration order should make the file read from primitives into orchestration without relying on hoisting.

### Effect generator exception [rule:function.effect-generator]

The only permitted generator function is an anonymous generator passed directly to `Effect.gen`.

```ts
export const loadConfig = Effect.gen(function* () {
  const file = yield* FileSystem.FileSystem;
  return yield* file.readFileString("config.json");
});
```

Do not name, assign, forward, or wrap that generator callback.

### Cohesive inputs [rule:function.input-shape]

Prefer one cohesive input. Two positional inputs are acceptable only when they are a natural pair. Three or more inputs require one named request object. Do not create a ceremonial request object for a single primitive, and do not pass behavior as a positional boolean flag.

### One visible job [rule:function.one-job]

A function should perform one job that can be understood from its name and body. Extract a second domain operation when a body mixes policy, I/O, presentation, and persistence. Do not split readable straight-line code into pass-through one-line wrappers.

### Blank lines between functions [rule:function.blank-line]

Leave one blank line between adjacent function declarations. Keep related statements together inside a function; do not add vertical noise between every line.

### Maximum nesting [rule:function.nesting]

Control flow may nest at most two levels. Use a guard clause or extract one cohesive operation before introducing a third level.

### Tagged errors are the only classes [rule:class.tagged-error-only]

Do not author classes except errors that directly extend `Schema.TaggedError`. Prefer data, schemas, arrow functions, and official Effect services.

## Comments

Comments explain intent, proof, ownership, or ordering that syntax cannot make obvious. Do not narrate routine assignments.

### Loop intent [rule:comment.loop-intent]

Every explicit `for`, `for...of`, `for...in`, `while`, or `do...while` loop has one short intent comment immediately above it, with no blank line.

```ts
// Preserve catalog order in the generated output.
for (const feature of featureCatalog) {
  sections.push(renderFeature(feature));
}
```

Prefer direct collection operators when they state the transformation more clearly.

### Indexed-access proof [rule:comment.index-proof]

An indexed non-null access is permitted only when a short proof comment sits immediately above the statement.

```ts
const itemAt = (items: ReadonlyArray<string>, index: number) => {
  if (index < 0 || index >= items.length) {
    return Option.none();
  }

  // The guard above proves this index is in bounds.
  return Option.some(items[index]!);
};
```

The comment does not excuse unrelated non-null assertions.

### Ordered pipeline contracts [rule:comment.pipeline-contract]

A real multi-phase pipeline has one contract comment above the orchestration and short numbered phase comments inside it. The numbers explain order and failure ownership; they are not decorative headings on ordinary functions.

```ts
// Apply one validated artifact plan atomically: stage first, write the receipt last, and roll back in reverse order.
export const applyArtifactPlan = (request: ApplyArtifactPlanRequest) =>
  Effect.gen(function* () {
    // 1. Inspect current destinations without changing disk state.
    const inspection = yield* inspectArtifactDestinations(request);

    // 2. Stage and validate every replacement before the first destination write.
    const stagedArtifacts = yield* stageArtifacts({ request, inspection });

    // 3. Commit destination changes in plan order.
    const committedArtifacts = yield* commitArtifacts(stagedArtifacts);

    // 4. Persist the ownership receipt only after every destination is durable.
    return yield* writeArtifactReceipt(committedArtifacts);
  });
```

## Schemas and types

### No hand-rolled parse helpers [rule:type.no-handrolled-parser]

Do not export type-guard/`parseX` pairs for schema-owned literals, numbers, or booleans (`isDedupMode` + `parseDedupMode`, `parseNumber`, and the like).

- **Application code** decodes with Effect Schema (`bagConfigSchema`, legacy environment maps, CLI request schemas). Failures surface as parse errors, not ad-hoc guards.
- **Dependency-free hook island** may keep private switch/default readers inside a single `readConfig` (or equivalent transport reader). Do not export those helpers for the rest of the package to reimplement validation.

```ts
// BAD — parallel validation surface next to Schema
export const isDedupMode = (value: string): value is DedupMode =>
  DEDUP_MODES.some((mode) => mode === value);
export const parseDedupMode = (raw?: string): DedupMode =>
  isDedupMode((raw ?? "").trim().toLowerCase()) ? /* … */ : "deny";

// GOOD — application: Schema owns the mode
export const dedupModeSchema = Schema.Literal("deny", "warn", "off");

// GOOD — hook island: private switch inside the only reader
const dedupModeFromEnv = (raw: string | undefined): DedupMode => {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "warn":
      return "warn";
    case "off":
      return "off";
    default:
      return "deny";
  }
};
```

### Schema owns runtime objects [rule:type.schema-owned-runtime]

When data crosses a runtime, persistence, CLI, environment, catalog, or agent-format boundary, define executable Effect Schema first and derive TypeScript types from it. Do not maintain a handwritten object type beside a validator.

Descriptions, defaults, checks, error messages, and legacy transformations live inline on the property they govern. Do not recreate parallel `DEFAULTS`, `BOUNDS`, `ENV_KEYS`, descriptor, or description maps.

`FeatureDefinition` follows this pattern:

```ts
// e.g. "context-guard" — not "ContextGuard"
const FEATURE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// e.g. "contextGuard" — not "context-guard"
const SOURCE_DIRECTORY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

export const featureDefinitionSchema = Schema.Struct({
  id: Schema.NonEmptyTrimmedString.pipe(
    Schema.pattern(FEATURE_ID_PATTERN, {
      message: () => "Feature IDs use lowercase kebab-case.",
    }),
    Schema.annotations({
      description: "Stable public feature ID.",
    }),
  ),
  sourceDirectory: Schema.NonEmptyTrimmedString.pipe(
    Schema.pattern(SOURCE_DIRECTORY_PATTERN, {
      message: () => "Source directories use camelCase.",
    }),
    Schema.annotations({
      description: "Authored directory under src/skills.",
    }),
  ),
  installedSkill: installedSkillDefinitionSchema.annotations({
    description: "Installed output, separate from feature identity.",
  }),
  title: Schema.NonEmptyTrimmedString.annotations({
    description: "Short CLI label.",
  }),
  summary: Schema.NonEmptyTrimmedString.annotations({
    description: "One-line user-facing description.",
  }),
  selectedByDefault: Schema.Boolean.annotations({
    description: "Whether a fresh install preselects the feature.",
  }),
  dependencies: Schema.Array(
    Schema.NonEmptyTrimmedString.pipe(
      Schema.pattern(FEATURE_ID_PATTERN, {
        message: () => "Dependency IDs use lowercase kebab-case.",
      }),
    ),
  ).annotations({
    description: "Features resolved before this feature.",
  }),
  platform: featurePlatformSchema.annotations({
    description: "Host requirement surfaced by install and doctor.",
  }),
  runtime: featureRuntimeSchema.annotations({
    description: "Optional dependency-free hook runtime.",
  }),
});

export type FeatureDefinition = Schema.Schema.Type<typeof featureDefinitionSchema>;
```

The dependency-free installed hook transport is the narrow exception: it may use small local structural types because Effect does not ship in that runtime island.

### No interfaces [rule:type.no-interface]

Do not author interfaces. Declaration-file augmentation is the only exception.

### No enums [rule:type.no-enum]

Use schema literals and their derived union instead of enums.

### No conditional or infer machinery [rule:type.no-conditional]

Do not author conditional types or `infer` chains to recover types from object descriptors. Make the schema the source of truth and derive its type directly.

### No assertions [rule:type.no-assertion]

Do not use `as`, angle-bracket assertions, `as const`, or general non-null assertions. Decode unknown input, narrow it, or improve the schema. The documented indexed-access proof is the sole non-null exception.

### No suppression directives [rule:type.no-suppression]

Do not use `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, formatter ignores, linter ignores, or coverage ignores. Fix the boundary or change the design.

## Exports and names

### Wildcard-only barrels [rule:barrel.direct-wildcard]

Barrels are optional flat manifests. When an `index.ts` exists, every statement is a direct wildcard export:

```ts
export * from "./artifactPlan.js";
export * from "./artifactReceipt.js";
```

Selective exports, aliases, logic, and chains through another barrel are forbidden.

### Domain-specific names [rule:name.domain-specific]

Names state the domain job or value. Avoid vague standalone roles and suffixes such as `Manager`, `Helper`, `Utils`, `Data`, `Info`, `Common`, and `Misc`. Prefer names such as `artifactReceipt`, `featureCatalog`, `decodeBagConfig`, and `applyArtifactPlan`.

Use `camelCase` for values, functions, variables, and authored non-UI files. Use `PascalCase` only for UI components and schema tagged-error classes. Keep public hyphenated IDs as decoded data.

## Values and collections

### Never mutate inputs [rule:mutation.no-input]

Treat every function input as borrowed. Return a new value or mutate a collection created and owned inside the function.

### No builder reduce [rule:collection.no-builder-reduce]

Do not use `reduce` to build arrays or objects. Use `map`, `filter`, `flatMap`, `Object.fromEntries`, or one clearly commented loop. Scalar reductions such as totals are acceptable.

### No Promise.all in the application [rule:effect.no-promise-all]

Use Effect collection operators. Default to sequential execution; opt into bounded concurrency only when the operation is independent and the bound is explicit.

## Effect boundaries

### One runtime edge [rule:effect.runtime-edge]

Only `src/cli/main.ts` may call `Effect.run*`. Capabilities return Effect values and compose without starting nested runtimes.

### Official services directly [rule:effect.official-services]

Use official Effect platform services directly. Add a repository-owned service only when it owns real policy or a stable external boundary; do not wrap a service merely to rename its methods.

### Dependency-free hook island [rule:import.hook-runtime]

Installed hook entrypoints and their transitive graph import only `node:*`, shared `src/runtime/**`, and their own feature runtime subtree. They do not import Effect, third-party packages, CLI code, catalog code, or install code.

### Application cannot import hook code [rule:import.application-boundary]

Application capabilities do not import installed hook-runtime modules. Shared transport parsing belongs under `src/runtime/**`; application orchestration belongs outside the hook island.

## Presentation

### TerminalUI owns application output [rule:presentation.terminal-ui]

Application code does not call `console.*`. `src/cli/TerminalUI.ts` owns terminal presentation, and command capabilities return structured success or tagged errors. Root tooling and dependency-free hook diagnostics may write directly to their process streams.

Non-TTY execution never prompts. Missing required input fails with a structured usage error.

## Formatting and verification

Biome owns 2-space indentation, double quotes, semicolons, trailing commas, 120-column width, and organized imports across maintained TS, TSX, JS, MJS, JSON, and JSONC.

The complete target verification order is:

```text
Biome → typecheck → code-style contract → tests → build → shipping verification → hook smoke
```

The contract checker remains dormant in `pnpm verify` until the migration task makes the maintained tree compliant. Fixture tests are active immediately; broad legacy allowlists are forbidden.
