import { createHash } from "node:crypto";
import { Schema, type SchemaAST } from "effect";

type RecursiveJsonValue = string | number | boolean | null | ReadonlyArray<RecursiveJsonValue> | RecursiveJsonObject;

type RecursiveJsonObject = {
  readonly [key: string]: RecursiveJsonValue;
};

type RecursiveJsonEncoded = string | number | boolean | null | ReadonlyArray<unknown> | Readonly<Record<string, unknown>>;

const isJsonArray = (value: RecursiveJsonValue): value is ReadonlyArray<RecursiveJsonValue> => {
  return Array.isArray(value);
};

const strictParseOptions = {
  onExcessProperty: "error",
} satisfies SchemaAST.ParseOptions;

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

const isDenseJsonArray = (input: unknown): input is ReadonlyArray<unknown> => {
  if (!Array.isArray(input) || Object.getOwnPropertySymbols(input).length > 0) {
    return false;
  }

  const ownNames = Object.getOwnPropertyNames(input).filter((name) => name !== "length");
  const descriptors = Object.getOwnPropertyDescriptors(input);

  return (
    ownNames.length === input.length &&
    ownNames.every((name, index) => {
      // Object.getOwnPropertyNames proves the descriptor table contains this exact own key.
      const descriptor = descriptors[name];

      return name === String(index) && descriptor !== undefined && "value" in descriptor;
    })
  );
};

const isPlainJsonObject = (input: unknown): input is Readonly<Record<string, unknown>> => {
  if (typeof input !== "object" || input === null || Array.isArray(input) || !isPlainObject(input)) {
    return false;
  }

  if (Object.getOwnPropertySymbols(input).length > 0) {
    return false;
  }

  const ownNames = Object.getOwnPropertyNames(input);
  const descriptors = Object.getOwnPropertyDescriptors(input);

  return (
    ownNames.length === Object.keys(input).length &&
    ownNames.every((name) => {
      // Object.getOwnPropertyNames proves the descriptor table contains this exact own key.
      const descriptor = descriptors[name];

      return descriptor !== undefined && "value" in descriptor;
    })
  );
};

const encodeCanonicalJsonValue = (value: RecursiveJsonValue): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    const encoded = JSON.stringify(value);

    if (encoded === undefined) {
      throw new Error("A validated JSON primitive must encode.");
    }

    return encoded;
  }

  if (isJsonArray(value)) {
    return `[${value.map(encodeCanonicalJsonValue).join(",")}]`;
  }

  const entries = Object.keys(value)
    .sort((left, right) => {
      if (left < right) {
        return -1;
      }

      return left > right ? 1 : 0;
    })
    .map((key) => {
      // Object.keys proves this key belongs to the validated plain JSON object.
      return `${JSON.stringify(key)}:${encodeCanonicalJsonValue(value[key])}`;
    });

  return `{${entries.join(",")}}`;
};

const isCanonicalBase64 = (value: string): boolean => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }

  return Buffer.from(value, "base64").toString("base64") === value;
};

const isBoundedNewlineDelimiter = (value: Uint8Array): boolean => {
  const text = Buffer.from(value).toString("utf8");

  return Buffer.from(text, "utf8").equals(Buffer.from(value)) && /^(?:\r?\n){0,2}$/.test(text);
};

const isSafeRelativePath = (value: string): boolean => {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.endsWith("/")
  ) {
    return false;
  }

  const segments = value.split("/");

  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
};

const hasParentChildConflict = (paths: ReadonlyArray<string>): boolean => {
  return paths.some((candidate) => {
    return paths.some((possibleParent) => {
      return candidate !== possibleParent && candidate.startsWith(`${possibleParent}/`);
    });
  });
};

const hasOverlappingPointers = (pointers: ReadonlyArray<string>): boolean => {
  return pointers.some((pointer, index) => {
    return pointers.some((candidate, candidateIndex) => {
      if (index === candidateIndex) {
        return false;
      }

      return candidate.startsWith(`${pointer}/`);
    });
  });
};

const uniqueValues = (values: ReadonlyArray<string>): boolean => {
  return new Set(values).size === values.length;
};

const sortedUniqueValues = (values: ReadonlyArray<string>): boolean => {
  if (!uniqueValues(values)) {
    return false;
  }

  return values.every((value, index) => {
    const previous = index === 0 ? undefined : values.at(index - 1);

    return previous === undefined || previous < value;
  });
};

export const sha256Bytes = (value: Uint8Array): string => {
  return createHash("sha256").update(value).digest("hex");
};

const denseJsonArraySchema = Schema.declare(isDenseJsonArray, {
  identifier: "DenseJsonArray",
  description: "A dense array without symbol or extra own properties.",
});

