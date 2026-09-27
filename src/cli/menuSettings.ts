/** Menu screens that change settings: managed config values, voice on/off, dictation, and narration. */

import { Effect } from "effect";

import { configSettings, defaultSettingValue, settingValueFromText, withSettingValue } from "../config/configSchema.js";
import { readConfig, resolveConfigTarget, saveConfig } from "../config/configSettings.js";
import { type CliScope, CliUsageError } from "./cliOptions.js";
import { formatSettingValue, pickRefine, showConfig } from "./configCommand.js";
import { setDictationLanguage, setKeepListening, sttOff, sttOn } from "./sttCommand.js";
import * as TerminalUI from "./TerminalUI.js";
import { ttsOff, ttsOn } from "./ttsCommand.js";
import { showVoiceStatus, voiceOff, voiceOn } from "./voiceCommand.js";

type ConfigSetting = (typeof configSettings)[number];

export const pickScope = (verb: string) =>
  TerminalUI.selectOne<CliScope>({
    message: `${verb} — which scope?`,
    choices: [
      { title: "global", value: "global", description: "home root · every session" },
      { title: "project", value: "project", description: "this repo · committable" },
    ],
    initial: "global",
  });

/** Show the plan and run `apply` only once the user approves it. */
export const applyIfApproved = <E, R>(request: {
  readonly title: string;
  readonly steps: ReadonlyArray<{ readonly label: string; readonly detail: string }>;
  readonly confirmMessage: string;
  readonly apply: Effect.Effect<void, E, R>;
}) => Effect.if(TerminalUI.confirmPlan(request), { onTrue: () => request.apply, onFalse: () => TerminalUI.cancelled });

// A menu action that mirrors one CLI command: the plan names that command, then the same work runs.
const applyCommand = <E, R>(request: {
  readonly command: string;
  readonly scope: CliScope;
  readonly action: string;
  readonly apply: Effect.Effect<void, E, R>;
}) =>
  applyIfApproved({
    title: `${request.command} plan`,
    steps: [
      { label: "Action", detail: request.action },
      { label: "Scope", detail: request.scope },
      { label: "Equivalent CLI", detail: `dufflebag ${request.command} --scope ${request.scope}` },
    ],
    confirmMessage: `Apply ${request.command}?`,
    apply: request.apply,
  });

const speechVoices = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"];

// Literal settings offer their schema values; an optional setting also offers "" to clear it.
const settingChoices = (setting: ConfigSetting): ReadonlyArray<string> => {
  const choices = setting.key === "speechVoice" ? speechVoices : setting.choices;
  return setting.optional && choices.length > 0 ? [...choices, ""] : choices;
};

const pickSetting = (message: string) =>
  TerminalUI.selectOne<ConfigSetting>({
    message,
    choices: configSettings.map((setting) => ({ title: setting.name, value: setting, description: setting.label })),
    initial: configSettings[0],
  });

const promptSettingValue = (request: { readonly setting: ConfigSetting; readonly current: string }) => {
  const { setting, current } = request;
  const choices = settingChoices(setting);
  if (choices.length === 0) {
    const numberHint = setting.kind === "number" ? " (number)" : "";
    return TerminalUI.optionalText({ message: `Value for ${setting.name}${numberHint}`, fallback: current });
  }

  return TerminalUI.selectOne({
    message: `Value for ${setting.name}`,
    choices: choices.map((value) => ({
      title: value === "" ? "(not set)" : value,
      value,
      description: value === current ? "current" : undefined,
    })),
    initial: choices.includes(current) ? current : choices[0],
  });
};

const pickAllOrOne = (request: { readonly message: string; readonly initial: "all" | "one" }) =>
  TerminalUI.selectOne<"all" | "one">({
    message: request.message,
    choices: [
      { title: "All settings", value: "all" },
      { title: "One setting", value: "one" },
    ],
    initial: request.initial,
  });

const runConfigShow = Effect.gen(function* () {
  const scope = yield* pickScope("Config show");
  const mode = yield* pickAllOrOne({ message: "Show", initial: "all" });
  const setting = yield* mode === "one" ? Effect.asSome(pickSetting("Setting")) : Effect.succeedNone;
  yield* showConfig({ scope, setting, format: "text" });
});

