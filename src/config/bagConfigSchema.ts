import { type Option, Schema, SchemaAST } from "effect";

import { autoCompactDurationSchema } from "./autoCompactDuration.js";

// e.g. "0.18", "+1e-3", ".5" — not "1." alone without digits after optional form handled, "NaN", or "0x10"
const LEGACY_NUMBER_STRING_PATTERN = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

const legacyNumberStringSchema = Schema.Trim.pipe(
  Schema.compose(
    Schema.String.pipe(
      Schema.pattern(LEGACY_NUMBER_STRING_PATTERN, {
        message: () => "Expected a complete base-10 number.",
      }),
    ),
  ),
  Schema.compose(Schema.NumberFromString),
);

const legacyBooleanStringSchema = Schema.Trim.pipe(Schema.compose(Schema.BooleanFromString));

export const bagConfigSchema = Schema.Struct({
  contextWarnFraction: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(0.01, 0.95, {
        message: () => "Context warning fraction must be between 0.01 and 0.95.",
      }),
      Schema.annotations({
        description: "Context occupancy fraction that starts warning for a handoff.",
      }),
    ),
    { default: () => 0.18, exact: true },
  ),
  contextBlockFraction: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(0.01, 0.99, {
        message: () => "Context blocking fraction must be between 0.01 and 0.99.",
      }),
      Schema.annotations({
        description: "Context occupancy fraction that blocks new code edits.",
      }),
    ),
    { default: () => 0.2, exact: true },
  ),
  autorunDefaultCycleCount: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(1, 1000, {
        message: () => "Default autorun cycle count must be between 1 and 1000.",
      }),
      Schema.annotations({
        description: "Autorun cycle budget used when no count is provided.",
      }),
    ),
    { default: () => 10, exact: true },
  ),
  autorunMaxCycleCount: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(1, 1000, {
        message: () => "Maximum autorun cycle count must be between 1 and 1000.",
      }),
      Schema.annotations({
        description: "Hard upper limit for an autorun cycle budget.",
      }),
    ),
    { default: () => 50, exact: true },
  ),
  autorunPollIntervalSeconds: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(1, 600, {
        message: () => "Autorun poll interval must be between 1 and 600 seconds.",
      }),
      Schema.annotations({
        description: "Seconds between autorun daemon observations.",
      }),
    ),
    { default: () => 5, exact: true },
  ),
  autorunIdleThresholdSeconds: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(1, 600, {
        message: () => "Autorun idle threshold must be between 1 and 600 seconds.",
      }),
      Schema.annotations({
        description: "Seconds without activity before autorun treats a turn as idle.",
      }),
    ),
    { default: () => 8, exact: true },
  ),
  idleAutoCompact: Schema.optionalWith(autoCompactDurationSchema, {
    default: () => "off",
    exact: true,
  }),
  speechVoice: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.compose(
        Schema.Trimmed.annotations({
          description: "macOS speech voice name; empty selects the system default.",
        }),
      ),
    ),
    { default: () => "Samantha", exact: true },
  ),
  speechWordsPerMinute: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(80, 720, {
        message: () => "Speech rate must be between 80 and 720 words per minute.",
      }),
      Schema.annotations({
        description: "Speech response rate in words per minute.",
      }),
    ),
    { default: () => 230, exact: true },
  ),
  dedupEnforcement: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.compose(
        Schema.Literal("deny", "warn", "off").annotations({
          description: "Duplicate-code enforcement mode.",
        }),
      ),
    ),
    { default: () => "deny", exact: true },
  ),
  dedupSkipDirectories: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.compose(
        Schema.Trimmed.annotations({
          description: "Comma-separated directories excluded from duplicate-code enforcement.",
        }),
      ),
    ),
    { default: () => "", exact: true },
  ),
  debugEnabled: Schema.optionalWith(
    Schema.Boolean.annotations({
      description: "Whether bag-owned runtime diagnostics are enabled.",
    }),
    { default: () => false, exact: true },
  ),
}).pipe(
  Schema.filter((config) => [
    config.contextWarnFraction < config.contextBlockFraction
      ? undefined
      : {
          path: ["contextWarnFraction"],
          message: "Context warning fraction must be below contextBlockFraction.",
        },
    config.autorunDefaultCycleCount <= config.autorunMaxCycleCount
      ? undefined
      : {
          path: ["autorunDefaultCycleCount"],
          message: "Default autorun cycle count must not exceed autorunMaxCycleCount.",
        },
  ]),
);

