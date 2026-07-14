# Dufflebag Deslop Refactor Design

**Status:** Approved on 2026-07-14 through the interactive design gate. All 42 decisions were accepted with no flips, revisit markers, or notes.

## Purpose

Refactor dufflebag into a lean, capability-first TypeScript package whose install, update, configure, and uninstall behavior can be trusted without reading every implementation detail.

The end state has:

- one strict root code-style contract;
- one authored source for every runtime domain shape;
- one ordered feature catalog and one ordered agent catalog;
- one transactional artifact writer with exact ownership receipts;
- one dependency-free installed hook runtime;
- one readable Effect application boundary;
- one fail-closed build and shipping boundary; and
- one verification command that proves the complete package.

The refactor preserves product behavior unless this document explicitly changes it. The approved behavior changes are schema-owned managed config, exact receipt-owned reconciliation, fail-closed catalog shipping, and the removal of tracked generated provider projections.

## Baseline and protected work

Before design work, `pnpm verify` passed with 13 test files and 114 tests. That is the characterization baseline.

Three user-owned files changed after the clean baseline:

- `src/skills/make-a-trailer/SKILL.md`
- `src/skills/make-a-trailer/reference/pipeline.md`
- `src/skills/make-a-trailer/scripts/assembleCut.mjs`

Their content must be preserved byte-for-byte while the directory moves to `src/skills/makeATrailer/`. They must never be reset, stashed, normalized, or absorbed into a refactor-authored diff.

`assembleCut.mjs` contains pre-existing function-form, function-input, and loop-comment violations. The contract checker therefore carries one explicit protected-baseline exception covering only these three moved paths. The exception cannot grow, and no other file may use it. It is removed in a separate owner-reviewed cleanup after the concurrent make-a-trailer patch is committed independently; this refactor does not rewrite those bytes to manufacture a clean result.

## Goals

1. Make the full install pipeline understandable in seconds.
2. Remove generic `core`, `commands`, `payload`, provider-module, wrapper, and helper layers.
3. Make runtime contracts executable with Effect Schema and derive TypeScript types from them.
4. Make every filesystem change planned, validated, applied transactionally, and recorded exactly.
5. Make catalog declarations determine defaults, ordering, docs, build inputs, runtime entrypoints, and package contents.
6. Keep installed hooks reliable in foreign agent processes without third-party runtime dependencies.
7. Replace scattered formatting and style conventions with a human contract plus automated enforcement.
8. Preserve public behavior through co-located public-seam tests and real temporary directories.

## Non-goals

- No monorepo.
- No plugin framework or speculative extension API.
- No compatibility wrappers for removed internal module paths.
- No JSON, quiet, or other output modes without a real consumer.
- No local Effect service, logger, filesystem, or terminal abstraction around official services.
- No one-module-per-agent provider abstraction.
- No tracked `.agents`, `.cursor`, `.devin`, or generated managed-instruction source copies.
- No redesign of the png-to-code harness; it remains a genuine nested shipped package.
- No broad rewrite of skill prose or the protected make-a-trailer work.

## Target repository structure

```text
src/
├── cli/
│   ├── main.ts
│   ├── TerminalUI.ts
│   ├── installCommand.ts
│   ├── updateCommand.ts
│   ├── uninstallCommand.ts
│   ├── configCommand.ts
│   ├── doctorCommand.ts
│   └── scaffoldWorkflowsCommand.ts
├── catalog/
│   ├── featureCatalog.ts
│   └── agentCatalog.ts
├── config/
│   ├── bagConfigSchema.ts
│   ├── configFile.ts
│   └── configure.ts
├── install/
│   ├── install.ts
│   ├── update.ts
│   ├── uninstall.ts
│   ├── artifactPlan.ts
│   ├── applyArtifactPlan.ts
│   ├── artifactReceipt.ts
│   └── agentFormats/
│       ├── skillDirectory.ts
│       ├── ruleFile.ts
│       ├── instructionFile.ts
│       └── configReference.ts
├── runtime/
│   ├── readConfig.ts
│   └── readHookInput.ts
├── skills/
├── doctor.ts
└── scaffoldWorkflows.ts

scripts/
├── buildPackage.ts
├── checkCodeStyle.ts
├── generateReadme.mjs
├── smokeHooks.ts
└── verifyShipping.ts
```

