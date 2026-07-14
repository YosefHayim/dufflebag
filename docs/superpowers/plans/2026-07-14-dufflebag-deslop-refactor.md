# Dufflebag Deslop Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dufflebag's layered, assertion-heavy installer with a lean Effect application whose runtime data is defined once by Effect Schema, whose filesystem changes are transactional and receipt-owned, and whose complete shipped package is proven by one strict verification command.

**Architecture:** Keep one npm package. Decode feature, agent, config, request, plan, receipt, and expected-error values at capability boundaries; derive their TypeScript types from those schemas; keep transformations pure; run application effects through one Node runtime edge; keep installed hooks dependency-free; and make one artifact-plan applier the only application writer.

**Tech Stack:** TypeScript 5.7, Node 20+, Effect 3.22, Effect Schema, `@effect/cli` 0.76, `@effect/platform` 0.97, `@effect/platform-node` 0.108, `@effect/vitest` 0.30, Vitest 3.2.7, Biome 2.5, pnpm 10.

## Global Constraints

- The approved design is [`docs/superpowers/specs/2026-07-14-dufflebag-deslop-design.md`](../specs/2026-07-14-dufflebag-deslop-design.md). It wins over this execution plan if wording drifts.
- Preserve these user-owned files byte-for-byte, including after their directory moves to `src/skills/makeATrailer/`:
  - `src/skills/make-a-trailer/SKILL.md` — SHA-256 `5bf0ec33ac92acd73b816f8c61c422c49f518f3cfcc5763986a8108d451cc297`
  - `src/skills/make-a-trailer/reference/pipeline.md` — SHA-256 `3bb89d856d28995c50fba23aca6a6a1af1fe56f10d67546a0515fe0d276f1669`
  - `src/skills/make-a-trailer/scripts/assembleCut.mjs` — SHA-256 `6dceccae4b1f49bc7b64b89bd164882c29e57142ef9193d0208ccc1f9d2291ad`
- Never reset, stash, format, stage, or commit those three working-tree edits. Commit their clean `HEAD` content as pure renames while leaving their user edits unstaged at the new paths.
- Use `apply_patch` for authored file edits. Use `git mv` for ordinary clean renames. Scope every commit explicitly; never use `git add .` or `git add -A` in this dirty worktree.
- Every runtime or persisted authored object is an Effect Schema value first. Its type is `Schema.Schema.Type<typeof schema>`; encoded forms use `Schema.Schema.Encoded<typeof schema>`. Do not add a parallel interface or object alias.
- Decode authored and persisted objects with `{ onExcessProperty: "error" }`. Invalid input fails; it is never clamped, case-folded, partially parsed, or silently defaulted.
- New and migrated code follows the approved arrow-function, guard-clause, no-assertion, no-interface, comment, naming, mutation, barrel, and collection rules from the first edit.
- A cutover task does not end with both legacy and replacement consumers. Foundation tasks may prove a replacement behind tests; the named cutover then moves every intended consumer and deletes the superseded path without a compatibility wrapper.
- Before every commit, run the task's focused command, `pnpm typecheck`, and the currently available `pnpm verify`. Record broad-gate failures separately from task-owned failures; do not edit unrelated code to silence them.
- Keep tests beside their owner. Use real temporary directories and public seams. Application tests use `it.effect`; dependency-free hook tests use ordinary Vitest.
- Expected final output is 23 cataloged features, 13 cataloged agents, four agent-format handlers, one runtime edge, one filesystem writer, and exactly three reported protected-baseline exceptions.

---

## Task 1: Install the Effect foundation without changing behavior

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Capture the dependency and behavior baseline**

Run:

```bash
pnpm verify
pnpm list --depth 0
```

Expected: 13 test files and 114 tests pass; Commander, Clack, picocolors, and Vitest 2 remain present before the edit.

- [ ] **Step 2: Install the exact approved application/test versions**

Run:

```bash
pnpm add --save-exact effect@3.22.0 @effect/cli@0.76.0 @effect/platform@0.97.0 @effect/platform-node@0.108.0
pnpm add -D --save-exact @effect/vitest@0.30.0 vitest@3.2.7
```

Do not remove Commander, Clack, or picocolors yet. They remain only until the CLI cutover proves parity.

- [ ] **Step 3: Prove the upgrade did not alter current behavior**

Run:

```bash
pnpm test
pnpm typecheck
pnpm verify
```

Expected: the same 13 files and 114 tests pass under Vitest 3.2.7.

- [ ] **Step 4: Commit the dependency foundation**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(effect): install application foundation"
```

---

## Task 2: Publish the strict human and machine style contract

**Files:**

- Create: `CODE-STYLE.md`
- Create: `code-style.rules.json`
- Create: `scripts/checkCodeStyle.ts`
- Create: `scripts/checkCodeStyle.test.ts`
- Modify: `AGENTS.md`
- Modify: `vitest.config.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Write the prescriptive root guide from the approved design**

Give every enforceable rule one stable ID, grouped under the approved topics. At minimum encode IDs for function form, generator exception, class exception, inputs, blank lines, nesting, loop comments, indexed-access comments, pipeline comments, schema-owned runtime objects, no interfaces/enums/conditional types/assertions/ignore directives, barrels, names, paths, mutation, collection style, Effect runtime boundaries, hook imports, and presentation boundaries.

The guide must show the approved `FeatureDefinition` pattern as executable Effect Schema—not an object type followed by a validator:

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

export type FeatureDefinition =
  Schema.Schema.Type<typeof featureDefinitionSchema>;
