# Dufflebag code style

This is the prescriptive human source of truth for maintained code in this repository. The codebase is migrating to this destination through the approved refactor plan. Existing debt does not weaken a rule and must not be hidden behind a broad allowlist.

`code-style.rules.json` mirrors every rule ID in the same order. Biome owns ordinary formatting and linting. `src/style/checkCodeStyle.ts` owns only focused AST, regex, path, and import-graph checks that those tools cannot express. Manual rules remain in the machine catalog and are reported honestly for review.

Generated provider projections and `dist/` are not authored source. The three exact make-a-trailer files named in the machine contract are protected by immutable committed and overlay hashes; no directory, wildcard, CI flag, or dirty-tree heuristic can replace those hashes.

## Architecture and paths

The target is one capability-first package:

```text
src/
├── build/
├── cli/
├── catalog/
├── config/
├── install/
├── runtime/
├── skills/<sourceDirectory>/
├── style/
├── doctor.ts
└── scaffoldWorkflows.ts
```

### Capability-owned layout [rule:path.capability-layout]

Put behavior beside the domain capability that owns its policy. `src/core`, `src/commands`, `src/payload`, generic repositories/DAOs, technical-layer trees, and mirrored wrapper hierarchies are not destinations. A genuinely tiny repository may remain flat.

### Domain files, not buckets [rule:path.no-generic-bucket]

Name modules for their job. `types.ts`, `helpers.ts`, `utils.ts`, `common.ts`, and `misc.ts` are forbidden buckets.

### Authored filenames [rule:path.authored-file-name]

Use `camelCase` for authored directories and non-component source, and `PascalCase` for UI components. Standard `.test`, `.config`, and declaration suffixes are metadata, not a second role. Do not use dotted role names or repeat roles: use `orderStore.ts`, not `order.repository.ts` or `orderRepositoryRepository.ts`. Public IDs and CLI flags remain decoded kebab-case data.

### No pass-through wrappers [rule:architecture.no-wrapper-layer]

Call official Effect, platform, and filesystem services from the owning capability. A local service or adapter must own policy, translation, lifecycle, or a real external boundary—not merely rename another API. Do not create speculative manager/helper/repository layers.

### Acyclic dependencies [rule:architecture.no-cycle]

Internal relative imports form an acyclic graph. If two capabilities depend on one another, move the shared contract to the owner both can point toward; do not conceal the cycle behind a barrel.

### Const unless reassigned [rule:binding.const-default]

Declare bindings with `const` unless the binding itself must be reassigned. Locally owned arrays, maps, and sets may still mutate under the ownership rule; mutation does not require rebinding them with `let`.

## Functions and bodies

### Arrow constants [rule:function.arrow-only]

Every named function is an arrow constant declared before use.

```ts
const decodeConfig = (input: unknown) => Schema.decodeUnknown(bagConfigSchema)(input);
```

### Effect generator exception [rule:function.effect-generator]

The only generator function is an anonymous generator passed directly to `Effect.gen`.

```ts
export const loadConfig = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString("config.json");
});
```

Do not name, assign, forward, or wrap the generator callback.

### Cohesive inputs [rule:function.input-shape]

Prefer one cohesive input. Two positional values are allowed only as a natural pair. Three or more values use a small named request object. Rest parameters are allowed when they express a real variadic operation. Positional boolean behavior flags are forbidden; schema-decoded external boolean state belongs inside a named request. Do not create a ceremonial object for one primitive.

### One visible job [rule:function.one-job]

A function owns one concept, policy, boundary, or operation. Use guard clauses and keep I/O, policy, persistence, and presentation with their real owners. There is no arbitrary function line limit.

### No pointless extraction [rule:function.no-pointless-extraction]

Do not extract a private one-use expression into a pass-through helper that adds no policy or meaning. Inline it until the name owns a concept, boundary, non-trivial invariant, or a second real caller.

### Function spacing [rule:function.blank-line]

Keep one blank line between adjacent declarations. Do not add blank lines between every statement in a body.

### Maximum nesting [rule:function.nesting]

Control flow nests at most two levels. Prefer a guard clause or extract one cohesive operation before a third level.

### Tagged errors are the class exception [rule:class.tagged-error-only]

Do not author classes except expected branch-worthy errors that directly extend `Schema.TaggedError`. Prefer schemas, values, arrow functions, and official services.

### Preserve causes and translate once [rule:error.public-boundary]

Preserve the original defect cause throughout internal failure handling. Translate or redact it once at the public CLI, HTTP, or provider boundary so callers receive a stable, non-sensitive error while logs and diagnostics retain the causal chain. Test the translation boundary; do not catch merely to discard `cause`, expose a provider payload, or print a raw stack.

