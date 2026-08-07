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
          description: "Supertonic voice ID (F1-F5 or M1-M5); unsupported legacy names fall back to F4.",
        }),
      ),
    ),
    { default: () => "F4", exact: true },
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
  speechResponseMode: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.compose(
        Schema.Literal("auto", "focused", "immediate", "off").annotations({
          description:
            "Response narration policy; auto waits for the originating Cmux surface and speaks immediately elsewhere.",
        }),
      ),
    ),
    { default: () => "auto", exact: true },
  ),
  speechReadAlong: Schema.optionalWith(
    Schema.Boolean.annotations({
      description: "Whether narration shows a synchronized active-word read-along panel.",
    }),
    { default: () => true, exact: true },
  ),
  promptRefinementMode: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.compose(
        Schema.Literal("off", "review", "stt", "both").annotations({
          description:
            "Prompt refine: off; review = Control double-tap clipboard; stt = refine final dictation before typing into the caret; both = review + stt.",
        }),
      ),
    ),
    { default: () => "off", exact: true },
  ),
  promptRefinementBackend: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.compose(
        Schema.Trimmed.annotations({
          description:
            "Refine provider (dynamic, PATH-scanned): codex | local | auto | grok | ollama | opencode | claude | gemini | pi. Model via promptRefinementModel; effort via promptRefinementReasoningEffort. `dufflebag config pick-refine` only lists providers with a binary on PATH that refine can invoke.",
        }),
      ),
    ),
    { default: () => "codex", exact: true },
  ),
  promptRefinementModel: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.compose(
        Schema.Trimmed.annotations({
          description:
            "Model id for the selected refine provider (e.g. gpt-5.3-codex-spark, grok-4.5, llama3.2). Empty uses provider default.",
        }),
      ),
    ),
    { default: () => "gpt-5.3-codex-spark", exact: true },
  ),
  promptRefinementReasoningEffort: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.compose(
        Schema.Literal("", "low", "medium", "high", "xhigh", "minimal").annotations({
          description:
            "Optional reasoning effort for providers that support it (e.g. grok --reasoning-effort / codex model_reasoning_effort). Default low keeps STT refine snappy; empty still falls back to low in the voice worker.",
        }),
      ),
    ),
    { default: () => "low", exact: true },
  ),
  promptRefinementShowRawFirst: Schema.optionalWith(
    Schema.Boolean.annotations({
      description:
        "After STT, paste the raw transcript first, then refine and replace it (so you see STT before the model rewrite). STT+refine always pastes raw first for latency regardless; this keeps the preference explicit.",
    }),
    { default: () => true, exact: true },
  ),
  promptRefinementAutoSubmit: Schema.optionalWith(
    Schema.Boolean.annotations({
      description:
        "After the final refined text is typed into the caret, send Enter (submit). Independent of cmux auto-submit.",
    }),
    { default: () => false, exact: true },
  ),
  promptRefinementDelivery: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.compose(
        Schema.Literal("caret", "cmux-new", "cmux-resume").annotations({
          description:
            "Where refined text goes: caret (focused input paste); cmux-new (new focused cmux workspace/terminal); cmux-resume (inject into focused cmux surface / session).",
        }),
      ),
    ),
    { default: () => "caret", exact: true },
  ),
  promptRefinementCmuxCommand: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.compose(
        Schema.Trimmed.annotations({
          description:
            "Optional shell for cmux-new after spawn. Placeholders: {{prompt_file}} (safe path), {{prompt}} (shell-escaped), {{cwd}}. Empty = paste refined text into the new terminal only (you submit).",
        }),
      ),
    ),
    { default: () => "", exact: true },
  ),
  promptRefinementCmuxAutoSubmit: Schema.optionalWith(
    Schema.Boolean.annotations({
      description:
        "When delivery is cmux-resume (or cmux-new without a command), send Enter after injecting the refined text.",
    }),
    { default: () => false, exact: true },
  ),
  dictationReplacements: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.compose(
        Schema.Trimmed.annotations({
          description: "Semicolon-separated speech replacements in heard=written form.",
        }),
      ),
    ),
    { default: () => "", exact: true },
  ),
  dictationMicOffDelayMs: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.between(0, 2000, {
        message: () => "Dictation mic-off delay must be between 0 and 2000 milliseconds.",
      }),
      Schema.annotations({
        description:
          "Milliseconds to keep the microphone open after Control is released so trailing words are not clipped.",
      }),
    ),
    { default: () => 200, exact: true },
  ),
  dictationLanguage: Schema.optionalWith(
    Schema.Trim.pipe(
      Schema.compose(
        Schema.Literal("en", "he").annotations({
          description:
            "Dictation speech language: en (default whisper.cpp) or he (ivrit.ai Hebrew whisper-large-v3-turbo ggml).",
        }),
      ),
    ),
    { default: () => "en", exact: true },
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
  speechResponseMode: Schema.optionalWith(bagConfigSchema.from.fields.speechResponseMode.from, {
    default: () => defaultBagConfig.speechResponseMode,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagSpeechResponseMode")),
  speechReadAlong: Schema.optionalWith(
    legacyBooleanStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.speechReadAlong.from)),
    {
      default: () => defaultBagConfig.speechReadAlong,
      exact: true,
    },
  ).pipe(Schema.fromKey("dufflebagSpeechReadAlong")),
  promptRefinementMode: Schema.optionalWith(bagConfigSchema.from.fields.promptRefinementMode.from, {
    default: () => defaultBagConfig.promptRefinementMode,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagPromptRefinementMode")),
  promptRefinementBackend: Schema.optionalWith(bagConfigSchema.from.fields.promptRefinementBackend.from, {
    default: () => defaultBagConfig.promptRefinementBackend,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagPromptRefinementBackend")),
  promptRefinementModel: Schema.optionalWith(bagConfigSchema.from.fields.promptRefinementModel.from, {
    default: () => defaultBagConfig.promptRefinementModel,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagPromptRefinementModel")),
  promptRefinementReasoningEffort: Schema.optionalWith(
    bagConfigSchema.from.fields.promptRefinementReasoningEffort.from,
    {
      default: () => defaultBagConfig.promptRefinementReasoningEffort,
      exact: true,
    },
  ).pipe(Schema.fromKey("dufflebagPromptRefinementReasoningEffort")),
  promptRefinementShowRawFirst: Schema.optionalWith(
    legacyBooleanStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.promptRefinementShowRawFirst.from)),
    {
      default: () => defaultBagConfig.promptRefinementShowRawFirst,
      exact: true,
    },
  ).pipe(Schema.fromKey("dufflebagPromptRefinementShowRawFirst")),
  promptRefinementAutoSubmit: Schema.optionalWith(
    legacyBooleanStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.promptRefinementAutoSubmit.from)),
    {
      default: () => defaultBagConfig.promptRefinementAutoSubmit,
      exact: true,
    },
  ).pipe(Schema.fromKey("dufflebagPromptRefinementAutoSubmit")),
  promptRefinementDelivery: Schema.optionalWith(bagConfigSchema.from.fields.promptRefinementDelivery.from, {
    default: () => defaultBagConfig.promptRefinementDelivery,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagPromptRefinementDelivery")),
  promptRefinementCmuxCommand: Schema.optionalWith(bagConfigSchema.from.fields.promptRefinementCmuxCommand.from, {
    default: () => defaultBagConfig.promptRefinementCmuxCommand,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagPromptRefinementCmuxCommand")),
  promptRefinementCmuxAutoSubmit: Schema.optionalWith(
    legacyBooleanStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.promptRefinementCmuxAutoSubmit.from)),
    {
      default: () => defaultBagConfig.promptRefinementCmuxAutoSubmit,
      exact: true,
    },
  ).pipe(Schema.fromKey("dufflebagPromptRefinementCmuxAutoSubmit")),
  dictationReplacements: Schema.optionalWith(bagConfigSchema.from.fields.dictationReplacements.from, {
    default: () => defaultBagConfig.dictationReplacements,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagDictationReplacements")),
  dictationMicOffDelayMs: Schema.optionalWith(
    legacyNumberStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.dictationMicOffDelayMs.from)),
    { default: () => defaultBagConfig.dictationMicOffDelayMs, exact: true },
  ).pipe(Schema.fromKey("dufflebagDictationMicOffDelayMs")),
  dictationLanguage: Schema.optionalWith(bagConfigSchema.from.fields.dictationLanguage.from, {
    default: () => defaultBagConfig.dictationLanguage,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagDictationLanguage")),
  dedupEnforcement: Schema.optionalWith(bagConfigSchema.from.fields.dedupEnforcement.from, {
    default: () => defaultBagConfig.dedupEnforcement,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagDedupEnforcement")),
  dedupSkipDirectories: Schema.optionalWith(bagConfigSchema.from.fields.dedupSkipDirectories.from, {
    default: () => defaultBagConfig.dedupSkipDirectories,
    exact: true,
  }).pipe(Schema.fromKey("dufflebagDedupSkipDirectories")),
  debugEnabled: Schema.optionalWith(
    legacyBooleanStringSchema.pipe(Schema.compose(bagConfigSchema.from.fields.debugEnabled.from)),
    {
      default: () => defaultBagConfig.debugEnabled,
      exact: true,
    },
  ).pipe(Schema.fromKey("dufflebagDebugEnabled")),
}).pipe(Schema.compose(Schema.typeSchema(bagConfigSchema)));

export const readSchemaDescription = (property: Schema.PropertySignature.All): Option.Option<string> => {
  switch (property.ast._tag) {
    case "PropertySignatureDeclaration":
      return SchemaAST.getDescriptionAnnotation(property.ast.type);
    case "PropertySignatureTransformation":
      return SchemaAST.getDescriptionAnnotation(property.ast.to.type);
  }
};