```

Do not show a handwritten `Feature` interface, conditional type, or `as const` alternative.

- [ ] **Step 2: Mirror only enforceable rules in JSON**

Use a flat ordered `rules` array. Each entry contains one `id`, one concise `summary`, and an `enforcement` value of `biome`, `ast`, `path`, `importGraph`, or `manual`. Do not put prose-only preferences in the machine file.

- [ ] **Step 3: Replace the stale AGENTS digest**

Make root `CODE-STYLE.md` the style SSOT, point to `code-style.rules.json`, describe the approved capability layout, remove the old pure-core/imperative-shell, interface, barrel-per-folder, flat-hook-payload, and `src/core` guidance, and keep the existing issue-tracker/domain-doc routing. Remove the tracked `<!-- dufflebag:skills -->` block in Task 14 with the generated projections so this commit does not mix content deletion with the contract.

- [ ] **Step 4: Write failing checker fixtures without activating the repo gate**

Extend Vitest and TypeScript coverage to `scripts/**/*.test.ts` and `scripts/**/*.ts`. Fixture tests must prove rule-ID bijection, every AST/path/import rule, exact line/rule reporting, generated-path exclusion, and fail-closed protected-path configuration. Only an anonymous generator directly passed to `Effect.gen` and a `Schema.TaggedError` class may pass their otherwise forbidden forms.

The fixture exception contains exactly the three protected paths. Only `assembleCut.mjs` receives code-rule exemptions for its confirmed function-form, function-input, and loop-comment violations; the two protected Markdown paths are still enumerated in the report but are not AST inputs. Any wildcard, fourth path, or extra exempt rule must fail the checker configuration.

Run:

```bash
pnpm vitest run scripts/checkCodeStyle.test.ts
```

Expected: RED before `checkCodeStyle.ts` exists, then GREEN against isolated fixture repositories. Do not run the checker against the pre-migration repository and do not add `check:style` to `pnpm verify` yet; a broad legacy allowlist is forbidden.

- [ ] **Step 5: Implement the focused checker**

Use the TypeScript compiler AST directly. Export `checkCodeStyle(repositoryRoot)` returning violations and the three protected paths. The checker owns only rules Biome cannot express; it is not a second formatter or general linter. Do not use assertions inside the checker.

- [ ] **Step 6: Validate the contract artifacts**

Run:

```bash
pnpm exec biome check code-style.rules.json
node -e 'JSON.parse(require("node:fs").readFileSync("code-style.rules.json", "utf8"))'
pnpm vitest run scripts/checkCodeStyle.test.ts
pnpm typecheck
pnpm verify
```

Expected: JSON parses, the existing code still passes its baseline gate, and the guide clearly marks the codebase as migrating to its prescriptive target.

- [ ] **Step 7: Commit the contract and dormant checker**

```bash
git add CODE-STYLE.md code-style.rules.json AGENTS.md scripts/checkCodeStyle.ts scripts/checkCodeStyle.test.ts vitest.config.ts tsconfig.json
git commit -m "feat(style): define and test the strict code contract"
```

---

## Task 3: Make managed configuration an Effect Schema contract

**Files:**

- Create: `src/config/bagConfigSchema.ts`
- Create: `src/config/bagConfigSchema.test.ts`

- [ ] **Step 1: Write failing schema behavior tests**

Test the public schema decoder with unknown inputs. Prove:

- `{}` resolves all 11 executable defaults;
- descriptions live on the 11 properties;
- omitted defaulted properties resolve, while unknown properties and invalid provided values fail;
- numeric bounds reject rather than clamp;
- `contextWarnFraction < contextBlockFraction`;
- `autorunDefaultCycleCount <= autorunMaxCycleCount`;
- complete base-10 legacy numeric strings decode;
- legacy booleans accept exactly `"true"` and `"false"`;
- explicitly documented text trimming succeeds;
- case folding, partial numeric input, unknown aliases, and invalid-value fallback fail; and
- JSON encoding writes a complete config object.

Run:

```bash
pnpm vitest run src/config/bagConfigSchema.test.ts
```

Expected: RED because `bagConfigSchema.ts` does not exist. If module resolution prevents assertions from running, add only the export names with deliberately incomplete schemas, rerun, and confirm assertion-level failures.

- [ ] **Step 2: Implement schema-owned config**

Export only the schema, its derived types, its JSON codec, the decoded default, the legacy environment schema, and the one annotation adapter:

```ts
export const bagConfigSchema = Schema.Struct({ /* inline checks, descriptions, defaults */ });
export type BagConfig = Schema.Schema.Type<typeof bagConfigSchema>;
export type EncodedBagConfig = Schema.Schema.Encoded<typeof bagConfigSchema>;
export const bagConfigJsonSchema = Schema.parseJson(bagConfigSchema);
export const defaultBagConfig = Schema.decodeUnknownSync(bagConfigSchema, {
  onExcessProperty: "error",
})({});
export const legacyBagConfigEnvironmentSchema = /* explicit owned keys */;
export const readSchemaDescription = /* schema annotation -> Option<string> */;
```

Keep each property's default, description, check, error message, and legacy representation beside that property. Do not recreate `DEFAULTS`, `BOUNDS`, `ENV_KEYS`, or a description map.

- [ ] **Step 3: Make the focused suite green**

Run:

```bash
pnpm vitest run src/config/bagConfigSchema.test.ts
pnpm typecheck
pnpm verify
```

Expected: the new schema suite and all baseline tests pass.

- [ ] **Step 4: Commit the schema contract**

```bash
git add src/config/bagConfigSchema.ts src/config/bagConfigSchema.test.ts
git commit -m "refactor(config): define schema-owned bag config"
```

---

## Task 4: Replace feature types and parallel registries with one decoded catalog

**Files:**

- Create: `src/catalog/featureCatalog.ts`
- Create: `src/catalog/featureCatalog.test.ts`

- [ ] **Step 1: Write failing catalog tests against unknown input**

Prove all 23 approved feature entries decode in display order; IDs, authored directories, and installed skill IDs are unique; dependencies exist and are acyclic; defaults derive only from `selectedByDefault`; source entrypoints end in `.ts`; generated `.js` paths are absent; `autonomous-loop` maps to source `autorun` and installed skill `autorun`; runtime-only features do not invent skills; exact shipped allowlists are retained; dependency expansion is stable and deduplicated; unknown selections return a tagged error; and excess properties fail.

Run:

```bash
pnpm vitest run src/catalog/featureCatalog.test.ts
```

Expected: RED because the module does not exist.

- [ ] **Step 2: Implement the schema before its type**

The public contract is:

```ts
export const featureIdSchema = /* kebab-case branded string */;
export type FeatureId = Schema.Schema.Type<typeof featureIdSchema>;

export const installedSkillDefinitionSchema = /* none | skill tagged union */;
export const featureRuntimeSchema = /* none | hook tagged union */;
export const featureDefinitionSchema = Schema.Struct({ /* approved shape */ });
export type FeatureDefinition =
  Schema.Schema.Type<typeof featureDefinitionSchema>;