const runConfigSet = Effect.gen(function* () {
  const scope = yield* pickScope("Config set");
  const setting = yield* pickSetting("Setting to change");
  const current = yield* readConfig(scope);
  const currentValue = formatSettingValue({ config: current.config, setting });
  const text = yield* promptSettingValue({ setting, current: currentValue });
  const nextConfig = yield* settingValueFromText({ setting, text }).pipe(
    Effect.flatMap((value) => withSettingValue({ config: current.config, key: setting.key, value })),
    Effect.mapError((error) => new CliUsageError({ issue: String(error) })),
  );
  const nextValue = formatSettingValue({ config: nextConfig, setting });
  yield* applyIfApproved({
    title: "Config set plan",
    steps: [
      { label: "Action", detail: "set managed setting" },
      { label: "Scope", detail: scope },
      { label: "Setting", detail: setting.name },
      { label: "From", detail: currentValue },
      { label: "To", detail: nextValue },
      { label: "Path", detail: current.configPath },
    ],
    confirmMessage: "Apply this config change?",
    apply: saveConfig({ target: current, configuration: { _tag: "selected", config: nextConfig } }).pipe(
      Effect.flatMap((owner) => TerminalUI.success(`${setting.label} → ${nextValue} (${owner})`)),
    ),
  });
});

const runConfigReset = Effect.gen(function* () {
  const scope = yield* pickScope("Config reset");
  if ((yield* pickAllOrOne({ message: "Reset", initial: "one" })) === "all") {
    // A full reset never reads the old file, so it also repairs a config.json that no longer decodes.
    const target = yield* resolveConfigTarget(scope);
    yield* applyIfApproved({
      title: "Config reset plan",
      steps: [
        { label: "Action", detail: "reset all settings" },
        { label: "Scope", detail: scope },
        { label: "Setting", detail: "every setting" },
        { label: "To", detail: "Schema defaults" },
        { label: "Path", detail: target.configPath },
      ],
      confirmMessage: "Apply this config reset?",
      apply: saveConfig({ target, configuration: { _tag: "reset" } }).pipe(
        Effect.zipRight(TerminalUI.success(`All ${scope} settings reset.`)),
      ),
    });
    return;
  }

  const current = yield* readConfig(scope);
  const setting = yield* pickSetting("Setting to reset");
  const nextConfig = yield* withSettingValue({
    config: current.config,
    key: setting.key,
    value: defaultSettingValue(setting.key),
  }).pipe(Effect.mapError((error) => new CliUsageError({ issue: String(error) })));
  const nextValue = formatSettingValue({ config: nextConfig, setting });
  yield* applyIfApproved({
    title: "Config reset plan",
    steps: [
      { label: "Action", detail: "reset one setting" },
      { label: "Scope", detail: scope },
      { label: "Setting", detail: setting.name },
      { label: "From", detail: formatSettingValue({ config: current.config, setting }) },
      { label: "To", detail: nextValue },
      { label: "Path", detail: current.configPath },
    ],
    confirmMessage: "Apply this config reset?",
    apply: saveConfig({ target: current, configuration: { _tag: "selected", config: nextConfig } }).pipe(
      Effect.zipRight(TerminalUI.success(`${setting.name} reset to ${nextValue}`)),
    ),
  });
});

const runPickRefine = Effect.gen(function* () {
  const scope = yield* pickScope("Config pick-refine");
  yield* applyCommand({
    command: "config pick-refine",
    scope,
    action: "pick refine provider, model, and effort",
    apply: pickRefine({ scope, format: "text", gui: false }),
  });
});

export const runConfig = Effect.gen(function* () {
  const action = yield* TerminalUI.selectOne<"show" | "set" | "reset" | "pick-refine" | "back">({
    message: "Config",
    choices: [
      { title: "Show", value: "show", description: "inspect managed settings" },
      { title: "Set", value: "set", description: "change one setting" },
      { title: "Reset", value: "reset", description: "restore Schema defaults" },
      { title: "Pick refine", value: "pick-refine", description: "refine provider, model, and effort" },
      { title: "Back", value: "back" },
    ],
    initial: "show",
  });
  switch (action) {
    case "show":
      return yield* runConfigShow;
    case "set":
      return yield* runConfigSet;
    case "reset":
      return yield* runConfigReset;
    case "pick-refine":
      return yield* runPickRefine;
    case "back":
      return;
  }
});

