import { createHash } from "node:crypto";

import { Either, ParseResult, Schema } from "effect";
import { applyEdits, type Node as JsonNode, modify, parseTree } from "jsonc-parser";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

import { agentCatalog, agentDefinitionSchema } from "../../catalog/agentCatalog.js";
import { findDuplicateJsonProperty } from "../../config/jsonDocument.js";
import {
  artifactKindSchema,
  artifactOwnerSchema,
  type JsonValuesOwnership,
  jsonValuesOwnershipSchema,
  type PreviousJsonValue,
  relativeArtifactPathSchema,
  type YamlSequenceValueOwnership,
  yamlSequenceValueOwnershipSchema,
} from "../artifactReceipt.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const jsonValueSchema = Schema.parseJson();
const instructionReferencesSchema = Schema.Array(Schema.String);
const isInstructionReferences = Schema.is(instructionReferencesSchema);
const agentDefinitionsEqual = Schema.equivalence(agentDefinitionSchema);

export class ConfigReferencePlanError extends Schema.TaggedError<ConfigReferencePlanError>()("ConfigReferencePlanError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable request, native configuration, or correlated-plan validation issue.",
  }),
}) {
  get message(): string {
    return `Cannot plan native config reference: ${this.issue}`;
  }
}

const formatParseError = (error: ParseResult.ParseError): string => ParseResult.TreeFormatter.formatErrorSync(error);

const formatUnknownError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const hashJsonValue = (value: unknown): string => hashBytes(textEncoder.encode(Schema.encodeSync(jsonValueSchema)(value)));

const jsonRulesOwnershipIsValid = (ownership: JsonValuesOwnership): boolean => {
  const ownedRules = ownership.values[0];

  return (
    ownership.values.length === 1 &&
    ownedRules?.pointer === "/rules" &&
    (ownedRules.previous._tag === "missing" || isInstructionReferences(ownedRules.previous.value))
  );
};

const configReferenceOwnershipSchema = Schema.Union(jsonValuesOwnershipSchema, yamlSequenceValueOwnershipSchema);

const configReferenceArtifactSchema = Schema.Struct({
  owner: artifactOwnerSchema.members[1].annotations({
    description: "Single catalog agent that owns this native config reference.",
  }),
  path: relativeArtifactPathSchema.annotations({
    description: "Exact native config path declared by the catalog target.",
  }),
  kind: artifactKindSchema.members[4].annotations({
    description: "Artifact kind fixed to a native config reference.",
  }),
  ownership: configReferenceOwnershipSchema.annotations({
    description: "Exact JSON member or YAML sequence history retained for restoration.",
  }),
});

const configReferenceWriteOperationFieldsSchema = Schema.TaggedStruct("write", {
  artifact: configReferenceArtifactSchema,
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Complete desired native configuration bytes.",
  }),
});

type ConfigReferenceWrite = Schema.Schema.Type<typeof configReferenceWriteOperationFieldsSchema>;

const configReferenceRestoreOperationSchema = Schema.TaggedStruct("restore", {
  artifact: configReferenceArtifactSchema,
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Exact unowned native configuration bytes left after restoration.",
  }),
});

const emptyConfigReferenceBytesSchema = Schema.Uint8ArrayFromSelf.pipe(
  Schema.filter((bytes) => bytes.byteLength === 0, {
    message: () => "Native config removal requires no remaining unowned bytes.",
  }),
);

const configReferenceRemoveOperationSchema = Schema.TaggedStruct("remove", {
  artifact: configReferenceArtifactSchema,
  unownedBytes: emptyConfigReferenceBytesSchema,
}).pipe(
  Schema.filter((operation) => {
    const ownership = operation.artifact.ownership;
    const ownedWholeCreatedFile =
      !ownership.filePreviouslyPresent &&
      (ownership._tag === "jsonValues"
        ? ownership.values.every((value) => value.previous._tag === "missing")
        : !ownership.previouslyPresent);

    return ownedWholeCreatedFile
      ? undefined
      : {
          path: ["artifact", "ownership"],
          message: "Native config removal requires proof that no prior file or owned member must be restored.",
        };
  }),
);

const configReferenceOperationFieldsSchema = Schema.Union(
  configReferenceWriteOperationFieldsSchema,
  configReferenceRestoreOperationSchema,
  configReferenceRemoveOperationSchema,
);

const currentFileSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("file", {
    bytes: Schema.Uint8ArrayFromSelf.annotations({
      description: "Exact current native configuration bytes inspected without mutation.",
    }),
  }),
);

const previousArtifactSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("owned", {
    artifact: Schema.typeSchema(configReferenceArtifactSchema).annotations({
      description: "Exact prior native-reference receipt entry whose restoration history must be retained.",
    }),
  }),
);