export const featureCatalogSchema = Schema.Array(featureDefinitionSchema).pipe(
  /* uniqueness, dependency, and acyclic checks */
);
export const featureCatalog = Schema.decodeUnknownSync(featureCatalogSchema, {
  onExcessProperty: "error",
})([ /* 23 entries */ ]);
```

Also export `findFeature`, `resolveFeatureSelection`, `selectedFeatureIds`, and `installedSkillsFor`. Use `Option` for lookup absence and `Schema.TaggedError` for `UnknownFeatureError`. Do not create an ID union, record, order list, default list, source map, or package allowlist beside the decoded array.

- [ ] **Step 3: Prove the catalog is the derivation source**

Run:

```bash
pnpm vitest run src/catalog/featureCatalog.test.ts
pnpm typecheck
pnpm verify
```

Expected: 23 entries pass every derivation and invalid-fixture assertion.

- [ ] **Step 4: Commit the feature SSOT**

```bash
git add src/catalog/featureCatalog.ts src/catalog/featureCatalog.test.ts
git commit -m "refactor(catalog): define the feature source of truth"
```

---

## Task 5: Model agent detection and output targets as schema data

**Files:**

- Create: `src/catalog/agentCatalog.ts`
- Create: `src/catalog/agentCatalog.test.ts`

- [ ] **Step 1: Write failing agent-catalog tests**

Prove the existing 13 agents decode in stable order, IDs are unique, detection uses explicit arrays, each entry has exactly one discriminated target, all four target tags are represented, target excess properties fail, Aider and Continue differ by `referenceFormat` rather than ID switches, classification preserves order, and UI names remain human-facing title/Pascal casing.

Run:

```bash
pnpm vitest run src/catalog/agentCatalog.test.ts
```

Expected: RED because the module does not exist.

- [ ] **Step 2: Implement one decoded catalog**

```ts
export const agentIdSchema = /* kebab-case branded string */;
export type AgentId = Schema.Schema.Type<typeof agentIdSchema>;

export const agentDetectionSchema = Schema.Struct({
  homePaths: Schema.Array(Schema.String),
  absolutePaths: Schema.Array(Schema.String),
  commands: Schema.Array(Schema.String),
});

export const agentTargetSchema = Schema.Union(
  /* skillDirectory, ruleFile, instructionFile, configReference */
);
export const agentDefinitionSchema = Schema.Struct({
  id: agentIdSchema,
  displayName: Schema.NonEmptyTrimmedString,
  detection: agentDetectionSchema,
  target: agentTargetSchema,
});
export type AgentDefinition =
  Schema.Schema.Type<typeof agentDefinitionSchema>;
```

Export the decoded `agentCatalog`, `findAgent`, `classifyAgents`, and the schemas/types they genuinely expose. Detection can use official filesystem/command services later; do not introduce a probe service wrapper or one module per agent.

- [ ] **Step 3: Run focused and broad gates**

```bash
pnpm vitest run src/catalog/agentCatalog.test.ts
pnpm typecheck
pnpm verify
```

Expected: 13 agents and four target variants pass.

- [ ] **Step 4: Commit the agent SSOT**

```bash
git add src/catalog/agentCatalog.ts src/catalog/agentCatalog.test.ts
git commit -m "refactor(catalog): model agent targets as schema data"
```

---

## Task 6: Define schema-owned artifact plans and exact receipts

**Files:**

- Create: `src/install/artifactPlan.ts`
- Create: `src/install/artifactPlan.test.ts`
- Create: `src/install/artifactReceipt.ts`
- Create: `src/install/artifactReceipt.test.ts`

- [ ] **Step 1: Write failing decode and reconciliation tests**

Cover a complete plan, duplicate target rejection, parent/child target conflicts, relative-path escape rejection, unknown keys, all artifact kinds, all ownership tags, receipt JSON round trips, desired-vs-receipt update diffs, receipt-only uninstall plans, and legacy manifest migration. Prove detection evidence cannot create a delete operation.

Run:

```bash
pnpm vitest run src/install/artifactPlan.test.ts src/install/artifactReceipt.test.ts
```

Expected: RED because both owners are absent.

- [ ] **Step 2: Implement the persisted schemas and pure planners**

Use tagged schemas for:

- application or agent ownership;
- write, remove, and receipt-publish operations;
- runtime, skill, rule, instruction, config-reference, settings, managed-config, and receipt artifact kinds; and
- `wholeFile`, `managedBlock`, `jsonValues`, and `yamlSequenceValue` ownership metadata.

`wholeFile` records the installed hash plus a tagged missing/prior-file value. `managedBlock` records markers and the installed-body hash. `jsonValues` records exact pointers, installed value hashes, and tagged previous values. `yamlSequenceValue` records the exact key/reference pair and its previous presence. Store previous bytes only where exact restoration requires them; encode them explicitly for JSON.

The main public values are schemas first:

```ts
export const artifactPlanSchema = Schema.Struct({ /* scope, root, operations, receipt */ });
export type ArtifactPlan = Schema.Schema.Type<typeof artifactPlanSchema>;

export const artifactReceiptSchema = Schema.Struct({ /* version, scope, features, artifacts */ });
export type ArtifactReceipt = Schema.Schema.Type<typeof artifactReceiptSchema>;
```

Export pure `validateArtifactPlan`, `createUpdatePlan`, `createUninstallPlan`, and `migrateLegacyManifest`. There is no writer in these files.

- [ ] **Step 3: Make reconciliation tests green**

```bash
pnpm vitest run src/install/artifactPlan.test.ts src/install/artifactReceipt.test.ts
pnpm typecheck
pnpm verify
```

Expected: invalid plans fail before mutation and uninstall operations derive only from decoded receipt entries.

- [ ] **Step 4: Commit plan and receipt contracts**

```bash
git add src/install/artifactPlan.ts src/install/artifactPlan.test.ts src/install/artifactReceipt.ts src/install/artifactReceipt.test.ts
git commit -m "refactor(install): define plans and ownership receipts"
```

---

## Task 7: Build the one transactional filesystem writer

**Files:**

- Create: `src/install/applyArtifactPlan.ts`
- Create: `src/install/applyArtifactPlan.test.ts`

- [ ] **Step 1: Write failing real-filesystem transaction tests**

Use temporary directories and public `applyArtifactPlan`. Cover successful stage/commit/receipt order, receipt committed last, reverse rollback after a middle commit failure, original-byte restoration, cleanup after success/failure, receipt absence after failure, and durable `recovery.json` plus retained snapshots when restoration itself fails.

Use real conflicts or an official platform test layer. Do not add injectable function bags, repository mocks, test-only exports, or conditional test branches.

Run:

```bash
pnpm vitest run src/install/applyArtifactPlan.test.ts
```

Expected: RED because the writer is absent.

- [ ] **Step 2: Implement the ordered pipeline with its required comments**

`applyArtifactPlan` is the only main-application writer. Its body must have the contract comment and numbered phase comments approved in the design:

```ts
/**
 * Applies one validated artifact plan transactionally.
 * A failed stage or commit restores every target before temporary files are removed.
 */
