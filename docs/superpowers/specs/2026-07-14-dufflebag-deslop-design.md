# Dufflebag Deslop Refactor Design

**Status:** Approved on 2026-07-14 through the interactive design gate and reconciled with every final follow-up approval before implementation resumed.

## Purpose

Refactor dufflebag into a lean, capability-first TypeScript package whose install, update, configure, and uninstall behavior can be trusted without reading every implementation detail.

The end state has:

- one strict root code-style contract;
- one authored source for every runtime domain shape;
- one ordered feature catalog and one ordered agent catalog;
- one transactional artifact writer with exact ownership receipts;
- one dependency-free installed hook runtime;
- one readable Effect application boundary;
- one fail-closed build and shipping boundary;
- one reusable profile-composed CODE-STYLE factory for new and existing repositories; and
- one verification command that proves the complete package.

The refactor preserves product behavior unless this document explicitly changes it. The approved behavior changes are schema-owned managed config, exact receipt-owned reconciliation, fail-closed catalog shipping, and the removal of tracked generated provider projections.

## Baseline and protected work

Before design work, `pnpm verify` passed with 13 test files and 114 tests. That is the characterization baseline.

Three user-owned files changed after the clean baseline:

- `src/skills/make-a-trailer/SKILL.md`
- `src/skills/make-a-trailer/reference/pipeline.md`
- `src/skills/make-a-trailer/scripts/assembleCut.mjs`

Their content must be preserved byte-for-byte while the directory moves to `src/skills/makeATrailer/`. They must never be reset, stashed, normalized, or absorbed into a refactor-authored diff.

The checker records all three files as exact `protectedPaths` metadata so their hashes remain visible. Only `assembleCut.mjs` receives code-rule exceptions: 13 function-form violations, 5 function-input violations, and 2 non-obvious uncommented-loop violations. Those three `maxViolations` values cannot increase; the two Markdown files are not fake AST exceptions. The exceptions are removed in a separate owner-reviewed cleanup after the concurrent make-a-trailer patch is committed independently; this refactor does not rewrite those bytes to manufacture a clean result.

## Goals

1. Make the full install pipeline understandable in seconds.
2. Remove generic `core`, `commands`, `payload`, provider-module, wrapper, and helper layers.
3. Make runtime contracts executable with Effect Schema and derive TypeScript types from them.
4. Make every filesystem change planned, validated, applied transactionally, and recorded exactly.
5. Make catalog declarations determine defaults, ordering, docs, build inputs, runtime entrypoints, and package contents.
6. Keep installed hooks reliable in foreign agent processes without third-party runtime dependencies.
7. Replace scattered formatting and style conventions with a human contract plus automated enforcement.
8. Preserve public behavior through co-located public-seam tests and real temporary directories.
9. Ship a repo-neutral CODE-STYLE factory that resolves owner defaults, applicable stack profiles, and narrow repository exceptions into local artifacts.

## Non-goals

- No monorepo.
- No plugin framework or speculative extension API.
- No compatibility wrappers for removed internal module paths.
- No universal JSON success envelope; each command owns the Effect Schema for its result.
- No target-repository runtime dependency on dufflebag after CODE-STYLE artifacts are installed.
- No local Effect service, logger, filesystem, or terminal abstraction around official services.
- No one-module-per-agent provider abstraction.
- No tracked `.agents`, `.cursor`, `.devin`, or generated managed-instruction source copies.
- No redesign of the png-to-code harness; it remains a genuine nested shipped package.
- No broad rewrite of skill prose or the protected make-a-trailer work.

## Target repository structure

```text
src/
├── build/
│   ├── buildPackage.ts
│   ├── smokeHooks.ts
│   └── verifyShipping.ts
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
├── documentation/
│   └── generateReadme.ts
├── style/
│   ├── checkCodeStyle.ts
│   └── codeStyleFactory.ts
├── skills/
├── doctor.ts
└── scaffoldWorkflows.ts

scripts/
├── buildPackage.ts
├── checkCodeStyle.ts
├── generateReadme.ts
├── smokeHooks.ts
└── verifyShipping.ts
```

Directories expose product capabilities, not technical layers. `src/core/`, `src/commands/`, and `src/payload/` disappear after their behavior moves to a named owner.

The root `scripts/` directory contains thin TypeScript maintenance entrypoints only. Substantive build, documentation, and verification behavior lives under its named `src/` owner. Package scripts are aliases or simple composition, shell is reserved for simple operating-system orchestration, and local experiments remain under ignored `scripts/dev/`. Build-only modules are excluded from shipped product artifacts.

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