const configReferenceAgentFieldsSchema = Schema.Struct({
  ...agentDefinitionSchema.fields,
  target: agentDefinitionSchema.fields.target.members[3],
});

const configReferenceAgentSchema = configReferenceAgentFieldsSchema.pipe(
  Schema.filter((agent) => agentCatalog.some((candidate) => agentDefinitionsEqual(candidate, agent)), {
    message: () => "Config-reference agents must exactly match the decoded agent catalog.",
  }),
);

const desiredReferenceSchema = Schema.Union(Schema.TaggedStruct("present", {}), Schema.TaggedStruct("absent", {}));

const configReferenceRequestFieldsSchema = Schema.Struct({
  agent: configReferenceAgentSchema.annotations({
    description: "Exact catalog agent whose target defines the native config path, reference, and format.",
  }),
  desired: desiredReferenceSchema.annotations({
    description: "Whether this exact native reference must be present or restored away.",
  }),
  currentFile: currentFileSchema,
  previousArtifact: previousArtifactSchema,
});

type ConfigReferenceRequestFields = Schema.Schema.Type<typeof configReferenceRequestFieldsSchema>;

const previousArtifactIssues = (request: ConfigReferenceRequestFields) => {
  if (request.previousArtifact._tag === "missing") {
    return [];
  }

  const artifact = request.previousArtifact.artifact;
  const target = request.agent.target;

  return [
    request.currentFile._tag === "file"
      ? undefined
      : {
          path: ["currentFile"],
          message: "A receipted native reference requires current file bytes.",
        },
    artifact.path === target.configPath
      ? undefined
      : {
          path: ["previousArtifact", "artifact", "path"],
          message: "Prior native-reference ownership must match the catalog config path.",
        },
    artifact.owner.agentIds.length === 1 && artifact.owner.agentIds[0] === request.agent.id
      ? undefined
      : {
          path: ["previousArtifact", "artifact", "owner"],
          message: "Prior native-reference ownership must belong only to the exact catalog agent.",
        },
    (target.referenceFormat === "yamlReadArray" && artifact.ownership._tag === "yamlSequenceValue") ||
    (target.referenceFormat === "jsonRulesArray" && artifact.ownership._tag === "jsonValues")
      ? undefined
      : {
          path: ["previousArtifact", "artifact", "ownership"],
          message: "Prior native-reference ownership must match the catalog reference format.",
        },
    artifact.ownership._tag !== "yamlSequenceValue" ||
    (artifact.ownership.key === "read" && artifact.ownership.reference === target.instructionPath)
      ? undefined
      : {
          path: ["previousArtifact", "artifact", "ownership"],
          message: "Prior YAML ownership must match the exact read reference.",
        },
    artifact.ownership._tag !== "jsonValues" || jsonRulesOwnershipIsValid(artifact.ownership)
      ? undefined
      : {
          path: ["previousArtifact", "artifact", "ownership"],
          message: "Prior JSON ownership must contain one /rules pointer with missing or string-array history.",
        },
  ];
};

export const configReferenceRequestSchema = configReferenceRequestFieldsSchema.pipe(Schema.filter(previousArtifactIssues));

export type ConfigReferenceRequest = Schema.Schema.Type<typeof configReferenceRequestSchema>;

const decodeRequest = (input: unknown): Either.Either<ConfigReferenceRequest, ConfigReferencePlanError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(configReferenceRequestSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new ConfigReferencePlanError({ issue: formatParseError(error) }),
  );

const decodeText = (bytes: Uint8Array, filename: string): Either.Either<string, ConfigReferencePlanError> => {
  const decoded = Either.try({
    try: () => textDecoder.decode(bytes),
    catch: (error) => new ConfigReferencePlanError({ issue: `${filename} is not strict UTF-8: ${formatUnknownError(error)}` }),
  });

  return Either.flatMap(decoded, (source) =>
    source.startsWith("\uFEFF")
      ? Either.left(new ConfigReferencePlanError({ issue: `${filename} must not start with a UTF-8 byte-order mark.` }))
      : Either.right(source),
  );
};

const lineEnding = (source: string): "\r\n" | "\n" => (source.includes("\r\n") ? "\r\n" : "\n");

const jsonConfigurationSchema = Schema.Struct(
  {
    rules: Schema.optional(instructionReferencesSchema).annotations({
      description: "Native Continue instruction-file references.",
    }),
  },
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);

const jsonConfigurationDocumentSchema = Schema.Struct({
  source: Schema.String,
  rules: Schema.optional(Schema.Array(Schema.String)),
});

type JsonConfigurationDocument = Schema.Schema.Type<typeof jsonConfigurationDocumentSchema>;

const jsonObjectSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });

const parseJsonObjectNode = (source: string): Either.Either<JsonNode, ConfigReferencePlanError> => {
  const root = parseTree(source, [], { allowTrailingComma: false, disallowComments: true });

  return root?.type === "object"
    ? Either.right(root)
    : Either.left(new ConfigReferencePlanError({ issue: "Continue configuration must be one JSON object." }));
};

const jsonPropertyName = (property: JsonNode): string | undefined => {
  const value = property.children?.[0]?.value;

  return typeof value === "string" ? value : undefined;
};

const insertMissingJsonRules = (source: string, rules: ReadonlyArray<string>): Either.Either<string, ConfigReferencePlanError> => {
  const root = parseJsonObjectNode(source);
  if (Either.isLeft(root)) {
    return Either.left(root.left);
  }

  const properties = root.right.children ?? [];
  const lastProperty = properties.at(-1);
  const insertionIndex = lastProperty === undefined ? root.right.offset + 1 : lastProperty.offset + lastProperty.length;
  const separator = lastProperty === undefined ? "" : ",";
  const encodedRules = Schema.encodeSync(jsonValueSchema)(rules);

  return Either.right(`${source.slice(0, insertionIndex)}${separator}"rules":${encodedRules}${source.slice(insertionIndex)}`);
};

const removeInsertedJsonRules = (source: string): Either.Either<string, ConfigReferencePlanError> => {
  const root = parseJsonObjectNode(source);
  if (Either.isLeft(root)) {
    return Either.left(root.left);
  }

  const properties = root.right.children ?? [];
  const rulesIndex = properties.findIndex((property) => jsonPropertyName(property) === "rules");
  const rulesProperty = properties[rulesIndex];
  if (rulesIndex < 0 || rulesProperty === undefined) {
    return Either.left(new ConfigReferencePlanError({ issue: "Receipted Continue rules member is missing." }));
  }

  if (properties.length === 1) {
    return Either.right(`${source.slice(0, rulesProperty.offset)}${source.slice(rulesProperty.offset + rulesProperty.length)}`);
  }

  if (rulesIndex > 0) {
    const previousProperty = properties[rulesIndex - 1];
    if (previousProperty === undefined) {
      return Either.left(new ConfigReferencePlanError({ issue: "Continue rules member has no stable preceding property." }));
    }

    const previousEnd = previousProperty.offset + previousProperty.length;
    const separator = source.slice(previousEnd, rulesProperty.offset);
    const commaOffset = separator.lastIndexOf(",");
    if (commaOffset < 0) {
      return Either.left(new ConfigReferencePlanError({ issue: "Continue rules member has no stable preceding comma." }));
    }

    const removalStart = previousEnd + commaOffset;

    return Either.right(`${source.slice(0, removalStart)}${source.slice(rulesProperty.offset + rulesProperty.length)}`);
  }

  const nextProperty = properties[1];
  if (nextProperty === undefined) {
    return Either.left(new ConfigReferencePlanError({ issue: "Continue rules member has no stable following property." }));
  }

  const rulesEnd = rulesProperty.offset + rulesProperty.length;
  const separator = source.slice(rulesEnd, nextProperty.offset);
  const commaOffset = separator.indexOf(",");
  if (commaOffset < 0) {
    return Either.left(new ConfigReferencePlanError({ issue: "Continue rules member has no stable following comma." }));
  }

  const removalEnd = rulesEnd + commaOffset + 1;

  return Either.right(`${source.slice(0, rulesProperty.offset)}${source.slice(removalEnd)}`);
};

const decodeJsonConfiguration = (
  bytes: Uint8Array,
  filename: string,
): Either.Either<JsonConfigurationDocument, ConfigReferencePlanError> => {
  const decodedText = decodeText(bytes, filename);
  if (Either.isLeft(decodedText)) {
    return Either.left(decodedText.left);
  }

  const duplicateProperty = findDuplicateJsonProperty(decodedText.right);
  if (duplicateProperty !== undefined) {
    return Either.left(
      new ConfigReferencePlanError({
        issue: `${filename} contains duplicate JSON property ${JSON.stringify(duplicateProperty)}.`,
      }),
    );
  }

  const configuration = Schema.decodeUnknownEither(Schema.parseJson(jsonConfigurationSchema), {
    onExcessProperty: "preserve",
  })(decodedText.right);
  if (Either.isLeft(configuration)) {
    return Either.left(new ConfigReferencePlanError({ issue: `${filename} is invalid: ${formatParseError(configuration.left)}` }));
  }

  return Either.right({ source: decodedText.right, rules: configuration.right.rules });
};

const yamlSequenceItemSchema = Schema.Struct({
  value: Schema.String,
  start: Schema.NonNegativeInt,
  end: Schema.NonNegativeInt,
});