const plainJsonObjectSchema = Schema.declare(isPlainJsonObject, {
  identifier: "PlainJsonObject",
  description: "A plain string-keyed object without hidden or symbol properties.",
});

export const jsonValueSchema: Schema.Schema<RecursiveJsonValue, RecursiveJsonEncoded> = Schema.suspend(() => {
  const arraySchema = denseJsonArraySchema.pipe(Schema.compose(Schema.Array(jsonValueSchema)));
  const objectSchema = plainJsonObjectSchema.pipe(
    Schema.compose(
      Schema.Record({
        key: Schema.String,
        value: jsonValueSchema,
      }),
    ),
  );

  return Schema.Union(Schema.Null, Schema.String, Schema.Boolean, Schema.JsonNumber, arraySchema, objectSchema);
});

export type JsonValue = Schema.Schema.Type<typeof jsonValueSchema>;

export const sha256JsonValue = (value: JsonValue): string => {
  return sha256Bytes(new TextEncoder().encode(encodeCanonicalJsonValue(value)));
};

export const sha256Schema = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{64}$/, {
    message: () => "SHA-256 values must contain 64 lowercase hexadecimal characters.",
  }),
);

const canonicalBase64Schema = Schema.String.pipe(
  Schema.filter(isCanonicalBase64, {
    message: () => "Persisted bytes must use canonical padded RFC 4648 base64.",
  }),
);

export const persistedBytesSchema = canonicalBase64Schema.pipe(Schema.compose(Schema.Uint8ArrayFromBase64));

const newlineDelimiterSchema = persistedBytesSchema.pipe(
  Schema.filter(isBoundedNewlineDelimiter, {
    message: () => "Managed-block delimiters must contain at most two LF or CRLF newline sequences.",
  }),
);

export const scopeRelativePathSchema = Schema.String.pipe(
  Schema.filter(isSafeRelativePath, {
    message: () => "Artifact paths must be normalized scope-relative POSIX paths.",
  }),
  Schema.brand("ScopeRelativePath"),
);

export type ScopeRelativePath = Schema.Schema.Type<typeof scopeRelativePathSchema>;

const stableIdSchema = Schema.String.pipe(
  Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: () => "Stable IDs must use kebab-case.",
  }),
);

const applicationOwnerSchema = Schema.TaggedStruct("application", {}).annotations({
  parseOptions: strictParseOptions,
});

const agentOwnerSchema = Schema.TaggedStruct("agent", {
  agentIds: Schema.Array(stableIdSchema).pipe(
    Schema.filter((agentIds) => agentIds.length > 0 && uniqueValues(agentIds), {
      message: () => "Agent ownership requires a non-empty ordered list of unique stable agent IDs.",
    }),
  ),
}).annotations({
  parseOptions: strictParseOptions,
});

export const artifactOwnerSchema = Schema.Union(applicationOwnerSchema, agentOwnerSchema);

export type ArtifactOwner = Schema.Schema.Type<typeof artifactOwnerSchema>;

const missingPriorFileSchema = Schema.TaggedStruct("missing", {}).annotations({
  parseOptions: strictParseOptions,
});

const priorFileSchema = Schema.TaggedStruct("file", {
  bytes: persistedBytesSchema,
  sha256: sha256Schema,
})
  .pipe(
    Schema.filter((prior) => prior.sha256 === sha256Bytes(prior.bytes), {
      message: () => "Prior file bytes must match their recorded SHA-256.",
    }),
  )
  .annotations({
    parseOptions: strictParseOptions,
  });

const wholeFileOwnershipSchema = Schema.TaggedStruct("wholeFile", {
  installedSha256: sha256Schema,
  prior: Schema.Union(missingPriorFileSchema, priorFileSchema),
}).annotations({
  parseOptions: strictParseOptions,
});

const missingDocumentSchema = Schema.TaggedStruct("missing", {}).annotations({
  parseOptions: strictParseOptions,
});

const existingDocumentSchema = Schema.TaggedStruct("existing", {}).annotations({
  parseOptions: strictParseOptions,
});

const priorDocumentSchema = Schema.Union(missingDocumentSchema, existingDocumentSchema);

const markerSchema = Schema.String.pipe(
  Schema.filter((marker) => marker.length > 0 && !marker.includes("\n") && !marker.includes("\r") && !marker.includes("\0"), {
    message: () => "Managed-block markers must be distinct non-empty single-line text without NUL bytes.",
  }),
);

