import { FileSystem } from "@effect/platform";
import { PlatformError } from "@effect/platform/Error";
import { Effect, Option, ParseResult, Schema } from "effect";

import { bagConfigSchema } from "./bagConfigSchema.js";
import { findDuplicateJsonProperty } from "./jsonDocument.js";

const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const managedConfigFileSchema = Schema.typeSchema(bagConfigSchema);

export type ManagedConfigFile = Schema.Schema.Type<typeof managedConfigFileSchema>;

export const configFileReadResultSchema = Schema.OptionFromSelf(managedConfigFileSchema);

export type ConfigFileReadResult = Schema.Schema.Type<typeof configFileReadResultSchema>;

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

const decodeJson = Schema.decodeUnknown(Schema.parseJson(), {
  onExcessProperty: "error",
});

const decodeManagedConfigFile = Schema.decodeUnknown(managedConfigFileSchema, {
  onExcessProperty: "error",
});

const formatParseError = (error: ParseResult.ParseError): string => ParseResult.TreeFormatter.formatErrorSync(error);

const formatUnknownError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isNotFound = (error: PlatformError): boolean => error._tag === "SystemError" && error.reason === "NotFound";

const decodeUtf8 = (bytes: Uint8Array, configPath: string) =>
  Effect.try({
    try: () => textDecoder.decode(bytes),
    catch: (error) =>
      new ConfigFileParseError({
        configPath,
        issue: `file bytes are not valid UTF-8: ${formatUnknownError(error)}`,
      }),
  });

export const readConfigFile = (configPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const contents = yield* fileSystem.readFile(configPath).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () => Effect.succeed(Option.none())),
    );

    if (Option.isNone(contents)) {
      return Option.none<ManagedConfigFile>();
    }

    const json = yield* decodeUtf8(contents.value, configPath);
    const parsed = yield* decodeJson(json).pipe(
      Effect.mapError(
        (error) =>
          new ConfigFileParseError({
            configPath,
            issue: formatParseError(error),
          }),
      ),
    );
    const duplicateProperty = findDuplicateJsonProperty(json);
    if (duplicateProperty !== undefined) {
      return yield* new ConfigFileParseError({
        configPath,
        issue: `duplicate JSON property ${JSON.stringify(duplicateProperty)}`,
      });
    }

    const config = yield* decodeManagedConfigFile(parsed).pipe(
      Effect.mapError(
        (error) =>
          new ConfigFileSchemaError({
            configPath,
            issue: formatParseError(error),
          }),
      ),
    );

    return Option.some(config);
  });
