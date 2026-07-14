import * as FileSystem from "@effect/platform/FileSystem";
import { Effect, Option, Schema, type SchemaAST } from "effect";

import { bagConfigSchema } from "./bagConfigSchema.js";

const strictParseOptions = {
  onExcessProperty: "error",
} satisfies SchemaAST.ParseOptions;

const completeBagConfigSchema = Schema.typeSchema(bagConfigSchema);

export const configFileSnapshotSchema = Schema.Struct({
  bytes: Schema.Uint8ArrayFromSelf,
  config: completeBagConfigSchema,
}).annotations({
  parseOptions: strictParseOptions,
});

export type ConfigFileSnapshot = Schema.Schema.Type<typeof configFileSnapshotSchema>;

export class ConfigFileReadError extends Schema.TaggedError<ConfigFileReadError>()("ConfigFileReadError", {
  path: Schema.String,
  message: Schema.String,
  cause: Schema.Defect,
}) {}

export class ConfigFileUtf8Error extends Schema.TaggedError<ConfigFileUtf8Error>()("ConfigFileUtf8Error", {
  path: Schema.String,
  message: Schema.String,
  cause: Schema.Defect,
}) {}

export class ConfigFileJsonError extends Schema.TaggedError<ConfigFileJsonError>()("ConfigFileJsonError", {
  path: Schema.String,
  message: Schema.String,
  cause: Schema.Defect,
}) {}

export class ConfigFileSchemaError extends Schema.TaggedError<ConfigFileSchemaError>()("ConfigFileSchemaError", {
  path: Schema.String,
  message: Schema.String,
  cause: Schema.Defect,
}) {}

const readBytes = (targetPath: string) => {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    return yield* fileSystem.readFile(targetPath).pipe(
      Effect.map(Option.some),
      Effect.catchAll((cause) => {
        if (cause._tag === "SystemError" && cause.reason === "NotFound") {
          return Effect.succeed(Option.none<Uint8Array>());
        }

        return Effect.fail(
          new ConfigFileReadError({
            path: targetPath,
            message: `Unable to read managed configuration at ${targetPath}.`,
            cause,
          }),
        );
      }),
    );
  });
};

/** Missing files are the only absence case; all unreadable or invalid files fail with a stage-specific tagged error. */
export const readConfigFile = (targetPath: string) => {
  // Read raw bytes, decode transport and syntax, then validate the complete persisted contract.
  return Effect.gen(function* () {
    // 1. Read without probing so non-NotFound failures stay observable.
    const raw = yield* readBytes(targetPath);
    if (Option.isNone(raw)) {
      return Option.none<ConfigFileSnapshot>();
    }

    // 2. Decode exact bytes as fatal UTF-8.
    const content = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(raw.value),
      catch: (cause) =>
        new ConfigFileUtf8Error({
          path: targetPath,
          message: `Managed configuration at ${targetPath} is not valid UTF-8.`,
          cause,
        }),
    });
    // 3. Parse JSON without applying any configuration defaults.
    const document = yield* Effect.try({
      try: (): unknown => JSON.parse(content),
      catch: (cause) =>
        new ConfigFileJsonError({
          path: targetPath,
          message: `Managed configuration at ${targetPath} is not valid JSON.`,
          cause,
        }),
    });
    // 4. Decode the type side so every persisted key is required.
    const config = yield* Schema.decodeUnknown(
      completeBagConfigSchema,
      strictParseOptions,
    )(document).pipe(
      Effect.mapError(
        (cause) =>
          new ConfigFileSchemaError({
            path: targetPath,
            message: `Managed configuration at ${targetPath} must contain the complete managed configuration contract.`,
            cause,
          }),
      ),
    );

    return Option.some(
      Schema.validateSync(
        configFileSnapshotSchema,
        strictParseOptions,
      )({
        bytes: raw.value,
        config,
      }),
    );
  });
};

export type ConfigFileError = ConfigFileReadError | ConfigFileUtf8Error | ConfigFileJsonError | ConfigFileSchemaError;
