# Dufflebag code style

This file is the **project dialect** (prescriptive SSOT) for maintained code in this repository. Workspace philosophy is the Uncle Bob distillation shipped as `templates/mdFiles/CODE-STYLE.md`. When mechanism conflicts with philosophy (e.g. Schema vs interfaces), **this file wins**; philosophy still binds on intent (small functions, honest names, dependency direction, tests as courage).

The maintained tree conforms to this contract. A new rule is not complete until its verifier gates the same change when the rule is mechanically decidable.

Generated provider projections, copied skill payload, and `dist/` are not application source. The three named make-a-trailer files in `code-style.rules.json` are the only protected authored-content exceptions; never broaden them to a directory or wildcard.

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

Every authored file and directory name states the domain job it performs.

```ts
// ✓ src/install/artifactReceipt.ts
export const writeArtifactReceipt = (request: WriteReceiptRequest) => Effect.void;

// ✗ also index, types, utils, helpers, common, shared, misc, constants, models, base, core
// src/install/utils.ts
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

### Separate policy from mechanism
[rule:architecture.policy-mechanism] · verify: judgment

Business decisions are pure functions and mutable filesystem, process, and terminal mechanisms are separated by reason to change.

```ts
// ✓ pure policy can change without touching process transport
const decideDuplicateEdit = (edit: CandidateEdit, knownEdits: ReadonlyArray<KnownEdit>) =>
  knownEdits.some((knownEdit) => overlaps(edit, knownEdit)) ? "deny" : "allow";

// ✗ policy is buried inside stdin, filesystem, and exit handling
const runDedupGuard = () => readStdinAndMaybeExitAfterScanningFiles();
```

Why: business rules and mutable mechanisms change for different reasons and deserve independent tests, while local mutation inside an owned mechanism remains valid.

### Abstractions must earn their name
[rule:architecture.earned-abstraction] · verify: judgment

An abstraction exists only when it names a domain concept, owns a side-effect boundary, or serves a second caller.

```ts
// ✓ stable external boundary
const runGit = (invocation: GitInvocation) => Command.make("git", ...invocation.arguments);

// ✗ pass-through used once
const getFeatureTitle = (feature: FeatureDefinition) => feature.title;
```

Why: a one-use rename increases indirection without reducing change cost.

### No speculative robustness
[rule:architecture.no-speculation] · verify: judgment

Fallbacks, optional branches, and recovery paths exist only at a named trust boundary with a real failure requirement.

```ts
// ✓ installed hook catches only at its fail-open process boundary
runHook().catch(() => process.exit(0));

// ✗ silent fallback chain for states the Schema excludes
const featureId = firstChoice || secondChoice || legacyChoice || "unknown";
```

Why: fake robustness hides broken contracts and multiplies states nobody tests.

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

### Guards protect prerequisites
[rule:control.guard-else] · verify: judgment

Failed prerequisites return early and `else` appears only when both branches are meaningful alternatives.

```ts
// ✓ guard removes an invalid prerequisite
if (!feature) {
  return Effect.fail(new UnknownFeatureError({ featureId }));
}
return installFeature(feature);

// ✗ else after a terminal branch
if (!feature) return missingFeature;
else return installFeature(feature);
```

Why: guards flatten exceptional paths while a real two-way business choice remains clearer as two explicit branches.

### Closed variants are exhaustive
[rule:control.closed-switch] · verify: judgment

Closed domain variants use an exhaustive switch and extensible catalogs use keyed declarations.

```ts
// ✓ scope is a closed two-case domain
switch (scope) {
  case "global": return globalRoot;
  case "project": return projectRoot;
}

// ✗ repeated string conditions for a closed variant
if (scope === "global") return globalRoot;
return projectRoot;
```

Why: exhaustive control flow makes a newly added closed variant fail visibly, while catalogs keep genuine extension seams declarative.

### Ternaries stay trivial
[rule:control.ternary] · verify: `biome ci .`

A ternary expresses only one short symmetric choice and never contains another ternary.

```ts
// ✓ one symmetric display choice
const marker = selected ? "✓" : "·";

