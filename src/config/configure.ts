import path from "node:path";
import { Option, Schema, type SchemaAST } from "effect";
import {
  type ArtifactObservation,
  artifactObservationSchema,
  artifactObservationsEqual,
  currentSnapshotMatches,
} from "../install/artifactMaterialization.js";
import { artifactPlanSchema, createUpdatePlan, validateArtifactPlan } from "../install/artifactPlan.js";
import {
  type ArtifactReceipt,
  artifactReceiptJsonSchema,
  artifactReceiptSchema,
  type JsonValue,
  jsonValueSchema,
  type OwnedArtifact,
  ownedArtifactSchema,
  sha256Bytes,
} from "../install/artifactReceipt.js";
import { bagConfigJsonSchema, bagConfigSchema, defaultBagConfig, legacyBagConfigEnvironmentSchema } from "./bagConfigSchema.js";
import { type ConfigFileSnapshot, configFileSnapshotSchema } from "./configFile.js";

const strictParseOptions = {
  onExcessProperty: "error",
} satisfies SchemaAST.ParseOptions;

const managedConfigPath = ".claude/dufflebag/config.json";
const managedSettingsPath = ".claude/settings.json";
const managedReceiptPath = ".claude/dufflebag/receipt.json";

const completeBagConfigSchema = Schema.typeSchema(bagConfigSchema);
const bagConfigsEquivalent = Schema.equivalence(completeBagConfigSchema);

const isNormalizedAbsoluteRoot = (root: string): boolean => {
  return (
    path.isAbsolute(root) &&
    path.normalize(root) === root &&
    !root.includes("\0") &&
    (root === path.parse(root).root || !root.endsWith(path.sep))
  );
};

const normalizedAbsoluteRootSchema = Schema.String.pipe(
  Schema.filter(isNormalizedAbsoluteRoot, {
    message: () => "Configuration roots must be absolute and byte-equal to native normalization.",
  }),
);

const missingSnapshotSchema = Schema.TaggedStruct("missing", {}).annotations({
  parseOptions: strictParseOptions,
});

const configSnapshotSchema = Schema.TaggedStruct("file", {
  file: configFileSnapshotSchema,
}).annotations({
  parseOptions: strictParseOptions,
});

export const managedConfigSnapshotSchema = Schema.Union(missingSnapshotSchema, configSnapshotSchema);

export type ManagedConfigSnapshot = Schema.Schema.Type<typeof managedConfigSnapshotSchema>;

const settingsSnapshotSchema = Schema.TaggedStruct("file", {
  bytes: Schema.Uint8ArrayFromSelf,
}).annotations({
  parseOptions: strictParseOptions,
});

export const managedSettingsSnapshotSchema = Schema.Union(missingSnapshotSchema, settingsSnapshotSchema);

export type ManagedSettingsSnapshot = Schema.Schema.Type<typeof managedSettingsSnapshotSchema>;

const receiptSnapshotSchema = Schema.TaggedStruct("file", {
  bytes: Schema.Uint8ArrayFromSelf,
}).annotations({
  parseOptions: strictParseOptions,
});

export const managedReceiptSnapshotSchema = Schema.Union(missingSnapshotSchema, receiptSnapshotSchema);

export type ManagedReceiptSnapshot = Schema.Schema.Type<typeof managedReceiptSnapshotSchema>;

const unreadGlobalSnapshotSchema = Schema.TaggedStruct("notRead", {}).annotations({
  parseOptions: strictParseOptions,
});

export const managedGlobalSnapshotSchema = Schema.Union(unreadGlobalSnapshotSchema, missingSnapshotSchema, configSnapshotSchema);

export type ManagedGlobalSnapshot = Schema.Schema.Type<typeof managedGlobalSnapshotSchema>;

const resolveSelectionSchema = Schema.TaggedStruct("resolve", {}).annotations({
  parseOptions: strictParseOptions,
});

const replaceSelectionSchema = Schema.TaggedStruct("replace", {
  config: completeBagConfigSchema,
}).annotations({
  parseOptions: strictParseOptions,
});

export const managedConfigurationSelectionSchema = Schema.Union(resolveSelectionSchema, replaceSelectionSchema);