const yamlReadDocumentSchema = Schema.Union(
  Schema.TaggedStruct("missing", {
    source: Schema.String,
  }),
  Schema.TaggedStruct("block", {
    source: Schema.String,
    pairStart: Schema.NonNegativeInt,
    pairEnd: Schema.NonNegativeInt,
    insertionIndex: Schema.NonNegativeInt,
    itemPrefix: Schema.NonEmptyString,
    items: Schema.Array(yamlSequenceItemSchema),
  }),
);

type YamlReadDocument = Schema.Schema.Type<typeof yamlReadDocumentSchema>;
type YamlInsertedPrefix = YamlSequenceValueOwnership["insertedPrefix"];

const lineStartAt = (source: string, index: number): number => source.lastIndexOf("\n", index - 1) + 1;

const lineEndAfter = (source: string, index: number): number => {
  const lineFeed = source.indexOf("\n", index);

  return lineFeed < 0 ? source.length : lineFeed + 1;
};

const inspectYamlReadDocument = (source: string): Either.Either<YamlReadDocument, ConfigReferencePlanError> => {
  if (source.includes("\t") || /\r(?!\n)/.test(source)) {
    return Either.left(
      new ConfigReferencePlanError({
        issue: "Aider configuration is invalid: use spaces with LF or CRLF line endings.",
      }),
    );
  }

  const document = parseDocument(source, { keepSourceTokens: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    return Either.left(
      new ConfigReferencePlanError({
        issue: `Aider configuration is invalid: ${document.errors.map((error) => error.message).join("; ")}`,
      }),
    );
  }

  if (document.contents === null) {
    return Either.right({ _tag: "missing", source });
  }

  if (!isMap(document.contents) || document.contents.flow === true) {
    return Either.left(new ConfigReferencePlanError({ issue: "Aider configuration must be one block mapping." }));
  }

  const readPairs = document.contents.items.filter(
    (pair) => isScalar(pair.key) && typeof pair.key.value === "string" && pair.key.value === "read",
  );
  if (readPairs.length === 0) {
    return Either.right({ _tag: "missing", source });
  }

  const pair = readPairs[0];
  if (pair === undefined || !isScalar(pair.key) || pair.key.range === undefined || pair.key.range === null) {
    return Either.left(new ConfigReferencePlanError({ issue: "Aider read key has no stable source range." }));
  }

  if (pair.value === null) {
    const pairEnd = lineEndAfter(source, pair.key.range[2]);

    return Either.right({
      _tag: "block",
      source,
      pairStart: pair.key.range[0],
      pairEnd,
      insertionIndex: pairEnd,
      itemPrefix: "  - ",
      items: [],
    });
  }

  if (!isSeq(pair.value) || pair.value.flow === true || pair.value.range === undefined || pair.value.range === null) {
    return Either.left(new ConfigReferencePlanError({ issue: "Aider read must be one block sequence of strings." }));
  }

  const items = [];
  let itemPrefix: string | undefined;

  // Extract semantic string values and their exact editable line ranges from the validated YAML AST.
  for (const item of pair.value.items) {
    if (
      item === null ||
      !isScalar(item) ||
      typeof item.value !== "string" ||
      item.range === undefined ||
      item.range === null ||
      item.anchor !== undefined ||
      item.tag !== undefined
    ) {
      return Either.left(new ConfigReferencePlanError({ issue: "Aider read must contain only direct string values." }));
    }

    const start = lineStartAt(source, item.range[0]);
    const prefix = source.slice(start, item.range[0]);
    if (!/^ +-\s+$/.test(prefix) || (itemPrefix !== undefined && itemPrefix !== prefix)) {
      return Either.left(new ConfigReferencePlanError({ issue: "Aider read must use one consistent space-indented block sequence." }));
    }

    itemPrefix = prefix;
    items.push({ value: item.value, start, end: item.range[2] });
  }

  const lastItem = items.at(-1);
  const insertionIndex = source.endsWith("\n") || lastItem === undefined ? pair.value.range[2] : lastItem.start;

  return Either.right({
    _tag: "block",
    source,
    pairStart: pair.key.range[0],
    pairEnd: pair.value.range[2],
    insertionIndex,
    itemPrefix: itemPrefix ?? "  - ",
    items,
  });
};

const yamlReferenceItems = (document: YamlReadDocument, reference: string) =>
  document._tag === "missing" ? [] : document.items.filter((item) => item.value === reference);

const appendYamlReference = (input: {
  document: YamlReadDocument;
  reference: string;
}): {
  source: string;
  insertedPrefix: YamlInsertedPrefix;
  keyPreviouslyPresent: boolean;
} => {
  const ending = lineEnding(input.document.source);
  if (input.document._tag === "missing") {
    const insertedPrefix = input.document.source.length === 0 ? "" : ending;

    return {
      source: `${input.document.source}${insertedPrefix}read:${ending}  - ${input.reference}${ending}`,
      insertedPrefix,
      keyPreviouslyPresent: false,
    };
  }

  if (yamlReferenceItems(input.document, input.reference).length > 0) {
    return { source: input.document.source, insertedPrefix: "", keyPreviouslyPresent: true };
  }

  const referenceLine = `${input.document.itemPrefix}${input.reference}${ending}`;

  return {
    source: `${input.document.source.slice(0, input.document.insertionIndex)}${referenceLine}${input.document.source.slice(input.document.insertionIndex)}`,
    insertedPrefix: "",
    keyPreviouslyPresent: true,
  };
};

const previousRulesValue = (rules: ReadonlyArray<string> | undefined): PreviousJsonValue =>
  rules === undefined ? { _tag: "missing" } : { _tag: "value", value: rules };

const createJsonOwnership = (input: {
  request: ConfigReferenceRequest;
  previousRules: ReadonlyArray<string> | undefined;
  desiredRules: ReadonlyArray<string>;
}): JsonValuesOwnership => {
  const previousArtifact = input.request.previousArtifact;
  const previousOwnership =
    previousArtifact._tag === "owned" && previousArtifact.artifact.ownership._tag === "jsonValues"
      ? previousArtifact.artifact.ownership
      : undefined;
  const history = previousOwnership?.values.find((value) => value.pointer === "/rules");

  return {
    _tag: "jsonValues",
    filePreviouslyPresent: previousOwnership?.filePreviouslyPresent ?? input.request.currentFile._tag === "file",
    values: [
      {
        pointer: "/rules",
        installedValueHash: hashJsonValue(input.desiredRules),
        previous: history?.previous ?? previousRulesValue(input.previousRules),
      },
    ],
  };
};

const createYamlOwnership = (input: {
  request: ConfigReferenceRequest;
  keyPreviouslyPresent: boolean;
  insertedPrefix: YamlInsertedPrefix;
  previouslyPresent: boolean;
}): YamlSequenceValueOwnership => {
  const previousArtifact = input.request.previousArtifact;
  if (previousArtifact._tag === "owned" && previousArtifact.artifact.ownership._tag === "yamlSequenceValue") {
    return previousArtifact.artifact.ownership;
  }

  return {
    _tag: "yamlSequenceValue",
    filePreviouslyPresent: input.request.currentFile._tag === "file",
    key: "read",
    keyPreviouslyPresent: input.keyPreviouslyPresent,
    insertedPrefix: input.insertedPrefix,
    reference: input.request.agent.target.instructionPath,
    previouslyPresent: input.previouslyPresent,
  };
};

const createReferenceWrite = (input: {
  request: ConfigReferenceRequest;
  bytes: Uint8Array;
  ownership: JsonValuesOwnership | YamlSequenceValueOwnership;
}): ConfigReferenceWrite => ({
  _tag: "write",
  artifact: {
    path: input.request.agent.target.configPath,
    kind: { _tag: "configReference" },
    owner: { _tag: "agent", agentIds: [input.request.agent.id] },
    ownership: input.ownership,
  },
  bytes: input.bytes,
});

const createReferenceRestoration = (
  request: ConfigReferenceRequest,
  bytes: Uint8Array,
): Either.Either<ConfigReferencePlan, ConfigReferencePlanError> => {
  if (request.previousArtifact._tag === "missing") {
    return Either.left(new ConfigReferencePlanError({ issue: "Native reference restoration requires prior receipt ownership." }));
  }

  const artifact = request.previousArtifact.artifact;
  const filePreviouslyPresent = artifact.ownership.filePreviouslyPresent;

  return Either.right(
    bytes.byteLength === 0 && !filePreviouslyPresent
      ? { _tag: "remove", artifact, unownedBytes: bytes }
      : { _tag: "restore", artifact, bytes },
  );
};

const validateCurrentJsonOwnership = (
  request: ConfigReferenceRequest,
  rules: ReadonlyArray<string> | undefined,
): Either.Either<void, ConfigReferencePlanError> => {
  const previousArtifact = request.previousArtifact;
  if (previousArtifact._tag === "missing" || previousArtifact.artifact.ownership._tag !== "jsonValues") {
    return Either.right(undefined);
  }

  const ownedRules = previousArtifact.artifact.ownership.values.find((value) => value.pointer === "/rules");

  return rules !== undefined && ownedRules !== undefined && hashJsonValue(rules) === ownedRules.installedValueHash
    ? Either.right(undefined)
    : Either.left(new ConfigReferencePlanError({ issue: "Receipted Continue rules changed after installation." }));
};

const planJsonReference = (request: ConfigReferenceRequest): Either.Either<ConfigReferenceWrite, ConfigReferencePlanError> => {
  const current =
    request.currentFile._tag === "missing"
      ? Either.right({ source: "{}\n", rules: undefined })
      : decodeJsonConfiguration(request.currentFile.bytes, request.agent.target.configPath);
  if (Either.isLeft(current)) {
    return Either.left(current.left);
  }

  const currentOwnership = validateCurrentJsonOwnership(request, current.right.rules);
  if (Either.isLeft(currentOwnership)) {
    return Either.left(currentOwnership.left);
  }

  const previousRules = current.right.rules;
  const instructionPath = request.agent.target.instructionPath;
  const desiredRules = previousRules?.includes(instructionPath) ? previousRules : [...(previousRules ?? []), instructionPath];
  let desiredSource = current.right.source;
  if (desiredRules !== previousRules && previousRules === undefined) {
    const insertion = insertMissingJsonRules(current.right.source, desiredRules);
    if (Either.isLeft(insertion)) {
      return Either.left(insertion.left);
    }

    desiredSource = insertion.right;
  }

  if (desiredRules !== previousRules && previousRules !== undefined) {
    desiredSource = applyEdits(
      current.right.source,
      modify(current.right.source, ["rules"], desiredRules, {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol: lineEnding(current.right.source) },
      }),
    );
  }

  return Either.right(
    createReferenceWrite({
      request,
      bytes: textEncoder.encode(desiredSource),
      ownership: createJsonOwnership({ request, previousRules, desiredRules }),
    }),
  );
};

