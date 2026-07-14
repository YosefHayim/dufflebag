import { type Option, Schema, SchemaAST } from "effect";

const completeLegacyNumberSchema = Schema.Trim.pipe(
  Schema.pattern(/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/, {
    message: () => "Legacy numeric values must use a complete base-10 decimal representation.",
  }),
  Schema.compose(Schema.NumberFromString),
);

export const bagConfigSchema = Schema.Struct({
  contextWarnFraction: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(0.01, 0.95, {
        message: () => "contextWarnFraction must be between 0.01 and 0.95.",
      }),
    ),
    {
      default: () => 0.18,
      exact: true,
    },
  ).annotations({
    description: "Fraction of the context window that triggers a warning.",
  }),
  contextBlockFraction: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(0.01, 0.99, {
        message: () => "contextBlockFraction must be between 0.01 and 0.99.",
      }),
    ),
    {
      default: () => 0.2,
      exact: true,
    },
  ).annotations({
    description: "Fraction of the context window that blocks further automatic work.",
  }),
  autorunDefaultCycleCount: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(1, 1000, {
        message: () => "autorunDefaultCycleCount must be between 1 and 1000.",
      }),
    ),
    {
      default: () => 10,
      exact: true,
    },
  ).annotations({
    description: "Cycle count used when autorun starts without an explicit count.",
  }),
  autorunMaxCycleCount: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(1, 1000, {
        message: () => "autorunMaxCycleCount must be between 1 and 1000.",
      }),
    ),
    {
      default: () => 50,
      exact: true,
    },
  ).annotations({
    description: "Maximum cycle count accepted by autorun.",
  }),
  autorunPollIntervalSeconds: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(1, 600, {
        message: () => "autorunPollIntervalSeconds must be between 1 and 600.",
      }),
    ),
    {
      default: () => 5,
      exact: true,
    },
  ).annotations({
    description: "Seconds between autorun state polls.",
  }),
  autorunIdleThresholdSeconds: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(1, 600, {
        message: () => "autorunIdleThresholdSeconds must be between 1 and 600.",
      }),
    ),
    {
      default: () => 8,
      exact: true,
    },
  ).annotations({
    description: "Idle seconds required before autorun may continue.",
  }),
  speechVoice: Schema.optionalWith(
    Schema.Trim.annotations({
      message: () => "speechVoice must be text.",
    }),
    {
      default: () => "Samantha",
      exact: true,
    },
  ).annotations({
    description: "macOS voice used for spoken notifications.",
  }),
  speechWordsPerMinute: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(80, 720, {
        message: () => "speechWordsPerMinute must be between 80 and 720.",
      }),
    ),
    {
      default: () => 230,
      exact: true,
    },
  ).annotations({
    description: "Estimated speech rate in words per minute.",
  }),
  dedupEnforcement: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.filter((value): value is "deny" | "warn" | "off" => value === "deny" || value === "warn" || value === "off", {
        message: () => "dedupEnforcement must be deny, warn, or off.",
      }),
    ),
    {
      default: () => "deny",
      exact: true,
    },
  ).annotations({
    description: "Behavior when duplicate skill content is detected.",
  }),
  dedupSkipDirectories: Schema.optionalWith(
    Schema.Trim.annotations({
      message: () => "dedupSkipDirectories must be text.",
    }),
    {
      default: () => "",
      exact: true,
    },
  ).annotations({
    description: "Comma-separated directory names excluded from duplicate checks.",
  }),
  debugEnabled: Schema.optionalWith(
    Schema.Boolean.annotations({
      message: () => "debugEnabled must be true or false.",
    }),
    {
      default: () => false,
      exact: true,
    },
  ).annotations({
    description: "Whether Dufflebag emits debug diagnostics.",
  }),
}).pipe(
  Schema.filter((config) => [
    config.contextWarnFraction < config.contextBlockFraction
      ? undefined
      : {
          path: ["contextWarnFraction"],
          message: "contextWarnFraction must be less than contextBlockFraction.",
        },
    config.autorunDefaultCycleCount <= config.autorunMaxCycleCount
      ? undefined
      : {
          path: ["autorunDefaultCycleCount"],
          message: "autorunDefaultCycleCount must be less than or equal to autorunMaxCycleCount.",
        },
  ]),
  Schema.annotations({
    parseOptions: {
      onExcessProperty: "error",
    },
  }),
);

export type BagConfig = Schema.Schema.Type<typeof bagConfigSchema>;

export type EncodedBagConfig = Schema.Schema.Encoded<typeof bagConfigSchema>;

export const bagConfigJsonSchema = Schema.parseJson(bagConfigSchema);

export const defaultBagConfig = Schema.decodeUnknownSync(bagConfigSchema, {
  onExcessProperty: "error",
})({});

export const legacyBagConfigEnvironmentSchema = Schema.Struct({
  contextWarnFraction: Schema.optional(completeLegacyNumberSchema).pipe(Schema.fromKey("dufflebagContextWarnFraction")),
  contextBlockFraction: Schema.optional(completeLegacyNumberSchema).pipe(Schema.fromKey("dufflebagContextBlockFraction")),
  autorunDefaultCycleCount: Schema.optional(completeLegacyNumberSchema).pipe(Schema.fromKey("dufflebagAutorunDefaultCycleCount")),
  autorunMaxCycleCount: Schema.optional(completeLegacyNumberSchema).pipe(Schema.fromKey("dufflebagAutorunMaxCycleCount")),
  autorunPollIntervalSeconds: Schema.optional(completeLegacyNumberSchema).pipe(Schema.fromKey("dufflebagAutorunPollIntervalSeconds")),
  autorunIdleThresholdSeconds: Schema.optional(completeLegacyNumberSchema).pipe(Schema.fromKey("dufflebagAutorunIdleThresholdSeconds")),
  speechVoice: Schema.optional(Schema.Trim).pipe(Schema.fromKey("dufflebagSpeechVoice")),
  speechWordsPerMinute: Schema.optional(completeLegacyNumberSchema).pipe(Schema.fromKey("dufflebagSpeechWordsPerMinute")),
  dedupEnforcement: Schema.optional(Schema.Trim).pipe(Schema.fromKey("dufflebagDedupEnforcement")),
  dedupSkipDirectories: Schema.optional(Schema.Trim).pipe(Schema.fromKey("dufflebagDedupSkipDirectories")),
  debugEnabled: Schema.optional(Schema.Trim.pipe(Schema.compose(Schema.BooleanFromString))).pipe(Schema.fromKey("dufflebagDebugEnabled")),
}).pipe(
  Schema.compose(bagConfigSchema),
  Schema.annotations({
    parseOptions: {
      onExcessProperty: "error",
    },
  }),
);

export const readSchemaDescription = (annotated: SchemaAST.Annotated): Option.Option<string> => {
  return SchemaAST.getDescriptionAnnotation(annotated);
};