Directories expose product capabilities, not technical layers. `src/core/`, `src/commands/`, and `src/payload/` disappear after their behavior moves to a named owner.

The root `scripts/` directory contains committed build and verification entrypoints only. It owns no application behavior. Local experiments remain under ignored `scripts/dev/`.

The png-to-code harness remains a nested package under `src/skills/pngToCode/scripts/`. It is not promoted into a workspace package.

## Authored source and generated projections

`src/skills/**` is the only authored skill source.

Provider-specific copies under `.agents/`, `.cursor/`, and `.devin/` are generated local projections and stop being tracked. The tracked `<!-- dufflebag:skills -->` block is removed from `AGENTS.md`. Consuming repositories may still receive generated projections locally.

Every authored skill directory uses camelCase. Public feature IDs, installed skill IDs, and CLI flags remain catalog-declared hyphenated data. UI and component module files use PascalCase.

The required source-directory mapping is:

| Feature ID                      | Installed skill ID              | Authored directory         |
| ------------------------------- | ------------------------------- | -------------------------- |
| `context-guard`                 | —                               | `contextGuard`             |
| `autonomous-loop`               | `autorun`                       | `autorun`                  |
| `speak-response`                | —                               | `speakResponse`            |
| `dedup-guard`                   | —                               | `dedupGuard`               |
| `png-to-code`                   | `png-to-code`                   | `pngToCode`                |
| `github-repo-metadata`          | `github-repo-metadata`          | `githubRepoMetadata`       |
| `write-a-post`                  | `write-a-post`                  | `writeAPost`               |
| `readme-editor`                 | `readme-editor`                 | `readmeEditor`             |
| `refresh-agent-docs`            | `refresh-agent-docs`            | `refreshAgentDocs`         |
| `deslop`                        | `deslop`                        | `deslop`                   |
| `deslop-v2`                     | `deslop-v2`                     | `deslopV2`                 |
| `grill-me`                      | `grill-me`                      | `grillMe`                  |
| `grill-me-code-style`           | `grill-me-code-style`           | `grillMeCodeStyle`         |
| `grill-me-code-style-coach`     | `grill-me-code-style-coach`     | `grillMeCodeStyleCoach`    |
| `grill-me-code-style-review`    | `grill-me-code-style-review`    | `grillMeCodeStyleReview`   |
| `grill-me-code-style-with-docs` | `grill-me-code-style-with-docs` | `grillMeCodeStyleWithDocs` |
| `grill-me-stack`                | `grill-me-stack`                | `grillMeStack`             |
| `grill-with-docs`               | `grill-with-docs`               | `grillWithDocs`            |
| `planpage`                      | `planpage`                      | `planpage`                 |
| `web-perf-ci`                   | `web-perf-ci`                   | `webPerfCi`                |
| `cws-listing-seo`               | `cws-listing-seo`               | `cwsListingSeo`            |
| `make-a-trailer`                | `make-a-trailer`                | `makeATrailer`             |
| `web-best-practices`            | `web-best-practices`            | `webBestPractices`         |

## Code readability contract

The root `CODE-STYLE.md` is prescriptive. Root `code-style.rules.json` mirrors only enforceable rules. `AGENTS.md` contains a short digest and points to both.

### Functions and bodies

- Every named function is an arrow constant declared before use.
- An anonymous `function*` is allowed only directly inside `Effect.gen`.
- `Schema.TaggedError` is the sole class exception.
- Functions use guard clauses, no more than two nesting levels, and one cohesive job.
- Prefer one cohesive argument. Two are allowed only as a natural pair. Three or more use a small named input object.
- Boolean behavior flag parameters are forbidden. Schema-decoded external boolean state is allowed inside a named request.
- There is no arbitrary function line cap.
- Blank lines separate function declarations.
- One-use pass-through wrappers are removed.

### Comments

Comments state intent, invariant, or tradeoff; they do not narrate syntax.

- Every explicit loop has one short intent comment immediately above it.
- Every indexed non-null assertion has one proof comment immediately above it.
- Every ordered multi-phase pipeline has a contract comment above it and short numbered comments for its phases.
- Leaf functions do not receive ceremonial comments.

### Types and narrowing