const restoredRulesValue = (ownership: JsonValuesOwnership): Either.Either<ReadonlyArray<string> | undefined, ConfigReferencePlanError> => {
  const ownedRules = ownership.values.find((value) => value.pointer === "/rules");
  if (ownedRules === undefined) {
    return Either.left(new ConfigReferencePlanError({ issue: "Continue ownership must contain the /rules pointer." }));
  }

  if (ownedRules.previous._tag === "missing") {
    return Either.right(undefined);
  }

  return isInstructionReferences(ownedRules.previous.value)
    ? Either.right(ownedRules.previous.value)
    : Either.left(new ConfigReferencePlanError({ issue: "Prior Continue rules must be a string array." }));
};

const jsonObjectIsEmpty = (source: string): boolean => {
  const decoded = Schema.decodeUnknownEither(Schema.parseJson(jsonObjectSchema))(source);

  return Either.isRight(decoded) && Object.keys(decoded.right).length === 0;
};

const removeJsonReference = (request: ConfigReferenceRequest): Either.Either<ConfigReferencePlan, ConfigReferencePlanError> => {
  if (
    request.previousArtifact._tag === "missing" ||
    request.previousArtifact.artifact.ownership._tag !== "jsonValues" ||
    request.currentFile._tag === "missing"
  ) {
    return Either.left(new ConfigReferencePlanError({ issue: "Receipted Continue configuration is missing or incompatible." }));
  }

  const ownership = request.previousArtifact.artifact.ownership;
  const document = decodeJsonConfiguration(request.currentFile.bytes, request.agent.target.configPath);
  if (Either.isLeft(document)) {
    return Either.left(document.left);
  }

  const ownedRules = ownership.values.find((value) => value.pointer === "/rules");
  if (
    document.right.rules === undefined ||
    ownedRules === undefined ||
    hashJsonValue(document.right.rules) !== ownedRules.installedValueHash
  ) {
    return Either.left(new ConfigReferencePlanError({ issue: "Receipted Continue rules changed after installation." }));
  }

  const previousRules = restoredRulesValue(ownership);
  if (Either.isLeft(previousRules)) {
    return Either.left(previousRules.left);
  }

  if (previousRules.right === undefined) {
    const desiredSource = removeInsertedJsonRules(document.right.source);
    if (Either.isLeft(desiredSource)) {
      return Either.left(desiredSource.left);
    }

    const bytes =
      !ownership.filePreviouslyPresent && jsonObjectIsEmpty(desiredSource.right)
        ? new Uint8Array()
        : textEncoder.encode(desiredSource.right);

    return createReferenceRestoration(request, bytes);
  }

  const desiredSource = applyEdits(
    document.right.source,
    modify(document.right.source, ["rules"], previousRules.right, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: lineEnding(document.right.source) },
    }),
  );

  return createReferenceRestoration(request, textEncoder.encode(desiredSource));
};

