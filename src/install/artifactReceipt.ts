import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Effect, Either, Encoding, Option, ParseResult, Predicate, Schema } from "effect";

import { agentCatalog, agentIdSchema } from "../catalog/agentCatalog.js";
import { featureIdSchema, resolveFeatureSelection } from "../catalog/featureCatalog.js";
import { findDuplicateJsonProperty } from "../config/jsonDocument.js";

export const scopeSchema = Schema.Literal("global", "project").annotations({
  description: "Installation scope that owns the receipt.",
});

export type Scope = Schema.Schema.Type<typeof scopeSchema>;

// e.g. "skills/deslop/SKILL.md" — not "/abs", "C:\x", "a/../b", or "a//b"
const RELATIVE_ARTIFACT_PATH_PATTERN =
  /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)[^\\/\0]+(?:\/[^\\/\0]+)*$/;
// e.g. 64-char lowercase hex: "a1b2…f9"
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
// e.g. "/hooks/0/command", "/a~1b" (~0/~1 escapes) — not "hooks" (relative) or "/a~2"
const JSON_POINTER_PATTERN = /^(?:\/(?:[^~/]|~[01])*)+$/;
// e.g. ", " or ",\n  " — one comma with optional JSON whitespace only
const JSON_PROPERTY_SEPARATOR_PATTERN = /^[ \t\r\n]*,[ \t\r\n]*$/u;
// e.g. "0.12.1", "1.0.0-rc.1", "1.0.0+build.3"
const SEMVER_PATTERN =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
// e.g. "context-guard" — legacy kebab skill id
const LEGACY_SKILL_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const relativeArtifactPathSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(RELATIVE_ARTIFACT_PATH_PATTERN, {
    message: () => "Artifact paths must be relative, normalized, and stay inside the scope root.",
  }),
  Schema.annotations({
    description: "Normalized scope-relative artifact path.",
  }),
);

export const sha256Schema = Schema.String.pipe(
  Schema.pattern(SHA256_HEX_PATTERN, {
    message: () => "Hashes must be lowercase SHA-256 hex strings.",
  }),
  Schema.annotations({
    description: "Lowercase SHA-256 digest.",
  }),
);

