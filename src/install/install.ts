import { createHash } from "node:crypto";

import { FileSystem, Path } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Effect, Either, Option, ParseResult, Predicate, Schema } from "effect";
import { findNodeAtLocation, type Node, parseTree } from "jsonc-parser";

import { type AgentDefinition, agentCatalog, classifyAgents } from "../catalog/agentCatalog.js";
import {
  featureCatalog,
  type featureIdSchema,
  installedSkillSchema,
  installedSkillsFor,
  resolveFeatureSelection,
  selectedFeatureIds,
} from "../catalog/featureCatalog.js";
import { defaultBagConfig } from "../config/bagConfigSchema.js";
import { type ConfigFileSnapshot, readConfigFile } from "../config/configFile.js";
import {
  type ConfigureRequest,
  hasLegacySettingsCandidate,
  type LegacySettingsPlan,
  type ManagedConfigPlan,
  managedConfigPath,
  planManagedConfig,
  settingsPath,
} from "../config/configure.js";
import { findDuplicateJsonProperty } from "../config/jsonDocument.js";
import { planConfigReference } from "./agentFormats/configReference.js";
import { planInstructionFile } from "./agentFormats/instructionFile.js";
import { planRuleFiles } from "./agentFormats/ruleFile.js";
import { planSkillDirectory } from "./agentFormats/skillDirectory.js";
import { applyArtifactPlan } from "./applyArtifactPlan.js";
import {
  type ArtifactExpectedCurrent,
  type ArtifactOperation,
  absoluteRootSchema,
  artifactOperationSchema,
  createUpdatePlan,
  type ReceiptTarget,
} from "./artifactPlan.js";
import {
  type ArtifactOwner,
  type ArtifactReceipt,
  artifactReceiptJsonSchema,
  artifactReceiptSnapshotSchema,
  type JsonValuesOwnership,
  type OwnedJsonValue,
  type PreviousFileValue,
  type PreviousJsonLexical,
  type PreviousJsonValue,
  type ReceiptEntry,
  readArtifactReceiptSnapshot,
  receiptEntrySchema,
} from "./artifactReceipt.js";
import {
  InstallError,
  type InstallRequest,
  type InstallResult,
  installRequestSchema,
  installResultSchema,
  receiptPath,
  runtimePath,
} from "./installSchemas.js";

export {
  agentChoiceSchema,
  configurationChoiceSchema,
  InstallError,
  type InstallRequest,
  type InstallResult,
  installationDestinationSchema,
  installationHostSchema,
  installationLocationSchema,
  installRequestSchema,
  installResultSchema,
  interactionSchema,
  platformRequirementSchema,
  receiptPath,
  runtimePath,
  selectedFeatureChoiceSchema,
  stagedPackageSchema,
} from "./installSchemas.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const jsonValueSchema = Schema.parseJson();
const receiptEqual = (left: ArtifactReceipt, right: ArtifactReceipt): boolean =>
  Schema.encodeSync(artifactReceiptJsonSchema)(left) === Schema.encodeSync(artifactReceiptJsonSchema)(right);
const applicationOwner: ArtifactOwner = { _tag: "application" };

const fileSnapshotSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("file", {
    bytes: Schema.Uint8ArrayFromSelf.annotations({
      description: "Exact bytes observed at one planned artifact path.",
    }),
  }),
);

type FileSnapshot = Schema.Schema.Type<typeof fileSnapshotSchema>;

const stagedRuntimeFileSchema = Schema.Struct({
  path: Schema.NonEmptyTrimmedString.annotations({
    description: "Feature-runtime-relative staged file path.",
  }),
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Exact staged runtime bytes copied into the installation.",
  }),
});

type StagedRuntimeFile = Schema.Schema.Type<typeof stagedRuntimeFileSchema>;

const stagedSkillPathIssues = (stagedSkill: {
  installedSkill: Schema.Schema.Type<typeof installedSkillSchema>;
  sourceFiles: ReadonlyArray<StagedRuntimeFile>;
}) => [
  ...stagedSkill.sourceFiles.flatMap((sourceFile, index) =>
    stagedSkill.installedSkill.shippedPaths.some(
      (shippedPath) => sourceFile.path === shippedPath || sourceFile.path.startsWith(`${shippedPath}/`),
    )
      ? []
      : [{ path: ["sourceFiles", index, "path"], message: `Staged skill file ${sourceFile.path} is not catalog-shipped.` }],
  ),
  ...stagedSkill.installedSkill.shippedPaths.flatMap((shippedPath, index) =>
    stagedSkill.sourceFiles.some((sourceFile) => sourceFile.path === shippedPath || sourceFile.path.startsWith(`${shippedPath}/`))
      ? []
      : [
          {
            path: ["installedSkill", "shippedPaths", index],
            message: `Catalog-shipped path ${shippedPath} is missing from the staged skill.`,
          },
        ],
  ),
];

const stagedInstalledSkillSchema = Schema.Struct({
  installedSkill: installedSkillSchema.annotations({
    description: "Catalog skill identity paired with its verified staged files.",
  }),
  sourceFiles: Schema.Array(stagedRuntimeFileSchema).annotations({
    description: "Complete verified staged skill file tree.",
  }),
  markdown: Schema.NonEmptyString.annotations({
    description: "Strict UTF-8 SKILL.md text used by native rule and instruction formats.",
  }),
}).pipe(Schema.filter(stagedSkillPathIssues));

type StagedInstalledSkill = Schema.Schema.Type<typeof stagedInstalledSkillSchema>;

const inspectedArtifactSchema = Schema.Struct({
  path: Schema.NonEmptyTrimmedString,
  snapshot: fileSnapshotSchema,
});

type InspectedArtifact = Schema.Schema.Type<typeof inspectedArtifactSchema>;

const settingsHooksSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Array(Schema.Unknown),
});

const settingsEnvironmentSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});

const settingsDocumentSchema = Schema.Struct(
  {
    hooks: Schema.optional(settingsHooksSchema),
    env: Schema.optional(settingsEnvironmentSchema),
  },
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);

type SettingsDocument = Schema.Schema.Type<typeof settingsDocumentSchema>;

const decodedSettingsSchema = Schema.Struct({
  source: Schema.String.annotations({
    description: "Exact decoded settings text retained for byte-preserving JSON edits.",
  }),
  document: settingsDocumentSchema.annotations({
    description: "Strict settings document decoded from the same source text.",
  }),
});

type DecodedSettings = Schema.Schema.Type<typeof decodedSettingsSchema>;

const formatParseError = (error: ParseResult.ParseError): string => ParseResult.TreeFormatter.formatErrorSync(error);

const formatUnknownError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const toInstallError = (error: unknown): InstallError =>
  error instanceof InstallError ? error : new InstallError({ issue: formatUnknownError(error) });

const effectFromEither = <Value, Error>(either: Either.Either<Value, Error>): Effect.Effect<Value, Error> =>
  Either.isLeft(either) ? Effect.fail(either.left) : Effect.succeed(either.right);

const validateArtifactOperation = (input: unknown): Either.Either<ArtifactOperation, InstallError> =>
  Either.mapLeft(
    Schema.validateEither(artifactOperationSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new InstallError({ issue: `Generated artifact operation is invalid: ${formatParseError(error)}` }),
  );

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

const hashJsonValue = (value: unknown): string => hashBytes(textEncoder.encode(Schema.encodeSync(jsonValueSchema)(value)));

const isNotFound = (error: PlatformError): boolean => error._tag === "SystemError" && error.reason === "NotFound";

const readFileSnapshot = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    return yield* fileSystem.readFile(filePath).pipe(
      Effect.map((bytes): FileSnapshot => ({ _tag: "file", bytes })),
      Effect.catchIf(isNotFound, (): Effect.Effect<FileSnapshot> => Effect.succeed({ _tag: "missing" })),
    );
  });

const expectedCurrent = (snapshot: FileSnapshot): ArtifactExpectedCurrent =>
  snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "file", sha256: hashBytes(snapshot.bytes) };

const previousFile = (snapshot: FileSnapshot): PreviousFileValue =>
  snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "priorFile", bytes: snapshot.bytes };

const configSnapshotFile = (snapshot: ConfigFileSnapshot): FileSnapshot =>
  snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "file", bytes: snapshot.bytes };

const decodeInstallRequest = (input: unknown) =>
  Schema.decodeUnknown(installRequestSchema, {
    onExcessProperty: "error",
  })(input).pipe(Effect.mapError((error) => new InstallError({ issue: formatParseError(error) })));

const resolveFeatures = (request: InstallRequest) => {
  const ids = request.features._tag === "defaults" ? selectedFeatureIds : request.features.ids;

  return Either.mapLeft(resolveFeatureSelection(ids), (error) => new InstallError({ issue: error.message }));
};

