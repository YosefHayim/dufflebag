import { Either, Encoding, Predicate, Schema } from "effect";

import { agentCatalog, agentIdSchema } from "../catalog/agentCatalog.js";
import { featureIdSchema, resolveFeatureSelection } from "../catalog/featureCatalog.js";

export const scopeSchema = Schema.Literal("global", "project").annotations({
  description: "Installation scope that owns the receipt.",
});

export type Scope = Schema.Schema.Type<typeof scopeSchema>;

export const relativeArtifactPathSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(/^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)[^\\/\0]+(?:\/[^\\/\0]+)*$/, {
    message: () => "Artifact paths must be relative, normalized, and stay inside the scope root.",
  }),
  Schema.annotations({
    description: "Normalized scope-relative artifact path.",
  }),
);

export const sha256Schema = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{64}$/, {
    message: () => "Hashes must be lowercase SHA-256 hex strings.",
  }),
  Schema.annotations({
    description: "Lowercase SHA-256 digest.",
  }),
);

export const jsonPointerSchema = Schema.String.pipe(
  Schema.pattern(/^(?:\/(?:[^~/]|~[01])*)+$/, {
    message: () => "JSON pointers must be absolute RFC 6901 paths with valid escape sequences.",
  }),
  Schema.annotations({
    description: "Absolute RFC 6901 pointer to one owned JSON value.",
  }),
);

const base64BytesSchema = Schema.String.pipe(
  Schema.filter(
    (encoded) => {
      const decoded = Encoding.decodeBase64(encoded);

      return Either.isRight(decoded) && Encoding.encodeBase64(decoded.right) === encoded;
    },
    {
      message: () => "Prior file bytes must use canonical base64.",
    },
  ),
  Schema.compose(Schema.Uint8ArrayFromBase64),
);

const isJsonValue = (value: unknown): boolean => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (!Predicate.isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }

  return Object.values(value).every(isJsonValue);
};

const jsonValueSchema = Schema.Unknown.pipe(
  Schema.filter(isJsonValue, {
    message: () => "Previous JSON values must contain only JSON-compatible data.",
  }),
);

const uniqueValues = <Value>(values: ReadonlyArray<Value>): boolean => values.length === new Set(values).size;

const knownAgentIds = new Set<string>(agentCatalog.map((agent) => agent.id));

const agentCatalogOrderIssues = (agentIds: ReadonlyArray<string>) => {
  const unknownIndex = agentIds.findIndex((agentId) => !knownAgentIds.has(agentId));
  if (unknownIndex >= 0) {
    return [
      {
        path: [unknownIndex],
        message: `Agent ownership ID ${agentIds[unknownIndex]} is unknown.`,
      },
    ];
  }

  const selectedIds = new Set(agentIds);
  const orderedIds = agentCatalog.flatMap((agent) => (selectedIds.has(agent.id) ? [agent.id] : []));
  const mismatchIndex = agentIds.findIndex((agentId, index) => agentId !== orderedIds[index]);
  if (mismatchIndex >= 0 || agentIds.length !== orderedIds.length) {
    return [
      {
        path: [mismatchIndex >= 0 ? mismatchIndex : agentIds.length],
        message: "Agent ownership IDs must use exact catalog order.",
      },
    ];
  }

  return [];
};

const agentIdsSchema = Schema.NonEmptyArray(agentIdSchema).pipe(
  Schema.filter(uniqueValues, {
    message: () => "Agent ownership IDs must be unique.",
  }),
  Schema.filter(agentCatalogOrderIssues),
);

export const artifactOwnerSchema = Schema.Union(
  Schema.TaggedStruct("application", {}),
  Schema.TaggedStruct("agent", {
    agentIds: agentIdsSchema.annotations({
      description: "Agents that share ownership of this exact artifact path.",
    }),
  }),
).annotations({
  description: "Application or shared agent ownership authority.",
});

export type ArtifactOwner = Schema.Schema.Type<typeof artifactOwnerSchema>;

export const artifactKindSchema = Schema.Union(
  Schema.TaggedStruct("runtime", {}),
  Schema.TaggedStruct("skill", {}),
  Schema.TaggedStruct("rule", {}),
  Schema.TaggedStruct("instruction", {}),
  Schema.TaggedStruct("configReference", {}),
  Schema.TaggedStruct("settings", {}),
  Schema.TaggedStruct("managedConfig", {}),
  Schema.TaggedStruct("receipt", {}),
).annotations({
  description: "Artifact role used to constrain ownership and restoration metadata.",
});

export type ArtifactKind = Schema.Schema.Type<typeof artifactKindSchema>;

export const previousFileValueSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("priorFile", {
    bytes: base64BytesSchema.annotations({
      description: "Original bytes decoded from their receipt-safe base64 representation.",
    }),
  }),
).annotations({
  description: "Original whole-file state needed for exact restoration.",
});

export type PreviousFileValue = Schema.Schema.Type<typeof previousFileValueSchema>;

export const previousJsonValueSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("value", {
    value: jsonValueSchema.annotations({
      description: "Exact JSON-compatible value present before this pointer first became owned.",
    }),
  }),
).annotations({
  description: "JSON pointer state recorded before the pointer first became owned.",
});