export type ManagedConfigurationSelection = Schema.Schema.Type<typeof managedConfigurationSelectionSchema>;

export const managedConfigurationRequestSchema = Schema.Struct({
  scope: Schema.Literal("global", "project"),
  root: normalizedAbsoluteRootSchema,
  installerVersion: Schema.NonEmptyTrimmedString,
  selection: managedConfigurationSelectionSchema,
  targetConfig: managedConfigSnapshotSchema,
  settings: managedSettingsSnapshotSchema,
  receipt: managedReceiptSnapshotSchema,
  receiptArtifactObservations: Schema.Array(Schema.typeSchema(artifactObservationSchema)),
  globalSnapshot: managedGlobalSnapshotSchema,
}).annotations({
  parseOptions: strictParseOptions,
});

export type ManagedConfigurationRequest = Schema.Schema.Type<typeof managedConfigurationRequestSchema>;

export const managedConfigurationSourceSchema = Schema.Union(
  Schema.TaggedStruct("target", {}),
  Schema.TaggedStruct("legacy", {}),
  Schema.TaggedStruct("globalSnapshot", {}),
  Schema.TaggedStruct("defaults", {}),
  Schema.TaggedStruct("replacement", {}),
);

export type ManagedConfigurationSource = Schema.Schema.Type<typeof managedConfigurationSourceSchema>;

const globalSnapshotRequiredSchema = Schema.TaggedStruct("globalSnapshotRequired", {
  path: Schema.Literal(managedConfigPath),
}).annotations({
  parseOptions: strictParseOptions,
});

const managedConfigurationPlannedSchema = Schema.TaggedStruct("planned", {
  source: managedConfigurationSourceSchema,
  config: completeBagConfigSchema,
  plan: artifactPlanSchema,
}).annotations({
  parseOptions: strictParseOptions,
});

export const managedConfigurationResultSchema = Schema.Union(globalSnapshotRequiredSchema, managedConfigurationPlannedSchema);

export type ManagedConfigurationResult = Schema.Schema.Type<typeof managedConfigurationResultSchema>;

const managedConfigurationErrorCodeSchema = Schema.Literal(
  "invalid-request",
  "target-invalid",
  "settings-invalid",
  "legacy-invalid",
  "receipt-invalid",
  "source-conflict",
  "ownership-conflict",
  "global-snapshot-invalid",
  "global-snapshot-unexpected",
  "artifact-plan-invalid",
);

export class ManagedConfigurationError extends Schema.TaggedError<ManagedConfigurationError>()("ManagedConfigurationError", {
  code: managedConfigurationErrorCodeSchema,
  message: Schema.String,
  cause: Schema.Defect,
}) {}

const managedConfigurationFailureSchema = Schema.Struct({
  code: managedConfigurationErrorCodeSchema,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}).annotations({
  parseOptions: strictParseOptions,
});

type ManagedConfigurationFailure = Schema.Schema.Type<typeof managedConfigurationFailureSchema>;

const failManagedConfiguration = ({ code, message, cause }: ManagedConfigurationFailure): never => {
  throw new ManagedConfigurationError({ code, message, cause: cause ?? message });
};

const decodeRequest = (input: unknown): ManagedConfigurationRequest => {
  try {
    return Schema.decodeUnknownSync(managedConfigurationRequestSchema, strictParseOptions)(input);
  } catch (cause) {
    return failManagedConfiguration({
      code: "invalid-request",
      message: "Managed configuration input does not match the strict request contract.",
      cause,
    });
  }
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  return Buffer.from(left).equals(Buffer.from(right));
};

const compareStrings = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
};

const decodeUtf8 = (
  raw: Uint8Array,
  code: "target-invalid" | "settings-invalid" | "receipt-invalid" | "global-snapshot-invalid",
): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch (cause) {
    return failManagedConfiguration({ code, message: "The inspected configuration snapshot is not valid UTF-8.", cause });
  }
};

const decodeJson = (raw: Uint8Array, code: "target-invalid" | "settings-invalid" | "global-snapshot-invalid"): unknown => {
  const content = decodeUtf8(raw, code);

  try {
    return JSON.parse(content);
  } catch (cause) {
    return failManagedConfiguration({ code, message: "The inspected configuration snapshot is not valid JSON.", cause });
  }
};