export const runVoice = Effect.gen(function* () {
  const action = yield* TerminalUI.selectOne<"on" | "off" | "status" | "back">({
    message: "Voice",
    choices: [
      { title: "On", value: "on", description: "install + start worker" },
      { title: "Off", value: "off", description: "stop + remove voice feature" },
      { title: "Status", value: "status", description: "install / STT / TTS state" },
      { title: "Back", value: "back" },
    ],
    initial: "status",
  });
  if (action === "back") return;

  const scope = yield* pickScope(`Voice ${action}`);
  switch (action) {
    case "status":
      return yield* showVoiceStatus({ scope, format: "text" });
    case "on":
      return yield* applyCommand({
        command: "voice on",
        scope,
        action: "install voice + start worker",
        apply: voiceOn(scope),
      });
    case "off":
      return yield* applyCommand({
        command: "voice off",
        scope,
        action: "stop worker + remove voice",
        apply: voiceOff(scope),
      });
  }
});

export const runStt = Effect.gen(function* () {
  const action = yield* TerminalUI.selectOne<"on" | "off" | "keep-listening" | "lang" | "back">({
    message: "STT (dictation)",
    choices: [
      { title: "On", value: "on", description: "install + start dictation worker" },
      { title: "Off", value: "off", description: "stop worker + remove voice feature" },
      { title: "Keep listening", value: "keep-listening", description: "post-release tail (seconds)" },
      { title: "Language", value: "lang", description: "en or he" },
      { title: "Back", value: "back" },
    ],
    initial: "on",
  });
  if (action === "back") return;

  const scope = yield* pickScope(`STT ${action}`);
  switch (action) {
    case "on":
      return yield* applyCommand({
        command: "stt on",
        scope,
        action: "enable hold-Shift dictation",
        apply: sttOn(scope),
      });
    case "off":
      return yield* applyCommand({
        command: "stt off",
        scope,
        action: "disable dictation worker",
        apply: sttOff(scope),
      });
    case "keep-listening": {
      const seconds = yield* TerminalUI.optionalText({
        message: "Seconds to keep the mic open after Shift is released (0–2)",
        fallback: "0.2",
      });
      return yield* applyCommand({
        command: `stt keep-listening ${seconds}`,
        scope,
        action: "set how long dictation keeps listening",
        apply: setKeepListening({ scope, seconds: Number(seconds) }),
      });
    }
    case "lang": {
      const language = yield* TerminalUI.selectOne<"en" | "he">({
        message: "Dictation language",
        choices: [
          { title: "en — English (whisper.cpp)", value: "en" },
          { title: "he — Hebrew (ivrit.ai)", value: "he" },
        ],
        initial: "en",
      });
      return yield* applyCommand({
        command: `stt lang ${language}`,
        scope,
        action: "set dictation language",
        apply: setDictationLanguage({ scope, language }),
      });
    }
  }
});

export const runTts = Effect.gen(function* () {
  const action = yield* TerminalUI.selectOne<"on" | "off" | "back">({
    message: "TTS (narration)",
    choices: [
      { title: "On", value: "on", description: "speech-mode → auto" },
      { title: "Off", value: "off", description: "speech-mode → off" },
      { title: "Back", value: "back" },
    ],
    initial: "on",
  });
  if (action === "back") return;

  const scope = yield* pickScope(`TTS ${action}`);
  switch (action) {
    case "on":
      return yield* applyCommand({
        command: "tts on",
        scope,
        action: "enable response narration (speech-mode off → auto)",
        apply: ttsOn(scope),
      });
    case "off":
      return yield* applyCommand({
        command: "tts off",
        scope,
        action: "disable response narration (speech-mode → off)",
        apply: ttsOff(scope),
      });
  }
});