const planYamlReference = (request: ConfigReferenceRequest): Either.Either<ConfigReferenceWrite, ConfigReferencePlanError> => {
  const current =
    request.currentFile._tag === "missing" ? Either.right("") : decodeText(request.currentFile.bytes, request.agent.target.configPath);
  if (Either.isLeft(current)) {
    return Either.left(current.left);
  }

  const document = inspectYamlReadDocument(current.right);
  if (Either.isLeft(document)) {
    return Either.left(document.left);
  }

  if (
    document.right._tag === "block" &&
    document.right.items.length === 0 &&
    document.right.source.length > 0 &&
    !document.right.source.endsWith("\n")
  ) {
    return Either.left(new ConfigReferencePlanError({ issue: "Aider read key must end its line before a reference can be added." }));
  }

  const instructionPath = request.agent.target.instructionPath;
  const referenceItems = yamlReferenceItems(document.right, instructionPath);
  if (request.previousArtifact._tag === "owned" && referenceItems.length !== 1) {
    return Either.left(new ConfigReferencePlanError({ issue: "Receipted Aider read reference changed after installation." }));
  }

  if (referenceItems.length > 1) {
    return Either.left(new ConfigReferencePlanError({ issue: "Aider read contains the managed reference more than once." }));
  }

  const desired = appendYamlReference({ document: document.right, reference: instructionPath });

  return Either.right(
    createReferenceWrite({
      request,
      bytes: textEncoder.encode(desired.source),
      ownership: createYamlOwnership({
        request,
        keyPreviouslyPresent: desired.keyPreviouslyPresent,
        insertedPrefix: desired.insertedPrefix,
        previouslyPresent: referenceItems.length === 1,
      }),
    }),
  );
};

