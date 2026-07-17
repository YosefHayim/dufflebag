import { createHash } from "node:crypto";

import { Either, ParseResult, Schema } from "effect";

import { type WriteOperation, writeOperationSchema } from "../install/artifactPlan.js";
import {
  type ArtifactOwner,
  jsonPointerSchema,
  type PreviousFileValue,
  previousFileValueSchema,
  scopeSchema,
  sha256Schema,
} from "../install/artifactReceipt.js";
import { defaultBagConfig, legacyBagConfigEnvironmentSchema } from "./bagConfigSchema.js";
import { configFileSnapshotSchema, type ManagedConfigFile, managedConfigFileSchema } from "./configFile.js";
import { findDuplicateJsonProperty } from "./jsonDocument.js";

export const managedConfigPath = ".claude/dufflebag/config.json";
export const settingsPath = ".claude/settings.json";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const jsonValueCodec = Schema.parseJson();
const managedConfigJsonSchema = Schema.parseJson(managedConfigFileSchema, { space: 2 });
const settingsEnvironmentSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const legacySettingsJsonSchema = Schema.parseJson(
  Schema.Struct(
    {
      env: settingsEnvironmentSchema.annotations({
        description: "Claude settings environment containing the legacy configuration candidate.",
      }),
    },
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
);
const applicationOwner: ArtifactOwner = { _tag: "application" };

export class ConfigurePlanError extends Schema.TaggedError<ConfigurePlanError>()("ConfigurePlanError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable request, legacy settings, or generated-plan validation issue.",
  }),
}) {
  get message(): string {
    return `Cannot plan managed configuration: ${this.issue}`;
  }
}

const formatParseError = (error: ParseResult.ParseError): string => ParseResult.TreeFormatter.formatErrorSync(error);

const formatUnknownError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

const renderManagedConfigBytes = (config: ManagedConfigFile): Uint8Array =>
  textEncoder.encode(`${Schema.encodeSync(managedConfigJsonSchema)(config)}\n`);

const renderJsonValueHash = (value: unknown): string => hashBytes(textEncoder.encode(Schema.encodeSync(jsonValueCodec)(value)));

const legacyEnvironmentEntries = (environment: Readonly<Record<string, unknown>>) =>
  Object.entries(environment)
    .filter(([key]) => key.toLowerCase().startsWith("dufflebag"))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

export const hasLegacySettingsCandidate = (environment: Readonly<Record<string, unknown>>): boolean =>
  legacyEnvironmentEntries(environment).length > 0;

const decodeLegacyConfig = (entries: ReadonlyArray<readonly [string, unknown]>) => {
  if (entries.length === 0) {
    return Either.left(new ConfigurePlanError({ issue: "settings.json contains no legacy dufflebag environment keys." }));
  }

  return Either.mapLeft(
    Schema.decodeUnknownEither(legacyBagConfigEnvironmentSchema, {
      onExcessProperty: "error",
    })(Object.fromEntries(entries)),
    (error) => new ConfigurePlanError({ issue: `legacy settings are invalid: ${formatParseError(error)}` }),
  );
};

const decodeLegacySettingsBytes = (bytes: Uint8Array) => {
  const decodedText = Either.try({
    try: () => textDecoder.decode(bytes),
    catch: (error) => new ConfigurePlanError({ issue: `settings.json is not valid UTF-8: ${formatUnknownError(error)}` }),
  });

  return Either.flatMap(decodedText, (json) => {
    const decodedSettings = Either.mapLeft(
      Schema.decodeUnknownEither(legacySettingsJsonSchema, {
        onExcessProperty: "error",
      })(json),
      (error) => new ConfigurePlanError({ issue: `settings.json is invalid: ${formatParseError(error)}` }),
    );
    const duplicateProperty = findDuplicateJsonProperty(json);

    return duplicateProperty === undefined
      ? decodedSettings
      : Either.left(
          new ConfigurePlanError({
            issue: `settings.json contains duplicate JSON property ${JSON.stringify(duplicateProperty)}.`,
          }),
        );
  });
};

const legacySettingValueSchema = Schema.Struct({
  pointer: jsonPointerSchema.annotations({
    description: "Exact legacy environment pointer that the settings planner must remove.",
  }),
  currentValueHash: sha256Schema.annotations({
    description: "Hash of the current canonical JSON value that authorizes removal.",
  }),
});

const createLegacyValues = (entries: ReadonlyArray<readonly [string, unknown]>) =>
  entries.map(([key, value]) => ({
    pointer: `/env/${key}`,
    currentValueHash: renderJsonValueHash(value),
  }));

const legacySettingsEvidenceFieldsSchema = Schema.TaggedStruct("cleanup", {
  path: Schema.Literal(settingsPath).annotations({
    description: "Scope-relative settings path inspected for legacy configuration.",
  }),
  originalBytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Exact validated settings bytes consumed later by the single settings planner.",
  }),
  values: Schema.Array(legacySettingValueSchema).annotations({
    description: "Exact legacy key/value evidence consumed later by the single settings planner.",
  }),
});