// ✗ nested control flow disguised as an expression
const marker = selected ? (failed ? "✗" : "✓") : pending ? "…" : "·";
```

Why: nested or asymmetric ternaries optimize for line count rather than comprehension.

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

### Failures carry domain facts
[rule:failure.domain-fields] · verify: judgment

Tagged application failures carry domain fields and leave user-facing wording to the CLI presentation boundary.

```ts
// ✓ facts remain reusable across text and JSON presentation
export class UnknownFeatureError extends Schema.TaggedError<UnknownFeatureError>()("UnknownFeatureError", {
  featureId: featureIdSchema,
}) {}

// ✗ capability bakes terminal prose into the failure
return Effect.fail(new Error(`Sorry, ${featureId} was not found!`));
```

Why: structured facts support one translation policy and more than one output format.

### One CLI failure translation
[rule:failure.cli-translation] · verify: judgment

The CLI translates tagged failures once and maps usage, operation, health, duplicate, and interrupt states to their documented exit codes.

```ts
// ✓ src/cli/main.ts owns the terminal edge
cliEffect.pipe(Effect.catchAllCause(presentCliFailure), Effect.runPromise);

// ✗ a command swallows a failure and exits successfully
install(request).pipe(Effect.catchAll((failure) => terminalUI.presentError(failure)));
```

Why: one terminal edge prevents contradictory messages and false zero exit codes, while defects remain defects.

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

### Comments explain hidden intent
[rule:comment.hidden-intent-only] · verify: judgment

Comments explain a constraint or decision that names, types, and structure cannot express.

```ts
// ✓ A receipt is deletion authority, so persist it only after every destination write succeeds.
yield* writeArtifactReceipt(committedArtifacts);

// ✗ Fetch the feature.
const feature = featureCatalogById.get(featureId);
```

Why: narration repeats syntax and drifts, while a hidden constraint prevents a future edit from breaking an invariant.

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

### Model valid states directly
[rule:type.valid-states] · verify: judgment

Domain types encode valid states directly instead of combining flags whose invalid combinations need conditions.

```ts
// ✓ one state has one value
const scopeSchema = Schema.Literal("global", "project");

// ✗ contradictory combinations are representable
const targetSchema = Schema.Struct({ global: Schema.Boolean, project: Schema.Boolean });
```

Why: a type that cannot represent contradiction deletes checks from every consumer.

### Brand only domain identities
[rule:type.selective-brand] · verify: judgment

Brands are reserved for domain identities whose accidental interchange would be a real defect.

```ts
// ✓ these strings have incompatible business meaning
const featureIdSchema = Schema.NonEmptyTrimmedString.pipe(Schema.brand("FeatureId"));

// ✗ every incidental string gets a brand
const menuLabelSchema = Schema.String.pipe(Schema.brand("MenuLabel"));
```

Why: selective brands prevent costly mixups without turning ordinary values into conversion ceremony.

### Schema owns serialization
[rule:type.schema-serialization] · verify: judgment

The owning Schema defines decoding, encoding, defaults, and persisted migrations for its boundary value.

```ts
// ✓ one config Schema owns both directions and migration
const decodeBagConfig = Schema.decodeUnknown(bagConfigSchema);
const encodeBagConfig = Schema.encode(bagConfigSchema);

// ✗ independent clone-and-patch migration beside the Schema
const migrateConfig = (config: LegacyConfig) => ({ ...config, version: 2 });
```

Why: parallel serializers and migrations drift from the contract they supposedly protect.

### No unsafe any
[rule:type.no-unsafe-any] · verify: `pnpm style`

Authored types use `unknown` at trust boundaries and never use unsafe `any`.

```ts
// ✓ force the boundary to prove the value
const decodeAgentEvent = (candidate: unknown) => Schema.decodeUnknown(agentEventSchema)(candidate);