const validateConfigSnapshot = (snapshot: ConfigFileSnapshot, code: "target-invalid" | "global-snapshot-invalid"): ConfigFileSnapshot => {
  try {
    const decoded = Schema.decodeUnknownSync(completeBagConfigSchema, strictParseOptions)(decodeJson(snapshot.bytes, code));
    if (!bagConfigsEquivalent(decoded, snapshot.config)) {
      return failManagedConfiguration({ code, message: "Decoded configuration does not match its exact raw snapshot." });
    }

    return snapshot;
  } catch (cause) {
    if (cause instanceof ManagedConfigurationError) {
      throw cause;
    }

    return failManagedConfiguration({
      code,
      message: "The inspected file must contain all 11 managed configuration keys.",
      cause,
    });
  }
};

const isJsonArray = (value: unknown): value is ReadonlyArray<JsonValue> => {
  return Array.isArray(value);
};

const isJsonObject = (value: unknown): value is Readonly<Record<string, JsonValue>> => {
  return value !== null && typeof value === "object" && !isJsonArray(value);
};

const legacyEnvironmentDefaults = Schema.encodeSync(legacyBagConfigEnvironmentSchema)(defaultBagConfig);
const ownedLegacyEntries = Object.entries(legacyEnvironmentDefaults);

const legacySettingEntrySchema = Schema.Struct({
  key: Schema.String,
  pointer: Schema.String,
  value: Schema.String,
}).annotations({
  parseOptions: strictParseOptions,
});

const settingsInspectionSchema = Schema.Struct({
  document: jsonValueSchema,
  legacyEntries: Schema.Array(legacySettingEntrySchema),
  legacyConfig: Schema.OptionFromSelf(completeBagConfigSchema),
}).annotations({
  parseOptions: strictParseOptions,
});

type SettingsInspection = Schema.Schema.Type<typeof settingsInspectionSchema>;

const receiptAuthorityCheckSchema = Schema.Struct({
  receipt: Schema.OptionFromSelf(Schema.typeSchema(artifactReceiptSchema)),
  observations: Schema.Array(Schema.typeSchema(artifactObservationSchema)),
  targetObservation: Schema.typeSchema(artifactObservationSchema),
  settingsObservation: Schema.typeSchema(artifactObservationSchema),
});

type ReceiptAuthorityCheck = Schema.Schema.Type<typeof receiptAuthorityCheckSchema>;

const configArtifactRequestSchema = Schema.Struct({
  configBytes: Schema.Uint8ArrayFromSelf,
  targetConfig: Schema.typeSchema(managedConfigSnapshotSchema),
  previous: Schema.OptionFromSelf(Schema.typeSchema(ownedArtifactSchema)),
});

type ConfigArtifactRequest = Schema.Schema.Type<typeof configArtifactRequestSchema>;

const desiredArtifactsRequestSchema = Schema.Struct({
  receipt: Schema.OptionFromSelf(Schema.typeSchema(artifactReceiptSchema)),
  configArtifact: Schema.typeSchema(ownedArtifactSchema),
  settingsArtifact: Schema.OptionFromSelf(Schema.typeSchema(ownedArtifactSchema)),
});

type DesiredArtifactsRequest = Schema.Schema.Type<typeof desiredArtifactsRequestSchema>;

const configWriteDecisionSchema = Schema.Struct({
  configArtifact: Schema.typeSchema(ownedArtifactSchema),
  previous: Schema.OptionFromSelf(Schema.typeSchema(ownedArtifactSchema)),
  targetObservation: Schema.typeSchema(artifactObservationSchema),
});

type ConfigWriteDecision = Schema.Schema.Type<typeof configWriteDecisionSchema>;

const configurationPlanRequestSchema = Schema.Struct({
  request: Schema.typeSchema(managedConfigurationRequestSchema),
  config: completeBagConfigSchema,
  settings: Schema.typeSchema(settingsInspectionSchema),
  receipt: Schema.OptionFromSelf(Schema.typeSchema(artifactReceiptSchema)),
  targetObservation: Schema.typeSchema(artifactObservationSchema),
  settingsObservation: Schema.typeSchema(artifactObservationSchema),
});