export const applyArtifactPlan = (plan: ArtifactPlan) =>
  Effect.gen(function* () {
    // 1. Assign temporary paths without touching the filesystem.
    // 2. Capture every original target before the first mutation.
    // 3. Write every desired artifact to its temporary path.
    // 4. Move staged artifacts into their final locations.
    // 5. Publish ownership only after every artifact succeeds.
    // 6. Restore originals on failure and always remove disposable staging.
  });
```

Use the official platform filesystem directly. Restore in reverse mutation order. Remove snapshots only after commit or successful rollback. If rollback fails, call `writeRecoveryRecord` before re-raising the rollback failure.

- [ ] **Step 3: Prove transaction safety**

```bash
pnpm vitest run src/install/applyArtifactPlan.test.ts
pnpm typecheck
pnpm verify
```

Expected: every injected real conflict leaves either original bytes or a durable recovery record; a normal failure never leaves `receipt.json`.

- [ ] **Step 4: Commit the writer**

```bash
git add src/install/applyArtifactPlan.ts src/install/applyArtifactPlan.test.ts
git commit -m "refactor(install): apply artifact plans transactionally"
```

---

## Task 8: Read, migrate, and plan managed configuration

**Files:**

- Create: `src/config/configFile.ts`
- Create: `src/config/configFile.test.ts`
- Create: `src/config/configure.ts`
- Create: `src/config/configure.test.ts`

- [ ] **Step 1: Write failing config-file and migration tests**

Cover missing-file `Option.none`, strict complete-file decoding, actionable parse/schema errors, global-first project snapshots, independent later project/global files, complete legacy environment migration, removal of owned keys only after commit, and zero writes for any invalid legacy value or cross-field invariant.

Run:

```bash
pnpm vitest run src/config/configFile.test.ts src/config/configure.test.ts
```

Expected: RED because the capabilities do not exist.

- [ ] **Step 2: Implement read-only inspection and pure plan creation**

`configFile.ts` reads/decodes only. `configure.ts` produces managed-config and legacy-settings operations for `ArtifactPlan`; it does not write. Export schema-derived request/result/error values rather than option bags. Use tagged selection values instead of boolean behavior flags.

The first project install reads the decoded global config when present and otherwise uses `defaultBagConfig`. Later writes target only the chosen scope. Legacy keys remain untouched until their validated config operation commits.

- [ ] **Step 3: Run focused and broad gates**

```bash
pnpm vitest run src/config/configFile.test.ts src/config/configure.test.ts
pnpm typecheck
pnpm verify
```

Expected: malformed or contradictory input yields a tagged error and no target changes.

- [ ] **Step 4: Commit managed config**

```bash
git add src/config/configFile.ts src/config/configFile.test.ts src/config/configure.ts src/config/configure.test.ts
git commit -m "refactor(config): plan managed configuration"
```

---

## Task 9: Replace provider branching with four pure format handlers

**Files:**

- Create: `src/install/agentFormats/skillDirectory.ts`
- Create: `src/install/agentFormats/skillDirectory.test.ts`
- Create: `src/install/agentFormats/ruleFile.ts`
- Create: `src/install/agentFormats/ruleFile.test.ts`
- Create: `src/install/agentFormats/instructionFile.ts`
- Create: `src/install/agentFormats/instructionFile.test.ts`
- Create: `src/install/agentFormats/configReference.ts`
- Create: `src/install/agentFormats/configReference.test.ts`

- [ ] **Step 1: Write one failing public-seam suite per output format**

Cover exact allowlist copying and template substitution for skill directories; frontmatter removal and one file per skill for rule files; idempotent managed-block insertion/replacement/removal while preserving surrounding bytes for instruction files; and Aider YAML versus Continue JSON references selected by the target's `referenceFormat` tag. Every handler must return desired artifacts plus matching ownership metadata without writing.

Run:

```bash
pnpm vitest run src/install/agentFormats
```

Expected: RED because the handlers do not exist.

- [ ] **Step 2: Implement the four target-tag handlers**

Each file owns one format and exports one planning function with one cohesive input object. Dispatch once on `agent.target._tag`; never switch on agent ID. Shared logic may stay in the caller until a second real handler needs it. Do not create `agentFormatHelper.ts`, per-agent modules, writer wrappers, or a barrel chain.

- [ ] **Step 3: Prove all 13 agents route through four formats**

```bash
pnpm vitest run src/install/agentFormats src/catalog/agentCatalog.test.ts
pnpm typecheck
pnpm verify
```

Expected: the catalog exhaustively reaches four handlers and no format function performs I/O.

- [ ] **Step 4: Commit the format boundary**

```bash
git add src/install/agentFormats
git commit -m "refactor(install): plan four native agent formats"
```

---

## Task 10: Implement install, update, and uninstall as plan-driven capabilities

**Files:**

- Create: `src/install/install.ts`
- Create: `src/install/install.test.ts`
- Create: `src/install/update.ts`
- Create: `src/install/update.test.ts`
- Create: `src/install/uninstall.ts`
- Create: `src/install/uninstall.test.ts`
- Modify: `src/doctor.ts` or create it when moving `src/commands/doctor.ts`

- [ ] **Step 1: Write failing end-to-end capability tests**

In real temporary homes/projects, cover first install, repeat install idempotency, update with removed and added features, exact skill allowlists, all four agent targets, complete managed config, byte-preserving settings edits, receipt ownership, legacy manifest migration, uninstall symmetry, user edits outside owned regions, conflict refusal inside owned regions, and absence/no-op behavior. Prove uninstall never removes a detected-but-unreceipted path.

Run:

```bash
pnpm vitest run src/install/install.test.ts src/install/update.test.ts src/install/uninstall.test.ts
```

Expected: RED because the capabilities do not exist.

- [ ] **Step 2: Define request and result schemas at each capability boundary**

Use schema-derived `InstallRequest`, `UpdateRequest`, and `UninstallRequest` values. Represent feature choice, agent choice, and interaction mode with tagged data. A request contains one scope/root value; it does not contain both `global: boolean` and `project: boolean` or other behavior flags.

- [ ] **Step 3: Implement the readable pipelines**

Each capability follows the visible order:

```text
decode request -> inspect current state -> resolve catalog -> create plan -> validate plan -> apply plan -> return result
```

Use `Effect.gen` only for dependent effects. Keep planning pure. `install.ts`, `update.ts`, `uninstall.ts`, and `configure.ts` may invoke `applyArtifactPlan`; nothing else writes application files.

- [ ] **Step 4: Move doctor to receipt/catalog evidence**

Make `src/doctor.ts` read decoded config, receipt, catalog, platform, staged runtime, and agent detection. Diagnostic detection can report discrepancies but cannot authorize repair or deletion.

- [ ] **Step 5: Prove the replacement is ready for the CLI cutover**

At this foundation boundary, the existing CLI still reaches the legacy path so its characterization behavior remains green. Do not add a compatibility wrapper or make a second production runtime edge. Task 11 atomically moves the CLI consumers and deletes the old tree.

- [ ] **Step 6: Prove vertical parity**

```bash
pnpm vitest run src/install src/config src/catalog src/doctor.test.ts
pnpm typecheck
pnpm verify
```

Expected: the new install/update/uninstall/configure tests all reach one writer and receipt-only uninstall passes; the unchanged legacy CLI characterization still passes until the next cutover.

- [ ] **Step 7: Commit the capability cutover**

```bash
git add src/install src/config src/catalog src/doctor.ts src/doctor.test.ts
git commit -m "refactor(install): reconcile capabilities through receipts"
```

---

## Task 11: Replace Commander and Clack with one Effect CLI edge

**Files:**

- Create: `src/cli/main.ts`
- Create: `src/cli/main.test.ts`
- Create: `src/cli/TerminalUI.ts`
- Create: `src/cli/TerminalUI.test.ts`
- Create: `src/cli/installCommand.ts`
- Create: `src/cli/updateCommand.ts`
- Create: `src/cli/uninstallCommand.ts`
- Create: `src/cli/configCommand.ts`
- Create: `src/cli/doctorCommand.ts`
- Create: `src/cli/scaffoldWorkflowsCommand.ts`
- Move behavior from: `src/commands/scaffoldCi.ts` to `src/scaffoldWorkflows.ts`
- Move tests from: `src/commands/scaffoldCi.test.ts` to `src/scaffoldWorkflows.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Delete: `src/cli.ts`
- Delete: `src/commands/`
- Delete after last consumer: `src/core/`