// ✗ compiler checks stop here
const decodeAgentEvent = (candidate: any) => candidate as AgentEvent;
```

Why: `any` silently spreads missing proof through every caller.

### Decode once at a boundary
[rule:type.decode-once] · verify: judgment

Each application boundary decodes through its owning Schema once and downstream business logic trusts the decoded value.

```ts
// ✓ application: Schema owns the mode
export const dedupModeSchema = Schema.Literal("deny", "warn", "off");
const decodeDedupMode = Schema.decodeUnknown(dedupModeSchema);

// ✗ a parallel validation surface next to Schema
export const isDedupMode = (value: string): value is DedupMode => DEDUP_MODES.some((mode) => mode === value);
export const parseDedupMode = (text?: string): DedupMode => (isDedupMode(text || "") ? "warn" : "deny");
```

Why: repeated defensive checks duplicate the boundary contract and make valid application states look untrusted forever. A dependency-free hook instead owns one private entry decoder because Effect does not ship there.

### No nullish fallback operator
[rule:syntax.no-nullish] · verify: `biome ci .`

Authored TypeScript and JavaScript never use the nullish coalescing operator.

```ts
// ✓ let the boundary Schema supply the default
const config = yield* decodeBagConfig(configSource);

// ✗ a fallback chain hides which boundary owns the default
const scope = invocation.scope ?? environment.scope ?? fileConfig.scope ?? "global";
```

Why: one decoded boundary should own absence and defaults instead of scattering fallback syntax through business logic.

### Interfaces only when the mechanism requires them
[rule:type.no-interface] · verify: `pnpm style`

Interfaces appear only for declaration merging or an external interoperability contract that requires one.

```ts
// ✓ src/types/environment.d.ts
declare global {
  interface ProcessEnv {
    DUFFLEBAG_HOME?: string;
  }
}

// ✗ an ordinary product-owned object shape
export interface BagConfig {
  debug: boolean;
}
```

Why: product-owned runtime shapes belong to Schema and internal static shapes use `type`, while real interoperation is not forced through a false local convention.

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

### Assertions need local proof
[rule:type.no-assertion] · verify: `pnpm style`

Unknown input is decoded or narrowed, while `as const`, `satisfies`, and a documented narrow external-type correction remain allowed.

```ts
// ✓
const config = yield * Schema.decodeUnknown(bagConfigSchema)(input);
const scopes = ["global", "project"] as const;
const feature = { id: "dedup-guard" } satisfies FeatureSummary;

// ✗ boundary escape
const config = input as BagConfig;
const required = value!;
```

Why: assertions must preserve compiler evidence rather than replacing runtime validation. Indexed access may use `!` only with the proof required by the preceding card.

### No suppression directives
[rule:type.no-suppression] · verify: `pnpm style`

A suppression is allowed only for a reasoned negative type test or a narrow external defect linked to an issue.

```ts
// ✓ negative type test states the contract being proved
// @ts-expect-error Feature IDs cannot contain spaces.
const invalidFeatureId: FeatureId = "dedup guard";

// ✗ vague escape with no contract or issue
// @ts-expect-error close enough
const config: BagConfig = input;
```

Why: an unexplained suppression turns a caught error into an invisible one, while an explicit proof or tracked upstream defect has a reviewable lifetime.

### No passive barrels
[rule:module.no-passive-barrel] · verify: `pnpm style`

Authored modules export their own capability directly and never exist only to re-export sibling modules.

```ts
// ✓ import the capability from its owning module
import { applyArtifactPlan } from "./install/applyArtifactPlan.js";

// ✗ src/install/index.ts
export * from "./artifactPlan.js";
```

Why: a passive barrel adds another path and export surface without owning behavior.

### Domain-specific names
[rule:name.domain-specific] · verify: `pnpm style`

Every authored identifier and path names its domain job and contains none of the forbidden generic tokens.

```ts
// ✓
const artifactReceipt = yield * writeArtifactReceipt(request);
const featureCatalog = yield * decodeFeatureCatalog(catalogSource);