type ConfigurationPlanRequest = Schema.Schema.Type<typeof configurationPlanRequestSchema>;

const inspectSettings = (snapshot: ManagedSettingsSnapshot): SettingsInspection => {
  if (snapshot._tag === "missing") {
    return Schema.validateSync(
      settingsInspectionSchema,
      strictParseOptions,
    )({
      document: {},
      legacyEntries: [],
      legacyConfig: Option.none(),
    });
  }

  let document: JsonValue;
  try {
    document = Schema.validateSync(jsonValueSchema, strictParseOptions)(decodeJson(snapshot.bytes, "settings-invalid"));
  } catch (cause) {
    if (cause instanceof ManagedConfigurationError) {
      return failManagedConfiguration({ code: "legacy-invalid", message: cause.message, cause });
    }

    return failManagedConfiguration({ code: "legacy-invalid", message: "Legacy settings must be a strict JSON document.", cause });
  }

  if (!isJsonObject(document)) {
    return failManagedConfiguration({ code: "legacy-invalid", message: "Legacy settings must be a JSON object." });
  }

  const environment = Object.hasOwn(document, "env") ? document.env : undefined;
  if (environment !== undefined && !isJsonObject(environment)) {
    return failManagedConfiguration({ code: "legacy-invalid", message: "Legacy settings env must be a JSON object when present." });
  }

  if (environment === undefined) {
    return Schema.validateSync(
      settingsInspectionSchema,
      strictParseOptions,
    )({
      document,
      legacyEntries: [],
      legacyConfig: Option.none(),
    });
  }

  const legacyEntries = ownedLegacyEntries.flatMap(([key]) => {
    if (!Object.hasOwn(environment, key)) {
      return [];
    }

    // The own-property guard binds this exact schema-derived key to its raw JSON value.
    const value = environment[key];
    if (typeof value !== "string") {
      return failManagedConfiguration({ code: "legacy-invalid", message: `Legacy setting ${key} must be a string.` });
    }

    return [{ key, pointer: `/env/${key}`, value }];
  });
  if (legacyEntries.length === 0) {
    return Schema.validateSync(
      settingsInspectionSchema,
      strictParseOptions,
    )({
      document,
      legacyEntries,
      legacyConfig: Option.none(),
    });
  }

  const candidate = Object.fromEntries(legacyEntries.map((entry) => [entry.key, entry.value]));
  try {
    const legacyConfig = Schema.decodeUnknownSync(legacyBagConfigEnvironmentSchema, strictParseOptions)(candidate);

    return Schema.validateSync(
      settingsInspectionSchema,
      strictParseOptions,
    )({
      document,
      legacyEntries,
      legacyConfig: Option.some(legacyConfig),
    });
  } catch (cause) {
    return failManagedConfiguration({
      code: "legacy-invalid",
      message: "Legacy configuration is invalid; no migration plan was created.",
      cause,
    });
  }
};

const decodeReceipt = (snapshot: ManagedReceiptSnapshot, scope: ManagedConfigurationRequest["scope"]): Option.Option<ArtifactReceipt> => {
  if (snapshot._tag === "missing") {
    return Option.none();
  }

  const content = decodeUtf8(snapshot.bytes, "receipt-invalid");
  try {
    const receipt = Schema.decodeUnknownSync(artifactReceiptJsonSchema, strictParseOptions)(content);
    const canonical = new TextEncoder().encode(Schema.encodeSync(artifactReceiptJsonSchema)(receipt));
    if (!bytesEqual(snapshot.bytes, canonical) || receipt.scope !== scope) {
      return failManagedConfiguration({
        code: "receipt-invalid",
        message: "The receipt snapshot must be canonical and match the selected scope.",
      });
    }

    return Option.some(receipt);
  } catch (cause) {
    if (cause instanceof ManagedConfigurationError) {
      throw cause;
    }

    return failManagedConfiguration({ code: "receipt-invalid", message: "The receipt snapshot is invalid.", cause });
  }
};