- [ ] **Step 1: Write failing CLI-boundary tests**

Cover explicit install/update/uninstall/config/doctor/`dedup check`/`scaffold-ci` commands, one mutually exclusive scope option, request-schema decoding, bare TTY menu routing to the same requests, non-TTY bare invocation that exits without prompting/hanging, cancellation, help text sourced from schema descriptions, one rendering of expected errors, and retained unexpected causes. `scaffoldWorkflowsCommand.ts` keeps the existing public command spelling `scaffold-ci`.

Spawn the built CLI for process/no-hang assertions. Use official Effect test services for application effects; do not export internals or add a fake UI service.

- [ ] **Step 2: Implement `TerminalUI` as the presentation owner**

The PascalCase module owns prompts, progress, success, warnings, and typed error presentation using official Effect/CLI facilities. Domain modules never print. `TerminalUI` is not a class, `Context.Tag`, or pass-through logger wrapper; its functions translate terminal interactions into decoded request data and application results into human output.

- [ ] **Step 3: Build the command tree and single runtime edge**

Use `@effect/cli` options/arguments for parsing and help. Decode every command request through its Effect Schema before invoking a capability. `src/cli/main.ts` contains the only main-package calls to `NodeRuntime.runMain` and `NodeContext.layer`. No other main application file calls `Effect.run*`.

- [ ] **Step 4: Remove the superseded CLI stack**

Update the bin to `dist/src/cli/main.js`, update `pnpm cli`, remove Commander, Clack, and picocolors from dependencies, and delete `src/cli.ts`, `src/commands/`, and the remaining `src/core/` owners only after every consumer imports the new capability path directly. Move any still-valid platform, dedup-check, and workflow-scaffolding behavior to its named owner; leave no compatibility exports or empty barrels.

Run:

```bash
pnpm remove commander @clack/prompts picocolors
pnpm vitest run src/cli src/scaffoldWorkflows.test.ts
pnpm typecheck
pnpm verify
```

Expected: explicit commands and bare-menu requests reach identical capabilities; no removed package remains in `pnpm list --depth 0`.

- [ ] **Step 5: Commit the CLI cutover**

```bash
git add package.json pnpm-lock.yaml src/cli src/scaffoldWorkflows.ts src/scaffoldWorkflows.test.ts src/doctor.ts src/install src/config src/catalog
git add -u src/cli.ts src/commands src/core
git commit -m "refactor(cli): move the application edge to Effect"
```

---

## Task 12: Build fail-closed staging and packed verifiers behind fixtures

**Files:**

- Create: `scripts/buildPackage.ts`
- Create: `scripts/buildPackage.test.ts`
- Create: `scripts/verifyShipping.ts`
- Create: `scripts/verifyShipping.test.ts`
- Create: `scripts/smokeHooks.ts`
- Create: `scripts/smokeHooks.test.ts`
- Move/rewrite: `src/scripts/generateReadme.mjs` to `scripts/generateReadme.mjs`
- Move tests: `src/scripts/generateReadme.test.ts` to `scripts/generateReadme.test.ts`
- Modify: `package.json` only for the moved README script/test surface
- Modify: `.github/workflows/readme-sync.yml`

- [ ] **Step 1: Write failing build-boundary fixture tests**

Against isolated temporary repositories, cover decoded catalog input, missing sources, extra or uncataloged runtime entrypoints, duplicate destinations, exact skill allowlists, the intact png-to-code nested package, nested runtime paths, `.ts` to `.js` mapping, preserved imports, package-tree comparison, byte comparison (including the three protected files), and packed-entrypoint smoke behavior.

Run:

```bash
pnpm vitest run scripts/buildPackage.test.ts scripts/verifyShipping.test.ts scripts/smokeHooks.test.ts scripts/generateReadme.test.ts
```

Expected: RED because the root build owners do not exist.

- [ ] **Step 2: Implement the public build and verification functions**