const removeYamlReference = (request: ConfigReferenceRequest): Either.Either<ConfigReferencePlan, ConfigReferencePlanError> => {
  if (
    request.previousArtifact._tag === "missing" ||
    request.previousArtifact.artifact.ownership._tag !== "yamlSequenceValue" ||
    request.currentFile._tag === "missing"
  ) {
    return Either.left(new ConfigReferencePlanError({ issue: "Receipted Aider configuration is missing or incompatible." }));
  }

  const ownership = request.previousArtifact.artifact.ownership;
  const source = decodeText(request.currentFile.bytes, request.agent.target.configPath);
  if (Either.isLeft(source)) {
    return Either.left(source.left);
  }

  const document = inspectYamlReadDocument(source.right);
  if (Either.isLeft(document) || document.right._tag === "missing") {
    return Either.left(new ConfigReferencePlanError({ issue: "Receipted Aider read reference changed after installation." }));
  }

  const referenceItems = yamlReferenceItems(document.right, ownership.reference);
  const referenceItem = referenceItems[0];
  if (referenceItems.length !== 1 || referenceItem === undefined) {
    return Either.left(new ConfigReferencePlanError({ issue: "Receipted Aider read reference changed after installation." }));
  }

  if (ownership.previouslyPresent) {
    return createReferenceRestoration(request, textEncoder.encode(source.right));
  }

  const installedReferenceLine = source.right.slice(referenceItem.start, referenceItem.end);
  const expectedReferenceLine = `${document.right.itemPrefix}${ownership.reference}${lineEnding(source.right)}`;
  if (installedReferenceLine !== expectedReferenceLine) {
    return Either.left(new ConfigReferencePlanError({ issue: "Receipted Aider reference line changed after installation." }));
  }

  if (!ownership.keyPreviouslyPresent && document.right.items.length === 1) {
    const ending = lineEnding(source.right);
    const expectedPair = `read:${ending}${document.right.itemPrefix}${ownership.reference}${ending}`;
    const installedPair = source.right.slice(document.right.pairStart, document.right.pairEnd);
    if (installedPair !== expectedPair) {
      return Either.left(new ConfigReferencePlanError({ issue: "Receipted Aider key pair changed after installation." }));
    }

    const prefixStart = document.right.pairStart - ownership.insertedPrefix.length;
    if (prefixStart < 0 || source.right.slice(prefixStart, document.right.pairStart) !== ownership.insertedPrefix) {
      return Either.left(new ConfigReferencePlanError({ issue: "Receipted Aider key framing changed after installation." }));
    }

    const prefix = source.right.slice(0, prefixStart);
    const suffix = source.right.slice(document.right.pairEnd);
    const suffixStartsLineEnding = suffix.startsWith("\n") || suffix.startsWith("\r\n");
    const separator =
      prefix.length > 0 && suffix.length > 0 && !prefix.endsWith("\n") && !suffixStartsLineEnding ? lineEnding(source.right) : "";
    const desiredSource = `${prefix}${separator}${suffix}`;

    return createReferenceRestoration(request, textEncoder.encode(desiredSource));
  }

  const desiredSource = `${source.right.slice(0, referenceItem.start)}${source.right.slice(referenceItem.end)}`;

  return createReferenceRestoration(request, textEncoder.encode(desiredSource));
};

const noOperationSchema = Schema.TaggedStruct("none", {});