- Effect Schema owns runtime domain objects.
- Plain type aliases exist only for genuinely compile-time-local shapes.
- Interfaces are allowed only for `.d.ts` augmentation.
- Enums, authored conditional/`infer` machinery, and authored assertions are forbidden.
- `as`, `as const`, `as unknown as`, `@ts-ignore`, and `@ts-expect-error` are forbidden.
- External `unknown` values are decoded or explicitly narrowed.
- `satisfies` is allowed because it checks without changing the claimed type.

### Names and barrels

- Names describe the domain job.
- Boolean values use predicate names; collections use plural names.
- `LANGUAGE.md` owns allowed abbreviations and domain terms.
- Vague `Manager`, `Helper`, `Utils`, `Data`, `Info`, `Common`, and `Misc` names are forbidden.
- Generic `types.ts`, `helpers.ts`, `utils.ts`, `common.ts`, and `misc.ts` buckets are forbidden.
- One-export-per-file fragmentation is forbidden. A split requires an independent change reason; an abstraction requires a second real caller or a genuine domain concept.
- A barrel may be a flat manifest of direct wildcard exports only.
- Barrels contain no logic, selective exports, aliases, or chains.

### Mutation and collections

- `const` is the default.
- Inputs are never mutated.
- Local `push`, `Map.set`, and `Set.add` are allowed when the collection is locally owned.
- Collection methods are preferred when they state the transformation directly.
- `for...of` is preferred for pure branching or locally stateful multi-step work.
- Effectful collections use `Effect.forEach` or `Effect.all` sequentially unless bounded concurrency is explicitly justified.
- `reduce` is not used to build arrays or objects.

## Effect application model

The main package uses:

- `effect@3.22.0`
- `@effect/cli@0.76.0`
- `@effect/platform@0.97.0`
- `@effect/platform-node@0.108.0`
- `@effect/vitest@0.30.0`
- `vitest@3.2.7`

Commander, Clack, and picocolors are removed.