const managedBlockOwnershipSchema = Schema.TaggedStruct("managedBlock", {
  startMarker: markerSchema,
  endMarker: markerSchema,
  installedBodySha256: sha256Schema,
  leadingDelimiter: newlineDelimiterSchema,
  trailingDelimiter: newlineDelimiterSchema,
  priorDocument: priorDocumentSchema,
})
  .pipe(
    Schema.filter((ownership) => ownership.startMarker !== ownership.endMarker, {
      message: () => "Managed-block start and end markers must be distinct.",
    }),
  )
  .annotations({
    parseOptions: strictParseOptions,
  });

export const missingJsonStateSchema = Schema.TaggedStruct("missing", {}).annotations({
  parseOptions: strictParseOptions,
});

export const installedJsonValueSchema = Schema.TaggedStruct("value", {
  value: jsonValueSchema,
  sha256: sha256Schema,
})
  .pipe(
    Schema.filter((state) => state.sha256 === sha256JsonValue(state.value), {
      message: () => "Installed JSON values must match their deterministic SHA-256.",
    }),
  )
  .annotations({
    parseOptions: strictParseOptions,
  });

const priorJsonValueSchema = Schema.TaggedStruct("value", {
  value: jsonValueSchema,
}).annotations({
  parseOptions: strictParseOptions,
});

const jsonPointerSchema = Schema.String.pipe(
  Schema.pattern(/^\/(?:[^~/]|~[01])*(?:\/(?:[^~/]|~[01])*)*$/, {
    message: () => "JSON ownership pointers must be non-root RFC 6901 pointers.",
  }),
);

const jsonValueEntrySchema = Schema.Struct({
  pointer: jsonPointerSchema,
  installed: Schema.Union(missingJsonStateSchema, installedJsonValueSchema),
  prior: Schema.Union(missingJsonStateSchema, priorJsonValueSchema),
}).annotations({
  parseOptions: strictParseOptions,
});

const jsonValuesOwnershipSchema = Schema.TaggedStruct("jsonValues", {
  entries: Schema.Array(jsonValueEntrySchema),
  priorDocument: priorDocumentSchema,
})
  .pipe(
    Schema.filter((ownership) => {
      const pointers = ownership.entries.map((entry) => entry.pointer);

      if (ownership.entries.length === 0 || !sortedUniqueValues(pointers) || hasOverlappingPointers(pointers)) {
        return [
          {
            path: ["entries"],
            message: "JSON ownership pointers must be non-empty, sorted, unique, and non-overlapping.",
          },
        ];
      }

      if (ownership.priorDocument._tag === "missing" && ownership.entries.some((entry) => entry.prior._tag === "value")) {
        return [
          {
            path: ["priorDocument"],
            message: "A previously missing JSON document cannot contain prior values.",
          },
        ];
      }

      return true;
    }),
  )
  .annotations({
    parseOptions: strictParseOptions,
  });

const absentYamlPresenceSchema = Schema.TaggedStruct("absent", {}).annotations({
  parseOptions: strictParseOptions,
});

const presentYamlPresenceSchema = Schema.TaggedStruct("present", {}).annotations({
  parseOptions: strictParseOptions,
});

const yamlPresenceSchema = Schema.Union(absentYamlPresenceSchema, presentYamlPresenceSchema);

const yamlSequenceValueOwnershipSchema = Schema.TaggedStruct("yamlSequenceValue", {
  key: Schema.NonEmptyString,
  reference: Schema.NonEmptyString,
  priorPresence: yamlPresenceSchema,
  priorKeyPresence: yamlPresenceSchema,
  priorDocument: priorDocumentSchema,
})
  .pipe(
    Schema.filter((ownership) => {
      if (ownership.priorDocument._tag === "missing" && ownership.priorKeyPresence._tag === "present") {
        return [
          {
            path: ["priorKeyPresence"],
            message: "A previously missing YAML document cannot contain the owned key.",
          },
        ];
      }

      if (ownership.priorKeyPresence._tag === "absent" && ownership.priorPresence._tag === "present") {
        return [
          {
            path: ["priorPresence"],
            message: "A previously missing YAML key cannot contain the owned reference.",
          },
        ];
      }

      return true;
    }),
  )
  .annotations({
    parseOptions: strictParseOptions,
  });

export const artifactOwnershipSchema = Schema.Union(
  wholeFileOwnershipSchema,
  managedBlockOwnershipSchema,
  jsonValuesOwnershipSchema,
  yamlSequenceValueOwnershipSchema,
);

export type ArtifactOwnership = Schema.Schema.Type<typeof artifactOwnershipSchema>;

export const artifactKindSchema = Schema.Literal(
  "runtime",
  "skill",
  "rule",
  "instruction",
  "configReference",
  "settings",
  "managedConfig",
  "receipt",
);