export type PreviousJsonValue = Schema.Schema.Type<typeof previousJsonValueSchema>;

export const wholeFileOwnershipSchema = Schema.TaggedStruct("wholeFile", {
  installedHash: sha256Schema.annotations({
    description: "Hash of the complete installed file.",
  }),
  previous: previousFileValueSchema,
});

export type WholeFileOwnership = Schema.Schema.Type<typeof wholeFileOwnershipSchema>;

export const managedBlockOwnershipSchema = Schema.TaggedStruct("managedBlock", {
  filePreviouslyPresent: Schema.Boolean.annotations({
    description: "Whether the host file existed before this receipt entry first managed it.",
  }),
  startMarker: Schema.NonEmptyTrimmedString.annotations({
    description: "Exact opening marker delimiting the managed block.",
  }),
  endMarker: Schema.NonEmptyTrimmedString.annotations({
    description: "Exact closing marker delimiting the managed block.",
  }),
  installedBodyHash: sha256Schema.annotations({
    description: "Hash of the exact managed block body.",
  }),
}).pipe(
  Schema.filter((ownership) =>
    ownership.startMarker === ownership.endMarker
      ? {
          path: ["endMarker"],
          message: "Managed block markers must be distinct.",
        }
      : undefined,
  ),
);

export type ManagedBlockOwnership = Schema.Schema.Type<typeof managedBlockOwnershipSchema>;

const ownedJsonValueSchema = Schema.Struct({
  pointer: jsonPointerSchema,
  installedValueHash: sha256Schema.annotations({
    description: "Hash of the canonical installed JSON value.",
  }),
  previous: previousJsonValueSchema.annotations({
    description: "State recorded before this JSON pointer first became owned.",
  }),
});

type OwnedJsonValue = Schema.Schema.Type<typeof ownedJsonValueSchema>;

const pathsConflict = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

const artifactPathConflictKey = (path: string): string => path.toLowerCase();

const pointerConflictIssues = (values: ReadonlyArray<OwnedJsonValue>) =>
  values.flatMap((value, index) =>
    values.slice(index + 1).flatMap((candidate, offset) =>
      pathsConflict(value.pointer, candidate.pointer)
        ? [
            {
              path: [index + offset + 1, "pointer"],
              message: `JSON pointer ${candidate.pointer} conflicts with ${value.pointer}.`,
            },
          ]
        : [],
    ),
  );

const ownedJsonValuesSchema = Schema.Array(ownedJsonValueSchema).pipe(
  Schema.minItems(1, {
    message: () => "JSON ownership must record at least one pointer.",
  }),
  Schema.filter(pointerConflictIssues),
);

export const jsonValuesOwnershipSchema = Schema.TaggedStruct("jsonValues", {
  filePreviouslyPresent: Schema.Boolean.annotations({
    description: "Whether the host file existed before this receipt entry first managed it.",
  }),
  values: ownedJsonValuesSchema,
});

export type JsonValuesOwnership = Schema.Schema.Type<typeof jsonValuesOwnershipSchema>;

export const yamlSequenceValueOwnershipSchema = Schema.TaggedStruct("yamlSequenceValue", {
  filePreviouslyPresent: Schema.Boolean.annotations({
    description: "Whether the host file existed before this receipt entry first managed it.",
  }),
  key: Schema.NonEmptyTrimmedString.annotations({
    description: "Exact YAML sequence key that owns the reference.",
  }),
  keyPreviouslyPresent: Schema.Boolean.annotations({
    description: "Whether the YAML sequence key existed before this reference first became owned.",
  }),
  insertedPrefix: Schema.Literal("", "\n", "\r\n").annotations({
    description: "Exact separator inserted before a handler-created YAML key so removal can restore the prior bytes.",
  }),
  reference: Schema.NonEmptyTrimmedString.annotations({
    description: "Exact sequence value installed under the key.",
  }),
  previouslyPresent: Schema.Boolean.annotations({
    description: "Whether the exact key/reference pair existed before that pair first became owned.",
  }),
}).pipe(
  Schema.filter((ownership) => [
    ownership.keyPreviouslyPresent || !ownership.previouslyPresent
      ? undefined
      : {
          path: ["previouslyPresent"],
          message: "A YAML reference cannot predate a key that did not exist.",
        },
    !ownership.keyPreviouslyPresent || ownership.insertedPrefix.length === 0
      ? undefined
      : {
          path: ["insertedPrefix"],
          message: "A pre-existing YAML key cannot own an inserted key prefix.",
        },
  ]),
);

export type YamlSequenceValueOwnership = Schema.Schema.Type<typeof yamlSequenceValueOwnershipSchema>;

export const artifactOwnershipSchema = Schema.Union(
  wholeFileOwnershipSchema,
  managedBlockOwnershipSchema,
  jsonValuesOwnershipSchema,
  yamlSequenceValueOwnershipSchema,
);

export type ArtifactOwnership = Schema.Schema.Type<typeof artifactOwnershipSchema>;