// ✗ forbidden tokens: data, raw, result(s), response, payload, body, info, temp/tmp, final, outcome
const result = decodePayload(raw);
```

Why: a generic token defers the reader to the body and lets unrelated meanings collapse into one vocabulary. Fixed public IDs and protocol property spellings are decoded once into domain names; the compound term `skill payload` remains the documented shipping concept.

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

### Collection syntax states intent
[rule:collection.intent] · verify: judgment

Collections use direct transformations, explicit loops for sequential or early-exit work, and `reduce` only for a genuine named aggregation.

```ts
// ✓ direct transformation and genuine aggregation
const byId = Object.fromEntries(features.map((feature) => [feature.id, feature]));
const totalBytes = artifacts.reduce((total, artifact) => total + artifact.size, 0);

// ✗ building a collection
const byId = features.reduce((accumulator, feature) => ({ ...accumulator, [feature.id]: feature }), {});
```

Why: syntax should expose whether the work transforms, filters, aggregates, stops early, or performs ordered effects.

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

### Configuration precedence is combined once
[rule:config.precedence] · verify: judgment

Managed configuration combines invocation, environment, file, and Schema default precedence once in that order.

```ts
// ✓ one capability owns the full precedence decision
const bagConfig = yield* resolveBagConfig({ invocationConfig, environmentConfig, fileConfig });

// ✗ every command reconstructs partial fallback precedence
const scope = invocationScope || environmentScope || fileScope || "global";
```

Why: distributed precedence creates command-specific behavior and makes the actual source of a setting unknowable.

### Capability-owned paths
[rule:path.workspace-ownership] · verify: judgment

The CLI resolves the workspace once and each capability owns constructors and containment rules for the paths it writes.

```ts
// ✓ install owns its destination vocabulary
const skillDestination = installPaths.skillDirectory({ workspace, featureId });

// ✗ generic path helper with no ownership or containment policy
const destination = joinPath(root, subdirectory, name);
```

Why: path safety belongs beside the capability and receipt policy that authorize the write or deletion.

### Child processes use argument arrays
[rule:process.argv] · verify: judgment

Child processes receive an executable and argument array without shell interpolation.

```ts
// ✓ arguments remain separate values
Command.make("git", "diff", "--name-only", gitReference);

// ✗ user-controlled text enters a shell command
exec(`git diff --name-only ${gitReference}`);
```

Why: argument arrays preserve quoting and remove command-injection behavior.

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

### Tests prove public behavior
[rule:test.behavior] · verify: judgment

Tests are colocated, name explicit scenarios, exercise public behavior in real temporary workspaces, and mock only external systems.

```ts
// ✓ scenario states the contract and uses the capability surface
it("leaves an unreceipted destination untouched during uninstall", () => withWorkspace(runUninstallScenario));

// ✗ private helper test hidden behind generic setup
it("works", () => expect(makeMock().helper()).toBe(true));
```

Why: behavior tests survive internal refactors and make ownership invariants executable.

### Maintained scripts are tool-first
[rule:tooling.tool-first] · verify: judgment

Maintained scripts exist only for repository-specific lifecycle work that an installed tool cannot perform directly.

```ts
// ✓ root script owns Dufflebag package assembly
// scripts/assembleHooks.mjs

// ✗ wrapper only forwards to Biome
// scripts/lint.ts -> execa("biome", ["ci", "."])
```

Why: direct tools keep commands recognizable and remove repository-owned forwarding code.

### Dependencies are exact
[rule:tooling.exact-dependencies] · verify: `pnpm install --frozen-lockfile`

Runtime and development dependencies use exact versions with one lockfile per package lifecycle.

```ts
// ✓ "typescript": "5.9.3"
const exactVersion = "5.9.3";

// ✗ "typescript": "^5.9.3"
const floatingVersion = "^5.9.3";
```

Why: an exact manifest and lockfile make local, CI, and published builds resolve the same toolchain.

### Git hooks only verify
[rule:tooling.git-hooks-verify] · verify: judgment

Git hooks run deterministic checks and never rewrite or stage repository files.

```ts
// ✓ pre-commit runs the deterministic repository gate
const preCommitCommand = "pnpm verify";

