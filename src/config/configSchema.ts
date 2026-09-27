import { Effect, Option, Schema, SchemaAST, type ParseResult as SchemaParseIssue, Struct } from "effect";

import { durationSchema } from "./durationSchema.js";

const withDefault = <Value, Encoded>(schema: Schema.Schema<Value, Encoded>, fallback: Value) =>
  Schema.optionalWith(schema, { default: () => fallback, exact: true });

const numberSetting = (setting: {
  readonly range: readonly [number, number];
  readonly outOfRange: string;
  readonly fallback: number;
  readonly title: string;
  readonly description: string;
}) =>
  withDefault(
    Schema.Number.pipe(Schema.between(...setting.range, { message: () => setting.outOfRange })),
    setting.fallback,
  ).annotations({ title: setting.title, description: setting.description });

const trimmed = <Value, Encoded extends string>(schema: Schema.Schema<Value, Encoded>) =>
  Schema.Trim.pipe(Schema.compose(schema));

// Every setting carries its CLI label (title) and meaning (description) on its property signature,
// so the CLI, the menu, and the README settings table all read one declaration.
export const configSchema = Schema.Struct({
  contextWarnPercent: numberSetting({
    range: [1, 95],
    outOfRange: "Context warning percent must be between 1 and 95.",
    fallback: 18,
    title: "context warn (%)",
    description: "Context use, as a whole percent of the model window, that starts the handoff warning (18 means 18%).",
  }),
  contextBlockPercent: numberSetting({
    range: [1, 99],
    outOfRange: "Context block percent must be between 1 and 99.",
    fallback: 20,
    title: "context block (%)",
    description: "Context use, as a whole percent of the model window, that blocks new code edits.",
  }),
  autorunDefaultCycles: numberSetting({
    range: [1, 1000],
    outOfRange: "Default autorun cycles must be between 1 and 1000.",
    fallback: 10,
    title: "autorun default cycles",
    description: "Compact cycles /autorun allows when no count is given.",
  }),
  autorunMaxCycles: numberSetting({
    range: [1, 1000],
    outOfRange: "Maximum autorun cycles must be between 1 and 1000.",
    fallback: 50,
    title: "autorun max cycles",
    description: "Hard limit on compact cycles for one autorun, whatever count is given.",
  }),
  autorunCheckEverySeconds: numberSetting({
    range: [1, 600],
    outOfRange: "Autorun check interval must be between 1 and 600 seconds.",
    fallback: 5,
    title: "autorun check every (seconds)",
    description: "Seconds between the autorun watcher's checks.",
  }),
  autorunIdleAfterSeconds: numberSetting({
    range: [1, 600],
    outOfRange: "Autorun idle time must be between 1 and 600 seconds.",
    fallback: 8,
    title: "autorun idle after (seconds)",
    description: "Seconds without transcript activity before autorun treats the turn as idle.",
  }),
  idleCompactAfter: withDefault(durationSchema, "off").annotations({
    title: "idle compact after",
    description:
      "How long an agent session sits idle before dufflebag submits a waiting draft or runs /compact: off, or a time like 30s, 2m, 1h.",
  }),
  speechVoice: withDefault(trimmed(Schema.Trimmed), "F4").annotations({
    title: "speech voice",
    description: "Supertonic voice ID (F1-F5 or M1-M5); unsupported names fall back to F4.",
  }),
  speechWordsPerMinute: numberSetting({
    range: [80, 720],
    outOfRange: "Speech rate must be between 80 and 720 words per minute.",
    fallback: 230,
    title: "speech rate (words per minute)",
    description: "Speech rate for read-aloud replies, in words per minute.",
  }),
  speechMode: withDefault(trimmed(Schema.Literal("auto", "focused", "immediate", "off")), "auto").annotations({
    title: "speech mode",
    description:
      "When agent replies are read aloud: auto waits for the originating Cmux surface and speaks at once elsewhere; focused, immediate, or off.",
  }),
  refineMode: withDefault(trimmed(Schema.Literal("off", "clipboard", "dictation", "both")), "off").annotations({
    title: "refine mode",
    description:
      "Prompt refine: off; clipboard = double-tap Shift refines the copied prompt; dictation = refine the final dictation before it is typed; both.",
  }),
  refineProvider: withDefault(trimmed(Schema.NonEmptyString), "codex").annotations({
    title: "refine provider",
    description:
      "Refine provider: codex | local | auto | grok | ollama | opencode | claude | gemini | pi. `dufflebag config pick-refine` lists only providers found on PATH.",
  }),
  refineModel: Schema.optionalWith(trimmed(Schema.NonEmptyString), { exact: true }).annotations({
    title: "refine model",
    description:
      "Model id for the refine provider (e.g. gpt-5.3-codex-spark, grok-4.5, llama3.2). When absent the voice worker uses gpt-5.3-codex-spark.",
  }),
  refineEffort: Schema.optionalWith(trimmed(Schema.Literal("low", "medium", "high", "xhigh", "minimal")), {
    exact: true,
  }).annotations({
    title: "refine effort",
    description:
      "Reasoning effort for providers that support it (grok --reasoning-effort, codex model_reasoning_effort). When absent the voice worker uses low so dictation refine stays fast.",
  }),
  refinePressEnter: withDefault(Schema.Boolean, false).annotations({
    title: "refine press Enter",
    description: "Press Enter after the refined text is typed at the caret. Independent of refineCmuxPressEnter.",
  }),
  refineSendTo: withDefault(trimmed(Schema.Literal("caret", "cmux-new", "cmux-resume")), "caret").annotations({
    title: "refine send to",
    description:
      "Where refined text goes: caret (paste into the focused input), cmux-new (a new focused cmux workspace), or cmux-resume (the focused cmux surface).",
  }),
  refineCmuxCommand: withDefault(trimmed(Schema.Trimmed), "").annotations({
    title: "refine cmux command",
    description:
      "Optional shell command run in the new cmux terminal for cmux-new. Placeholders: {{prompt_file}} (safe path), {{prompt}} (shell-escaped), {{cwd}}. Empty pastes the refined text only.",
  }),
  refineCmuxPressEnter: withDefault(Schema.Boolean, false).annotations({
    title: "refine cmux press Enter",
    description: "Press Enter after injecting refined text into cmux (cmux-resume, or cmux-new without a command).",
  }),
  dictationReplacements: withDefault(trimmed(Schema.Trimmed), "").annotations({
    title: "dictation replacements",
    description: "Semicolon-separated speech replacements in heard=written form.",
  }),
  dictationKeepListeningSeconds: numberSetting({
    range: [0, 2],
    outOfRange: "Dictation keep-listening time must be between 0 and 2 seconds.",
    fallback: 0.2,
    title: "dictation keep listening (seconds)",
    description: "Seconds the microphone stays open after Shift is released so trailing words are not cut off.",
  }),
  dictationLanguage: withDefault(trimmed(Schema.Literal("en", "he")), "en").annotations({
    title: "dictation language",
    description:
      "Dictation speech language: en (default whisper.cpp) or he (ivrit.ai Hebrew whisper-large-v3-turbo ggml).",
  }),
  duplicateCodeMode: withDefault(trimmed(Schema.Literal("block", "warn", "off")), "block").annotations({
    title: "duplicate code mode",
    description:
      "What the duplicate-code guard does with a copied function or type shape: block the edit, warn, or off.",
  }),
  duplicateCodeSkipFolders: withDefault(Schema.Array(Schema.NonEmptyTrimmedString), []).annotations({
    title: "duplicate code skip folders",
    description: "Folder names the duplicate-code guard skips, on top of its built-in skips such as node_modules.",
  }),
  debugLogs: withDefault(Schema.Boolean, false).annotations({
    title: "debug logs",
    description: "Print dufflebag hook errors to stderr.",
  }),
}).pipe(
  Schema.filter((config) => [
    config.contextWarnPercent < config.contextBlockPercent
      ? undefined
      : {
          path: ["contextWarnPercent"],
          message: "Context warning percent must be below contextBlockPercent.",
        },
    config.autorunDefaultCycles <= config.autorunMaxCycles
      ? undefined
      : {
          path: ["autorunDefaultCycles"],
          message: "Default autorun cycles must not exceed autorunMaxCycles.",
        },
  ]),
);