The root `CODE-STYLE.md` is prescriptive. Root `code-style.rules.json` mirrors the complete rule identity set, including explicitly manual-review rules, so human and machine IDs stay bijective. `AGENTS.md` contains a short digest and points to both.

### Functions and bodies

- Every named function is an arrow constant declared before use.
- An anonymous `function*` is allowed only directly inside `Effect.gen`.
- `Schema.TaggedError` is the sole class exception.
- Functions use guard clauses, no more than two nesting levels, and one cohesive job.
- Prefer one cohesive argument. Two are allowed only as a natural pair. Three or more use a small named input object.
- Boolean behavior flag parameters are forbidden. Schema-decoded external boolean state is allowed inside a named request.
- There is no arbitrary function line cap.
- Blank lines separate function declarations.
- Pointless one-expression extraction and one-use pass-through wrappers are removed; a named function must own a concept, policy, boundary, or second real call site.

### Comments

Comments state intent, invariant, or tradeoff; they do not narrate syntax.

- Only a non-obvious explicit loop receives a short comment immediately above it. That comment explains intent, an invariant, ordering, performance, batching, or an early-exit reason.
- Every indexed access whose safety is not obvious has one proof comment immediately above it; the proof does not authorize a TypeScript assertion.
- Every ordered multi-phase pipeline has a contract comment above it and short numbered comments for its phases.
- Leaf functions do not receive ceremonial comments.

### Types and narrowing

- Effect Schema owns runtime domain objects.
- Plain type aliases exist only for genuinely compile-time-local shapes.
- Runtime-data interfaces that duplicate Effect Schemas are forbidden. Interfaces are allowed for `.d.ts` declaration augmentation and for genuinely substitutable, feature-owned external capability ports.
- Enums, authored conditional/`infer` machinery, and authored assertions are forbidden.
- `as`, `as const`, `as unknown as`, `@ts-ignore`, and `@ts-expect-error` are forbidden.
- External `unknown` values are decoded or explicitly narrowed.
- `satisfies` is allowed because it checks without changing the claimed type.
- `undefined` is ordinary application absence, `null` exists only at an external protocol boundary, and `Option` represents meaningful business absence. One value never uses all three representations.

### Documentation signals

TSDoc is signal-based. Exported APIs receive documentation only when a caller needs behavior, invariant, side-effect, ownership, lifecycle, error, retry, ordering, security, or performance information that the signature and schema do not already state. Comments never restate types, parameter names, schema descriptions, or obvious implementation steps.

### Names and barrels

- Names describe the domain job.
- Boolean values use predicate names; collections use plural names.
- `LANGUAGE.md` owns allowed abbreviations and domain terms.
- Vague `Manager`, `Helper`, `Utils`, `Data`, `Info`, `Common`, and `Misc` names are forbidden.
- Generic `types.ts`, `helpers.ts`, `utils.ts`, `common.ts`, and `misc.ts` buckets are forbidden.
- Authored non-component filenames use camelCase without repeated role suffixes such as `order.repository.ts` or `orderRepository.repository.ts`; UI component modules use PascalCase.
- Named exports are the default. Framework-required default exports are the only exception.
- One-export-per-file fragmentation is forbidden. A split requires an independent change reason; an abstraction requires a second real caller or a genuine domain concept.
- Internal barrels and `export *` are forbidden. Explicit re-exports are allowed only at a real public package boundary.

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
- one dependent handoff may use one `Effect.flatMap`; two or more dependent steps use `Effect.gen`;
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

## Reusable CODE-STYLE factory

Dufflebag is the source of a CODE-STYLE factory, not one universal guide copied unchanged into every repository. The factory resolves, in order:

1. the locked owner base;
2. every applicable stack profile detected or explicitly selected for the target repository; and
3. explicit narrow repository exceptions.

Later layers may narrow an earlier rule but never silently weaken or replace it. Unknown applicability and genuine stack conflicts are resolved during the grill. Future grills do not re-ask locked owner tastes; they ask only about real stack conflicts, unknown applicability, or a requested exception.

The post-migration canonical profile tree is:

```text
src/skills/grillMeCodeStyle/references/
├── profileComposition.md
└── profiles/
    ├── ownerBase.json
    ├── typescriptEffect.json
    ├── reactTailwind.json
    ├── backendHttp.json
    ├── dataPersistence.json
    ├── sql.json
    ├── noSql.json
    ├── securityOperations.json
    ├── asyncMessaging.json
    ├── externalAdapters.json
    └── scriptsCli.json
```

`profileComposition.md` explains the agent workflow, detection evidence, merge order, conflict handling, exception review, and local artifact rendering. It contains no second rule catalog. Each structured JSON profile is a canonical rule reference, not a rendered guide fragment or a new universal target-repository config system. `src/style/codeStyleFactory.ts` owns strict Effect Schemas for profile, rule, example, enforcement, resolved-artifact, and exception data and derives their TypeScript types. Profile responsibilities do not overlap:

| Profile | Sole responsibility |
| --- | --- |
| `ownerBase` | Owner-wide readability, names, files, documentation, module boundaries, and safe enforcement defaults. |
| `typescriptEffect` | TypeScript, Effect, Effect Schema, errors, absence, async composition, and runtime boundaries. |
| `reactTailwind` | React ownership, UI state, accessibility, Tailwind tokens, responsive behavior, motion, themes, and localization. |
| `backendHttp` | HTTP request flow, representations, authorization placement, tenancy, errors, and pagination. |
| `dataPersistence` | Persistence ownership, direct-query-first design, transactions, consistency, cache boundaries, and testing. |
| `sql` | Relational naming, constraints, identifiers, migrations, queries, indexes, concurrency, deletion, JSON, and tenant controls. |
| `noSql` | Aggregate boundaries, validators, migrations, access-pattern indexes, concurrency, TTL, recovery, and partitioning. |
| `securityOperations` | Configuration, secrets, hostile input, authentication, authorization, privacy, logs, audit, limits, and operational safety. |
| `asyncMessaging` | Jobs, outbox/inbox delivery, webhooks, retries, schedules, workflows, and distributed consistency vocabulary. |
| `externalAdapters` | Earned third-party boundaries, SDK confinement, wire decoding, resilience, reconciliation, and contract tests. |
| `scriptsCli` | Maintenance entrypoints, generators, automation behavior, CLI routing, output schemas, and process exit contracts. |

Every profile ID and rule ID is globally unique. Every rule records `applicability`, `summary`, `rationale`, good and bad examples, and one or more enforcement channels from exactly:

`formatter | linter | regex | ast | path | importGraph | typecheck | test | manual`

Anchored regex or text checks enforce textual and path-local rules. AST, linter, and import-graph checks enforce semantic structure and boundaries. Typechecking and tests prove types and behavior. Manual review owns judgment and taste. Only a formatter or linter transformation proven safe by fixtures may autofix; regex, AST, path, import-graph, typecheck, test, and manual channels are report-only.

The human `CODE-STYLE.md` projection and machine `code-style.rules.json` projection contain a bijective set of rule IDs. The factory also merges formatter/linter/checker wiring and package verification commands into the target repository rather than replacing existing configuration.

An exception references an existing rule ID and contains exact repository-relative paths, a reason, an exit condition, and a non-negative `maxViolations`. Broad paths, unknown rules, exceeded counts, stale exit conditions, or an attempted increase from an already recorded maximum fail resolution. An exception is debt with a ratchet, not a second style profile.

The resolved target owns all resulting artifacts:

- local `CODE-STYLE.md`;
- local `code-style.rules.json`;
- formatter, linter, and focused checker integration;
- package verification wiring; and
- a bounded digest inside `AGENTS.md` markers.

Content outside the bounded AGENTS markers is preserved byte-for-byte. A target repository never imports dufflebag at runtime. Reapplying the same resolution is a no-op.

### Approved profile contracts

The profile catalog encodes these decisions directly; it does not reduce them to vague interview prompts.

#### Owner base

- Organize by feature or domain; a genuinely tiny repository may remain flat.
- Use named exports except where a framework requires a default export. Keep internal imports direct, ban cycles and internal barrels, and allow only explicit public-package re-exports.
- Use arrow constants, guard clauses, cohesive inputs, camelCase non-component filenames, PascalCase component filenames, and no repeated role suffixes.
- Do not create speculative wrappers, generic CRUD/DAO/repository layers, bucket modules, one-expression helpers, or one-export-per-file fragmentation.
- Keep owned values immutable at boundaries while allowing contained local mutation when it makes the algorithm clearer.
- Use signal-based TSDoc and intent comments only where the signature or code cannot carry the contract.