// ✗ hook mutates and stages the worktree
const preCommitCommand = "pnpm generate-readme && git add README.md";
```

Why: a commit hook must report stale artifacts without silently changing the commit the author reviewed.

### Feature branch for product work
[rule:git.feature-branch] · verify: judgment

All product changes land from a named topic branch via a focused PR or branch push, never as direct product commits on the default branch.

```ts
// ✓ git switch -c feat/42-catalog-skill
// ✓ .worktrees/feat-42-catalog-skill + gh pr create --body "Fixes #42"
// ✗ commit product work on main
// ✗ git push --delete origin feat/… after ship (unless user asked)
```

Why: keeps main releasable, reviews scoped, and parallel agents isolated.

## Canonical example

The dependency-free `dedupGuard` slice is the litmus test for policy/mechanism separation: one private boundary decoder, one pure decision, one outer fail-open catch, and subprocess tests for the executable contract.

```ts
// src/hookIsland/dedupGuard/hooks/dedupGuard.ts
const decideDuplicateEdit = (candidateEdit: CandidateEdit, knownEdits: ReadonlyArray<KnownEdit>): HookDecision =>
  knownEdits.some((knownEdit) => overlaps(candidateEdit, knownEdit)) ? "deny" : "allow";

const decodeHookEvent = (candidate: unknown): HookEvent | undefined => {
  if (!isRecord(candidate) || typeof candidate.tool_input !== "object") {
    return undefined;
  }

  return normalizeHookEvent(candidate);
};

const runDedupGuard = async (): Promise<void> => {
  const hookEvent = decodeHookEvent(await readTransport());
  if (!hookEvent) {
    return;
  }

  const hookDecision = decideDuplicateEdit(hookEvent.candidateEdit, readKnownEdits(hookEvent.workspace));
  writeHookDecision(hookDecision);
};