const snapshotObservation = (targetPath: string, snapshot: ManagedConfigSnapshot | ManagedSettingsSnapshot): ArtifactObservation => {
  const raw = snapshot._tag === "file" ? ("file" in snapshot ? snapshot.file.bytes : snapshot.bytes) : undefined;

  return Schema.validateSync(
    artifactObservationSchema,
    strictParseOptions,
  )({
    path: targetPath,
    snapshot:
      raw === undefined
        ? { _tag: "missing" }
        : {
            _tag: "file",
            bytes: raw,
            sha256: sha256Bytes(raw),
          },
  });
};

const findObservation = (observations: ReadonlyArray<ArtifactObservation>, targetPath: string): Option.Option<ArtifactObservation> => {
  const observation = observations.find((candidate) => candidate.path === targetPath);

  return observation === undefined ? Option.none() : Option.some(observation);
};

const verifyReceiptAuthority = ({ receipt, observations, targetObservation, settingsObservation }: ReceiptAuthorityCheck): void => {
  if (Option.isNone(receipt)) {
    if (observations.length > 0) {
      failManagedConfiguration({
        code: "ownership-conflict",
        message: "Receipt observations cannot exist without a decoded receipt.",
      });
    }

    return;
  }

  const expectedPaths = receipt.value.artifacts.map((artifact) => artifact.path).sort(compareStrings);
  const observedPaths = observations.map((observation) => observation.path).sort(compareStrings);
  if (
    new Set(observedPaths).size !== observedPaths.length ||
    expectedPaths.length !== observedPaths.length ||
    expectedPaths.some((expectedPath, index) => expectedPath !== observedPaths.at(index))
  ) {
    failManagedConfiguration({
      code: "ownership-conflict",
      message: "Observations must cover every and only receipt-owned artifact.",
    });
  }

  // Bind every receipt member to its inspected bytes before source selection can authorize a plan.
  for (const artifact of receipt.value.artifacts) {
    const observation = findObservation(observations, artifact.path);
    if (Option.isNone(observation) || !currentSnapshotMatches({ artifact, observation: observation.value, target: "installed" })) {
      failManagedConfiguration({ code: "ownership-conflict", message: `Receipt-owned artifact changed: ${artifact.path}` });
    }
  }

  // Cross-check only fixed targets already present in the exact receipt observation set.
  for (const fixedObservation of [targetObservation, settingsObservation]) {
    const receiptObservation = findObservation(observations, fixedObservation.path);
    if (Option.isSome(receiptObservation) && !artifactObservationsEqual(receiptObservation.value, fixedObservation)) {
      failManagedConfiguration({
        code: "ownership-conflict",
        message: `Fixed-path snapshot differs from receipt observation: ${fixedObservation.path}`,
      });
    }
  }
};

const selectConfiguration = (
  request: ManagedConfigurationRequest,
  settings: SettingsInspection,
):
  | ManagedConfigurationResult
  | { readonly source: ManagedConfigurationSource; readonly config: Schema.Schema.Type<typeof completeBagConfigSchema> } => {
  const target =
    request.targetConfig._tag === "file"
      ? Option.some(validateConfigSnapshot(request.targetConfig.file, "target-invalid").config)
      : Option.none<Schema.Schema.Type<typeof completeBagConfigSchema>>();
  if (request.selection._tag === "replace") {
    if (request.globalSnapshot._tag !== "notRead") {
      return failManagedConfiguration({
        code: "global-snapshot-unexpected",
        message: "Replacement selection must not read global configuration.",
      });
    }

    return { source: { _tag: "replacement" }, config: request.selection.config };
  }

  if (Option.isSome(target)) {
    if (request.globalSnapshot._tag !== "notRead") {
      return failManagedConfiguration({
        code: "global-snapshot-unexpected",
        message: "An existing target must not read global configuration.",
      });
    }

    if (Option.isSome(settings.legacyConfig) && !bagConfigsEquivalent(target.value, settings.legacyConfig.value)) {
      return failManagedConfiguration({
        code: "source-conflict",
        message: "Target and legacy configuration contain different valid values.",
      });
    }

    return { source: { _tag: "target" }, config: target.value };
  }

  if (Option.isSome(settings.legacyConfig)) {
    if (request.globalSnapshot._tag !== "notRead") {
      return failManagedConfiguration({
        code: "global-snapshot-unexpected",
        message: "Legacy migration must not read global configuration.",
      });
    }

    return { source: { _tag: "legacy" }, config: settings.legacyConfig.value };
  }

  if (request.scope === "global") {
    if (request.globalSnapshot._tag !== "notRead") {
      return failManagedConfiguration({
        code: "global-snapshot-unexpected",
        message: "Global configuration cannot take a global snapshot of itself.",
      });
    }

    return { source: { _tag: "defaults" }, config: defaultBagConfig };
  }

  if (request.globalSnapshot._tag === "notRead") {
    return Schema.validateSync(
      managedConfigurationResultSchema,
      strictParseOptions,
    )({
      _tag: "globalSnapshotRequired",
      path: managedConfigPath,
    });
  }

  if (request.globalSnapshot._tag === "missing") {
    return { source: { _tag: "defaults" }, config: defaultBagConfig };
  }

  return {
    source: { _tag: "globalSnapshot" },
    config: validateConfigSnapshot(request.globalSnapshot.file, "global-snapshot-invalid").config,
  };
};