`buildPackage` accepts one request containing repository root, output directory, and the decoded feature catalog. It validates every declared source, stages only `installedSkill.shippedPaths`, preserves the reachable runtime tree under `dist/runtime/<sourceDirectory>/`, changes only the emitted extension, performs no import rewriting, and rejects any undeclared executable.

`verifyShipping` creates a real tarball in a temporary directory and compares decoded catalog → source allowlists → staged tree → tarball paths and bytes. `smokePackedHooks` unpacks a real tarball, isolates `HOME`, writes one complete Schema-encoded config, passes `{}` on stdin, enforces a short timeout, and runs every unique catalog entrypoint.

- [ ] **Step 3: Move README generation to decoded catalog data**

The root generator imports decoded catalog data through `tsx`; it never regex-parses TypeScript or scans home-directory skill roots. Update the `generate-readme` script and README-sync workflow paths/command now. Do not activate the new build, shipping, smoke, or style commands against the still-kebab-case repository in this foundation task.

- [ ] **Step 4: Prove the builders with fixtures while the current package build stays green**

```bash
pnpm vitest run scripts
pnpm generate-readme
pnpm typecheck
pnpm verify
```

Expected: fixture tests pass, README regeneration is deterministic, and the unchanged current package build remains green. No broad migration allowlist exists.

- [ ] **Step 5: Commit the dormant shipping boundary**

```bash
git add scripts package.json README.md .github/workflows/readme-sync.yml
git add -u src/scripts/generateReadme.mjs src/scripts/generateReadme.test.ts
git commit -m "build: define catalog-closed package verification"
```

---

## Task 13: Atomically rehome skills, isolate hooks, and cut package shipping over

**Files:**

- Create: `src/runtime/readConfig.ts`
- Create: `src/runtime/readConfig.test.ts`
- Create: `src/runtime/readHookInput.ts`
- Create: `src/runtime/readHookInput.test.ts`
- Move: all 20 skill directories whose approved authored name differs
- Migrate: every catalog-declared hook entrypoint and reachable feature-local runtime module
- Delete: `src/payload/config.ts`
- Delete: `src/payload/io.ts`
- Delete: `src/scripts/assembleHooks.mjs`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: source-path links and catalog consumers

- [ ] **Step 1: Write failing plain-Node runtime tests before moving sources**

Encode config with `bagConfigSchema`, write it beside a temporary installed runtime, and exercise the shared readers plus every hook entrypoint. Cover exact transport keys, malformed/missing input, missing/unreadable config fail-open behavior, one concise warning maximum, and the absence of semantic defaults, bounds, descriptions, clamping, and legacy aliases in the runtime graph.

- [ ] **Step 2: Consolidate catalog runtime entrypoints**

The singular `runtime.sourceEntrypoint` is the executable authority for each runtime feature:

- consolidate `ctxWatchSpawn.ts` and `ctxLoopCtl.ts` into one `autorun` entrypoint that accepts SessionStart transport and the `arm`/`stop`/`exit` verbs; keep watcher logic as a statically imported internal module;
- consolidate Claude/Cursor dedup transport into one `dedupGuard` entrypoint, or remove the obsolete Cursor executable when the new agent-format registration makes it unnecessary; and
- retain one real entrypoint each for context guard and speech.

An empty `{}` input must exit safely. Files reachable from these entrypoints import only `node:*`, `src/runtime/**`, or their own feature runtime subtree.

- [ ] **Step 3: Rename the 19 clean/migration-owned directories with history**

Use `git mv` for every mapping except `make-a-trailer` → `makeATrailer`. Three source names (`autorun`, `deslop`, and `planpage`) already conform and do not move. Update authored links and catalog-path consumers; public feature IDs, installed skill IDs, and flags remain hyphenated data.

- [ ] **Step 4: Stage a baseline-only `makeATrailer` rename**

Create a pure rename patch from a disposable clean worktree at the current `HEAD`:

```bash
git worktree add --detach /tmp/dufflebag-rename HEAD
cd /tmp/dufflebag-rename
git mv src/skills/make-a-trailer src/skills/makeATrailer
git diff --cached --binary --find-renames=100% > /tmp/makeATrailer-rename.patch
cd -
git worktree remove /tmp/dufflebag-rename
mv src/skills/make-a-trailer src/skills/makeATrailer
git apply --cached /tmp/makeATrailer-rename.patch
```

The redirection creates only a disposable patch. Verify the three new working paths still match the protected SHA-256 values. The index blobs for those paths must equal the old committed blobs.

- [ ] **Step 5: Activate catalog-closed build, tarball verification, and smoke tests**

Change `package.json#files` to exactly `dist`, `templates`, `README.md`, and `LICENSE`—never `src/skills`. Installation reads only staged `dist/skills` and `dist/runtime`. Wire:

```text
build -> TypeScript emit, then scripts/buildPackage.ts
verify:shipping -> scripts/verifyShipping.ts
smoke:hooks -> scripts/smokeHooks.ts
```

Keep `check:style` dormant until Task 15. Replace the flat assembler completely; no output import rewrite or `dist/hooks` remains.

At this cutover, `verify` runs Biome → typecheck → tests → build → shipping verification → hook smoke. Task 15 inserts the contract checker between typecheck and tests once the full authored tree conforms.

- [ ] **Step 6: Prove source, stage, tarball, and runtime agree**

```bash
pnpm vitest run src/runtime scripts
pnpm build
pnpm verify:shipping
pnpm smoke:hooks
pnpm typecheck
pnpm verify
git diff --cached --summary --find-renames=100%
git diff --cached -- src/skills/makeATrailer/SKILL.md src/skills/makeATrailer/reference/pipeline.md src/skills/makeATrailer/scripts/assembleCut.mjs
git status --short
```

Expected: 23 cataloged features stage exact allowlists; every packed entrypoint runs; no `dist/src/skills`, raw hook TypeScript, `dist/hooks`, or rewritten import ships; protected cached paths are pure renames with their user hunks still unstaged.

- [ ] **Step 7: Commit the atomic shipping cutover**

Stage migration-owned paths explicitly. Any pathspec that includes `src/skills` must exclude the three protected new paths; their clean baseline rename is already in the index from Step 4.