const resolveSelectedAgents = (ids: ReadonlyArray<string>): Either.Either<ReadonlyArray<AgentDefinition>, InstallError> => {
  const unknownId = ids.find((id) => !agentCatalog.some((agent) => agent.id === id));
  if (unknownId !== undefined) {
    return Either.left(new InstallError({ issue: `Unknown agent: ${unknownId}` }));
  }

  if (ids.length !== new Set(ids).size) {
    return Either.left(new InstallError({ issue: "Agent selection contains duplicate IDs." }));
  }

  const selectedIds = new Set(ids);

  return Either.right(agentCatalog.filter((agent) => selectedIds.has(agent.id)));
};

const resolveAgents = (request: InstallRequest): Either.Either<ReadonlyArray<AgentDefinition>, InstallError> => {
  if (request.agents._tag === "selected") {
    return resolveSelectedAgents(request.agents.ids);
  }

  const detectedIds = classifyAgents(request.agents.evidence).flatMap((agent) => (agent.installed ? [agent.id] : []));

  return resolveSelectedAgents(detectedIds);
};

const decodeSettings = (snapshot: FileSnapshot): Either.Either<DecodedSettings, InstallError> => {
  if (snapshot._tag === "missing") {
    return Either.right(decodedSettingsSchema.make({ source: "{}\n", document: {} }));
  }

  const decodedText = Either.try({
    try: () => textDecoder.decode(snapshot.bytes),
    catch: (error) => new InstallError({ issue: `settings.json is not strict UTF-8: ${formatUnknownError(error)}` }),
  });

  return Either.flatMap(decodedText, (source) => {
    if (source.startsWith("\uFEFF")) {
      return Either.left(new InstallError({ issue: "settings.json must not start with a UTF-8 byte-order mark." }));
    }

    const duplicateProperty = findDuplicateJsonProperty(source);
    if (duplicateProperty !== undefined) {
      return Either.left(
        new InstallError({ issue: `settings.json contains duplicate JSON property ${JSON.stringify(duplicateProperty)}.` }),
      );
    }

    return Either.mapLeft(
      Schema.decodeUnknownEither(Schema.parseJson(settingsDocumentSchema), {
        onExcessProperty: "preserve",
      })(source),
      (error) => new InstallError({ issue: `settings.json is invalid: ${formatParseError(error)}` }),
    ).pipe(Either.map((document) => decodedSettingsSchema.make({ source, document })));
  });
};

const hookEventFromPointer = (pointer: string): string | undefined => {
  const prefix = "/hooks/";

  return pointer.startsWith(prefix) && !pointer.slice(prefix.length).includes("/") ? pointer.slice(prefix.length) : undefined;
};

const previousHookGroups = (ownership: JsonValuesOwnership | undefined, event: string): PreviousJsonValue | undefined =>
  ownership?.values.find((value) => value.pointer === `/hooks/${event}`)?.previous;

const decodeHookGroups = (value: unknown, event: string): Either.Either<ReadonlyArray<unknown>, InstallError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(Schema.Array(Schema.Unknown))(value),
    () => new InstallError({ issue: `settings.json hook event ${event} must contain an array.` }),
  );

const baseHookGroups = (input: {
  ownership: JsonValuesOwnership | undefined;
  document: SettingsDocument;
  event: string;
  source: string;
}): Either.Either<{ groups: ReadonlyArray<unknown>; previous: PreviousJsonValue }, InstallError> => {
  const history = previousHookGroups(input.ownership, input.event);
  if (history?._tag === "value") {
    if (history.lexical === undefined) {
      return Either.left(new InstallError({ issue: `Receipted hook event ${input.event} lacks lexical restoration evidence.` }));
    }

    return Either.map(decodeHookGroups(history.value, input.event), (groups) => ({ groups, previous: history }));
  }

  if (history?._tag === "missing") {
    return Either.right({ groups: [], previous: history });
  }

  const current = input.document.hooks?.[input.event];
  if (current === undefined) {
    return Either.right({ groups: [], previous: { _tag: "missing" } });
  }

  const groups = decodeHookGroups(current, input.event);
  if (Either.isLeft(groups)) {
    return Either.left(groups.left);
  }

  const lexical = captureJsonValueLexical({ source: input.source, path: ["hooks", input.event] });

  return Either.map(lexical, (sourceEvidence) => ({
    groups: groups.right,
    previous: { _tag: "value", value: groups.right, lexical: sourceEvidence },
  }));
};

const decodeJsonPointerSegment = (segment: string): string => segment.replaceAll("~1", "/").replaceAll("~0", "~");

const jsonPointerPath = (pointer: string): ReadonlyArray<string> => pointer.slice(1).split("/").map(decodeJsonPointerSegment);

const settingsValueAtPointer = (document: SettingsDocument, pointer: string): unknown => {
  const [container, key, extra] = jsonPointerPath(pointer);
  if (extra !== undefined || key === undefined) {
    return undefined;
  }

  if (container === "hooks") {
    return document.hooks?.[key];
  }

  return container === "env" ? document.env?.[key] : undefined;
};

const installedJsonValueMatches = (value: OwnedJsonValue, current: unknown): boolean =>
  value.installed._tag === "missing" ? current === undefined : current !== undefined && hashJsonValue(current) === value.installed.hash;

const validateCurrentSettingsOwnership = (
  document: SettingsDocument,
  ownership: JsonValuesOwnership | undefined,
): Either.Either<void, InstallError> => {
  if (ownership === undefined) {
    return Either.right(undefined);
  }

  const conflict = ownership.values.find((value) => {
    const current = settingsValueAtPointer(document, value.pointer);

    return !installedJsonValueMatches(value, current);
  });

  return conflict === undefined
    ? Either.right(undefined)
    : Either.left(new InstallError({ issue: `Receipted settings value ${conflict.pointer} changed after installation.` }));
};

const settingsOperationSchema = artifactOperationSchema.pipe(
  Schema.filter((operation) => {
    const identityIssues = [
      ...(operation.artifact.path === settingsPath
        ? []
        : [{ path: ["artifact", "path"], message: `Settings operations must target ${settingsPath}.` }]),
      ...(operation.artifact.kind._tag === "settings"
        ? []
        : [{ path: ["artifact", "kind"], message: "Settings operations must use the settings artifact kind." }]),
      ...(operation.artifact.owner._tag === "application"
        ? []
        : [{ path: ["artifact", "owner"], message: "Settings operations must use the application owner." }]),
    ];
    if (identityIssues.length > 0 || operation._tag === "remove") {
      return identityIssues;
    }

    const decoded = decodeSettings({ _tag: "file", bytes: operation.bytes });
    if (Either.isLeft(decoded)) {
      return [...identityIssues, { path: ["bytes"], message: decoded.left.issue }];
    }

    if (operation._tag !== "write" || operation.artifact.ownership._tag !== "jsonValues") {
      return identityIssues;
    }

    return [
      ...identityIssues,
      ...operation.artifact.ownership.values.flatMap((value, index) =>
        installedJsonValueMatches(value, settingsValueAtPointer(decoded.right.document, value.pointer))
          ? []
          : [
              {
                path: ["artifact", "ownership", "values", index],
                message: `Settings operation bytes do not match owned pointer ${value.pointer}.`,
              },
            ],
      ),
    ];
  }),
);