## Comments and documentation

Comments explain intent, invariant, proof, ownership, ordering, security, or a measured tradeoff. They never narrate syntax.

### Comment only non-obvious loops [rule:comment.loop-intent]

A simple loop whose body states its work needs no ceremony. A non-obvious explicit loop receives one short comment immediately above it explaining ordering, batching, local mutation, performance, or early exit.

```ts
// Roll back in reverse commit order so dependent destinations never observe a partial owner.
for (const artifact of committedArtifacts.toReversed()) {
  rollback(artifact);
}
```

`// Loop through artifacts` is not an intent comment.

### Prove non-obvious indexed access [rule:comment.index-proof]

Place a short proof immediately above a non-literal indexed access when safety is not obvious. The proof never authorizes `!`, `as`, or another assertion.

```ts
if (index < 0 || index >= items.length) {
  return Option.none();
}

// The bounds guard proves the requested element exists.
return Option.fromNullable(items[index]);
```

### Contract real pipelines [rule:comment.pipeline-contract]

An ordered workflow with three or more dependent phases has a contract comment above the orchestration and short numbered phase comments. The contract states ordering and failure ownership; ordinary leaf functions do not receive numbered headings.

### Signal-based TSDoc [rule:documentation.signal-tsdoc]

Document an exported API only when its caller needs behavior, invariant, side effect, ownership, lifecycle, error, retry, ordering, security, or performance information that its signature and schema do not show. Never restate the function name, parameter names, property types, schema descriptions, or obvious implementation steps.

## Schemas, types, and absence

### Effect Schema owns runtime objects [rule:type.schema-owned-runtime]

Effect Schema is the single source for runtime validation, derived TypeScript types, descriptions, defaults, error messages, OpenAPI, and JSON Schema. Data crossing a CLI, environment, persistence, catalog, agent-format, network, or capability boundary begins with executable Schema. Do not pair a handwritten runtime object type with a validator or parallel defaults/descriptions map.

Owned requests, configuration, persisted data, and security input decode strictly with excess properties rejected. Third-party responses may tolerate fields the application deliberately does not own, but still decode every consumed field.

The canonical feature pattern is executable Schema first:

```ts
export const featureDefinitionSchema = Schema.Struct({
  id: featureIdSchema.annotations({
    description: "Stable public feature ID.",
  }),
  sourceDirectory: sourceDirectorySchema.annotations({
    description: "Authored directory under src/skills.",
  }),
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
  dependencies: Schema.Array(featureIdSchema).annotations({
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

The dependency-free installed-hook transport reader is a narrow exception: it may use local structural aliases while narrowing an already validated wire format. It owns no application defaults, bounds, messages, or domain validation.

### The two interface cases [rule:type.interface-cases]

Interfaces are allowed only for `.d.ts` declaration augmentation and a genuinely substitutable, feature-owned external capability port. A port lives with the feature adapter, names the external capability, and exposes meaningful operations that tests or providers can substitute. Runtime data, requests, results, and ordinary internal services derive from Schema or use a local type alias.

### No enums [rule:type.no-enum]

Use Schema literals and their derived union instead of an enum.

### No conditional type machinery [rule:type.no-conditional]

Do not author conditional or `infer` chains to recover types from descriptors. Make the schema the source and derive directly.

### No assertions [rule:type.no-assertion]

Do not use `as`, angle-bracket assertions, `as const`, double assertions, or non-null assertions. Decode external `unknown`, narrow it explicitly, or improve the schema. `satisfies` is allowed because it checks a value without changing its claimed type.

### No suppression directives [rule:type.no-suppression]

Do not use TypeScript, Biome, Prettier, ESLint, or coverage ignore directives. Fix the boundary or change the design.

### One absence representation per boundary [rule:type.absence-boundary]

Use `undefined` for ordinary application absence, `null` only while decoding or encoding an external protocol, and `Option` for meaningful business absence. Translate once at the boundary. One value never exposes `null`, `undefined`, and `Option` together.

## Modules, exports, and names

### Named exports [rule:export.named-only]

Use named exports. A framework-required default export is the only exception and stays at that framework boundary.

### No internal barrels or export star [rule:export.no-internal-barrel]

Import internal owners directly. `export *` is always forbidden. Internal `index.ts` barrels are forbidden. A real public package entrypoint may explicitly re-export named APIs; it contains no logic and does not re-export another barrel.

### Domain-specific names [rule:name.domain-specific]

Names state the domain job. Booleans are predicates and collections are plural. Avoid vague `Manager`, `Helper`, `Utils`, `Data`, `Info`, `Common`, and `Misc` names. `LANGUAGE.md` owns accepted domain terms and abbreviations.

### Earn module boundaries [rule:module.no-fragmentation]

Do not create one-export-per-file fragmentation. A split needs an independent reason to change, a genuine domain concept, or a second real caller. Keep a schema beside the operations that own it when they change together.

## Values, mutation, and collections

### Never mutate inputs [rule:mutation.no-input]

Treat inputs as borrowed. Return a new value or create a locally owned collection.

### Local mutation is allowed [rule:mutation.local-ownership]

`push`, `Map.set`, and `Set.add` are allowed when the collection is created and contained inside the operation. Do not contort a clear algorithm into repeated spreads merely to claim immutability.

### No builder reduce [rule:collection.no-builder-reduce]

Do not use `reduce` to build arrays or objects. Prefer `map`, `filter`, `flatMap`, `Object.fromEntries`, or one clear local loop. Scalar reductions remain valid.

### Choose the collection form that exposes the work [rule:collection.loop-choice]

Use collection methods for direct transformations. Prefer `for...of` for branching or locally stateful multi-step work. Effectful collections use `Effect.forEach` or `Effect.all` sequentially unless bounded concurrency has a written reason and limit.

## Effect and runtime boundaries

### Match composition to dependency depth [rule:effect.composition-depth]

One dependent handoff may use one `Effect.flatMap`. Two or more dependent steps use `Effect.gen`. Avoid nested or repeated `flatMap`, `Effect.Do`, long pipe pyramids, and ceremonial generators. A short plain transformation may use `pipe`.

### No Promise.all in the application [rule:effect.no-promise-all]

Use Effect collection operators so failures, interruption, and concurrency remain explicit.

### One runtime edge [rule:effect.runtime-edge]

The main application contains exactly one `NodeRuntime.runMain(program.pipe(Effect.provide(NodeContext.layer)))` occurrence, in `src/cli/main.ts`. All other application capabilities return Effect values; `Effect.run*`, `NodeRuntime.runMain`, and `NodeContext.layer` are forbidden elsewhere. Independent shipped hook and png-to-code harness entrypoints are separate runtime graphs.

### Official services directly [rule:effect.official-services]

Use official Effect platform services directly. Add a repository service only for real policy or a stable external integration.

### Sequential by default [rule:effect.sequential-default]

Effectful filesystem and provider work is sequential by default. Bounded concurrency requires independent work, a measured reason, and an explicit limit.

### Dependency-free hook island [rule:import.hook-runtime]

Installed hook entrypoints and their transitive graph import only `node:*`, shared `src/runtime/**`, and their own feature `hooks/**` or `runtime/**`. They never import Effect, packages, CLI, catalog, config, or install capabilities.

### Application does not import hooks [rule:import.application-boundary]

Application capabilities never import installed hook code. Shared wire parsing belongs in the dependency-free transport owner; application orchestration stays outside the hook island.

### TerminalUI owns presentation [rule:presentation.terminal-ui]

Main application code does not call `console.*`. `TerminalUI` owns TTY interaction, rendering, and structured non-interactive behavior. A non-TTY process never prompts. Root tooling and installed-hook diagnostics may write to their own process streams.

### Thin root scripts [rule:script.thin-entrypoint]

Root scripts decode arguments, actually call an imported substantive owner under `src/`, render the result, and set process status. Merely importing an unused owner does not make a local engine thin. AST traversal, contract parsing, build planning, and other domain logic stay importable and co-located with tests under `src/`.

### Application never imports scripts [rule:import.application-no-scripts]

Dependency direction is `scripts/` to `src/`, never any authored `src/**` owner—including `src/build` and `src/style`—to a script entrypoint.

### Confine provider SDKs [rule:adapter.external-sdk-confinement]

An external provider SDK appears only in an earned feature-owned adapter. The adapter decodes provider data, translates errors, and returns domain values; routes, operations, schemas, and persistence do not import the SDK.

## Formatting and enforcement

### Biome owns mechanical style [rule:formatting.biome]

Biome owns 2-space indentation, double quotes, semicolons, trailing commas, organized imports, and recommended linting. During Tasks 2–14 the maintained migration scope and line width remain deliberately narrow; Task 15 performs the reviewed 120-column whole-maintained-tree cutover. Autofix is allowed only for formatter/linter transformations covered by fixtures and only on an explicitly reviewed file list.

The complete target verification order is:

```text
Biome → typecheck → code-style contract → tests → build → shipping verification → hook smoke
```

The live code-style scan remains dormant in `pnpm verify` until Task 15 makes maintained source compliant. Metadata validation and isolated checker fixtures are active immediately. Broad legacy exceptions are forbidden.