#### TypeScript and Effect

- Effect Schema is the single source for runtime validation, derived types, descriptions, error messages, OpenAPI, and JSON Schema; Zod and parallel handwritten runtime-data interfaces are forbidden.
- Decode untrusted and persisted input at the boundary with excess-property behavior chosen explicitly: strict for owned requests/config/security data and deliberately tolerant only for third-party response fields the application does not own.
- Expected branch-worthy failures are typed; defects preserve their cause; public errors are translated and redacted once at the presentation boundary.
- Use ordinary React rendering and local state in UI code, and Effect for backend, CLI, worker, job, and other I/O workflows.
- Use one `flatMap` for one dependent handoff and `Effect.gen` for two or more dependent steps. Sequential execution is the default; bounded concurrency requires a reason and a limit.
- Keep `undefined`, protocol `null`, and business `Option` distinct. Run an Effect exactly once at the deployable runtime edge.

#### React and Tailwind

- One exported component owns one file only when it has earned that boundary; nested component declarations are forbidden. A child with its own state, hook, or effect owns its own file.
- `useEffect` synchronizes one concern with an external system at the smallest owning component. It is not used for derived values, event handling, or ordinary data fetching.
- State ownership follows local state, URL state, server-query cache, form state, feature context/store, then application store. Prop passthrough across more than two component boundaries moves to a feature context, store, or hook.
- Event handlers are named `handle<Action>`, callback props are named `on<Action>`, and JSX does not contain inline event-handler implementations. Memoization requires measured or referential evidence.
- Every async surface explicitly handles loading, error, empty, and success while preserving existing content during refresh. Forms derive validation and messages from Effect Schema.
- Meet WCAG 2.2 AA with semantic elements, keyboard access, visible focus, correct labels, contrast, reduced-motion support, and meaningful live-region behavior.
- Tailwind semantic tokens are the styling source. Use the existing scale first; the second repetition of a nonstandard value earns a config token. Raw `px`, `rem`, or `em` values and unrestricted `className` escape hatches are forbidden.
- Use typed variants, mobile-first layouts, and container queries for reusable components. Motion is purposeful, `transition-all` is forbidden, dark mode is semantic, and layouts/copy remain localization and RTL safe.

#### Backend HTTP

- The request path is `route -> Schema decode -> named operation -> database/external capability -> typed result/error -> representation encode`.
- Routes own transport only. Authentication yields a typed `Actor`; authorization is performed in the named operation; tenant scope is explicit and denial is the default, reinforced with row-level security where supported.
- HTTP success representations are explicit and expected failures use RFC 9457 problem details without leaking defects or provider errors.
- Cursor pagination is the default for changing collections, with stable ordering and a maximum page size of 100.

#### Data persistence, SQL, NoSQL, and cache

- Start with direct feature-owned persistence. A repository abstraction is earned only by genuinely substitutable stores or a domain boundary with behavior beyond generic CRUD.
- SQL is the default durable store; NoSQL requires evidence from aggregate shape, scale, latency, availability, or access patterns.
- Transactions own invariants; the outbox bridges committed state to async delivery; idempotency protects retried commands. Tests use the real database engine for constraints, transactions, migrations, and query behavior.
- SQL uses plural `snake_case` names, named constraints/indexes, UUIDv7 surrogate identifiers, unique natural keys, branded application IDs, explicit time zones, exact decimals, and currency-aware money values.
- SQL migrations are immutable timestamped expand/backfill/validate/contract steps. Queries avoid `select *`, unbounded reads, and N+1 access; indexes follow measured queries and `EXPLAIN`; concurrency uses atomic updates or optimistic versions.
- Deletion, status history, retention, tenant scope, and row-level security are explicit. JSON columns are bounded and versioned rather than an escape from modeling.
- NoSQL documents follow aggregate boundaries, database validators, versioned migrations, access-pattern-specific indexes, explicit optimistic/conditional concurrency, TTL semantics, recovery tests, and partition-key analysis.
- Cache is derived and disposable. Keys are versioned and tenant-scoped, TTLs use jitter where appropriate, critical coordination primitives are separated from cached data, and production code never uses global key scans such as Redis `KEYS`.

#### Security and operations