const validateSettingsOperation = (input: unknown): Either.Either<ArtifactOperation, InstallError> =>
  Either.mapLeft(
    Schema.validateEither(settingsOperationSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new InstallError({ issue: `Generated settings operation is invalid: ${formatParseError(error)}` }),
  );

const managedHookCommandSchema = Schema.Struct({
  type: Schema.Literal("command").annotations({
    description: "Claude hook leaf kind used for a spawned command.",
  }),
  command: Schema.NonEmptyString.annotations({
    description: "Fully resolved command invoking one installed runtime entrypoint.",
  }),
});

const managedHookGroupSchema = Schema.Struct({
  matcher: Schema.optional(
    Schema.NonEmptyString.annotations({
      description: "Optional tool matcher copied from the feature registration.",
    }),
  ),
  hooks: Schema.Tuple(managedHookCommandSchema).annotations({
    description: "Single dufflebag-authored command leaf for this registration.",
  }),
});

type ManagedHookGroup = Schema.Schema.Type<typeof managedHookGroupSchema>;

const stagedRuntimeEntrypoint = (sourceEntrypoint: string): string => `${sourceEntrypoint.slice(0, -3)}.js`;

const installedRuntimeFile = (sourceDirectory: string, filePath: string): string => `${runtimePath}/${sourceDirectory}/${filePath}`;

const runtimeCommand = (root: string, sourceDirectory: string, sourceEntrypoint: string, path: Path.Path): string =>
  `node "${path.join(root, installedRuntimeFile(sourceDirectory, stagedRuntimeEntrypoint(sourceEntrypoint)))}"`;

const registrationSourceEntrypoint = (
  feature: (typeof featureCatalog)[number],
  registration: {
    entrypoint: { _tag: "featureDefault" } | { _tag: "path"; value: string };
  },
): string => {
  if (feature.runtime._tag !== "hook") {
    return "";
  }

  return registration.entrypoint._tag === "path" ? registration.entrypoint.value : feature.runtime.sourceEntrypoint;
};

const desiredHookGroups = (input: {
  root: string;
  featureIds: ReadonlyArray<string>;
  selectedAgents: ReadonlyArray<AgentDefinition>;
  path: Path.Path;
}) => {
  if (!input.selectedAgents.some((agent) => agent.id === "claude-code")) {
    return new Map<string, ReadonlyArray<ManagedHookGroup>>();
  }

  const selectedIds = new Set(input.featureIds);
  const groups = new Map<string, ReadonlyArray<ManagedHookGroup>>();

  featureCatalog.forEach((feature) => {
    if (!selectedIds.has(feature.id) || feature.runtime._tag === "none") {
      return;
    }

    feature.runtime.registrations.forEach((registration) => {
      const entrypoint = registrationSourceEntrypoint(feature, registration);
      const command = runtimeCommand(input.root, feature.sourceDirectory, entrypoint, input.path);
      const group = managedHookGroupSchema.make({
        ...(registration.matcher._tag === "pattern" ? { matcher: registration.matcher.value } : {}),
        hooks: [{ type: "command", command }],
      });
      const current = groups.get(registration.event) ?? [];

      groups.set(registration.event, [...current, group]);
    });
  });

  return groups;
};

const propertyKey = (property: Node): string | undefined => {
  const key = property.children?.[0];

  return typeof key?.value === "string" ? key.value : undefined;
};

const objectProperties = (node: Node): ReadonlyArray<Node> => node.children ?? [];

const commaBetween = (input: { source: string; start: number; end: number }): number | undefined => {
  const offset = input.source.indexOf(",", input.start);

  return offset >= input.start && offset < input.end ? offset : undefined;
};

const removeJsonProperty = (input: { source: string; parent: Node; property: Node }): Either.Either<string, InstallError> => {
  const properties = objectProperties(input.parent);
  const index = properties.indexOf(input.property);
  const previous = properties[index - 1];
  const next = properties[index + 1];

  if (next !== undefined) {
    const comma = commaBetween({
      source: input.source,
      start: input.property.offset + input.property.length,
      end: next.offset,
    });
    if (comma === undefined) {
      return Either.left(new InstallError({ issue: "settings.json property separators could not be preserved safely." }));
    }

    return Either.right(input.source.slice(0, input.property.offset) + input.source.slice(comma + 1));
  }

  if (previous !== undefined) {
    const comma = commaBetween({
      source: input.source,
      start: previous.offset + previous.length,
      end: input.property.offset,
    });
    if (comma === undefined) {
      return Either.left(new InstallError({ issue: "settings.json property separators could not be preserved safely." }));
    }

    return Either.right(input.source.slice(0, comma) + input.source.slice(input.property.offset + input.property.length));
  }

  return Either.right(input.source.slice(0, input.property.offset) + input.source.slice(input.property.offset + input.property.length));
};

const editJsonValue = (input: { source: string; path: ReadonlyArray<string>; value: unknown }): Either.Either<string, InstallError> => {
  const root = parseTree(input.source);
  const key = input.path.at(-1);
  const parent = root === undefined ? undefined : findNodeAtLocation(root, input.path.slice(0, -1));
  if (root === undefined || key === undefined || parent?.type !== "object") {
    return Either.left(new InstallError({ issue: `settings.json path /${input.path.join("/")} is not an editable object property.` }));
  }

  const properties = objectProperties(parent);
  const property = properties.find((candidate) => propertyKey(candidate) === key);
  if (property !== undefined) {
    if (input.value === undefined) {
      return removeJsonProperty({ source: input.source, parent, property });
    }

    const currentValue = property.children?.[1];
    if (currentValue === undefined) {
      return Either.left(new InstallError({ issue: `settings.json property ${key} has no value.` }));
    }

    const encoded = Schema.encodeSync(jsonValueSchema)(input.value);
    return Either.right(
      input.source.slice(0, currentValue.offset) + encoded + input.source.slice(currentValue.offset + currentValue.length),
    );
  }

  if (input.value === undefined) {
    return Either.right(input.source);
  }

  const previous = properties.at(-1);
  const previousKey = previous?.children?.[0];
  const previousValue = previous?.children?.[1];
  const keyValueSeparator =
    previousKey === undefined || previousValue === undefined
      ? ":"
      : input.source.slice(previousKey.offset + previousKey.length, previousValue.offset);
  const encodedProperty = `${JSON.stringify(key)}${keyValueSeparator}${Schema.encodeSync(jsonValueSchema)(input.value)}`;
  const offset = previous === undefined ? parent.offset + 1 : previous.offset + previous.length;
  const closingOffset = parent.offset + parent.length - 1;
  const closingWhitespace = previous === undefined ? "" : input.source.slice(offset, closingOffset);
  const prefix = previous === undefined ? "" : `,${closingWhitespace}`;

  return Either.right(input.source.slice(0, offset) + prefix + encodedProperty + input.source.slice(offset));
};

const jsonPropertyAtPath = (input: {
  source: string;
  path: ReadonlyArray<string>;
}): Either.Either<{ parent: Node; property: Node }, InstallError> => {
  const root = parseTree(input.source);
  const key = input.path.at(-1);
  const parent = root === undefined ? undefined : findNodeAtLocation(root, input.path.slice(0, -1));
  const property =
    parent?.type === "object" && key !== undefined
      ? objectProperties(parent).find((candidate) => propertyKey(candidate) === key)
      : undefined;

  return property === undefined || parent === undefined
    ? Either.left(new InstallError({ issue: `settings.json property /${input.path.join("/")} could not be located.` }))
    : Either.right({ parent, property });
};

const captureJsonValueLexical = (input: {
  source: string;
  path: ReadonlyArray<string>;
}): Either.Either<PreviousJsonLexical, InstallError> => {
  const located = jsonPropertyAtPath(input);
  if (Either.isLeft(located)) {
    return Either.left(located.left);
  }

  const value = located.right.property.children?.[1];

  return value === undefined
    ? Either.left(new InstallError({ issue: `settings.json property /${input.path.join("/")} has no value.` }))
    : Either.right({
        _tag: "value",
        source: input.source.slice(value.offset, value.offset + value.length),
      });
};

const removeJsonPropertyWithLexical = (input: {
  source: string;
  path: ReadonlyArray<string>;
}): Either.Either<{ source: string; lexical: PreviousJsonLexical }, InstallError> => {
  const located = jsonPropertyAtPath(input);
  if (Either.isLeft(located)) {
    return Either.left(located.left);
  }

  const { parent, property } = located.right;
  const properties = objectProperties(parent);
  const index = properties.indexOf(property);
  const previous = properties[index - 1];
  const next = properties[index + 1];
  const propertySource = input.source.slice(property.offset, property.offset + property.length);

  if (next !== undefined) {
    const separator = input.source.slice(property.offset + property.length, next.offset);
    const comma = commaBetween({ source: separator, start: 0, end: separator.length });
    const nextKey = propertyKey(next);
    if (comma === undefined || nextKey === undefined) {
      return Either.left(new InstallError({ issue: "settings.json next-property evidence could not be captured safely." }));
    }

    return Either.right({
      source: input.source.slice(0, property.offset) + input.source.slice(next.offset),
      lexical: { _tag: "beforeProperty", property: propertySource, separator, nextKey },
    });
  }

  if (previous !== undefined) {
    const separator = input.source.slice(previous.offset + previous.length, property.offset);
    const comma = commaBetween({ source: separator, start: 0, end: separator.length });
    const previousKey = propertyKey(previous);
    if (comma === undefined || previousKey === undefined) {
      return Either.left(new InstallError({ issue: "settings.json previous-property evidence could not be captured safely." }));
    }

    return Either.right({
      source: input.source.slice(0, previous.offset + previous.length) + input.source.slice(property.offset + property.length),
      lexical: { _tag: "afterProperty", previousKey, separator, property: propertySource },
    });
  }

  const parentStart = parent.offset + 1;
  const parentEnd = parent.offset + parent.length - 1;

  return Either.right({
    source: input.source.slice(0, property.offset) + input.source.slice(property.offset + property.length),
    lexical: {
      _tag: "onlyProperty",
      prefix: input.source.slice(parentStart, property.offset),
      property: propertySource,
      suffix: input.source.slice(property.offset + property.length, parentEnd),
    },
  });
};

const restoreJsonLexical = (input: {
  source: string;
  path: ReadonlyArray<string>;
  lexical: PreviousJsonLexical;
}): Either.Either<string, InstallError> => {
  const lexical = input.lexical;

  if (lexical._tag === "value") {
    const located = jsonPropertyAtPath(input);
    if (Either.isLeft(located)) {
      return Either.left(located.left);
    }

    const value = located.right.property.children?.[1];

    return value === undefined
      ? Either.left(new InstallError({ issue: `settings.json property /${input.path.join("/")} has no value.` }))
      : Either.right(input.source.slice(0, value.offset) + lexical.source + input.source.slice(value.offset + value.length));
  }

  const root = parseTree(input.source);
  const parentPath = input.path.slice(0, -1);
  const parent = root === undefined ? undefined : findNodeAtLocation(root, parentPath);
  const key = input.path.at(-1);
  if (parent?.type !== "object" || key === undefined) {
    return Either.left(new InstallError({ issue: `Settings parent /${parentPath.join("/")} cannot be restored safely.` }));
  }

  const properties = objectProperties(parent);
  if (properties.some((property) => propertyKey(property) === key)) {
    return Either.left(new InstallError({ issue: `Settings property /${input.path.join("/")} unexpectedly exists.` }));
  }

  if (lexical._tag === "beforeProperty") {
    const next = properties.find((property) => propertyKey(property) === lexical.nextKey);

    return next === undefined
      ? Either.left(new InstallError({ issue: `Settings restoration anchor ${lexical.nextKey} is missing.` }))
      : Either.right(input.source.slice(0, next.offset) + lexical.property + lexical.separator + input.source.slice(next.offset));
  }

  if (lexical._tag === "afterProperty") {
    const previous = properties.find((property) => propertyKey(property) === lexical.previousKey);

    return previous === undefined
      ? Either.left(new InstallError({ issue: `Settings restoration anchor ${lexical.previousKey} is missing.` }))
      : Either.right(
          input.source.slice(0, previous.offset + previous.length) +
            lexical.separator +
            lexical.property +
            input.source.slice(previous.offset + previous.length),
        );
  }

  const parentStart = parent.offset + 1;
  const parentEnd = parent.offset + parent.length - 1;
  const currentInterior = input.source.slice(parentStart, parentEnd);
  if (properties.length > 0 || currentInterior !== lexical.prefix + lexical.suffix) {
    return Either.left(new InstallError({ issue: `Settings sole-property framing changed at /${parentPath.join("/")}.` }));
  }

  return Either.right(
    input.source.slice(0, parentStart) + lexical.prefix + lexical.property + lexical.suffix + input.source.slice(parentEnd),
  );
};

const decodeGeneratedSettings = (source: string): Either.Either<SettingsDocument, InstallError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(Schema.parseJson(settingsDocumentSchema), {
      onExcessProperty: "preserve",
    })(source),
    (error) => new InstallError({ issue: `Generated settings.json is invalid: ${formatParseError(error)}` }),
  );