type LegacySettingsEvidenceFields = Schema.Schema.Type<typeof legacySettingsEvidenceFieldsSchema>;

const legacyInspectionSchema = Schema.Struct({
  config: managedConfigFileSchema,
  cleanup: legacySettingsEvidenceFieldsSchema,
});

type LegacyInspection = Schema.Schema.Type<typeof legacyInspectionSchema>;

const validateLegacyInspection = (input: unknown): Either.Either<LegacyInspection, ConfigurePlanError> =>
  Either.mapLeft(
    Schema.validateEither(legacyInspectionSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new ConfigurePlanError({ issue: `legacy cleanup is invalid: ${formatParseError(error)}` }),
  );

// Inspect one legacy settings snapshot without editing it: decode the bytes, validate one config, then retain exact evidence.
const inspectLegacySettings = (originalBytes: Uint8Array): Either.Either<LegacyInspection, ConfigurePlanError> => {
  // 1. Decode the exact bytes and reject ambiguous JSON before reading values.
  const snapshot = decodeLegacySettingsBytes(originalBytes);
  if (Either.isLeft(snapshot)) {
    return Either.left(snapshot.left);
  }

  // 2. Decode every legacy key together through the complete config schema.
  const entries = legacyEnvironmentEntries(snapshot.right.env);
  const config = decodeLegacyConfig(entries);
  if (Either.isLeft(config)) {
    return Either.left(config.left);
  }

  // 3. Correlate the decoded config with the untouched bytes and exact key/value evidence.
  return validateLegacyInspection({
    config: config.right,
    cleanup: {
      _tag: "cleanup",
      path: settingsPath,
      originalBytes,
      values: createLegacyValues(entries),
    },
  });
};

const legacyValuesEqual = Schema.equivalence(Schema.Array(legacySettingValueSchema));

const legacyEvidenceIssues = (evidence: LegacySettingsEvidenceFields) => {
  const expected = inspectLegacySettings(evidence.originalBytes);
  if (Either.isLeft(expected)) {
    return [
      {
        path: ["originalBytes"],
        message: expected.left.message,
      },
    ];
  }

  return legacyValuesEqual(evidence.values, expected.right.cleanup.values)
    ? []
    : [
        {
          path: ["values"],
          message: "Legacy key/value evidence must match the exact inspected settings values.",
        },
      ];
};

export const legacySettingsEvidenceSchema = legacySettingsEvidenceFieldsSchema.pipe(Schema.filter(legacyEvidenceIssues));

export type LegacySettingsEvidence = Schema.Schema.Type<typeof legacySettingsEvidenceSchema>;

export const legacySettingsPlanSchema = Schema.Union(
  Schema.TaggedStruct("none", {}).annotations({
    description: "No legacy settings cleanup is required.",
  }),
  legacySettingsEvidenceSchema,
).annotations({
  description: "Optional evidence merged into the single later settings operation.",
});

export type LegacySettingsPlan = Schema.Schema.Type<typeof legacySettingsPlanSchema>;

const configSelectionSchema = Schema.Union(
  Schema.TaggedStruct("selected", {
    config: managedConfigFileSchema.annotations({
      description: "Complete validated configuration selected for this scope.",
    }),
  }),
  Schema.TaggedStruct("firstProjectInstall", {
    globalConfig: configFileSnapshotSchema.annotations({
      description: "Exact validated global snapshot copied once, or a missing snapshot when schema defaults should be used.",
    }),
  }),
  Schema.TaggedStruct("legacyEnvironment", {
    settingsBytes: Schema.Uint8ArrayFromSelf.annotations({
      description: "Exact existing settings.json bytes inspected for one-time legacy migration.",
    }),
  }),
).annotations({
  description: "Tagged source of the complete managed configuration without behavior flags.",
});

const configureRequestFieldsSchema = Schema.Struct({
  scope: scopeSchema.annotations({
    description: "Installation scope receiving the managed configuration.",
  }),
  selection: configSelectionSchema,
  previousConfigFile: Schema.typeSchema(previousFileValueSchema).annotations({
    description: "Exact original managed-config state retained for whole-file restoration.",
  }),
});

type ConfigureRequestFields = Schema.Schema.Type<typeof configureRequestFieldsSchema>;

const configureRequestIssues = (request: ConfigureRequestFields) => {
  const oneTimeSelection = request.selection._tag === "firstProjectInstall" || request.selection._tag === "legacyEnvironment";

  return [
    request.selection._tag === "firstProjectInstall" && request.scope !== "project"
      ? {
          path: ["selection", "_tag"],
          message: "A first project install requires project scope.",
        }
      : undefined,
    oneTimeSelection && request.previousConfigFile._tag !== "missing"
      ? {
          path: ["previousConfigFile"],
          message: "First-project and legacy selections require a missing target managed config.",
        }
      : undefined,
  ];
};

export const configureRequestSchema = configureRequestFieldsSchema.pipe(Schema.filter(configureRequestIssues));

export type ConfigureRequest = Schema.Schema.Type<typeof configureRequestSchema>;

const managedConfigWriteSchema = writeOperationSchema.pipe(
  Schema.filter((operation) => [
    operation.artifact.path === managedConfigPath
      ? undefined
      : {
          path: ["artifact", "path"],
          message: `Managed configuration writes must target ${managedConfigPath}.`,
        },
    operation.artifact.kind._tag === "managedConfig"
      ? undefined
      : {
          path: ["artifact", "kind"],
          message: "Managed configuration writes require the managedConfig artifact kind.",
        },
    operation.artifact.ownership._tag === "wholeFile" && operation.artifact.ownership.installedHash !== hashBytes(operation.bytes)
      ? {
          path: ["artifact", "ownership", "installedHash"],
          message: "Managed-config ownership hash must match its exact desired bytes.",
        }
      : undefined,
  ]),
);

const managedConfigPlanFieldsSchema = Schema.Struct({
  config: managedConfigFileSchema.annotations({
    description: "Complete configuration materialized by this plan.",
  }),
  managedConfigWrite: managedConfigWriteSchema.annotations({
    description: "Exact managed-config write published by the complete artifact plan.",
  }),
  legacySettings: legacySettingsPlanSchema,
});

type ManagedConfigPlanFields = Schema.Schema.Type<typeof managedConfigPlanFieldsSchema>;

const configEqual = Schema.equivalence(managedConfigFileSchema);

const legacyConfigIssue = (plan: ManagedConfigPlanFields) => {
  if (plan.legacySettings._tag === "none") {
    return undefined;
  }

  const inspected = inspectLegacySettings(plan.legacySettings.originalBytes);

  return Either.isRight(inspected) && configEqual(plan.config, inspected.right.config)
    ? undefined
    : {
        path: ["config"],
        message: "A legacy plan config must match the complete decoded environment candidate.",
      };
};

const managedConfigPlanIssues = (plan: ManagedConfigPlanFields) => [
  bytesEqual(plan.managedConfigWrite.bytes, renderManagedConfigBytes(plan.config))
    ? undefined
    : {
        path: ["managedConfigWrite", "bytes"],
        message: "Managed-config bytes must encode the returned complete configuration.",
      },
  legacyConfigIssue(plan),
];

export const managedConfigPlanSchema = managedConfigPlanFieldsSchema.pipe(Schema.filter(managedConfigPlanIssues));

export type ManagedConfigPlan = Schema.Schema.Type<typeof managedConfigPlanSchema>;

const decodeConfigureRequest = (input: unknown): Either.Either<ConfigureRequest, ConfigurePlanError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(configureRequestSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new ConfigurePlanError({ issue: formatParseError(error) }),
  );

const validateManagedConfigPlan = (input: unknown): Either.Either<ManagedConfigPlan, ConfigurePlanError> =>
  Either.mapLeft(
    Schema.validateEither(managedConfigPlanSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new ConfigurePlanError({ issue: formatParseError(error) }),
  );

const createManagedConfigWrite = (config: ManagedConfigFile, previous: PreviousFileValue): WriteOperation => {
  const bytes = renderManagedConfigBytes(config);

  return {
    _tag: "write",
    artifact: {
      path: managedConfigPath,
      kind: { _tag: "managedConfig" },
      owner: applicationOwner,
      ownership: {
        _tag: "wholeFile",
        installedHash: hashBytes(bytes),
        previous,
      },
    },
    bytes,
  };
};

const resolveConfigSelection = (request: ConfigureRequest): Either.Either<ManagedConfigPlanFields, ConfigurePlanError> => {
  switch (request.selection._tag) {
    case "selected":
      return Either.right({
        config: request.selection.config,
        managedConfigWrite: createManagedConfigWrite(request.selection.config, request.previousConfigFile),
        legacySettings: { _tag: "none" },
      });
    case "firstProjectInstall": {
      const config = request.selection.globalConfig._tag === "present" ? request.selection.globalConfig.config : defaultBagConfig;

      return Either.right({
        config,
        managedConfigWrite: createManagedConfigWrite(config, request.previousConfigFile),
        legacySettings: { _tag: "none" },
      });
    }
    case "legacyEnvironment":
      return Either.map(inspectLegacySettings(request.selection.settingsBytes), ({ config, cleanup }) => ({
        config,
        managedConfigWrite: createManagedConfigWrite(config, request.previousConfigFile),
        legacySettings: cleanup,
      }));
  }
};

// Plan one managed config without I/O: decode fully, resolve one source, then validate every correlated artifact value.
export const planManagedConfig = (input: unknown): Either.Either<ManagedConfigPlan, ConfigurePlanError> => {
  // 1. Decode the complete tagged request before materializing any artifact data.
  const request = decodeConfigureRequest(input);
  if (Either.isLeft(request)) {
    return Either.left(request.left);
  }

  // 2. Resolve the config write and optional legacy-settings evidence.
  const plan = resolveConfigSelection(request.right);
  if (Either.isLeft(plan)) {
    return Either.left(plan.left);
  }

  // 3. Validate config bytes, hashes, restoration state, and legacy correlations together.
  return validateManagedConfigPlan(plan.right);
};