```bash
git add package.json tsconfig.json src/runtime src/catalog src/install scripts
git add src/skills \
  ':(exclude)src/skills/makeATrailer/SKILL.md' \
  ':(exclude)src/skills/makeATrailer/reference/pipeline.md' \
  ':(exclude)src/skills/makeATrailer/scripts/assembleCut.mjs'
git add -u src/payload src/scripts/assembleHooks.mjs
git commit -m "refactor(runtime): ship cataloged skills and nested hooks"
```

After commit, rerun all three hashes and `git status --short`. Expected: only the three protected new paths remain modified.

---

## Task 14: Remove tracked provider projections and prove the lean tree

**Files:**

- Delete: tracked `.agents/**`, `.cursor/**`, and `.devin/**` projections
- Modify: `.gitignore`
- Modify: `AGENTS.md`

- [ ] **Step 1: Remove generated source projections**

Remove the 83 tracked provider files, ignore future generated projections, and remove the `<!-- dufflebag:skills -->` block from root `AGENTS.md` while preserving human repository guidance. Consuming repositories may still receive generated local outputs through the four agent formats.

- [ ] **Step 2: Prove the target tree and imports**

```bash
test ! -d src/core
test ! -d src/commands
test ! -d src/payload
test "$(git ls-files '.agents/**' '.cursor/**' '.devin/**' | wc -l | tr -d ' ')" = "0"
rg -n 'src/(core|commands|payload)|dist/hooks|from ["\x27](commander|@clack/prompts|picocolors)["\x27]' src scripts package.json tsconfig.json
pnpm typecheck
pnpm verify
```

Expected: no legacy application layer, removed dependency, flat hook output, or tracked provider source remains.

- [ ] **Step 3: Commit only generated-source cleanup**

```bash
git add .gitignore AGENTS.md
git add -u .agents .cursor .devin
git commit -m "chore: stop tracking generated provider projections"
```

Recheck the three protected hashes and confirm they remain the only dirty files.

---

## Task 15: Enforce the contract with Biome and a focused AST checker

**Files:**

- Modify: `biome.json`
- Modify: `scripts/checkCodeStyle.ts`
- Modify: `scripts/checkCodeStyle.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify as reported: all maintained TypeScript/JavaScript/JSON sources except protected `assembleCut.mjs`

- [ ] **Step 1: Re-run the dormant fixtures, then capture the real migration failure**

Test one focused fixture per machine rule: function declarations, disallowed generators/classes/interfaces/enums/conditional types/assertions/directives, too many raw parameters, missing blank lines, loop comments, indexed non-null proof comments, ordered-pipeline comments, barrels, vague/bucket names, path casing, forbidden imports, input mutation, reducer builders, `Effect.run*`, application `console.*`, and hook import edges. Prove guide IDs and JSON IDs are a bijection.

Test the exception contract separately: exactly the three new `makeATrailer` paths are reported as protected. Only `assembleCut.mjs` has code-rule exemptions, limited to its confirmed function-form, function-input, and loop-comment violations. Wildcards, a fourth path, or an additional exempt rule fail closed.

Run:

```bash
pnpm vitest run scripts/checkCodeStyle.test.ts
pnpm tsx scripts/checkCodeStyle.ts
```

Expected: fixture tests stay GREEN; the direct repository check is RED with the complete migration-owned violation list. Save that output as the worklist, not as a baseline allowlist.

- [ ] **Step 2: Expand Biome to every maintained supported file**

Set 2-space indentation, double quotes, semicolons, trailing commas, 120 columns, organized imports, and coverage for maintained TS, TSX, JS, MJS, JSON, and JSONC in the main package, root scripts, and png-to-code harness. Exclude generated output. Exclude only the exact protected `src/skills/makeATrailer/scripts/assembleCut.mjs` from Biome; the two protected Markdown files are outside Biome's code surface and need no formatter exemption.

- [ ] **Step 3: Implement the narrow checker using the TypeScript AST**

Tighten the already fixture-tested checker as real migration cases reveal gaps. It reads `code-style.rules.json`, walks authored sources, enforces only the rules Biome cannot express, and reports file/line/rule ID. It is not a second general linter. Use TypeScript's public node guards; do not use assertions or add an AST wrapper layer.

- [ ] **Step 4: Deslop every reported maintained violation**

Fix causes, not checker rules. Prefer removing wrappers, renaming owners, flattening branches, deriving schema types, and moving declarations before use. Add one short intent comment above every explicit loop, a proof comment above every indexed non-null access, and contract/numbered comments only on real ordered pipelines. Do not add ceremonial comments to silence the gate.

- [ ] **Step 5: Wire and run the complete style sequence**

Add `check:style` and make `verify` run exactly Biome → typecheck → checker → tests → build → shipping verification → hook smoke. Update the real CI gate to run `pnpm verify` (or required jobs with exactly the same coverage) so the GitHub `CI Gate` cannot pass while the new stages are skipped.

```bash
pnpm exec biome check --write .
pnpm check:style
pnpm vitest run scripts/checkCodeStyle.test.ts
pnpm typecheck
pnpm verify
```

Expected: Biome and the checker pass; the checker prints exactly three named protected exceptions and zero unprotected violations.

- [ ] **Step 6: Commit enforcement and cleanup**

```bash
git add biome.json code-style.rules.json package.json .github/workflows/ci.yml scripts/checkCodeStyle.ts scripts/checkCodeStyle.test.ts scripts
git add src \
  ':(exclude)src/skills/makeATrailer/SKILL.md' \
  ':(exclude)src/skills/makeATrailer/reference/pipeline.md' \
  ':(exclude)src/skills/makeATrailer/scripts/assembleCut.mjs'