const artifactAt = (receipt: Option.Option<ArtifactReceipt>, targetPath: string): Option.Option<OwnedArtifact> => {
  if (Option.isNone(receipt)) {
    return Option.none();
  }

  const artifact = receipt.value.artifacts.find((candidate) => candidate.path === targetPath);

  return artifact === undefined ? Option.none() : Option.some(artifact);
};

const createConfigArtifact = ({ configBytes, targetConfig, previous }: ConfigArtifactRequest): OwnedArtifact => {
  if (Option.isSome(previous)) {
    if (
      previous.value.kind !== "managedConfig" ||
      previous.value.owner._tag !== "application" ||
      previous.value.ownership._tag !== "wholeFile"
    ) {
      return failManagedConfiguration({
        code: "ownership-conflict",
        message: "The fixed config path has incompatible receipt ownership.",
      });
    }

    return Schema.validateSync(
      ownedArtifactSchema,
      strictParseOptions,
    )({
      ...previous.value,
      ownership: {
        ...previous.value.ownership,
        installedSha256: sha256Bytes(configBytes),
      },
    });
  }

  const prior =
    targetConfig._tag === "missing"
      ? { _tag: "missing" }
      : {
          _tag: "file",
          bytes: targetConfig.file.bytes,
          sha256: sha256Bytes(targetConfig.file.bytes),
        };

  return Schema.validateSync(
    ownedArtifactSchema,
    strictParseOptions,
  )({
    path: managedConfigPath,
    owner: { _tag: "application" },
    kind: "managedConfig",
    ownership: {
      _tag: "wholeFile",
      installedSha256: sha256Bytes(configBytes),
      prior,
    },
  });
};

const pointersOverlap = (left: string, right: string): boolean => {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
};

const createSettingsArtifact = (settings: SettingsInspection, previous: Option.Option<OwnedArtifact>): Option.Option<OwnedArtifact> => {
  if (settings.legacyEntries.length === 0) {
    return previous;
  }

  if (
    Option.isSome(previous) &&
    (previous.value.kind !== "settings" || previous.value.owner._tag !== "application" || previous.value.ownership._tag !== "jsonValues")
  ) {
    return failManagedConfiguration({
      code: "ownership-conflict",
      message: "The fixed settings path has incompatible receipt ownership.",
    });
  }

  const previousEntries = Option.isSome(previous) && previous.value.ownership._tag === "jsonValues" ? previous.value.ownership.entries : [];
  if (
    settings.legacyEntries.some((legacyEntry) =>
      previousEntries.some((previousEntry) => pointersOverlap(legacyEntry.pointer, previousEntry.pointer)),
    )
  ) {
    return failManagedConfiguration({
      code: "ownership-conflict",
      message: "A legacy setting reappeared inside an already receipt-owned JSON range.",
    });
  }

  const entries = [
    ...previousEntries,
    ...settings.legacyEntries.map((entry) => ({
      pointer: entry.pointer,
      installed: { _tag: "missing" },
      prior: { _tag: "value", value: entry.value },
    })),
  ].sort((left, right) => compareStrings(left.pointer, right.pointer));
  const priorDocument =
    Option.isSome(previous) && previous.value.ownership._tag === "jsonValues"
      ? previous.value.ownership.priorDocument
      : { _tag: "existing" };

  return Option.some(
    Schema.validateSync(
      ownedArtifactSchema,
      strictParseOptions,
    )({
      path: managedSettingsPath,
      owner: { _tag: "application" },
      kind: "settings",
      ownership: {
        _tag: "jsonValues",
        entries,
        priorDocument,
      },
    }),
  );
};