- One Effect Config boundary per deployable decodes configuration. Secrets are redacted, rotatable, absent from clients/logs, and separated by environment.
- Treat hostile input capability-first: validate identifiers and allowlists; bound paths, URLs, uploads, bodies, deadlines, and responses; and block SSRF through scheme, destination, redirect, and DNS/IP policy.
- Browser sessions use secure cookies and CSRF protection; machine/native clients use bearer credentials. Authentication and authorization remain separate typed steps.
- Raw HTML is forbidden by default. Any exception uses one typed sanitizer and one renderer plus a strict CSP and security headers.
- Structured logs are allowlisted and redacted. A separate typed durable audit trail records security-relevant actions. Data collection is classified and minimized; managed encryption is the default; field crypto requires a threat model; passwords use Argon2id.
- Resource and rate limits are operation-specific. Health, readiness, timeouts, shutdown, observability, backup/restore, and recovery drills are explicit operational contracts.

#### Async messaging

- Durable jobs are feature-owned and versioned, published through an outbox, delivered at least once, and idempotent. Retry limits, backoff, dead-letter handling, schedules, observability, and replay ownership are explicit.
- Verified webhooks use a durable inbox, signature/timestamp/replay checks, idempotent processing, and reconciliation for final truth.
- Direct calls are the default. Use `query`, `command`, `job`, `event`, and `audit` precisely; an in-process event emitter cannot hide control flow. CQRS, sagas, and event sourcing require concrete evidence.
- Persisted workflows are earned only for durable multi-step state. They define explicit states/transitions and a persisted version, commit one durable step at a time, never hold a database transaction across an external call, and use stable idempotency keys, conditional transitions, durable timers, compensation, or `manualReview`. A generic workflow manager waits for a second real workflow.

#### External adapters

- Generic provider registries and pass-through SDK wrappers are forbidden. A real third-party contract may earn one feature-owned, domain-shaped capability such as `authorize`, not an SDK-shaped method mirror.
- Only that adapter imports the provider SDK. It owns domain-facing schemas, types, and expected errors; decodes critical responses; pins the provider API version; sets deadlines and cancellation; and separates test and production environments.
- A logical command keeps one stable idempotency key. Exactly one layer owns retries. Provider errors are mapped to safe typed failures and never cross the public boundary raw.
- Persist provider references and domain state needed for recovery. Reconciliation or verified webhooks establish final truth. Contract tests cover owned request/response assumptions and failure mapping.

#### Scripts and CLI

- Root `scripts/` files are thin TypeScript repo-maintenance entrypoints; shipped CLI code lives under `src/cli/`; feature-specific tooling stays beside its feature. Application modules never import root scripts.
- Package scripts contain aliases or simple composition, not substantive shell or `node -e` programs. Shell is limited to simple operating-system orchestration and is checked with ShellCheck and shfmt when present.
- Bulk mutations support `--dry-run`; destructive actions require explicit confirmation. Generators are deterministic, idempotent, and support `--check`.
- Results use stdout and diagnostics use stderr. Automation does not require a TTY. Interactive menus route to the same Effect Schema requests and capabilities as explicit arguments.
- Human output is the default; `--json` emits exactly one JSON document on stdout for success or failure. Each command owns its result Effect Schema; success has no universal wrapper. Failure is `{ "error": { "code": string, "message": string, "retryable": boolean } }`.
- JSON mode has no prompt, ANSI color, spinner, or banner. Exit status is 0 for success or warning, 1 for operational failure or defect, 2 for usage or request-schema input failure, and 130 for cancellation. Help and version exit 0; a bare non-TTY invocation without a command exits 2; `--strict` promotes warnings to failure.

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
- human output is the default and explicit `--json` selects machine output;
- each command owns an Effect Schema for its JSON success result rather than using a universal success wrapper;
- JSON failures encode exactly `{ "error": { "code": string, "message": string, "retryable": boolean } }`;
- success or failure emits exactly one JSON document on stdout, while diagnostics and progress use stderr;
- JSON mode has no prompt, ANSI color, spinner, or banner;
- exit status 0 means success or warning, 1 means operational failure or defect, 2 means usage or request-schema input failure, and 130 means cancellation;
- help and version exit 0, a bare non-TTY invocation without a command exits 2, and `--strict` promotes warnings to failure;
- command modules translate input and render output only;
- domain modules do not prompt or print;
- `TerminalUI.ts` owns prompts, progress, success, and typed error presentation; and
- expected errors render once at the CLI edge.

## Build and shipping

Every distributable skill belongs to one feature entry and has an exact source-relative allowlist.