const legacyOwnershipValues = (input: {
  snapshot: FileSnapshot;
  decoded: DecodedSettings;
  legacySettings: LegacySettingsPlan;
}): Either.Either<ReadonlyArray<{ pointer: string; value: unknown }>, InstallError> => {
  if (input.legacySettings._tag === "none") {
    return Either.right([]);
  }

  if (input.snapshot._tag !== "file" || !bytesEqual(input.snapshot.bytes, input.legacySettings.originalBytes)) {
    return Either.left(new InstallError({ issue: "Legacy settings evidence does not match the inspected settings bytes." }));
  }

  return Either.all(
    input.legacySettings.values.map((evidence) => {
      const current = settingsValueAtPointer(input.decoded.document, evidence.pointer);
      if (current === undefined || hashJsonValue(current) !== evidence.currentValueHash) {
        return Either.left(new InstallError({ issue: `Legacy settings value ${evidence.pointer} changed after configuration planning.` }));
      }

      return Either.right({ pointer: evidence.pointer, value: current });
    }),
  );
};

const retainedDeletedSettingsValues = (
  previous: JsonValuesOwnership | undefined,
  legacy: ReadonlyArray<OwnedJsonValue>,
): ReadonlyArray<OwnedJsonValue> => {
  const retained = previous?.values.filter((value) => value.installed._tag === "missing") ?? [];

  return [...retained, ...legacy.filter((value) => !retained.some((candidate) => candidate.pointer === value.pointer))];
};

const planSettings = (input: {
  snapshot: FileSnapshot;
  decoded: DecodedSettings;
  previousArtifact: ReceiptEntry | undefined;
  desiredGroups: ReadonlyMap<string, ReadonlyArray<ManagedHookGroup>>;
  legacySettings: LegacySettingsPlan;
}): Either.Either<ArtifactOperation | undefined, InstallError> => {
  const previousOwnership = input.previousArtifact?.ownership._tag === "jsonValues" ? input.previousArtifact.ownership : undefined;
  if (
    input.previousArtifact !== undefined &&
    (input.previousArtifact.path !== settingsPath ||
      input.previousArtifact.kind._tag !== "settings" ||
      input.previousArtifact.owner._tag !== "application" ||
      previousOwnership === undefined)
  ) {
    return Either.left(new InstallError({ issue: "Receipted settings entry must keep its exact path, kind, and application owner." }));
  }

  if (previousOwnership !== undefined && input.snapshot._tag === "missing") {
    return Either.left(new InstallError({ issue: "Receipted settings.json was removed after installation." }));
  }

  const currentOwnership = validateCurrentSettingsOwnership(input.decoded.document, previousOwnership);
  if (Either.isLeft(currentOwnership)) {
    return Either.left(currentOwnership.left);
  }

  const legacyCandidates = legacyOwnershipValues(input);
  if (Either.isLeft(legacyCandidates)) {
    return Either.left(legacyCandidates.left);
  }

  let source = input.decoded.source;
  const legacyValues: Array<OwnedJsonValue> = [];

  // Remove only the exact legacy pointers proven by Task 8 evidence.
  for (const candidate of legacyCandidates.right) {
    const removed = removeJsonPropertyWithLexical({
      source,
      path: jsonPointerPath(candidate.pointer),
    });
    if (Either.isLeft(removed)) {
      return Either.left(removed.left);
    }

    source = removed.right.source;
    legacyValues.push({
      pointer: candidate.pointer,
      installed: { _tag: "missing" },
      previous: { _tag: "value", value: candidate.value, lexical: removed.right.lexical },
    });
  }

  const previousEvents =
    previousOwnership?.values.flatMap((value) => {
      const event = hookEventFromPointer(value.pointer);

      return event === undefined ? [] : [event];
    }) ?? [];
  const removedEvents = previousEvents.filter((event) => !input.desiredGroups.has(event)).reverse();
  const events = [...new Set([...removedEvents, ...input.desiredGroups.keys()])];
  const createdHooksContainer =
    previousOwnership?.createdContainers.includes("/hooks") === true ||
    (input.decoded.document.hooks === undefined && input.desiredGroups.size > 0);
  const ownershipValues: Array<OwnedJsonValue> = [...retainedDeletedSettingsValues(previousOwnership, legacyValues)];

  if (input.decoded.document.hooks === undefined && input.desiredGroups.size > 0) {
    const edited = editJsonValue({ source, path: ["hooks"], value: {} });
    if (Either.isLeft(edited)) {
      return Either.left(edited.left);
    }

    source = edited.right;
  }

  // Restore removed events and materialize every desired event from its original value plus catalog hook groups.
  for (const event of events) {
    const base = baseHookGroups({
      ownership: previousOwnership,
      document: input.decoded.document,
      event,
      source,
    });
    if (Either.isLeft(base)) {
      return Either.left(base.left);
    }

    const desired = input.desiredGroups.get(event);
    const value = desired === undefined ? undefined : [...base.right.groups, ...desired];
    const edited =
      desired === undefined && base.right.previous._tag === "value" && base.right.previous.lexical !== undefined
        ? restoreJsonLexical({ source, path: ["hooks", event], lexical: base.right.previous.lexical })
        : editJsonValue({
            source,
            path: ["hooks", event],
            value: desired === undefined ? undefined : value,
          });
    if (Either.isLeft(edited)) {
      return Either.left(edited.left);
    }

    source = edited.right;
    if (desired !== undefined) {
      ownershipValues.push({
        pointer: `/hooks/${event}`,
        installed: { _tag: "value", hash: hashJsonValue(value) },
        previous: base.right.previous,
      });
    }
  }

  let finalDocument = decodeGeneratedSettings(source);
  if (Either.isLeft(finalDocument)) {
    return Either.left(finalDocument.left);
  }

  if (createdHooksContainer && finalDocument.right.hooks !== undefined && Object.keys(finalDocument.right.hooks).length === 0) {
    const edited = editJsonValue({ source, path: ["hooks"], value: undefined });
    if (Either.isLeft(edited)) {
      return Either.left(edited.left);
    }

    source = edited.right;
    finalDocument = decodeGeneratedSettings(source);
    if (Either.isLeft(finalDocument)) {
      return Either.left(finalDocument.left);
    }
  }

  if (ownershipValues.length === 0) {
    if (input.previousArtifact === undefined) {
      return Either.right(undefined);
    }

    const removeFile = !previousOwnership?.filePreviouslyPresent && Object.keys(finalDocument.right).length === 0;
    const operation = removeFile
      ? {
          _tag: "remove",
          artifact: input.previousArtifact,
          unownedBytes: new Uint8Array(),
          expectedCurrent: expectedCurrent(input.snapshot),
        }
      : {
          _tag: "restore",
          artifact: input.previousArtifact,
          bytes: textEncoder.encode(source),
          expectedCurrent: expectedCurrent(input.snapshot),
        };

    return validateSettingsOperation(operation);
  }

  const containerCandidates = [...(previousOwnership?.createdContainers ?? []), ...(createdHooksContainer ? ["/hooks"] : [])];
  const createdContainers = containerCandidates.filter(
    (container, index) =>
      containerCandidates.indexOf(container) === index && ownershipValues.some((value) => value.pointer.startsWith(`${container}/`)),
  );

  const ownership: JsonValuesOwnership = {
    _tag: "jsonValues",
    filePreviouslyPresent: previousOwnership?.filePreviouslyPresent ?? input.snapshot._tag === "file",
    createdContainers,
    values: ownershipValues,
  };
  const operation = {
    _tag: "write",
    artifact: {
      owner: applicationOwner,
      path: settingsPath,
      kind: { _tag: "settings" },
      ownership,
    },
    bytes: textEncoder.encode(source),
    expectedCurrent: expectedCurrent(input.snapshot),
  };

  const mismatchedValue = ownership.values.find((ownedValue) => {
    const value = settingsValueAtPointer(finalDocument.right, ownedValue.pointer);

    return !installedJsonValueMatches(ownedValue, value);
  });

  if (mismatchedValue !== undefined) {
    return Either.left(new InstallError({ issue: `Generated settings ownership drifted at ${mismatchedValue.pointer}.` }));
  }

  return validateSettingsOperation(operation);
};