const configReferenceOperationSchema = configReferenceOperationFieldsSchema.pipe(
  Schema.filter((operation) => {
    const ownerId = operation.artifact.owner.agentIds[0];
    const agent = agentCatalog.find((candidate) => candidate.id === ownerId);
    const target = agent?.target;

    return [
      operation.artifact.owner.agentIds.length === 1
        ? undefined
        : { path: ["artifact", "owner"], message: "Native references require exactly one catalog agent owner." },
      target?._tag === "configReference" && target.configPath === operation.artifact.path
        ? undefined
        : { path: ["artifact", "path"], message: "Native-reference owner and path must match the decoded agent catalog." },
      target?._tag !== "configReference" ||
      (target.referenceFormat === "yamlReadArray" && operation.artifact.ownership._tag === "yamlSequenceValue") ||
      (target.referenceFormat === "jsonRulesArray" && operation.artifact.ownership._tag === "jsonValues")
        ? undefined
        : { path: ["artifact", "ownership"], message: "Native-reference ownership must match the catalog format." },
      target?._tag !== "configReference" ||
      operation.artifact.ownership._tag !== "yamlSequenceValue" ||
      (operation.artifact.ownership.key === "read" && operation.artifact.ownership.reference === target.instructionPath)
        ? undefined
        : {
            path: ["artifact", "ownership"],
            message: "Aider ownership must match the catalog read key and instruction path.",
          },
      operation.artifact.ownership._tag !== "jsonValues" || jsonRulesOwnershipIsValid(operation.artifact.ownership)
        ? undefined
        : {
            path: ["artifact", "ownership"],
            message: "Continue ownership must contain one /rules pointer with missing or string-array history.",
          },
    ];
  }),
  Schema.filter((operation) => {
    if (operation._tag !== "write" || operation.artifact.ownership._tag !== "jsonValues") {
      return undefined;
    }

    const configuration = decodeJsonConfiguration(operation.bytes, operation.artifact.path);
    const ownedRules = operation.artifact.ownership.values;
    const ownerId = operation.artifact.owner.agentIds[0];
    const owner = agentCatalog.find((candidate) => candidate.id === ownerId);
    const expectedReference = owner?.target._tag === "configReference" ? owner.target.instructionPath : undefined;

    return Either.isRight(configuration) &&
      configuration.right.rules !== undefined &&
      expectedReference !== undefined &&
      configuration.right.rules.includes(expectedReference) &&
      ownedRules.length === 1 &&
      ownedRules[0]?.pointer === "/rules" &&
      ownedRules[0].installedValueHash === hashJsonValue(configuration.right.rules)
      ? undefined
      : {
          path: ["artifact", "ownership"],
          message: "Continue ownership must hash the exact desired /rules value.",
        };
  }),
  Schema.filter((operation) => {
    if (operation._tag !== "write" || operation.artifact.ownership._tag !== "yamlSequenceValue") {
      return undefined;
    }

    const source = decodeText(operation.bytes, operation.artifact.path);
    if (Either.isLeft(source)) {
      return { path: ["bytes"], message: "Aider write bytes must be strict UTF-8." };
    }

    const document = inspectYamlReadDocument(source.right);
    const ownership = operation.artifact.ownership;

    return ownership.key === "read" && Either.isRight(document) && yamlReferenceItems(document.right, ownership.reference).length === 1
      ? undefined
      : {
          path: ["artifact", "ownership"],
          message: "Aider ownership must match the exact desired read reference.",
        };
  }),
);

export const configReferencePlanSchema = Schema.Union(noOperationSchema, configReferenceOperationSchema);

export type ConfigReferencePlan = Schema.Schema.Type<typeof configReferencePlanSchema>;

const validatePlan = (input: unknown): Either.Either<ConfigReferencePlan, ConfigReferencePlanError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(configReferencePlanSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new ConfigReferencePlanError({ issue: formatParseError(error) }),
  );

const materializeReferencePlan = (request: ConfigReferenceRequest): Either.Either<ConfigReferencePlan, ConfigReferencePlanError> => {
  if (request.desired._tag === "absent" && request.previousArtifact._tag === "missing") {
    return Either.right({ _tag: "none" });
  }

  if (request.desired._tag === "absent") {
    return request.agent.target.referenceFormat === "yamlReadArray" ? removeYamlReference(request) : removeJsonReference(request);
  }

  return request.agent.target.referenceFormat === "yamlReadArray" ? planYamlReference(request) : planJsonReference(request);
};

// Plan one native config reference: decode the catalog target, materialize its format, then validate the direct action.
export const planConfigReference = (input: unknown): Either.Either<ConfigReferencePlan, ConfigReferencePlanError> => {
  // 1. Decode the exact catalog agent, desired presence, current bytes, and prior receipt.
  const request = decodeRequest(input);
  if (Either.isLeft(request)) {
    return Either.left(request.left);
  }

  // 2. Select YAML or JSON only from the catalog target tag and materialize one action.
  const plan = materializeReferencePlan(request.right);
  if (Either.isLeft(plan)) {
    return Either.left(plan.left);
  }

  // 3. Validate the direct action before returning it to the capability planner.
  return validatePlan(plan.right);
};