Root build, verification, and documentation scripts only decode arguments, call their substantive `src/build/**` or `src/documentation/**` owner, render the result, and set process status. Generators and bulk maintenance commands are deterministic and idempotent, expose `--check` or `--dry-run` as appropriate, write results to stdout and diagnostics to stderr, and never require a TTY in automation. Build-only owners, entrypoints, tests, and fixtures are excluded from product artifacts.

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
- subprocess decoding of every JSON success and failure result, with exact stdout document count, stderr separation, ANSI/prompt/spinner absence, and exit statuses 0, 1, 2, and 130;
- help/version status 0, bare non-TTY status 2, warning behavior, and `--strict` warning promotion;
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

`scripts/checkCodeStyle.ts` is a thin entrypoint into the focused repository contract verifier in `src/style/checkCodeStyle.ts`, not a second general linter. The verifier dispatches each rule only through its declared enforcement channels from `formatter | linter | regex | ast | path | importGraph | typecheck | test | manual`. Anchored regex/text checks own textual and path-local violations; AST, lint, and import-graph checks own semantic structure and boundaries; typecheck and tests own types and behavior; manual review owns judgment. It also proves that every `CODE-STYLE.md` rule ID has one matching `code-style.rules.json` entry and that the machine file contains no undocumented rule ID. Only proven-safe formatter/linter transformations may autofix.

Generated projections and `dist` are excluded from authored-source checks. The verifier reports the three named make-a-trailer `protectedPaths` and hashes without accepting a wildcard. Only `assembleCut.mjs` has temporary maintained-source rule exceptions, ratcheted at 13 function-form, 5 function-input, and 2 non-obvious-loop violations.

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
- generic `templates/mdFiles/CODE-STYLE.md`, `code-style.rules.json`, and `PROJECT.md` scaffolds;
- canonical composable profile references and forward-test fixtures for the CODE-STYLE factory; and
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
- 0006 → 0017 where the approved Effect CLI stack replaces the prior dependency choice
- 0008 → 0020 where tracked projections or source mapping changed
- 0010 → 0017
- 0011 → 0017 for the new CLI implementation while preserving the shared-path behavior
- 0012 → 0016
- 0013 → 0016, 0017, and 0020 as applicable
- 0014 → 0017 and 0020
- 0015 → 0020 for catalog-derived generation and shipping verification

## Migration strategy

The implementation lands as independently green slices:

1. Commit the approved design/plan and characterization coverage.
2. Upgrade Vitest and the Effect foundation without changing behavior.
3. Publish the strict root human/machine style contract with its checker dormant.
4. Introduce Schema-owned config and decoded catalogs.
5. Introduce pure artifact plans, receipts, transactional application, and migration.
6. Move agent output into four handlers.
7. Replace the CLI edge with `@effect/cli` and `TerminalUI`.
8. Rebuild the nested dependency-free hook runtime and fail-closed package staging.
9. Rehome modules and camelCase skill directories with history preserved.
10. Remove legacy code and tracked projections only after parity.
11. Build and forward-test the profile-composed CODE-STYLE factory.
12. Close docs, packed-tarball checks, smoke tests, and the complete verification gate.

Every slice starts with a failing or characterization test, ends with its focused tests and `pnpm verify` green, and is committed separately. Legacy paths are removed only after their replacement is proven.

The make-a-trailer move is staged as a pure rename of the committed baseline while its three concurrent modifications remain unstaged at the new path. Verification reports the three exact protected paths and the `assembleCut.mjs` ratchets separately from migration-owned conformance.

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
- JSON CLI subprocesses emit exactly one schema-valid stdout document, keep diagnostics on stderr, and return the approved 0/1/2/130 statuses;
- every packed hook entrypoint executes from the staged tree;
- root maintenance scripts remain thin, build-only owners do not ship, and external SDK imports are confined to earned feature-owned adapters;
- all CODE-STYLE profiles compose without irrelevant-profile leakage, produce repo-neutral local artifacts, preserve existing configuration and unowned AGENTS bytes, ratchet exceptions, and rerun as a no-op;
- no forbidden syntax, naming, wrapper, internal barrel, ceremonial comment, or path pattern remains outside the three exact protected make-a-trailer baseline files;
- the contract checker reports all three protected paths plus only the 13/5/2 `assembleCut.mjs` ratchets and accepts no additional exception;
- root and template docs describe their correct audiences;
- the packed tarball contains only declared output; and
- `pnpm verify` passes from a clean checkout.