const readStagedFiles = (directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = (yield* fileSystem.readDirectory(directory, { recursive: true })).sort();
    const files = yield* Effect.forEach(entries, (entry) =>
      Effect.gen(function* () {
        const sourcePath = path.join(directory, entry);
        const info = yield* fileSystem.stat(sourcePath);
        if (info.type === "Directory") {
          return Option.none<StagedRuntimeFile>();
        }

        if (info.type !== "File") {
          return yield* new InstallError({ issue: `Staged path ${sourcePath} must be a regular file.` });
        }

        return Option.some({ path: entry.replaceAll("\\", "/"), bytes: yield* fileSystem.readFile(sourcePath) });
      }),
    );

    return files.flatMap((file) => (Option.isSome(file) ? [file.value] : []));
  });

const createRuntimeWrites = (input: {
  request: InstallRequest;
  featureIds: ReadonlyArray<string>;
  previousReceipt: ArtifactReceipt | undefined;
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const selectedIds = new Set(input.featureIds);
    const runtimeFeatures = featureCatalog.filter((feature) => selectedIds.has(feature.id) && feature.runtime._tag === "hook");
    const writes = yield* Effect.forEach(runtimeFeatures, (feature) =>
      Effect.gen(function* () {
        if (feature.runtime._tag === "none") {
          return [];
        }

        const directory = path.join(input.request.stagedPackage.root, "runtime", feature.sourceDirectory);
        const files = yield* readStagedFiles(directory);
        const entrypoints = feature.runtime.registrations.map((registration) =>
          stagedRuntimeEntrypoint(registrationSourceEntrypoint(feature, registration)),
        );
        // Prove every registration entrypoint is present in the staged feature tree.
        for (const entrypoint of entrypoints) {
          if (!files.some((file) => file.path === entrypoint)) {
            return yield* new InstallError({ issue: `Staged runtime entrypoint is missing: ${feature.sourceDirectory}/${entrypoint}` });
          }
        }

        return yield* Effect.forEach(files, (file) =>
          Effect.gen(function* () {
            const artifactPath = installedRuntimeFile(feature.sourceDirectory, file.path);
            const snapshot = yield* readFileSnapshot(path.join(input.request.destination.root, artifactPath));
            const previous = yield* effectFromEither(previousWholeFile(input.previousReceipt, artifactPath, snapshot));

            return yield* effectFromEither(
              validateArtifactOperation({
                _tag: "write",
                artifact: {
                  owner: applicationOwner,
                  path: artifactPath,
                  kind: { _tag: "runtime" },
                  ownership: {
                    _tag: "wholeFile",
                    installedHash: hashBytes(file.bytes),
                    previous,
                  },
                },
                bytes: file.bytes,
                expectedCurrent: expectedCurrent(snapshot),
              }),
            );
          }),
        );
      }),
    );

    return writes.flat();
  });

const decodeStagedMarkdown = (bytes: Uint8Array, filePath: string): Either.Either<string, InstallError> => {
  const decoded = Either.try({
    try: () => textDecoder.decode(bytes),
    catch: (error) => new InstallError({ issue: `${filePath} is not strict UTF-8: ${formatUnknownError(error)}` }),
  });

  return Either.flatMap(decoded, (markdown) =>
    markdown.startsWith("\uFEFF")
      ? Either.left(new InstallError({ issue: `${filePath} must not start with a UTF-8 byte-order mark.` }))
      : Either.right(markdown),
  );
};

const readStagedSkills = (input: { request: InstallRequest; featureIds: ReadonlyArray<Schema.Schema.Type<typeof featureIdSchema>> }) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const skills = installedSkillsFor(input.featureIds);

    return yield* Effect.forEach(skills, (installedSkill) =>
      Effect.gen(function* () {
        const directory = path.join(input.request.stagedPackage.root, "skills", installedSkill.id);
        const sourceFiles = yield* readStagedFiles(directory);
        const skillFile = sourceFiles.find((file) => file.path === "SKILL.md");
        if (skillFile === undefined) {
          return yield* new InstallError({ issue: `Staged skill ${installedSkill.id} is missing SKILL.md.` });
        }

        const markdown = yield* effectFromEither(decodeStagedMarkdown(skillFile.bytes, path.join(directory, "SKILL.md")));

        return yield* Schema.validate(stagedInstalledSkillSchema, {
          onExcessProperty: "error",
        })({ installedSkill, sourceFiles, markdown }).pipe(
          Effect.mapError(
            (error) => new InstallError({ issue: `Staged skill ${installedSkill.id} is invalid: ${formatParseError(error)}` }),
          ),
        );
      }),
    );
  });

const inspectArtifacts = (root: string, artifactPaths: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    return yield* Effect.forEach(
      artifactPaths,
      (artifactPath): Effect.Effect<InspectedArtifact, PlatformError, FileSystem.FileSystem> =>
        readFileSnapshot(path.join(root, artifactPath)).pipe(Effect.map((snapshot) => ({ path: artifactPath, snapshot }))),
    );
  });

const inspectedSnapshot = (
  inspected: ReadonlyArray<InspectedArtifact>,
  artifactPath: string,
): Either.Either<FileSnapshot, InstallError> => {
  const found = inspected.find((artifact) => artifact.path === artifactPath);

  return found === undefined
    ? Either.left(new InstallError({ issue: `Missing inspected state for ${artifactPath}.` }))
    : Either.right(found.snapshot);
};

const previousWholeFile = (
  receipt: ArtifactReceipt | undefined,
  artifactPath: string,
  snapshot: FileSnapshot,
): Either.Either<PreviousFileValue, InstallError> => {
  const artifact = previousReceiptArtifact(receipt, artifactPath);
  if (artifact === undefined) {
    return Either.right(previousFile(snapshot));
  }

  if (artifact.ownership._tag !== "wholeFile") {
    return Either.left(new InstallError({ issue: `Receipted whole-file artifact ${artifactPath} has incompatible ownership.` }));
  }

  if (snapshot._tag !== "file" || hashBytes(snapshot.bytes) !== artifact.ownership.installedHash) {
    return Either.left(new InstallError({ issue: `Receipted whole-file artifact ${artifactPath} changed after installation.` }));
  }

  return Either.right(artifact.ownership.previous);
};

const guardHandlerOperations = (
  operations: ReadonlyArray<unknown>,
  inspected: ReadonlyArray<InspectedArtifact>,
): Either.Either<ReadonlyArray<ArtifactOperation>, InstallError> =>
  Either.all(
    operations.map((operation) => {
      if (!Predicate.isRecord(operation)) {
        return Either.left(new InstallError({ issue: "Format handler returned a non-object operation." }));
      }

      const artifact = Schema.decodeUnknownEither(
        Schema.Struct({ artifact: Schema.Struct({ path: Schema.String }) }, Schema.Record({ key: Schema.String, value: Schema.Unknown })),
        { onExcessProperty: "preserve" },
      )(operation);
      if (Either.isLeft(artifact)) {
        return Either.left(new InstallError({ issue: `Format handler returned an invalid operation: ${formatParseError(artifact.left)}` }));
      }

      return Either.flatMap(inspectedSnapshot(inspected, artifact.right.artifact.path), (snapshot) =>
        validateArtifactOperation({
          ...operation,
          expectedCurrent: expectedCurrent(snapshot),
        }),
      );
    }),
  );

const mapFormatError = <Value>(result: Either.Either<Value, unknown>): Either.Either<Value, InstallError> =>
  Either.mapLeft(result, toInstallError);