export type Config = Schema.Schema.Type<typeof configSchema>;

type ConfigKey = keyof Config;

export const configJsonSchema = Schema.parseJson(configSchema);

export const defaultConfig = Schema.decodeUnknownSync(configSchema, { onExcessProperty: "error" })({});

export const decodeConfig = Schema.decodeUnknown(configSchema, { onExcessProperty: "error" });

type ConfigProperty = Schema.PropertySignature.All;

// The value side (before the default) carries the kind; the property signature carries title and description.
const propertyParts = (property: ConfigProperty): { valueAst: SchemaAST.AST; annotations: SchemaAST.Annotated } => {
  switch (property.ast._tag) {
    case "PropertySignatureDeclaration":
      return { valueAst: property.ast.type, annotations: property.ast };
    case "PropertySignatureTransformation":
      return { valueAst: property.ast.from.type, annotations: property.ast.to };
  }
};

type SettingKind = "number" | "boolean" | "list" | "text";

const settingKind = (valueAst: SchemaAST.AST): SettingKind => {
  switch (SchemaAST.encodedAST(valueAst)._tag) {
    case "NumberKeyword":
      return "number";
    case "BooleanKeyword":
      return "boolean";
    case "TupleType":
      return "list";
    default:
      return "text";
  }
};

const literalChoices = (valueAst: SchemaAST.AST): ReadonlyArray<string> => {
  const typeAst = SchemaAST.typeAST(valueAst);
  if (SchemaAST.isBooleanKeyword(typeAst)) {
    return ["true", "false"];
  }

  const members = SchemaAST.isUnion(typeAst) ? typeAst.types : [typeAst];
  return members.flatMap((member) => (SchemaAST.isLiteral(member) ? [String(member.literal)] : []));
};