The main dufflebag application follows the official [Effect](https://effect.website/docs/) and [Effect Schema](https://effect.website/docs/schema/introduction/) model:

- pure transformations remain plain arrow functions;
- application effects return `Effect`;
- dependent workflows use `Effect.gen`;
- one short transformation may use `pipe`;
- long pipe pyramids, `Effect.Do`, and ceremonial generators are avoided;
- official platform services are used directly;
- no local `Context.Tag`, `Layer`, filesystem, terminal, logger, or service wrappers are introduced without a real external integration;
- expected branch-worthy failures use `Schema.TaggedError`;
- unexpected defects retain their cause;
- `Option` represents meaningful absence;
- effectful collections are sequential by default;
- `Promise.all` and unbounded concurrent filesystem mutation are forbidden;
- bounded concurrency is explicit and allowed only where measurements justify it;
- `Effect.runPromise`, `Effect.runSync`, and other `Effect.run*` calls are forbidden outside the main `src/cli/main.ts` runtime edge; and
- application presentation goes through `TerminalUI`, not `console.*`.

`NodeRuntime.runMain` and `NodeContext.layer` appear once at `src/cli/main.ts` for the main application.

That one-runtime rule does not apply to the independently shipped png-to-code harness or root build/verification scripts. They are separate tooling entrypoints. Within main-package runtime code, installed hooks are the only Effect-free executable graph.

`TerminalUI`, `readSchemaDescription`, the four agent-format handlers, and `applyArtifactPlan` are accepted boundary owners because each translates between distinct representations or owns a safety invariant. They must not become pass-through wrappers.

## Schema-owned runtime contracts

Effect Schema owns every main-application or persisted authored domain object that is decoded, validated, serialized, loaded, or passed across a capability boundary:

- `featureDefinitionSchema` → `FeatureDefinition`
- `agentDefinitionSchema` → `AgentDefinition`
- `bagConfigSchema` → `BagConfig`
- CLI request schemas → command request types
- `artifactPlanSchema` → `ArtifactPlan`
- `artifactReceiptSchema` → `ArtifactReceipt`
- tagged error schemas → expected error types

Authored object aliases or interfaces do not sit beside these schemas.

Every persisted or authored object decode uses `onExcessProperty: "error"`. Unknown fields, missing required fields, invalid values, out-of-range values, and contradictory values fail with actionable errors. Fields with executable Schema defaults resolve when missing.

The plain installed-hook transport reader is the named exception. It performs dependency-free structural narrowing for the already validated wire format and owns no application type, default, bound, description, or domain validation.

The canonical feature shape is:

```ts
import { Schema } from "effect";

const featureDefinitionSchema = Schema.Struct({
  id: Schema.String.pipe(
    Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: () => "Feature IDs must use kebab-case.",
    }),
    Schema.annotations({
      description: "Stable public feature ID.",
    }),
  ),
  sourceDirectory: Schema.String.pipe(
    Schema.pattern(/^[a-z][a-zA-Z0-9]*$/, {
      message: () => "Source directories must use camelCase.",
    }),
    Schema.annotations({
      description: "Authored directory name under src/skills.",
    }),
  ),
  installedSkill: Schema.Union(
    Schema.Struct({
      _tag: Schema.Literal("none"),
    }),
    Schema.Struct({
      _tag: Schema.Literal("skill"),
      id: Schema.String.pipe(
        Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
          message: () => "Installed skill IDs must use kebab-case.",
        }),
        Schema.annotations({
          description: "Public directory name installed for this skill.",
        }),
      ),
      shippedPaths: Schema.Array(Schema.NonEmptyTrimmedString).annotations({
        description:
          "Exact feature-relative allowlist copied into dist/skills.",
      }),
    }),
  ).annotations({
    description: "Installed skill output, separate from feature identity.",
  }),
  title: Schema.NonEmptyTrimmedString.annotations({
    description: "Short human-readable CLI label.",
  }),
  summary: Schema.NonEmptyTrimmedString.annotations({
    description: "One-line user-facing feature description.",
  }),
  selectedByDefault: Schema.Boolean.annotations({
    description: "Whether a fresh interactive install preselects the feature.",
  }),
  dependencies: Schema.Array(
    Schema.String.pipe(
      Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
        message: () => "Dependency IDs must use kebab-case.",
      }),
    ),
  ).annotations({
    description: "Feature IDs resolved before this feature.",
  }),
  platform: Schema.Literal("any", "macos", "macos+ghostty").annotations({
    description: "Host requirement surfaced by install and doctor.",
  }),
  runtime: Schema.Union(
    Schema.Struct({
      _tag: Schema.Literal("none"),
    }),
    Schema.Struct({
      _tag: Schema.Literal("hook"),
      sourceEntrypoint: Schema.String.pipe(
        Schema.endsWith(".ts", {
          message: () => "Hook source entrypoints must end in .ts.",
        }),
        Schema.annotations({
          description:
            "Feature-relative TypeScript entrypoint compiled into dist/runtime.",
        }),
      ),
      registrations: Schema.Array(
        Schema.Struct({
          event: Schema.Literal(
            "PreToolUse",
            "PostToolUse",
            "UserPromptSubmit",
            "SessionStart",
            "Stop",
          ).annotations({
            description: "Agent lifecycle event that invokes this entrypoint.",
          }),
          matcher: Schema.Union(
            Schema.Struct({
              _tag: Schema.Literal("none"),
            }),
            Schema.Struct({
              _tag: Schema.Literal("pattern"),
              value: Schema.NonEmptyTrimmedString,
            }),
          ).annotations({
            description:
              "Optional tool matcher represented without an optional property.",
          }),
        }),
      ).annotations({
        description:
          "Hook registrations derived into supported agent settings.",
      }),
    }),
  ).annotations({
    description: "Optional hook runtime represented as a tagged union.",
  }),
});

const featureCatalogSchema = Schema.Array(featureDefinitionSchema);

type FeatureDefinition = Schema.Schema.Type<typeof featureDefinitionSchema>;

const featureCatalog = Schema.decodeUnknownSync(featureCatalogSchema, {
  onExcessProperty: "error",
})([
  {
    id: "context-guard",
    sourceDirectory: "contextGuard",
    installedSkill: {
      _tag: "none",
    },
    title: "Context guard",
    summary:
      "Protect long agent sessions before the context window is exhausted.",
    selectedByDefault: true,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
      sourceEntrypoint: "hooks/contextGuard.ts",
      registrations: [
        {
          event: "PreToolUse",
          matcher: {
            _tag: "pattern",
            value: "Write|Edit|MultiEdit|NotebookEdit",
          },
        },
        {
          event: "PostToolUse",
          matcher: {
            _tag: "pattern",
            value: "Write|Edit|MultiEdit|NotebookEdit",
          },
        },
        {
          event: "UserPromptSubmit",
          matcher: {
            _tag: "none",
          },
        },
      ],
    },
  },
]);
```

Descriptions live on the schema properties they describe. Checks and their messages live with the checked property. A nested named schema is introduced only when it is a real reusable domain value, not to shorten a file.

## Feature and agent catalogs

`src/catalog/featureCatalog.ts` owns `featureDefinitionSchema` and one decoded ordered feature catalog. Each public ID appears once.

The decoded catalog derives:

- display order;
- default selection;
- dependency expansion;
- CLI choices;
- README catalog output;
- feature-ID to camelCase-source mapping;
- distinct installed skill IDs and destinations;
- build inputs;
- exact shipped allowlists; and
- hook runtime entrypoints.

There is no parallel ID union, record, order list, default list, package allowlist, or README regex parser.

A hook catalog entry stores a feature-relative TypeScript `sourceEntrypoint`. The build derives its only staged representation by preserving the nested relative path under `dist/runtime/<sourceDirectory>/` and changing the emitted extension to `.js`. Catalog data never mixes authored `.ts` paths with staged `.js` paths.

`src/catalog/agentCatalog.ts` owns `agentDefinitionSchema` and one decoded ordered agent catalog. Each agent declares detection plus exactly one discriminated target. Agent identity is data.

Native output behavior belongs to exactly four handlers:

- `skillDirectory.ts`
- `ruleFile.ts`
- `instructionFile.ts`
- `configReference.ts`

There are no per-agent modules, optional target-property bags, or agent-ID switches inside format handlers.

## Managed configuration

`bagConfigSchema` owns every configuration property's:

- runtime check;
- error message;
- description; and
- executable default.

Cross-field invariants live on the containing schema. There are no detached default, description, check, environment-key, or help maps.

`readSchemaDescription` is the single adapter at the CLI help boundary. It reads schema annotations; it does not duplicate copy.

The CLI writes one complete validated `config.json` beside each installed runtime. The artifact receipt owns it. Installed hooks read this file with plain Node and own no defaults, bounds, descriptions, environment-key catalog, clamping, or silent fallback.

A first project install copies the current validated global config. If no global config exists, schema defaults create the project config. Global and project files are independent afterward.

Legacy `dufflebag*` environment configuration is migrated once:

`existing env → decode complete candidate → validate all invariants → plan config write and owned-key removal → apply transaction`

An invalid migration performs no writes. Only validated dufflebag-owned legacy keys are removed, and only after the managed file commits.

Allowed representation normalization is explicit in the property schema:

- trim surrounding whitespace from external text before validation;
- parse a complete base-10 numeric string through `Schema.NumberFromString`;
- decode the exact legacy strings `"true"` and `"false"` when a boolean field has a documented legacy representation; and
- decode an explicitly listed legacy alias only when that alias appears beside the property schema.

Case folding, partial numeric parsing, clamping, unknown aliases, and default-on-invalid behavior are forbidden. Normalization changes representation only; it cannot turn an invalid domain value into a valid one.

The plain hook reader necessarily knows the transport property names, but not their semantics. Integration tests encode a config through `bagConfigSchema`, write it, and run every hook reader/entrypoint. This prevents wire-key drift without duplicating defaults or validation in the hook graph.

## Artifact planning, receipts, and recovery

Every install mutation follows:

`catalog + config + scope → inspect → plan → validate → apply → receipt`

Planning is pure. The complete desired state is decoded and validated before the first filesystem mutation.

`ArtifactPlan` and `ArtifactReceipt` are Schema-owned. A receipt records every owned artifact with:

- agent;
- scope-relative path;
- artifact kind; and
- discriminated ownership metadata appropriate to that kind.

The four format handlers produce desired artifacts and their ownership metadata. Detection is diagnostic evidence only; it never authorizes deletion.

Update diffs the previous receipt against the desired plan. Uninstall follows the receipt exactly. Legacy manifests migrate once through validated planning.

`applyArtifactPlan` is the only main-application filesystem writer:

```ts
/**
 * Applies one validated artifact plan transactionally.
 * A failed stage or commit restores every target before temporary files are removed.
 */
const applyArtifactPlan = (plan: ArtifactPlan) =>
  Effect.gen(function* () {
    // 1. Assign temporary paths without touching the filesystem.
    const stagedPlan = createStagedArtifactPlan(plan);

    // 2. Capture every original target before the first mutation.
    const snapshots = yield* snapshotArtifacts(stagedPlan);

    const apply = Effect.gen(function* () {
      // 3. Write every desired artifact to its temporary path.
      yield* stageArtifacts(stagedPlan);

      // 4. Move staged artifacts into their final locations.
      yield* commitArtifacts(stagedPlan);

      // 5. Publish ownership only after every artifact succeeds.
      yield* commitReceipt(stagedPlan.receipt);
    });

    // 6. Restore originals on failure and always remove temporary files.
    yield* apply.pipe(
      Effect.onError(() => restoreArtifacts(snapshots)),
      Effect.ensuring(removeStagedArtifacts(stagedPlan)),
    );
  });
```

Original targets are restored in reverse mutation order. `removeStagedArtifacts` always removes disposable desired-output staging files. Captured recovery snapshots are removed only after a successful commit or a successful rollback.

The normal `<installDir>/receipt.json` is committed last. If `restoreArtifacts` fails, `writeRecoveryRecord` writes a separate `<installDir>/recovery.json` containing the unrecovered paths and durable captured snapshot locations before the rollback failure is re-raised. Those snapshots survive cleanup. The normal receipt remains absent, and recovery evidence is never presented as a successful ownership receipt.

Fault-injection tests use real temporary filesystem conflicts or an official platform test layer. They do not export repository internals or add test-only branches.

## Hook runtime

Everything reachable from an installed hook entrypoint imports only `node:*` and other files under `src/runtime/` or that feature's runtime subtree.

The hook graph:

- imports no Effect or third-party package;
- imports no main application module;
- reads the complete managed `config.json`;
- owns no semantic defaults, bounds, descriptions, or legacy env catalog;
- preserves the nested module tree under `dist/runtime/`;
- requires no flattening or import rewriting; and
- fails open with at most one concise warning.

Every catalog-declared staged entrypoint is smoke-run from the exact packed layout.

## CLI and presentation

A bare TTY invocation opens the interactive menu. Explicit commands remain scriptable. Both decode through the same request schema and call the same capability.

The CLI guarantees:

- global and project scope are mutually exclusive;
- non-TTY invocation never prompts or hangs;
- command modules translate input and render output only;
- domain modules do not prompt or print;
- `TerminalUI.ts` owns prompts, progress, success, and typed error presentation; and
- expected errors render once at the CLI edge.

Human-readable output is the only current output mode.

## Build and shipping

Every distributable skill belongs to one feature entry and has an exact source-relative allowlist.

The build:

1. decodes the catalogs;
2. validates that declared sources exist;
3. rejects missing, extra, duplicate, uncataloged, or build-only shipped content;
4. stages only declared content under `dist/skills/`;
5. compiles catalog-declared hooks as a preserved nested tree under `dist/runtime/`; and
6. packs from `dist` rather than `src/skills`.

Install consumes the staged `dist` layout only. The tarball, staged tree, source catalog, and exact allowlists are compared by `scripts/verifyShipping.ts`.

README generation imports decoded catalog data through a supported build-time entrypoint. It never regex-parses TypeScript and never scans unrelated home-directory skill roots to decide what ships.

## Tests and verification

Tests co-locate with their owner.

- Application Effect tests use `it.effect` from `@effect/vitest`.
- The dependency-free hook runtime uses ordinary Vitest.
- Tests exercise public seams and real temporary directories.
- Repository internals are not mocked or exported for tests.
- Bug fixes begin with a failing regression.
- Snapshots are reserved for intentional rendered artifacts.

Required behavior coverage includes:

- schema defaults, descriptions, messages, excess-key rejection, and cross-field invariants;
- feature order, dependencies, defaults, source mapping, and exact allowlists;
- agent target discrimination and all four output handlers;
- install, update, and uninstall idempotency and symmetry;
- receipt ownership and legacy-manifest migration;
- stage/commit/receipt failures, reverse rollback, byte restoration, cleanup, and recovery evidence;
- complete config migration and zero-write invalid migration;
- bare TTY and explicit command parity;
- non-TTY no-prompt behavior;
- package contents and uncataloged-content failure;
- hook import-graph isolation; and
- smoke execution of every packed runtime entrypoint.

Biome is the sole formatter and general linter:

- 2 spaces;
- double quotes;
- semicolons;
- trailing commas;
- 120-column width; and
- organized imports.

Biome covers every maintained TypeScript, TSX, JavaScript, MJS, JSON, and JSONC file in the main package, root scripts, and the png-to-code harness.

`scripts/checkCodeStyle.ts` is a focused repository contract verifier, not a second general linter. It enforces AST, import-graph, path, barrel, comment, assertion, and function-form rules that Biome cannot express. It also proves that every enforceable `CODE-STYLE.md` rule ID has one matching `code-style.rules.json` entry and that the machine file contains no undocumented rule ID.

Generated projections and `dist` are excluded from authored-source checks. The three named protected make-a-trailer paths are the only temporary maintained-source exception, and the verifier reports them by exact path rather than accepting a wildcard.

`pnpm verify` runs exactly:

`Biome → typecheck → contract checker → tests → build → shipping verification → hook smoke`

## Documentation and decision records

The migration creates or refreshes:

- root `CODE-STYLE.md`;
- root `code-style.rules.json`;
- `AGENTS.md` layout, digest, and golden path;
- complete root `PROJECT.md`;
- `CONTEXT.md` operational model;
- `LANGUAGE.md` domain vocabulary;
- `TEACH.md` stack decisions and self-closing glossary;
- catalog-derived `README.md` output;
- generic `templates/mdFiles/CODE-STYLE.md`, `code-style.rules.json`, and `PROJECT.md` scaffolds; and
- ADRs 0016 through 0020.

The ADRs are:

- `0016-strict-readable-code-contract.md`
- `0017-effect-application-and-capability-layout.md`
- `0018-schema-owned-managed-config.md`
- `0019-transactional-artifact-reconciliation.md`
- `0020-cataloged-shipping-and-preserved-runtime-tree.md`

Historical ADR bodies remain unchanged. Conflicting current ADRs receive status/supersession annotations pointing to the replacement:

- 0003 → 0018
- 0004 → 0016 and 0017
- 0008 → 0020 where tracked projections or source mapping changed
- 0010 → 0017
- 0011 → 0017 for the new CLI implementation while preserving the shared-path behavior
- 0012 → 0016
- 0013 → 0016, 0017, and 0020 as applicable
- 0014 → 0017 and 0020
- 0015 → 0020 for catalog-derived generation and shipping verification

## Migration strategy

The implementation lands as independently green slices:

1. Commit the approved contracts and characterization coverage.
2. Upgrade Vitest and the Effect foundation without changing behavior.
3. Introduce Schema-owned config and decoded catalogs.
4. Introduce pure artifact plans, receipts, transactional application, and migration.
5. Move agent output into four handlers.
6. Replace the CLI edge with `@effect/cli` and `TerminalUI`.
7. Rebuild the nested dependency-free hook runtime and fail-closed package staging.
8. Rehome modules and camelCase skill directories with history preserved.
9. Remove legacy code and tracked projections only after parity.
10. Close docs, packed-tarball checks, smoke tests, and the complete verification gate.

Every slice starts with a failing or characterization test, ends with its focused tests and `pnpm verify` green, and is committed separately. Legacy paths are removed only after their replacement is proven.

The make-a-trailer move is staged as a pure rename of the committed baseline while its three concurrent modifications remain unstaged at the new path. Verification reports their exact protected-baseline exception separately from migration-owned conformance.

## Success criteria

The refactor is complete only when:

- the protected make-a-trailer edits remain intact;
- every main-application and persisted authored runtime domain object derives from Effect Schema, with only the named plain-hook transport exception;
- every public feature and agent is declared exactly once;
- every shipped path is cataloged and verified;
- install, update, configure, and uninstall use one transactional writer;
- rollback restores original bytes or writes explicit recovery evidence;
- uninstall deletes only receipt-owned artifacts;
- non-TTY CLI use cannot prompt or hang;
- every packed hook entrypoint executes from the staged tree;
- no forbidden syntax, naming, wrapper, barrel, comment, or path pattern remains outside the three exact protected make-a-trailer baseline files;
- the contract checker reports that protected exception explicitly and accepts no additional exception;
- root and template docs describe their correct audiences;
- the packed tarball contains only declared output; and
- `pnpm verify` passes from a clean checkout.
