import { FileSystem } from "@effect/platform";
import { PlatformError } from "@effect/platform/Error";
import { Effect, Either, Option, ParseResult, Schema } from "effect";

import { bagConfigSchema } from "./bagConfigSchema.js";
import { findDuplicateJsonProperty } from "./jsonDocument.js";

const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const managedConfigFileSchema = Schema.typeSchema(bagConfigSchema);

export type ManagedConfigFile = Schema.Schema.Type<typeof managedConfigFileSchema>;

export class ConfigFileParseError extends Schema.TaggedError<ConfigFileParseError>()("ConfigFileParseError", {
  configPath: Schema.NonEmptyString.annotations({
    description: "Managed configuration file that could not be parsed as JSON.",
  }),
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable JSON parsing issue reported by Effect Schema.",
  }),
}) {
  get message(): string {
    return `Managed config at ${this.configPath} is not valid JSON: ${this.issue}. Fix or remove it, then retry.`;
  }
}

export class ConfigFileSchemaError extends Schema.TaggedError<ConfigFileSchemaError>()("ConfigFileSchemaError", {
  configPath: Schema.NonEmptyString.annotations({
    description: "Managed configuration file whose decoded value violated the schema.",
  }),
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable managed configuration issue reported by Effect Schema.",
  }),
}) {
  get message(): string {
    return `Managed config at ${this.configPath} is invalid: ${this.issue}. Fix or remove it, then retry.`;
  }
}

export const configFileReadErrorSchema = Schema.Union(PlatformError, ConfigFileParseError, ConfigFileSchemaError);

export type ConfigFileReadError = Schema.Schema.Type<typeof configFileReadErrorSchema>;

const decodeJson = Schema.decodeUnknownEither(Schema.parseJson(), {
  onExcessProperty: "error",
});

const decodeManagedConfigFile = Schema.decodeUnknownEither(managedConfigFileSchema, {
  onExcessProperty: "error",
});

const formatParseError = (error: ParseResult.ParseError): string => ParseResult.TreeFormatter.formatErrorSync(error);

const formatUnknownError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isNotFound = (error: PlatformError): boolean => error._tag === "SystemError" && error.reason === "NotFound";

const decodeConfigFileBytes = (input: {
  readonly bytes: Uint8Array;
  readonly configPath: string;
}): Either.Either<ManagedConfigFile, ConfigFileParseError | ConfigFileSchemaError> => {
  // Apply the same lossless byte-to-config pipeline at every trust boundary.
  // 1. Decode bytes without replacement characters or BOM normalization.
  const decodedText = Either.mapLeft(
    Either.try({
      try: () => textDecoder.decode(input.bytes),
      catch: formatUnknownError,
    }),
    (issue) =>
      new ConfigFileParseError({
        configPath: input.configPath,
        issue: `file bytes are not valid UTF-8: ${issue}`,
      }),
  );
  if (Either.isLeft(decodedText)) {
    return Either.left(decodedText.left);
  }

  const json = decodedText.right;
  if (json.startsWith("\uFEFF")) {
    return Either.left(
      new ConfigFileParseError({
        configPath: input.configPath,
        issue: "file must not start with a UTF-8 byte-order mark",
      }),
    );
  }

  // 2. Parse strict JSON before inspecting its object semantics.
  const parsed = Either.mapLeft(
    decodeJson(json),
    (error) =>
      new ConfigFileParseError({
        configPath: input.configPath,
        issue: formatParseError(error),
      }),
  );
  if (Either.isLeft(parsed)) {
    return Either.left(parsed.left);
  }

  // 3. Reject duplicate properties that JSON parsing would collapse.
  const duplicateProperty = findDuplicateJsonProperty(json);
  if (duplicateProperty !== undefined) {
    return Either.left(
      new ConfigFileParseError({
        configPath: input.configPath,
        issue: `duplicate JSON property ${JSON.stringify(duplicateProperty)}`,
      }),
    );
  }

  // 4. Decode the complete managed configuration shape and invariants.
  return Either.mapLeft(
    decodeManagedConfigFile(parsed.right),
    (error) =>
      new ConfigFileSchemaError({
        configPath: input.configPath,
        issue: formatParseError(error),
      }),
  );
};

const managedConfigsEqual = Schema.equivalence(managedConfigFileSchema);

const missingConfigFileSnapshotSchema = Schema.TaggedStruct("missing", {}).annotations({
  description: "Managed configuration file is absent.",
});

const presentConfigFileSnapshotSchema = Schema.TaggedStruct("present", {
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Exact managed configuration bytes read once from disk.",
  }),
  config: managedConfigFileSchema.annotations({
    description: "Complete strict configuration decoded from the same bytes.",
  }),
})
  .pipe(
    Schema.filter((snapshot) => {
      const decodedConfig = decodeConfigFileBytes({
        bytes: snapshot.bytes,
        configPath: "managed configuration snapshot",
      });

      return Either.isRight(decodedConfig) && managedConfigsEqual(decodedConfig.right, snapshot.config)
        ? undefined
        : {
            path: ["config"],
            message: "Decoded managed configuration must exactly match its source bytes.",
          };
    }),
  )
  .annotations({
    description: "Exact managed configuration bytes and their decoded value.",
  });

export const configFileSnapshotSchema = Schema.Union(missingConfigFileSnapshotSchema, presentConfigFileSnapshotSchema).annotations({
  description: "Missing or present managed configuration captured by one filesystem read.",
});

export type ConfigFileSnapshot = Schema.Schema.Type<typeof configFileSnapshotSchema>;

export const readConfigFile = (configPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const contents = yield* fileSystem.readFile(configPath).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () => Effect.succeed(Option.none())),
    );

    if (Option.isNone(contents)) {
      return missingConfigFileSnapshotSchema.make();
    }

    const decodedConfig = decodeConfigFileBytes({ bytes: contents.value, configPath });
    if (Either.isLeft(decodedConfig)) {
      return yield* decodedConfig.left;
    }

    return presentConfigFileSnapshotSchema.make({
      _tag: "present",
      bytes: contents.value,
      config: decodedConfig.right,
    });
  });