runDedupGuard().catch(() => process.exit(0));
```

The feature catalog owns its shipped files, the hook process owns transport, the pure decision owns business policy, and the test suite proves duplicate, non-duplicate, malformed-input, and fail-open scenarios through the executable boundary.

## Golden path — adding a feature

A **feature** is dufflebag's unit of extension: a catalog entry plus the artifacts it installs.

1. Define the user-visible contract and its public feature ID before choosing files.
2. Choose exactly one authored tree: copied skill content under `src/skills/<sourceDirectory>/` or executable runtime under `src/hookIsland/<sourceDirectory>/`.
3. Build the smallest capability by mirroring `src/skills/githubRepoMetadata/` for copied content or the canonical `src/hookIsland/dedupGuard/` slice for runtime.
4. Register the feature once in `src/catalog/featureCatalog.ts` with exact shipped paths; workflow skills declare the existing `type: flow` frontmatter instead of joining a second repeated list.
5. Prove public behavior, fail-open behavior when applicable, catalog closure, and receipt-last ownership with colocated tests and real temporary workspaces.
6. Update only the owning docs, regenerate README explicitly, and run the feature's narrow checks plus the png-to-code harness when that skill changes.
7. Run `pnpm verify`, `npm pack --dry-run`, then inspect README, the package file list, index, and worktree.

**Definition of done**

- [ ] Contract and authored tree chosen before implementation.
- [ ] Registered in `featureCatalog.ts` with exact `shippedPaths`.
- [ ] Receipt written last; nothing deletes without receipt authority.
- [ ] Any hook imports only the dependency-free set and fails open.
- [ ] Tests co-located and green; `pnpm verify` passes.
- [ ] Package dry run and generated README inspected.

## Recipes

### Branching & PR

See rule `git.feature-branch` under **Rules**. Skills: `finish-and-ship`, `organized-commits`, `coordinate-worktrees`. Remote branches stay unless the user explicitly asks to delete them.

### Adding a CLI command

1. Define the request Schema and the thin command adapter in `src/cli/`, returning an Effect.
2. Reuse the same capability from explicit and interactive paths; do not create a second command path.
3. Render structured capability values through `src/cli/TerminalUI.ts`; never `console.*` from the capability.
3. Keep `Effect.run*` in `src/cli/main.ts` only.
4. Make non-TTY invocation deterministic: text is the default format, JSON is explicit, and confirmation-required destructive commands require `--yes`.

### Adding a rule to this document

1. Add the card here with all five slots and a one-sentence assertion.
2. Add the same `id` to `code-style.rules.json` with a `statement` byte-identical to the assertion.
3. Point `verify` at a real command, or `judgment` if no detector exists.
4. Implement the detector in `scripts/checkCodeStyle.ts` when the shape is mechanically checkable.
5. Run `pnpm verify` — `scripts/checkStyleGuide.ts` fails the build if a slot is missing or the texts diverge.

## Exemplars

Write new code like these files:

- `src/skills/githubRepoMetadata/` — smallest copied-skill feature shape.
- `src/hookIsland/dedupGuard/` — policy/mechanism separation, one decoder, outer fail-open, and subprocess proof.
- `src/catalog/featureCatalog.ts` — cohesive Schema-owned catalog declaration; keep it declarative rather than splitting by line count.
- `src/install/applyArtifactPlan.ts` — inspect, validate, apply, and receipt-last ownership expressed through named operations.
- `src/cli/TerminalUI.ts` — the single presentation owner.
- `src/runtime/io.ts` — a real shared dependency-free boundary, not a generic helper bucket.

## Never

The slop fingerprint for this repository. Each entry is a concrete shape, not an abstract warning:

- `src/core/`, `src/commands/`, `src/payload/` — retired technical layers · [rule:path.capability-layout]
- `index`, `types`, `utils`, `helpers`, `common`, `shared`, `misc`, `constants`, `models`, `base`, or `core` as authored module or directory names · [rule:path.no-generic-bucket]
- `Manager` / `Helper` / `Utils` wrappers that forward to an official service · [rule:architecture.no-wrapper-layer]
- `isX` + `parseX` pairs beside a schema that already decodes the value · [rule:type.decode-once]
- A handwritten object type next to a validator, with parallel `DEFAULTS` / `ENV_KEYS` maps · [rule:type.schema-owned-runtime]
- `data`, `raw`, `result`, `results`, `response`, `payload`, `body`, `info`, `temp`, `tmp`, `final`, or `outcome` in authored identifiers or paths · [rule:name.domain-specific]
- `??` in authored TypeScript or JavaScript · [rule:syntax.no-nullish]
- Nested ternaries or boolean flags that encode a domain state · [rule:control.ternary]
- `as`, `any`, or `!` used to get past a boundary instead of proving it · [rule:type.no-assertion]
- Unexplained `@ts-expect-error` or broad tool suppressions · [rule:type.no-suppression]
- Passive `index.ts` re-export modules · [rule:module.no-passive-barrel]
- `console.log` inside a capability · [rule:presentation.terminal-ui]
- `Promise.all` in application code · [rule:effect.no-promise-all]
- `reduce` used as a disguised collection builder · [rule:collection.intent]
- Comments that narrate a loop, phase number, assignment, or function name · [rule:comment.hidden-intent-only]
- `import { Effect }` anywhere in an installed hook graph · [rule:import.hook-runtime]

## Formatting and verification

Biome owns 2-space indentation, double quotes, semicolons, trailing commas, 120-column width, organized imports, the nullish-operator ban, and the nested-ternary ban across maintained TS, TSX, JS, MJS, JSON, and JSONC. Pinned Ruff owns Python linting and formatting for the voice island.

| Command | Covers |
| --- | --- |
| `pnpm verify` | Biome → Ruff → typecheck → code-style contract → style-guide contract → tests → build → generated-document check. |
| `pnpm style` | Repository-specific architecture, path, declaration, and import-graph checks over every maintained runtime tree. |

The complete target verification order is:

```text
Biome → Ruff → typecheck → code-style contract → style-guide contract → tests → build → generated-document check
```

The custom checker does not duplicate ordinary syntax checks that Biome, its Grit plugins, TypeScript, or Ruff already own. Hook-island findings gate with application and tooling findings. Broad legacy allowlists are forbidden; the only exceptions are the three exact protected authored-content paths in `code-style.rules.json`.