// e.g. "duplicateCodeSkipFolders" → "duplicate-code-skip-folders"
const settingNameFor = (key: ConfigKey): string => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

type ConfigSetting = {
  readonly key: ConfigKey;
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly kind: SettingKind;
  readonly choices: ReadonlyArray<string>;
  readonly optional: boolean;
};

const configFields = configSchema.from.fields;

export const configSettings: ReadonlyArray<ConfigSetting> = Struct.keys(configFields).map((key) => {
  const property: ConfigProperty = configFields[key];
  const { valueAst, annotations } = propertyParts(property);
  return {
    key,
    name: settingNameFor(key),
    label: Option.getOrElse(SchemaAST.getTitleAnnotation(annotations), () => key),
    description: Option.getOrElse(SchemaAST.getDescriptionAnnotation(annotations), () => ""),
    kind: settingKind(valueAst),
    choices: literalChoices(valueAst),
    optional: property.ast._tag === "PropertySignatureDeclaration" && property.ast.isOptional,
  };
});

const decodeNumberText = Schema.decodeUnknown(Schema.NumberFromString);

const decodeBooleanText = Schema.decodeUnknown(Schema.BooleanFromString);

// Turn CLI text into the value a setting stores; empty text clears an optional setting.
export const settingValueFromText = (request: {
  readonly setting: ConfigSetting;
  readonly text: string;
}): Effect.Effect<Option.Option<unknown>, SchemaParseIssue.ParseError> => {
  if (request.setting.optional && request.text.trim() === "") {
    return Effect.succeed(Option.none());
  }

  switch (request.setting.kind) {
    case "number":
      return decodeNumberText(request.text.trim()).pipe(Effect.map(Option.some));
    case "boolean":
      return decodeBooleanText(request.text.trim()).pipe(Effect.map(Option.some));
    case "list":
      return Effect.succeed(
        Option.some(
          request.text
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry !== ""),
        ),
      );
    case "text":
      return Effect.succeed(Option.some(request.text));
  }
};

export const defaultSettingValue = (key: ConfigKey): Option.Option<unknown> =>
  key in defaultConfig ? Option.some(defaultConfig[key]) : Option.none();

// A cleared optional setting leaves config.json without the key instead of storing an empty value.
export const withSettingValue = (request: {
  readonly config: Config;
  readonly key: ConfigKey;
  readonly value: Option.Option<unknown>;
}) =>
  decodeConfig(
    Option.match(request.value, {
      onNone: () => Struct.omit(request.config, request.key),
      onSome: (value) => ({ ...request.config, [request.key]: value }),
    }),
  );