git commit -m "refactor(style): enforce the readable code contract"
```

Confirm the protected files were excluded and remain unstaged with the same hashes.

---

## Task 16: Align project docs, ADRs, templates, and teaching material

**Files:**

- Modify: `README.md`
- Modify: `PROJECT.md`
- Modify: `CONTEXT.md`
- Modify: `LANGUAGE.md`
- Create: `TEACH.md`
- Modify: `AGENTS.md`
- Modify: `templates/mdFiles/CODE-STYLE.md`
- Modify: `templates/mdFiles/code-style.rules.json`
- Modify: `templates/mdFiles/PROJECT.md`
- Create: `scripts/documentation.test.ts`
- Create: `docs/adr/current/0016-strict-readable-code-contract.md`
- Create: `docs/adr/current/0017-effect-application-and-capability-layout.md`
- Create: `docs/adr/current/0018-schema-owned-managed-config.md`
- Create: `docs/adr/current/0019-transactional-artifact-reconciliation.md`
- Create: `docs/adr/current/0020-cataloged-shipping-and-preserved-runtime-tree.md`
- Annotate only: ADRs `0003`, `0004`, `0006`, `0008`, `0010`, `0011`, `0012`, `0013`, `0014`, `0015`

- [ ] **Step 1: Write failing documentation-contract tests**

Prove README generation order equals the decoded catalog, a second generation is a no-op, root docs link root `CODE-STYLE.md` rather than the generic scaffold, the managed skills block is absent, provider projections are untracked, all required ADR files/links exist, historical bodies below their status headers are unchanged, templates contain no dufflebag-specific names or paths, and `TEACH.md` contains all six decisions plus one deduplicated glossary definition per term.

Run:

```bash
pnpm vitest run scripts/generateReadme.test.ts scripts/documentation.test.ts
```

Expected: RED against the stale documentation set.

- [ ] **Step 2: Write the current root project model**

Make root `PROJECT.md` complete rather than a template pointer. Make `CONTEXT.md` explain inspect/plan/apply/receipt/recovery and runtime/shipping boundaries. Make `LANGUAGE.md` own approved terms, abbreviations, public IDs, and authored naming. Keep `AGENTS.md` short and operational.

- [ ] **Step 3: Write `TEACH.md` in the required decision format**

Use these exact six decision headings:

1. Why dufflebag stays one npm package — not a pnpm monorepo
2. Why Effect owns application workflow — not raw Promises/thrown errors/custom services
3. Why Effect Schema owns configuration — not handwritten validators/descriptor tables/conditional types
4. Why `@effect/cli` replaces Commander and Clack
5. Why Biome is paired with a focused TypeScript AST checker
6. Why installed hooks remain a plain-Node island

For each, follow `src/skills/grillMeStack/TEACH-FORMAT.md`: lean decision, quick comparison, one small relevant snippet where useful, official primary links, and a deduplicated self-closing glossary. Explicitly teach that `FeatureDefinition` and other runtime data are schema-derived, not handwritten objects plus validators.

- [ ] **Step 4: Make scaffold templates genuinely generic**

Remove dufflebag names, Effect-specific mandates, repo paths, migration history, and agent-specific assumptions from `templates/mdFiles/**`. Preserve useful placeholders and explain how a new repository chooses its own rules. Root docs remain specific to dufflebag.

- [ ] **Step 5: Record the five decisions without rewriting history**

Create ADRs 0016–0020 with context, decision, consequences, and supersession links from the design. Add status/supersession annotations only to the ten historical ADRs; leave their bodies unchanged. ADR 0006 points to 0017 because its Commander/Clack/picocolors dependency choice is replaced by the approved Effect CLI stack.

- [ ] **Step 6: Regenerate public catalog output and verify docs**

```bash
pnpm generate-readme
pnpm vitest run scripts/generateReadme.test.ts scripts/documentation.test.ts
pnpm exec biome check README.md PROJECT.md CONTEXT.md LANGUAGE.md TEACH.md AGENTS.md templates/mdFiles docs/adr/current
git diff --check
pnpm verify
```

If Biome does not process Markdown, its no-files result is advisory; `git diff --check`, catalog generation tests, JSON parsing, and link/path review are the Markdown gates.

- [ ] **Step 7: Commit documentation alignment**

```bash
git add README.md PROJECT.md CONTEXT.md LANGUAGE.md TEACH.md AGENTS.md templates/mdFiles docs/adr/current scripts/documentation.test.ts
git commit -m "docs: align the repository with the Effect architecture"
```

---

## Task 17: Prove the refactor from source through packed execution

**Files:**

- Modify only if a failing regression identifies a real owner
- Verify: entire repository and packed tarball

- [ ] **Step 1: Recheck protected user work**

Run SHA-256 on the three `src/skills/makeATrailer/**` files and compare to Global Constraints. Run `git diff --` for those paths and verify the user hunks remain unstaged. Do not proceed if any byte differs unexpectedly.

- [ ] **Step 2: Run focused architecture searches**

```bash
rg -n '\b(interface|enum)\b|\bas\s+(const|unknown|[A-Z_a-z])|@ts-(ignore|expect-error)|Effect\.run' src scripts --glob '*.{ts,tsx,js,mjs}'
rg -n 'from ["\x27](commander|@clack/prompts|picocolors)["\x27]' src scripts
rg -n 'src/(core|commands|payload)|function [A-Za-z_$]|class [A-Za-z_$]' src scripts --glob '*.{ts,tsx,js,mjs}'
```

Expected: no maintained application violations; only exact protected-path findings already reported by the contract checker or permitted `Effect.gen(function* ()` / `Schema.TaggedError` forms.

- [ ] **Step 3: Run the exact final gate from a clean index**

```bash
pnpm verify
```

Expected order and result:

```text
Biome PASS
Typecheck PASS
Contract checker PASS (3 exact protected exceptions reported)
Vitest PASS
Build PASS
Shipping verification PASS
Hook smoke PASS
```

- [ ] **Step 4: Inspect the packed artifact**

```bash
pnpm pack --pack-destination /tmp/dufflebag-pack
npm pack --dry-run --json
```

Expected: no authored `src/skills`, no provider projections, no test/build-only files, all catalog allowlists present under `dist/skills`, and every declared runtime entrypoint under `dist/runtime`.

- [ ] **Step 5: Run an independent code/style review**

Use `superpowers:requesting-code-review` plus the repo's code-style review workflow against the complete commit range from `946971a` to `HEAD`. Review schema/type SSOT, transaction safety, receipt deletion authority, non-TTY behavior, hook isolation, shipping closure, wrapper/name/body noise, docs accuracy, and protected-file preservation. Fix every confirmed blocker with a failing regression first.

- [ ] **Step 6: Verify again after review fixes**

Run `pnpm verify`, packed verification, protected hashes, `git diff --check`, and `git status --short` again. Expected: all gates pass and only the three protected user files are modified.

- [ ] **Step 7: Commit any review-owned regression fixes**

Use one narrow commit per confirmed issue. Do not fold user-owned make-a-trailer changes into refactor commits.

- [ ] **Step 8: Hand off the completed branch state**

Report commit list, exact test/build counts, packed-content result, three protected paths/hashes, remaining worktree status, and any remote/publish step not explicitly authorized. Do not claim completion from an earlier run; cite the final command outputs.