const removeLegacySettings = (settings: SettingsInspection): Uint8Array => {
  if (!isJsonObject(settings.document)) {
    return failManagedConfiguration({
      code: "settings-invalid",
      message: "Validated settings unexpectedly stopped being a JSON object.",
    });
  }

  const environment = Object.hasOwn(settings.document, "env") ? settings.document.env : undefined;
  if (!isJsonObject(environment)) {
    return failManagedConfiguration({
      code: "settings-invalid",
      message: "Validated legacy settings unexpectedly lost their env object.",
    });
  }

  const cleanedEnvironment: Record<string, JsonValue> = { ...environment };

  // Delete only the exact schema-derived keys that were validated into the complete legacy candidate.
  for (const entry of settings.legacyEntries) {
    // Every entry was selected by an own-property check against the decoded env object.
    delete cleanedEnvironment[entry.key];
  }

  const cleanedDocument: Record<string, JsonValue> = {
    ...settings.document,
    env: cleanedEnvironment,
  };
  const encoded = JSON.stringify(cleanedDocument);

  return new TextEncoder().encode(encoded);
};

const mergeDesiredArtifacts = ({ receipt, configArtifact, settingsArtifact }: DesiredArtifactsRequest): ReadonlyArray<OwnedArtifact> => {
  const replacements = [configArtifact, ...Option.toArray(settingsArtifact)];
  const replacementPaths = new Set(replacements.map((artifact) => artifact.path));
  const carried = Option.isSome(receipt) ? receipt.value.artifacts.filter((artifact) => !replacementPaths.has(artifact.path)) : [];

  return [...carried, ...replacements].sort((left, right) => compareStrings(left.path, right.path));
};

const mergeObservations = (
  base: ReadonlyArray<ArtifactObservation>,
  additions: ReadonlyArray<ArtifactObservation>,
): ReadonlyArray<ArtifactObservation> => {
  const merged = [...base];

  // Merge fixed-path reads into the receipt snapshot set while rejecting contradictory duplicate evidence.
  for (const addition of additions) {
    const existing = merged.find((candidate) => candidate.path === addition.path);
    if (existing === undefined) {
      merged.push(addition);
      continue;
    }

    if (!artifactObservationsEqual(existing, addition)) {
      failManagedConfiguration({ code: "ownership-conflict", message: `Conflicting observations exist for ${addition.path}.` });
    }
  }

  return merged.sort((left, right) => compareStrings(left.path, right.path));
};

const configNeedsWrite = ({ configArtifact, previous, targetObservation }: ConfigWriteDecision): boolean => {
  if (Option.isNone(previous) || previous.value.ownership._tag !== "wholeFile" || configArtifact.ownership._tag !== "wholeFile") {
    return true;
  }

  return (
    previous.value.ownership.installedSha256 !== configArtifact.ownership.installedSha256 ||
    targetObservation.snapshot._tag !== "file" ||
    targetObservation.snapshot.sha256 !== configArtifact.ownership.installedSha256
  );
};