export const jsonPointerSchema = Schema.String.pipe(
  Schema.pattern(JSON_POINTER_PATTERN, {
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

const jsonPropertySeparatorSchema = Schema.String.pipe(
  Schema.pattern(JSON_PROPERTY_SEPARATOR_PATTERN, {
    message: () => "A JSON property separator must contain one comma and only JSON whitespace.",
  }),
);

export const previousJsonLexicalSchema = Schema.Union(
  Schema.TaggedStruct("value", {
    source: Schema.NonEmptyString.annotations({
      description: "Exact JSON value token replaced while this pointer is owned.",
    }),
  }),
  Schema.TaggedStruct("beforeProperty", {
    property: Schema.NonEmptyString.annotations({
      description: "Exact JSON property token removed before its next sibling.",
    }),
    separator: jsonPropertySeparatorSchema.annotations({
      description: "Exact comma and whitespace between the removed property and its next sibling.",
    }),
    nextKey: Schema.String.annotations({
      description: "Decoded next-sibling key anchoring exact property restoration.",
    }),
  }),
  Schema.TaggedStruct("afterProperty", {
    previousKey: Schema.String.annotations({
      description: "Decoded previous-sibling key anchoring exact property restoration.",
    }),
    separator: jsonPropertySeparatorSchema.annotations({
      description: "Exact comma and whitespace between the previous sibling and removed property.",
    }),
    property: Schema.NonEmptyString.annotations({
      description: "Exact JSON property token removed after its previous sibling.",
    }),
  }),
  Schema.TaggedStruct("onlyProperty", {
    prefix: Schema.String.annotations({
      description: "Exact whitespace before the removed sole property.",
    }),
    property: Schema.NonEmptyString.annotations({
      description: "Exact JSON property token removed as its object's sole property.",
    }),
    suffix: Schema.String.annotations({
      description: "Exact whitespace after the removed sole property.",
    }),
  }),
).annotations({
  description: "Exact lexical evidence needed to restore one settings value without reformatting user bytes.",
});

export type PreviousJsonLexical = Schema.Schema.Type<typeof previousJsonLexicalSchema>;

export const previousJsonValueSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("value", {
    value: jsonValueSchema.annotations({
      description: "Exact JSON-compatible value present before this pointer first became owned.",
    }),
    lexical: Schema.optional(previousJsonLexicalSchema).annotations({
      description: "Settings-only lexical evidence correlated with the previous semantic value.",
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

export const installedJsonValueSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}).annotations({
    description: "The managed JSON pointer was deliberately absent after installation.",
  }),
  Schema.TaggedStruct("value", {
    hash: sha256Schema.annotations({
      description: "Hash of the canonical JSON value present after installation.",
    }),
  }),
).annotations({
  description: "Exact installed state required before one managed JSON pointer can be restored.",
});

export type InstalledJsonValue = Schema.Schema.Type<typeof installedJsonValueSchema>;

export const ownedJsonValueSchema = Schema.Struct({
  pointer: jsonPointerSchema,
  installed: installedJsonValueSchema.annotations({
    description: "Exact missing or hashed value state installed at this pointer.",
  }),
  previous: previousJsonValueSchema.annotations({
    description: "State recorded before this JSON pointer first became owned.",
  }),
}).pipe(
  Schema.filter((value) =>
    value.installed._tag === "missing" && value.previous._tag === "missing"
      ? {
          path: ["previous"],
          message: "Installed missing JSON ownership requires a previous value that the installation removed.",
        }
      : undefined,
  ),
);

export type OwnedJsonValue = Schema.Schema.Type<typeof ownedJsonValueSchema>;

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
  createdContainers: Schema.Array(jsonPointerSchema).annotations({
    description: "Exact JSON object pointers created to reach owned values and removable only when empty.",
  }),
  values: ownedJsonValuesSchema,
}).pipe(
  Schema.filter((ownership) => [
    ...ownership.createdContainers.flatMap((container, index) =>
      ownership.createdContainers.indexOf(container) === index
        ? []
        : [
            {
              path: ["createdContainers", index],
              message: `Created JSON container ${container} must be unique.`,
            },
          ],
    ),
    ...ownership.createdContainers.flatMap((container, index) =>
      ownership.values.some((value) => value.pointer.startsWith(`${container}/`))
        ? []
        : [
            {
              path: ["createdContainers", index],
              message: `Created JSON container ${container} must be a proper ancestor of an owned value.`,
            },
          ],
    ),
  ]),
);

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

const jsonValueTextSchema = Schema.parseJson(jsonValueSchema);
const decodeJsonValueSource = Schema.decodeUnknownEither(jsonValueTextSchema, {
  onExcessProperty: "error",
});

const jsonPropertyRecordSchema = Schema.Record({ key: Schema.String, value: jsonValueSchema });
const decodeJsonPropertySource = Schema.decodeUnknownEither(Schema.parseJson(jsonPropertyRecordSchema), {
  onExcessProperty: "error",
});
const jsonValuesEqual = (left: unknown, right: unknown): boolean =>
  Schema.encodeSync(jsonValueTextSchema)(left) === Schema.encodeSync(jsonValueTextSchema)(right);

const pointerKey = (pointer: string): string => {
  const segment = pointer.slice(pointer.lastIndexOf("/") + 1);

  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
};

const lexicalProperty = (lexical: PreviousJsonLexical): string | undefined => {
  switch (lexical._tag) {
    case "value":
      return undefined;
    case "beforeProperty":
    case "afterProperty":
    case "onlyProperty":
      return lexical.property;
  }
};

const lexicalMatchesPrevious = (value: OwnedJsonValue): boolean => {
  if (value.previous._tag === "missing" || value.previous.lexical === undefined) {
    return false;
  }

  if (value.previous.lexical._tag === "value") {
    const decoded = decodeJsonValueSource(value.previous.lexical.source);

    return Either.isRight(decoded) && jsonValuesEqual(decoded.right, value.previous.value);
  }

  const property = lexicalProperty(value.previous.lexical);
  const decoded = property === undefined ? undefined : decodeJsonPropertySource(`{${property}}`);
  if (decoded === undefined || Either.isLeft(decoded)) {
    return false;
  }

  const entries = Object.entries(decoded.right);

  return entries.length === 1 && entries[0]?.[0] === pointerKey(value.pointer) && jsonValuesEqual(entries[0][1], value.previous.value);
};

const settingsLexicalIssues = (entry: { kind: ArtifactKind; ownership: ArtifactOwnership }) => {
  if (entry.ownership._tag !== "jsonValues") {
    return [];
  }

  return entry.ownership.values.flatMap((value, index) => {
    const lexical = value.previous._tag === "value" ? value.previous.lexical : undefined;
    if (entry.kind._tag !== "settings") {
      return lexical === undefined
        ? []
        : [
            {
              path: ["ownership", "values", index, "previous", "lexical"],
              message: "Only settings ownership may carry lexical JSON restoration evidence.",
            },
          ];
    }

    if (value.previous._tag === "missing") {
      return [];
    }

    const expectedTag = value.installed._tag === "missing" ? "property" : "value";
    const actualTag = lexical?._tag === "value" ? "value" : lexical === undefined ? "missing" : "property";

    return actualTag === expectedTag && lexicalMatchesPrevious(value)
      ? []
      : [
          {
            path: ["ownership", "values", index, "previous", "lexical"],
            message: `Settings ownership requires correlated ${expectedTag} lexical restoration evidence.`,
          },
        ];
  });
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
    ...settingsLexicalIssues(entry),
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

export const versionSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(SEMVER_PATTERN, {
    message: () => "Receipt versions must use semantic version syntax.",
  }),
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

const artifactReceiptTextDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const artifactReceiptsEqual = (left: ArtifactReceipt, right: ArtifactReceipt): boolean =>
  Schema.encodeSync(artifactReceiptJsonSchema)(left) === Schema.encodeSync(artifactReceiptJsonSchema)(right);

const decodeArtifactReceiptBytes = (bytes: Uint8Array): Either.Either<ArtifactReceipt, string> => {
  const decodedText = Either.try({
    try: () => artifactReceiptTextDecoder.decode(bytes),
    catch: (error) => `file bytes are not valid UTF-8: ${error instanceof Error ? error.message : String(error)}`,
  });

  return Either.flatMap(decodedText, (json) => {
    if (json.startsWith("\uFEFF")) {
      return Either.left("leading UTF-8 byte-order mark is not allowed");
    }

    const duplicateProperty = findDuplicateJsonProperty(json);
    if (duplicateProperty !== undefined) {
      return Either.left(`duplicate JSON property ${JSON.stringify(duplicateProperty)}`);
    }

    return Either.mapLeft(
      Schema.decodeUnknownEither(artifactReceiptJsonSchema, {
        onExcessProperty: "error",
      })(json),
      ParseResult.TreeFormatter.formatErrorSync,
    );
  });
};

export const artifactReceiptSnapshotSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("present", {
    bytes: Schema.Uint8ArrayFromSelf.annotations({
      description: "Exact receipt file bytes read from disk.",
    }),
    receipt: Schema.typeSchema(artifactReceiptSchema).annotations({
      description: "Strict receipt decoded from the same file bytes.",
    }),
  }).pipe(
    Schema.filter((snapshot) => {
      const decodedReceipt = decodeArtifactReceiptBytes(snapshot.bytes);

      return Either.isRight(decodedReceipt) && artifactReceiptsEqual(decodedReceipt.right, snapshot.receipt)
        ? undefined
        : {
            path: ["receipt"],
            message: "Decoded receipt authority must exactly match its source bytes.",
          };
    }),
  ),
).annotations({
  description: "Missing or strictly decoded artifact receipt with its exact source bytes.",
});

export type ArtifactReceiptSnapshot = Schema.Schema.Type<typeof artifactReceiptSnapshotSchema>;

export class ArtifactReceiptParseError extends Schema.TaggedError<ArtifactReceiptParseError>()("ArtifactReceiptParseError", {
  receiptPath: Schema.NonEmptyString.annotations({
    description: "Artifact receipt file whose contents could not be decoded.",
  }),
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable receipt encoding, JSON, or schema issue.",
  }),
}) {
  get message(): string {
    return `Artifact receipt at ${this.receiptPath} is invalid: ${this.issue}. Fix or remove it, then retry.`;
  }
}

const missingArtifactReceiptSnapshot: ArtifactReceiptSnapshot = { _tag: "missing" };

const isNotFound = (error: PlatformError): boolean => error._tag === "SystemError" && error.reason === "NotFound";

export const readArtifactReceiptSnapshot = (receiptPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const contents = yield* fileSystem.readFile(receiptPath).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () => Effect.succeed(Option.none())),
    );

    if (Option.isNone(contents)) {
      return missingArtifactReceiptSnapshot;
    }

    const bytes = contents.value;
    const decodedReceipt = decodeArtifactReceiptBytes(bytes);
    if (Either.isLeft(decodedReceipt)) {
      return yield* new ArtifactReceiptParseError({ receiptPath, issue: decodedReceipt.left });
    }

    const snapshot = Schema.validateSync(artifactReceiptSnapshotSchema, {
      onExcessProperty: "error",
    })({ _tag: "present", bytes, receipt: decodedReceipt.right });

    return snapshot;
  });

const legacySkillIdSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(LEGACY_SKILL_ID_PATTERN, {
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