const controlPath = (root: string, path: Path.Path): Either.Either<string, InstallError> => {
  // Loop control lives under context-guard (ctxLoopCtl), not the skill-only autorun feature.
  const feature = featureCatalog.find((candidate) => candidate.id === "context-guard");
  if (feature?.runtime._tag !== "hook") {
    return Either.left(new InstallError({ issue: "The context-guard catalog feature must declare one runtime entrypoint." }));
  }

  return Either.right(path.join(root, installedRuntimeFile(feature.sourceDirectory, "hooks/ctxLoopCtl.js")));
};

const createSkillDirectoryWrites = (input: {
  request: InstallRequest;
  agent: AgentDefinition;
  stagedSkills: ReadonlyArray<StagedInstalledSkill>;
  previousReceipt: ArtifactReceipt | undefined;
  ctl: string;
}) =>
  Effect.gen(function* () {
    if (input.agent.target._tag !== "skillDirectory") {
      return [];
    }

    const target = input.agent.target;
    const paths = input.stagedSkills.flatMap((skill) =>
      skill.sourceFiles.map((file) => `${target.path}/${skill.installedSkill.id}/${file.path}`),
    );
    const inspected = yield* inspectArtifacts(input.request.destination.root, paths);
    const previousFiles = yield* Effect.forEach(inspected, (artifact) =>
      effectFromEither(previousWholeFile(input.previousReceipt, artifact.path, artifact.snapshot)).pipe(
        Effect.map((previous) => ({ path: artifact.path, previous })),
      ),
    );
    const plan = yield* effectFromEither(
      mapFormatError(
        planSkillDirectory({
          agent: input.agent,
          ctl: input.ctl,
          skills: input.stagedSkills.map((skill) => ({
            installedSkill: skill.installedSkill,
            sourceFiles: skill.sourceFiles,
          })),
          previousFiles,
        }),
      ),
    );

    return yield* effectFromEither(guardHandlerOperations(plan.writes, inspected));
  });

const createRuleFileWrites = (input: {
  request: InstallRequest;
  agent: AgentDefinition;
  stagedSkills: ReadonlyArray<StagedInstalledSkill>;
  previousReceipt: ArtifactReceipt | undefined;
  ctl: string;
}) =>
  Effect.gen(function* () {
    if (input.agent.target._tag !== "ruleFile") {
      return [];
    }

    const target = input.agent.target;
    const paths = input.stagedSkills.map((skill) => `${target.directory}/${skill.installedSkill.id}${target.extension}`);
    const inspected = yield* inspectArtifacts(input.request.destination.root, paths);
    const previousFiles = yield* Effect.forEach(inspected, (artifact) =>
      effectFromEither(previousWholeFile(input.previousReceipt, artifact.path, artifact.snapshot)).pipe(
        Effect.map((previous) => ({ path: artifact.path, previous })),
      ),
    );
    const plan = yield* effectFromEither(
      mapFormatError(
        planRuleFiles({
          agent: input.agent,
          ctl: input.ctl,
          skills: input.stagedSkills.map((skill) => ({
            installedSkill: skill.installedSkill,
            markdown: skill.markdown,
          })),
          previousFiles,
        }),
      ),
    );

    return yield* effectFromEither(guardHandlerOperations(plan.writes, inspected));
  });

const instructionPathForAgent = (agent: AgentDefinition): string | undefined => {
  if (agent.target._tag === "instructionFile") {
    return agent.target.path;
  }

  return agent.target._tag === "configReference" ? agent.target.instructionPath : undefined;
};

const createInstructionWrites = (input: {
  request: InstallRequest;
  selectedAgents: ReadonlyArray<AgentDefinition>;
  stagedSkills: ReadonlyArray<StagedInstalledSkill>;
  previousReceipt: ArtifactReceipt | undefined;
  ctl: string;
}) =>
  Effect.gen(function* () {
    if (input.stagedSkills.length === 0) {
      return [];
    }

    const candidatePaths = input.selectedAgents.flatMap((agent) => {
      const artifactPath = instructionPathForAgent(agent);

      return artifactPath === undefined ? [] : [artifactPath];
    });
    const instructionPaths = candidatePaths.filter((artifactPath, index) => candidatePaths.indexOf(artifactPath) === index);
    const path = yield* Path.Path;
    const operations = yield* Effect.forEach(instructionPaths, (artifactPath) =>
      Effect.gen(function* () {
        const owners = input.selectedAgents.filter((agent) => instructionPathForAgent(agent) === artifactPath);
        const snapshot = yield* readFileSnapshot(path.join(input.request.destination.root, artifactPath));
        const previousArtifact = previousReceiptArtifact(input.previousReceipt, artifactPath);
        if (previousArtifact !== undefined && previousArtifact.kind._tag !== "instruction") {
          return yield* new InstallError({ issue: `Receipted instruction path ${artifactPath} has an incompatible artifact kind.` });
        }

        const plan = yield* effectFromEither(
          mapFormatError(
            planInstructionFile({
              path: artifactPath,
              desired: {
                _tag: "present",
                agentIds: owners.map((agent) => agent.id),
                skills: input.stagedSkills.map((skill) => ({
                  installedSkill: skill.installedSkill,
                  markdown: skill.markdown,
                })),
                ctl: input.ctl,
              },
              currentFile: snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "file", bytes: snapshot.bytes },
              previousArtifact: previousArtifact === undefined ? { _tag: "missing" } : { _tag: "owned", artifact: previousArtifact },
            }),
          ),
        );
        if (plan._tag === "none") {
          return [];
        }

        return [yield* effectFromEither(validateArtifactOperation({ ...plan, expectedCurrent: expectedCurrent(snapshot) }))];
      }),
    );

    return operations.flat();
  });

const createConfigReferenceWrites = (input: {
  request: InstallRequest;
  selectedAgents: ReadonlyArray<AgentDefinition>;
  stagedSkills: ReadonlyArray<StagedInstalledSkill>;
  previousReceipt: ArtifactReceipt | undefined;
}) =>
  Effect.gen(function* () {
    if (input.stagedSkills.length === 0) {
      return [];
    }

    const path = yield* Path.Path;
    const agents = input.selectedAgents.filter((agent) => agent.target._tag === "configReference");
    const operations = yield* Effect.forEach(agents, (agent) =>
      Effect.gen(function* () {
        if (agent.target._tag !== "configReference") {
          return [];
        }

        const snapshot = yield* readFileSnapshot(path.join(input.request.destination.root, agent.target.configPath));
        const previousArtifact = previousReceiptArtifact(input.previousReceipt, agent.target.configPath);
        if (previousArtifact !== undefined && previousArtifact.kind._tag !== "configReference") {
          return yield* new InstallError({
            issue: `Receipted native config path ${agent.target.configPath} has an incompatible artifact kind.`,
          });
        }

        const plan = yield* effectFromEither(
          mapFormatError(
            planConfigReference({
              agent,
              desired: { _tag: "present" },
              currentFile: snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "file", bytes: snapshot.bytes },
              previousArtifact: previousArtifact === undefined ? { _tag: "missing" } : { _tag: "owned", artifact: previousArtifact },
            }),
          ),
        );
        if (plan._tag === "none") {
          return [];
        }

        return [yield* effectFromEither(validateArtifactOperation({ ...plan, expectedCurrent: expectedCurrent(snapshot) }))];
      }),
    );

    return operations.flat();
  });

const createAgentWrites = (input: {
  request: InstallRequest;
  selectedAgents: ReadonlyArray<AgentDefinition>;
  stagedSkills: ReadonlyArray<StagedInstalledSkill>;
  previousReceipt: ArtifactReceipt | undefined;
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const ctl = yield* effectFromEither(controlPath(input.request.destination.root, path));
    const directoryWrites = yield* Effect.forEach(input.selectedAgents, (agent) =>
      createSkillDirectoryWrites({
        request: input.request,
        agent,
        stagedSkills: input.stagedSkills,
        previousReceipt: input.previousReceipt,
        ctl,
      }),
    );
    const ruleWrites = yield* Effect.forEach(input.selectedAgents, (agent) =>
      createRuleFileWrites({
        request: input.request,
        agent,
        stagedSkills: input.stagedSkills,
        previousReceipt: input.previousReceipt,
        ctl,
      }),
    );
    const instructionWrites = yield* createInstructionWrites({ ...input, ctl });
    const configReferenceWrites = yield* createConfigReferenceWrites(input);

    return [...directoryWrites.flat(), ...ruleWrites.flat(), ...instructionWrites, ...configReferenceWrites];
  });

const restoreWholeFile = (input: { artifact: ReceiptEntry; snapshot: FileSnapshot }): Either.Either<ArtifactOperation, InstallError> => {
  if (input.artifact.ownership._tag !== "wholeFile") {
    return Either.left(new InstallError({ issue: `Artifact ${input.artifact.path} requires a format-specific restoration.` }));
  }

  if (input.snapshot._tag !== "file" || hashBytes(input.snapshot.bytes) !== input.artifact.ownership.installedHash) {
    return Either.left(new InstallError({ issue: `Receipted artifact ${input.artifact.path} changed after installation.` }));
  }

  const operation =
    input.artifact.ownership.previous._tag === "missing"
      ? {
          _tag: "remove",
          artifact: input.artifact,
          unownedBytes: new Uint8Array(),
          expectedCurrent: expectedCurrent(input.snapshot),
        }
      : {
          _tag: "restore",
          artifact: input.artifact,
          bytes: input.artifact.ownership.previous.bytes,
          expectedCurrent: expectedCurrent(input.snapshot),
        };

  return validateArtifactOperation(operation);
};