export type BagConfig = Schema.Schema.Type<typeof bagConfigSchema>;

export type EncodedBagConfig = Schema.Schema.Encoded<typeof bagConfigSchema>;

export const bagConfigJsonSchema = Schema.parseJson(bagConfigSchema);

export const defaultBagConfig = Schema.decodeUnknownSync(bagConfigSchema, {
  onExcessProperty: "error",
})({});

export const legacyBagConfigEnvironmentSchema = Schema.Struct({
  contextWarnFraction: Schema.optionalWith(
    legacyNumberStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.contextWarnFraction.from)),
    { default: () => defaultBagConfig.contextWarnFraction, exact: true },
  ).pipe(Schema.fromKey("dufflebagContextWarnFraction")),
  contextBlockFraction: Schema.optionalWith(
    legacyNumberStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.contextBlockFraction.from)),
    { default: () => defaultBagConfig.contextBlockFraction, exact: true },
  ).pipe(Schema.fromKey("dufflebagContextBlockFraction")),
  autorunDefaultCycleCount: Schema.optionalWith(
    legacyNumberStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.autorunDefaultCycleCount.from)),
    { default: () => defaultBagConfig.autorunDefaultCycleCount, exact: true },
  ).pipe(Schema.fromKey("dufflebagAutorunDefaultCycleCount")),
  autorunMaxCycleCount: Schema.optionalWith(
    legacyNumberStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.autorunMaxCycleCount.from)),
    { default: () => defaultBagConfig.autorunMaxCycleCount, exact: true },
  ).pipe(Schema.fromKey("dufflebagAutorunMaxCycleCount")),
  autorunPollIntervalSeconds: Schema.optionalWith(
    legacyNumberStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.autorunPollIntervalSeconds.from)),
    { default: () => defaultBagConfig.autorunPollIntervalSeconds, exact: true },
  ).pipe(Schema.fromKey("dufflebagAutorunPollIntervalSeconds")),
  autorunIdleThresholdSeconds: Schema.optionalWith(
    legacyNumberStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.autorunIdleThresholdSeconds.from)),
    { default: () => defaultBagConfig.autorunIdleThresholdSeconds, exact: true },
  ).pipe(Schema.fromKey("dufflebagAutorunIdleThresholdSeconds")),
  idleAutoCompact: Schema.optionalWith(bagConfigSchema.from.fields.idleAutoCompact.from, {
    default: () => defaultBagConfig.idleAutoCompact,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagIdleAutoCompact")),
  speechVoice: Schema.optionalWith(bagConfigSchema.from.fields.speechVoice.from, {
    default: () => defaultBagConfig.speechVoice,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagSpeechVoice")),
  speechWordsPerMinute: Schema.optionalWith(
    legacyNumberStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.speechWordsPerMinute.from)),
    { default: () => defaultBagConfig.speechWordsPerMinute, exact: true },
  ).pipe(Schema.fromKey("dufflebagSpeechWordsPerMinute")),
  dedupEnforcement: Schema.optionalWith(bagConfigSchema.from.fields.dedupEnforcement.from, {
    default: () => defaultBagConfig.dedupEnforcement,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagDedupEnforcement")),
  dedupSkipDirectories: Schema.optionalWith(bagConfigSchema.from.fields.dedupSkipDirectories.from, {
    default: () => defaultBagConfig.dedupSkipDirectories,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagDedupSkipDirectories")),
  debugEnabled: Schema.optionalWith(legacyBooleanStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.debugEnabled.from)), {
    default: () => defaultBagConfig.debugEnabled,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagDebugEnabled")),
}).pipe(Schema.compose(Schema.typeSchema(bagConfigSchema)));

export const readSchemaDescription = (property: Schema.PropertySignature.All): Option.Option<string> => {
  switch (property.ast._tag) {
    case "PropertySignatureDeclaration":
      return SchemaAST.getDescriptionAnnotation(property.ast.type);
    case "PropertySignatureTransformation":
      return SchemaAST.getDescriptionAnnotation(property.ast.to.type);
  }
};