export type ArtifactKind = Schema.Schema.Type<typeof artifactKindSchema>;

const wholeFileArtifactFields = {
  path: scopeRelativePathSchema,
  owner: artifactOwnerSchema,
  ownership: wholeFileOwnershipSchema,
};

const runtimeArtifactSchema = Schema.Struct({
  ...wholeFileArtifactFields,
  kind: Schema.Literal("runtime"),
});

const skillArtifactSchema = Schema.Struct({
  ...wholeFileArtifactFields,
  kind: Schema.Literal("skill"),
});

const ruleArtifactSchema = Schema.Struct({
  ...wholeFileArtifactFields,
  kind: Schema.Literal("rule"),
});

const managedConfigArtifactSchema = Schema.Struct({
  ...wholeFileArtifactFields,
  kind: Schema.Literal("managedConfig"),
});

const instructionArtifactSchema = Schema.Struct({
  path: scopeRelativePathSchema,
  owner: artifactOwnerSchema,
  kind: Schema.Literal("instruction"),
  ownership: managedBlockOwnershipSchema,
});

const jsonConfigReferenceArtifactSchema = Schema.Struct({
  path: scopeRelativePathSchema,
  owner: artifactOwnerSchema,
  kind: Schema.Literal("configReference"),
  ownership: jsonValuesOwnershipSchema,
});

const yamlConfigReferenceArtifactSchema = Schema.Struct({
  path: scopeRelativePathSchema,
  owner: artifactOwnerSchema,
  kind: Schema.Literal("configReference"),
  ownership: yamlSequenceValueOwnershipSchema,
});

const settingsArtifactSchema = Schema.Struct({
  path: scopeRelativePathSchema,
  owner: artifactOwnerSchema,
  kind: Schema.Literal("settings"),
  ownership: jsonValuesOwnershipSchema,
});

export const ownedArtifactSchema = Schema.Union(
  runtimeArtifactSchema,
  skillArtifactSchema,
  ruleArtifactSchema,
  instructionArtifactSchema,
  jsonConfigReferenceArtifactSchema,
  yamlConfigReferenceArtifactSchema,
  settingsArtifactSchema,
  managedConfigArtifactSchema,
).annotations({
  parseOptions: strictParseOptions,
});

export type OwnedArtifact = Schema.Schema.Type<typeof ownedArtifactSchema>;

export const artifactReceiptSchema = Schema.Struct({
  version: Schema.Literal(1),
  installerVersion: Schema.NonEmptyTrimmedString,
  scope: Schema.Literal("global", "project"),
  features: Schema.Array(stableIdSchema).pipe(
    Schema.filter((features) => uniqueValues(features), {
      message: () => "Receipt feature IDs must be unique.",
    }),
  ),
  artifacts: Schema.Array(ownedArtifactSchema),
})
  .pipe(
    Schema.filter((receipt) => {
      const paths = receipt.artifacts.map((artifact) => artifact.path);

      if (!sortedUniqueValues(paths)) {
        return [
          {
            path: ["artifacts"],
            message: "Receipt artifacts must be strictly path-sorted and unique.",
          },
        ];
      }

      return hasParentChildConflict(paths)
        ? [
            {
              path: ["artifacts"],
              message: "Receipt artifacts cannot own parent and child targets.",
            },
          ]
        : true;
    }),
  )
  .annotations({
    parseOptions: strictParseOptions,
  });

export type ArtifactReceipt = Schema.Schema.Type<typeof artifactReceiptSchema>;

export type EncodedArtifactReceipt = Schema.Schema.Encoded<typeof artifactReceiptSchema>;

const encodeCanonicalUnknown = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    const encoded = JSON.stringify(value);

    if (encoded === undefined) {
      throw new Error("A validated JSON primitive must encode.");
    }

    return encoded;
  }

  if (Array.isArray(value)) {
    return `[${value.map(encodeCanonicalUnknown).join(",")}]`;
  }

  if (typeof value !== "object") {
    throw new Error("Receipt JSON may contain only validated JSON values.");
  }

  const entries = Object.entries(value)
    .sort(([left], [right]) => {
      if (left < right) {
        return -1;
      }

      return left > right ? 1 : 0;
    })
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${encodeCanonicalUnknown(entryValue)}`);

  return `{${entries.join(",")}}`;
};

const canonicalJsonDocumentSchema = Schema.transform(Schema.String, Schema.Unknown, {
  strict: true,
  decode: (value) => JSON.parse(value),
  encode: encodeCanonicalUnknown,
});

export const artifactReceiptJsonSchema = canonicalJsonDocumentSchema.pipe(Schema.compose(artifactReceiptSchema));