const restoreInstructionFile = (input: {
  artifact: ReceiptEntry;
  snapshot: FileSnapshot;
}): Either.Either<ArtifactOperation, InstallError> => {
  const plan = mapFormatError(
    planInstructionFile({
      path: input.artifact.path,
      desired: { _tag: "absent" },
      currentFile: input.snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "file", bytes: input.snapshot.bytes },
      previousArtifact: { _tag: "owned", artifact: input.artifact },
    }),
  );

  return Either.flatMap(plan, (operation) =>
    operation._tag === "none"
      ? Either.left(new InstallError({ issue: `Instruction restoration for ${input.artifact.path} returned no operation.` }))
      : validateArtifactOperation({ ...operation, expectedCurrent: expectedCurrent(input.snapshot) }),
  );
};

const restoreConfigReference = (input: {
  artifact: ReceiptEntry;
  snapshot: FileSnapshot;
}): Either.Either<ArtifactOperation, InstallError> => {
  if (input.artifact.owner._tag !== "agent" || input.artifact.owner.agentIds.length !== 1) {
    return Either.left(new InstallError({ issue: `Native config restoration for ${input.artifact.path} requires one agent owner.` }));
  }

  const agentId = input.artifact.owner.agentIds.at(0);
  const agent = agentCatalog.find((candidate) => candidate.id === agentId);
  if (agent === undefined || agent.target._tag !== "configReference") {
    return Either.left(new InstallError({ issue: `Native config restoration for ${input.artifact.path} has no catalog agent.` }));
  }

  const plan = mapFormatError(
    planConfigReference({
      agent,
      desired: { _tag: "absent" },
      currentFile: input.snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "file", bytes: input.snapshot.bytes },
      previousArtifact: { _tag: "owned", artifact: input.artifact },
    }),
  );

  return Either.flatMap(plan, (operation) =>
    operation._tag === "none"
      ? Either.left(new InstallError({ issue: `Native config restoration for ${input.artifact.path} returned no operation.` }))
      : validateArtifactOperation({ ...operation, expectedCurrent: expectedCurrent(input.snapshot) }),
  );
};

const restoreSettingsArtifact = (input: {
  artifact: ReceiptEntry;
  snapshot: FileSnapshot;
}): Either.Either<ArtifactOperation, InstallError> => {
  if (
    input.artifact.kind._tag !== "settings" ||
    input.artifact.owner._tag !== "application" ||
    input.artifact.ownership._tag !== "jsonValues"
  ) {
    return Either.left(new InstallError({ issue: `Settings restoration for ${input.artifact.path} has invalid ownership.` }));
  }

  if (input.snapshot._tag === "missing") {
    return Either.left(new InstallError({ issue: `Receipted settings file ${input.artifact.path} was removed after installation.` }));
  }

  const decoded = decodeSettings(input.snapshot);
  if (Either.isLeft(decoded)) {
    return Either.left(decoded.left);
  }

  const currentOwnership = validateCurrentSettingsOwnership(decoded.right.document, input.artifact.ownership);
  if (Either.isLeft(currentOwnership)) {
    return Either.left(currentOwnership.left);
  }

  let source = decoded.right.source;

  const values = [...input.artifact.ownership.values].reverse();

  // Reverse append order while restoring each pointer to its original state.
  for (const value of values) {
    const pointerPath = jsonPointerPath(value.pointer);
    const restored =
      value.previous._tag === "missing"
        ? editJsonValue({ source, path: pointerPath, value: undefined })
        : value.previous.lexical === undefined
          ? Either.left(new InstallError({ issue: `Settings value ${value.pointer} lacks lexical restoration evidence.` }))
          : restoreJsonLexical({ source, path: pointerPath, lexical: value.previous.lexical });
    if (Either.isLeft(restored)) {
      return Either.left(restored.left);
    }

    source = restored.right;
  }

  const containers = [...input.artifact.ownership.createdContainers].reverse();

  // Remove only installer-created containers that became empty after pointer restoration.
  for (const pointer of containers) {
    const pointerPath = jsonPointerPath(pointer);
    const root = parseTree(source);
    const container = root === undefined ? undefined : findNodeAtLocation(root, [...pointerPath]);
    if (container?.type !== "object" || objectProperties(container).length > 0) {
      continue;
    }

    const restored = editJsonValue({ source, path: pointerPath, value: undefined });
    if (Either.isLeft(restored)) {
      return Either.left(restored.left);
    }

    source = restored.right;
  }

  const document = decodeGeneratedSettings(source);
  if (Either.isLeft(document)) {
    return Either.left(document.left);
  }

  const operation =
    !input.artifact.ownership.filePreviouslyPresent && Object.keys(document.right).length === 0
      ? {
          _tag: "remove",
          artifact: input.artifact,
          unownedBytes: new Uint8Array(),
          expectedCurrent: expectedCurrent(input.snapshot),
        }
      : {
          _tag: "restore",
          artifact: input.artifact,
          bytes: textEncoder.encode(source),
          expectedCurrent: expectedCurrent(input.snapshot),
        };

  return validateArtifactOperation(operation);
};

export const artifactRestorationRequestSchema = Schema.Struct({
  root: absoluteRootSchema.annotations({
    description: "Canonical installation root containing the receipted artifacts.",
  }),
  artifacts: Schema.Array(Schema.typeSchema(receiptEntrySchema)).annotations({
    description: "Exact receipt entries whose final unowned state must be materialized.",
  }),
}).annotations({
  description: "Receipt-authorized artifact restoration request with no detection authority.",
});

export type ArtifactRestorationRequest = Schema.Schema.Type<typeof artifactRestorationRequestSchema>;

const decodeArtifactRestorationRequest = (input: unknown) =>
  Schema.decodeUnknown(artifactRestorationRequestSchema, {
    onExcessProperty: "error",
  })(input).pipe(Effect.mapError((error) => new InstallError({ issue: formatParseError(error) })));

// Materialize final unowned bytes from exact receipt entries without mutating the filesystem.
export const materializeArtifactRestorations = (input: unknown) =>
  Effect.gen(function* () {
    // 1. Decode receipt authority before inspecting any artifact target.
    const request = yield* decodeArtifactRestorationRequest(input);
    const path = yield* Path.Path;

    // 2. Inspect every authorized artifact once and delegate to its format owner.
    return yield* Effect.forEach(request.artifacts, (artifact) =>
      Effect.gen(function* () {
        const snapshot = yield* readFileSnapshot(path.join(request.root, artifact.path));
        if (artifact.kind._tag === "instruction") {
          return yield* effectFromEither(restoreInstructionFile({ artifact, snapshot }));
        }

        if (artifact.kind._tag === "configReference") {
          return yield* effectFromEither(restoreConfigReference({ artifact, snapshot }));
        }

        if (artifact.kind._tag === "settings") {
          return yield* effectFromEither(restoreSettingsArtifact({ artifact, snapshot }));
        }

        return yield* effectFromEither(restoreWholeFile({ artifact, snapshot }));
      }),
    );
  }).pipe(Effect.mapError(toInstallError));

const createStaleRestorations = (input: {
  root: string;
  previousReceipt: ArtifactReceipt | undefined;
  desiredWrites: ReadonlyArray<ArtifactOperation>;
  settingsPlan: ArtifactOperation | undefined;
}) =>
  Effect.gen(function* () {
    if (input.previousReceipt === undefined) {
      return [];
    }

    const desiredPaths = new Set(input.desiredWrites.map((write) => write.artifact.path));
    const plannedSettingsRestoration =
      input.settingsPlan !== undefined && input.settingsPlan._tag !== "write" ? input.settingsPlan : undefined;
    const preplannedPaths = new Set(plannedSettingsRestoration === undefined ? [] : [plannedSettingsRestoration.artifact.path]);
    const staleArtifacts = input.previousReceipt.artifacts.filter(
      (artifact) => !desiredPaths.has(artifact.path) && !preplannedPaths.has(artifact.path),
    );
    const restorations = yield* materializeArtifactRestorations({ root: input.root, artifacts: staleArtifacts });

    return [...(plannedSettingsRestoration === undefined ? [] : [plannedSettingsRestoration]), ...restorations];
  });

const receiptTarget = (): ReceiptTarget => ({
  path: receiptPath,
  kind: { _tag: "receipt" },
  owner: applicationOwner,
});

const previousReceiptArtifact = (receipt: ArtifactReceipt | undefined, artifactPath: string): ReceiptEntry | undefined =>
  receipt?.artifacts.find((artifact) => artifact.path === artifactPath);