const ownerMatchesKind = (kind: ArtifactKind, owner: ArtifactOwner): boolean => {
  switch (kind._tag) {
    case "runtime":
    case "settings":
    case "managedConfig":
    case "receipt":
      return owner._tag === "application";
    case "skill":
    case "rule":
    case "instruction":
    case "configReference":
      return owner._tag === "agent";
  }
};

const ownershipMatchesKind = (kind: ArtifactKind, ownership: ArtifactOwnership): boolean => {
  switch (kind._tag) {
    case "runtime":
    case "skill":
    case "rule":
    case "managedConfig":
    case "receipt":
      return ownership._tag === "wholeFile";
    case "instruction":
      return ownership._tag === "managedBlock";
    case "configReference":
      return ownership._tag === "jsonValues" || ownership._tag === "yamlSequenceValue";
    case "settings":
      return ownership._tag === "jsonValues";
  }
};

export const receiptEntrySchema = Schema.Struct({
  owner: artifactOwnerSchema,
  path: relativeArtifactPathSchema,
  kind: artifactKindSchema,
  ownership: artifactOwnershipSchema,
}).pipe(
  Schema.filter((entry) => [
    ownerMatchesKind(entry.kind, entry.owner)
      ? undefined
      : {
          path: ["owner"],
          message: `Artifact kind ${entry.kind._tag} has incompatible owner ${entry.owner._tag}.`,
        },
    ownershipMatchesKind(entry.kind, entry.ownership)
      ? undefined
      : {
          path: ["ownership"],
          message: `Artifact kind ${entry.kind._tag} has incompatible ownership ${entry.ownership._tag}.`,
        },
  ]),
);

export type ReceiptEntry = Schema.Schema.Type<typeof receiptEntrySchema>;

const artifactPathConflictIssues = (artifacts: ReadonlyArray<ReceiptEntry>) =>
  artifacts.flatMap((artifact, index) =>
    artifacts.slice(index + 1).flatMap((candidate, offset) =>
      pathsConflict(artifactPathConflictKey(artifact.path), artifactPathConflictKey(candidate.path))
        ? [
            {
              path: [index + offset + 1, "path"],
              message: `Artifact path ${candidate.path} conflicts with ${artifact.path}.`,
            },
          ]
        : [],
    ),
  );

const artifactListIssues = (artifacts: ReadonlyArray<ReceiptEntry>) => [
  ...artifactPathConflictIssues(artifacts),
  ...artifacts.flatMap((artifact, index) =>
    artifact.kind._tag === "receipt"
      ? [
          {
            path: [index, "kind"],
            message: "An artifact receipt cannot record ownership of itself.",
          },
        ]
      : [],
  ),
];

const artifactListSchema = Schema.Array(receiptEntrySchema).pipe(Schema.filter(artifactListIssues));

const receiptFeatureIssues = (features: ReadonlyArray<string>) => {
  const resolved = resolveFeatureSelection(features);
  if (Either.isLeft(resolved)) {
    return [
      {
        path: [features.indexOf(resolved.left.featureId)],
        message: `Receipt feature ${resolved.left.featureId} is unknown.`,
      },
    ];
  }

  const mismatchIndex = features.findIndex((feature, index) => feature !== resolved.right[index]);
  if (mismatchIndex >= 0 || features.length !== resolved.right.length) {
    return [
      {
        path: [mismatchIndex >= 0 ? mismatchIndex : features.length],
        message: "Receipt features must be unique and use fully dependency-resolved catalog order.",
      },
    ];
  }

  return [];
};

const featureListSchema = Schema.Array(featureIdSchema).pipe(Schema.filter(receiptFeatureIssues));

const versionSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(
    /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    {
      message: () => "Receipt versions must use semantic version syntax.",
    },
  ),
);

export const artifactReceiptSchema = Schema.Struct({
  version: versionSchema,
  scope: scopeSchema,
  features: featureListSchema,
  artifacts: artifactListSchema,
});

export type ArtifactReceipt = Schema.Schema.Type<typeof artifactReceiptSchema>;

export const artifactReceiptJsonSchema = Schema.parseJson(artifactReceiptSchema);

export const decodeArtifactReceiptJson = Schema.decodeUnknown(artifactReceiptJsonSchema, {
  onExcessProperty: "error",
});

const legacySkillIdSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, {
    message: () => "Legacy installed skill IDs must use lowercase kebab-case.",
  }),
);

const legacySkillListSchema = Schema.Array(legacySkillIdSchema).pipe(
  Schema.filter(uniqueValues, {
    message: () => "Legacy installed skill IDs must be unique.",
  }),
);

const canonicalTimestampSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.filter(
    (timestamp) => {
      const parsed = new Date(timestamp);

      return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === timestamp;
    },
    {
      message: () => "Legacy installation timestamps must use canonical ISO-8601 UTC syntax.",
    },
  ),
);

export const legacyManifestSchema = Schema.Struct({
  version: versionSchema,
  scope: scopeSchema,
  features: featureListSchema,
  skills: legacySkillListSchema,
  installedAt: canonicalTimestampSchema,
});

export type LegacyManifest = Schema.Schema.Type<typeof legacyManifestSchema>;