const buildPlan = ({ request, config, settings, receipt, targetObservation, settingsObservation }: ConfigurationPlanRequest) => {
  const configBytes = new TextEncoder().encode(Schema.encodeSync(bagConfigJsonSchema)(config));
  const previousConfig = artifactAt(receipt, managedConfigPath);
  const previousSettings = artifactAt(receipt, managedSettingsPath);
  const configArtifact = createConfigArtifact({ configBytes, targetConfig: request.targetConfig, previous: previousConfig });
  const settingsArtifact = createSettingsArtifact(settings, previousSettings);
  const artifacts = mergeDesiredArtifacts({ receipt, configArtifact, settingsArtifact });
  const observations = mergeObservations(request.receiptArtifactObservations, [
    targetObservation,
    ...(Option.isSome(settingsArtifact) ? [settingsObservation] : []),
  ]);
  const operations = [
    ...(settings.legacyEntries.length > 0 || configNeedsWrite({ configArtifact, previous: previousConfig, targetObservation })
      ? [
          {
            _tag: "write",
            path: managedConfigPath,
            bytes: configBytes,
            source: { _tag: "desiredArtifact" },
          },
        ]
      : []),
    ...(settings.legacyEntries.length > 0
      ? [
          {
            _tag: "write",
            path: managedSettingsPath,
            bytes: removeLegacySettings(settings),
            source: { _tag: "desiredArtifact" },
          },
        ]
      : []),
  ];
  const receiptValue = Schema.validateSync(
    artifactReceiptSchema,
    strictParseOptions,
  )({
    version: 1,
    installerVersion: request.installerVersion,
    scope: request.scope,
    features: Option.isSome(receipt) ? receipt.value.features : [],
    artifacts,
  });

  try {
    if (Option.isNone(receipt)) {
      return validateArtifactPlan({
        scope: request.scope,
        root: request.root,
        authority: {
          _tag: "fresh",
          observations,
        },
        artifacts,
        operations,
        receipt: {
          _tag: "publishReceipt",
          path: managedReceiptPath,
          value: receiptValue,
        },
      });
    }

    const previousReceiptBytes = new TextEncoder().encode(Schema.encodeSync(artifactReceiptJsonSchema)(receipt.value));
    const desiredPlan = {
      scope: request.scope,
      root: request.root,
      authority: {
        _tag: "receipt",
        receiptPath: managedReceiptPath,
        receiptSha256: sha256Bytes(previousReceiptBytes),
        receipt: receipt.value,
        observations,
      },
      artifacts,
      operations,
      receipt: {
        _tag: "publishReceipt",
        path: managedReceiptPath,
        value: receiptValue,
      },
    };

    return createUpdatePlan({
      previousReceiptPath: managedReceiptPath,
      previousReceiptSha256: sha256Bytes(previousReceiptBytes),
      previousReceipt: receipt.value,
      desiredPlan,
      observations: request.receiptArtifactObservations,
      mode: { _tag: "patch" },
    });
  } catch (cause) {
    if (cause instanceof ManagedConfigurationError) {
      throw cause;
    }

    return failManagedConfiguration({
      code: "artifact-plan-invalid",
      message: "Managed configuration could not produce a valid artifact plan.",
      cause,
    });
  }
};

/** Resolves one validated source and returns a pure fixed-path artifact plan without performing filesystem writes. */
export const planManagedConfiguration = (input: unknown): ManagedConfigurationResult => {
  try {
    const request = decodeRequest(input);
    const receipt = decodeReceipt(request.receipt, request.scope);
    const targetObservation = snapshotObservation(managedConfigPath, request.targetConfig);
    const settingsObservation = snapshotObservation(managedSettingsPath, request.settings);
    verifyReceiptAuthority({
      receipt,
      observations: request.receiptArtifactObservations,
      targetObservation,
      settingsObservation,
    });
    const settings = inspectSettings(request.settings);

    const selection = selectConfiguration(request, settings);
    if ("_tag" in selection && selection._tag === "globalSnapshotRequired") {
      return selection;
    }

    const plan = buildPlan({
      request,
      config: selection.config,
      settings,
      receipt,
      targetObservation,
      settingsObservation,
    });

    return Schema.validateSync(
      managedConfigurationResultSchema,
      strictParseOptions,
    )({
      _tag: "planned",
      source: selection.source,
      config: selection.config,
      plan,
    });
  } catch (cause) {
    if (cause instanceof ManagedConfigurationError) {
      throw cause;
    }

    return failManagedConfiguration({
      code: "artifact-plan-invalid",
      message: "Managed configuration could not produce a valid artifact plan.",
      cause,
    });
  }
};