const automaticConfigSelection = (input: {
  request: InstallRequest;
  target: ConfigFileSnapshot;
  global: ConfigFileSnapshot | undefined;
  settings: DecodedSettings;
  settingsSnapshot: FileSnapshot;
}): ConfigureRequest["selection"] => {
  if (input.target._tag === "present") {
    return { _tag: "selected", config: input.target.config };
  }

  if (hasLegacySettingsCandidate(input.settings.document.env ?? {}) && input.settingsSnapshot._tag === "file") {
    return { _tag: "legacyEnvironment", settingsBytes: input.settingsSnapshot.bytes };
  }

  if (input.request.destination._tag === "project") {
    return { _tag: "firstProjectInstall", globalConfig: input.global ?? { _tag: "missing" } };
  }

  return { _tag: "selected", config: defaultBagConfig };
};

const createManagedConfigPlan = (input: {
  request: InstallRequest;
  snapshot: ConfigFileSnapshot;
  globalSnapshot: ConfigFileSnapshot | undefined;
  settings: DecodedSettings;
  settingsSnapshot: FileSnapshot;
  previousReceipt: ArtifactReceipt | undefined;
}): Either.Either<ManagedConfigPlan, InstallError> => {
  const snapshot = configSnapshotFile(input.snapshot);
  const previous = previousWholeFile(input.previousReceipt, managedConfigPath, snapshot);
  if (Either.isLeft(previous)) {
    return Either.left(previous.left);
  }

  const selection =
    input.request.configuration._tag === "selected"
      ? input.request.configuration
      : automaticConfigSelection({
          request: input.request,
          target: input.snapshot,
          global: input.globalSnapshot,
          settings: input.settings,
          settingsSnapshot: input.settingsSnapshot,
        });

  return Either.mapLeft(
    planManagedConfig({
      scope: input.request.destination._tag,
      selection,
      previousConfigFile: previous.right,
    }),
    toInstallError,
  );
};

const createInstallResult = (input: {
  tag: "installed" | "unchanged";
  request: InstallRequest;
  featureIds: ReadonlyArray<Schema.Schema.Type<typeof featureIdSchema>>;
  selectedAgents: ReadonlyArray<AgentDefinition>;
}): InstallResult =>
  Schema.validateSync(installResultSchema, {
    onExcessProperty: "error",
  })({
    _tag: input.tag,
    scope: input.request.destination._tag,
    features: input.featureIds,
    agents: input.selectedAgents.map((agent) => agent.id),
    platformRequirements: featureCatalog
      .filter((feature) => input.featureIds.includes(feature.id))
      .map((feature) => ({ featureId: feature.id, platform: feature.platform })),
    interaction: input.request.interaction,
  });

export const installationReconciliationSchema = Schema.Struct({
  request: Schema.typeSchema(installRequestSchema).annotations({
    description: "Decoded install request being reconciled.",
  }),
  receiptSnapshot: artifactReceiptSnapshotSchema.annotations({
    description: "Exact receipt state inspected once before reconciliation.",
  }),
}).annotations({
  description: "Decoded install request paired with its single ownership-receipt snapshot.",
});

export type InstallationReconciliation = Schema.Schema.Type<typeof installationReconciliationSchema>;

const decodeReconciliation = (input: unknown) =>
  Schema.decodeUnknown(installationReconciliationSchema, {
    onExcessProperty: "error",
  })(input).pipe(Effect.mapError((error) => new InstallError({ issue: formatParseError(error) })));

// Reconcile one decoded installation through a visible inspect, resolve, plan, validate, apply, and result pipeline.
export const reconcileInstallation = (input: unknown) =>
  Effect.gen(function* () {
    const reconciliation = yield* decodeReconciliation(input);
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const canonicalRoot = yield* fileSystem.realPath(reconciliation.request.destination.root);
    const canonicalHomeRoot = yield* fileSystem.realPath(reconciliation.request.host.homeRoot);
    const request = yield* decodeInstallRequest({
      ...reconciliation.request,
      destination: { ...reconciliation.request.destination, root: canonicalRoot },
      host: { homeRoot: canonicalHomeRoot },
    });

    // 2. Inspect the prior receipt and every application-owned host file exactly once.
    const configSnapshot = yield* readConfigFile(path.join(request.destination.root, managedConfigPath));
    const settingsSnapshot = yield* readFileSnapshot(path.join(request.destination.root, settingsPath));
    const settings = yield* effectFromEither(decodeSettings(settingsSnapshot));
    const previousReceipt = reconciliation.receiptSnapshot._tag === "present" ? reconciliation.receiptSnapshot.receipt : undefined;
    if (previousReceipt !== undefined && previousReceipt.scope !== request.destination._tag) {
      return yield* new InstallError({ issue: "Existing receipt scope does not match the requested destination." });
    }

    // 3. Resolve feature dependencies and agent identities only from the decoded catalogs.
    const featureIds = yield* effectFromEither(resolveFeatures(request));
    const selectedAgents = yield* effectFromEither(resolveAgents(request));

    // 4. Create pure format writes from staged bytes and exact inspected host snapshots.
    const runtimeWrites = yield* createRuntimeWrites({ request, featureIds, previousReceipt });
    const stagedSkills = yield* readStagedSkills({ request, featureIds });
    const agentWrites = yield* createAgentWrites({ request, selectedAgents, stagedSkills, previousReceipt });
    const shouldReadGlobalConfig =
      request.configuration._tag === "automatic" &&
      request.destination._tag === "project" &&
      configSnapshot._tag === "missing" &&
      !hasLegacySettingsCandidate(settings.document.env ?? {});
    const globalConfigSnapshot = shouldReadGlobalConfig
      ? yield* readConfigFile(path.join(request.host.homeRoot, managedConfigPath))
      : undefined;
    const managedConfigPlan = yield* effectFromEither(
      createManagedConfigPlan({
        request,
        snapshot: configSnapshot,
        globalSnapshot: globalConfigSnapshot,
        settings,
        settingsSnapshot,
        previousReceipt,
      }),
    );
    const managedConfigWrite = yield* effectFromEither(
      validateArtifactOperation({
        ...managedConfigPlan.managedConfigWrite,
        expectedCurrent: expectedCurrent(configSnapshotFile(configSnapshot)),
      }),
    );
    const hookGroups = desiredHookGroups({ root: request.destination.root, featureIds, selectedAgents, path });
    const settingsPlan = yield* effectFromEither(
      planSettings({
        snapshot: settingsSnapshot,
        decoded: settings,
        previousArtifact: previousReceiptArtifact(previousReceipt, settingsPath),
        desiredGroups: hookGroups,
        legacySettings: managedConfigPlan.legacySettings,
      }),
    );
    const settingsWrite = settingsPlan?._tag === "write" ? settingsPlan : undefined;
    const writes = [...runtimeWrites, ...agentWrites, managedConfigWrite, ...(settingsWrite === undefined ? [] : [settingsWrite])];
    const restorations = yield* createStaleRestorations({
      root: request.destination.root,
      previousReceipt,
      desiredWrites: writes,
      settingsPlan,
    });
    const receipt: ArtifactReceipt = {
      version: request.stagedPackage.version,
      scope: request.destination._tag,
      features: featureIds,
      artifacts: writes.map((write) => write.artifact),
    };

    // 5. Validate one complete update plan, including expected-current preconditions and receipt correlations.
    const plan = yield* effectFromEither(
      createUpdatePlan({
        root: request.destination.root,
        previous: previousReceipt === undefined ? { _tag: "missing" } : { _tag: "receipt", receipt: previousReceipt },
        restorations,
        desired: { receipt, writes },
        receiptTarget: receiptTarget(),
        receiptExpectedCurrent:
          reconciliation.receiptSnapshot._tag === "missing"
            ? { _tag: "missing" }
            : { _tag: "file", sha256: hashBytes(reconciliation.receiptSnapshot.bytes) },
      }),
    );

    const unchanged =
      previousReceipt !== undefined &&
      plan.operations.length === 0 &&
      plan.receipt._tag === "receiptPublish" &&
      receiptEqual(previousReceipt, plan.receipt.receipt);
    if (unchanged) {
      return createInstallResult({ tag: "unchanged", request, featureIds, selectedAgents });
    }

    // 6. Apply the validated plan through the single transactional filesystem writer.
    yield* applyArtifactPlan(plan);

    // 7. Return one schema-validated presentation value without leaking planning internals.
    return createInstallResult({ tag: "installed", request, featureIds, selectedAgents });
  }).pipe(Effect.mapError(toInstallError));

// Decode one install request, inspect its receipt once, then enter the shared reconciliation pipeline.
export const install = (input: unknown) =>
  Effect.gen(function* () {
    // 1. Decode the complete capability request before reading external state.
    const request = yield* decodeInstallRequest(input);
    const path = yield* Path.Path;
    const receiptSnapshot = yield* readArtifactReceiptSnapshot(path.join(request.destination.root, receiptPath));

    return yield* reconcileInstallation({ request, receiptSnapshot });
  }).pipe(Effect.mapError(toInstallError));
