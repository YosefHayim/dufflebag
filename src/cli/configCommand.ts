/** `dufflebag config show|set|reset` — managed configuration as explicit verbs. */

import { Args, Command } from "@effect/cli";
import { FileSystem, Path, Terminal } from "@effect/platform";
import { Effect, Either, Option, Schema } from "effect";

import { type BagConfig, bagConfigSchema, defaultBagConfig } from "../config/bagConfigSchema.js";
import { type ConfigFileSnapshot, readConfigFile } from "../config/configFile.js";
import { managedConfigPath, planManagedConfig } from "../config/configure.js";
import { readArtifactReceiptSnapshot } from "../install/artifactReceipt.js";
import { receiptPath } from "../install/install.js";
import { update } from "../install/update.js";
import { captureHostEvidence, destinationForScope, type HostEvidence } from "./hostEvidence.js";
import { type CliScope, CliUsageError, formatOption, scopeOption, yesOption } from "./scopeOptions.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

const configSettings = [
  "context-warn-fraction",
  "context-block-fraction",
  "autorun-default-cycle-count",
  "autorun-max-cycle-count",
  "autorun-poll-interval-seconds",
  "autorun-idle-threshold-seconds",
  "idle-auto-compact",
  "speech-voice",
  "speech-words-per-minute",
  "speech-response-mode",
  "speech-read-along",
  "prompt-refinement-mode",
  "dictation-replacements",
  "dedup-enforcement",
  "dedup-skip-directories",
  "debug-enabled",
] as const;

type ConfigSetting = (typeof configSettings)[number];
type ConfigKey = keyof BagConfig;

const configSettingChoices = configSettings.map((setting): [string, ConfigSetting] => [setting, setting]);

const settingArgument = Args.choice(configSettingChoices, { name: "setting" }).pipe(
  Args.withDescription("Managed setting name"),
);

const optionalSettingArgument = settingArgument.pipe(Args.optional);

const settingValueArgument = Args.text({ name: "value" }).pipe(Args.withDescription("New setting value"));

const numericSettings = [
  "context-warn-fraction",
  "context-block-fraction",
  "autorun-default-cycle-count",
  "autorun-max-cycle-count",
  "autorun-poll-interval-seconds",
  "autorun-idle-threshold-seconds",
  "speech-words-per-minute",
] as const;

const booleanSettings = ["speech-read-along", "debug-enabled"] as const;

const stringSettings = [
  "idle-auto-compact",
  "speech-voice",
  "speech-response-mode",
  "prompt-refinement-mode",
  "dictation-replacements",
  "dedup-enforcement",
  "dedup-skip-directories",
] as const;

const configSettingChangeSchema = Schema.Union(
  Schema.Struct({ setting: Schema.Literal(...numericSettings), value: Schema.NumberFromString }),
  Schema.Struct({ setting: Schema.Literal(...booleanSettings), value: Schema.BooleanFromString }),
  Schema.Struct({ setting: Schema.Literal(...stringSettings), value: Schema.String }),
);

const configSettingKeys: Record<ConfigSetting, ConfigKey> = {
  "context-warn-fraction": "contextWarnFraction",
  "context-block-fraction": "contextBlockFraction",
  "autorun-default-cycle-count": "autorunDefaultCycleCount",
  "autorun-max-cycle-count": "autorunMaxCycleCount",
  "autorun-poll-interval-seconds": "autorunPollIntervalSeconds",
  "autorun-idle-threshold-seconds": "autorunIdleThresholdSeconds",
  "idle-auto-compact": "idleAutoCompact",
  "speech-voice": "speechVoice",
  "speech-words-per-minute": "speechWordsPerMinute",
  "speech-response-mode": "speechResponseMode",
  "speech-read-along": "speechReadAlong",
  "prompt-refinement-mode": "promptRefinementMode",
  "dictation-replacements": "dictationReplacements",
  "dedup-enforcement": "dedupEnforcement",
  "dedup-skip-directories": "dedupSkipDirectories",
  "debug-enabled": "debugEnabled",
};

const configLabels: Record<ConfigKey, string> = {
  contextWarnFraction: "context warn fraction",
  contextBlockFraction: "context block fraction",
  autorunDefaultCycleCount: "autorun default cycles",
  autorunMaxCycleCount: "autorun maximum cycles",
  autorunPollIntervalSeconds: "autorun poll interval (seconds)",
  autorunIdleThresholdSeconds: "autorun idle threshold (seconds)",
  idleAutoCompact: "idle auto-compact",
  speechVoice: "speech voice",
  speechWordsPerMinute: "speech rate (words per minute)",
  speechResponseMode: "speech narration mode",
  speechReadAlong: "speech read-along",
  promptRefinementMode: "prompt refinement mode",
  dictationReplacements: "dictation replacements",
  dedupEnforcement: "dedup enforcement",
  dedupSkipDirectories: "dedup skip directories",
  debugEnabled: "debug diagnostics",
};

const configKeys: ReadonlyArray<ConfigKey> = Object.values(configSettingKeys);

type ConfigDestination =
  | { readonly _tag: "global"; readonly root: string }
  | { readonly _tag: "project"; readonly root: string };

type ScopedConfig = {
  readonly scope: CliScope;
  readonly host: HostEvidence;
  readonly destination: ConfigDestination;
  readonly configPath: string;
  readonly snapshot: ConfigFileSnapshot;
  readonly current: BagConfig;
};

const readScopedConfig = (scope: CliScope) =>
  Effect.gen(function* () {
    const host = yield* captureHostEvidence;
    const path = yield* Path.Path;
    const destination = destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot });
    const configPath = path.join(destination.root, managedConfigPath);
    const snapshot = yield* readConfigFile(configPath);
    const current = snapshot._tag === "present" ? snapshot.config : defaultBagConfig;
    return { scope, host, destination, configPath, snapshot, current } satisfies ScopedConfig;
  });

const writeScopedConfig = (request: { readonly scopedConfig: ScopedConfig; readonly nextConfig: BagConfig }) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fileSystem = yield* FileSystem.FileSystem;
    const receiptSnapshot = yield* readArtifactReceiptSnapshot(
      path.join(request.scopedConfig.destination.root, receiptPath),
    );
    if (receiptSnapshot._tag === "present") {
      if (receiptSnapshot.receipt.scope !== request.scopedConfig.scope) {
        return yield* Effect.fail(
          new Error(
            `Receipt scope is ${receiptSnapshot.receipt.scope}, not ${request.scopedConfig.scope}; select the matching scope.`,
          ),
        );
      }
      yield* update({
        destination: request.scopedConfig.destination,
        host: { homeRoot: request.scopedConfig.host.homeRoot },
        stagedPackage: yield* stagePackage,
        features: { _tag: "preserve" },
        agents: { _tag: "detected", evidence: request.scopedConfig.host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "selected", config: request.nextConfig },
      });
      return "receipt";
    }

    const previousConfigFile =
      request.scopedConfig.snapshot._tag === "present"
        ? { _tag: "priorFile" as const, bytes: request.scopedConfig.snapshot.bytes }
        : { _tag: "missing" as const };
    const plan = planManagedConfig({
      scope: request.scopedConfig.scope,
      selection: { _tag: "selected", config: request.nextConfig },
      previousConfigFile,
    });
    if (Either.isLeft(plan)) return yield* Effect.fail(plan.left);
    yield* fileSystem.makeDirectory(path.dirname(request.scopedConfig.configPath), { recursive: true });
    yield* fileSystem.writeFile(request.scopedConfig.configPath, plan.right.managedConfigWrite.bytes);
    return "file";
  });

const presentResetCancellation = (request: { readonly format: "text" | "json"; readonly scope: CliScope }) =>
  request.format === "json"
    ? TerminalUI.json({ _tag: "cancelled", scope: request.scope })
    : TerminalUI.outro("Cancelled — nothing was changed.");

const showCommand = Command.make(
  "show",
  { setting: optionalSettingArgument, scope: scopeOption, format: formatOption },
  (args) =>
    Effect.gen(function* () {
      const scopedConfig = yield* readScopedConfig(args.scope);
      if (Option.isSome(args.setting)) {
        const key = configSettingKeys[args.setting.value];
        if (args.format === "json") {
          yield* TerminalUI.json({ scope: args.scope, setting: args.setting.value, value: scopedConfig.current[key] });
        } else {
          yield* TerminalUI.note(`${configLabels[key]}  ${String(scopedConfig.current[key])}`, "managed config");
        }
        return;
      }

      if (args.format === "json") {
        yield* TerminalUI.json({ scope: args.scope, config: scopedConfig.current });
        return;
      }
      const lines = configKeys.map((key) => `${configLabels[key].padEnd(40)} ${String(scopedConfig.current[key])}`);
      yield* TerminalUI.note(lines.join("\n"), "managed config");
    }),
).pipe(Command.withDescription("Show all settings or one named setting"));

const setCommand = Command.make(
  "set",
  { setting: settingArgument, value: settingValueArgument, scope: scopeOption, format: formatOption },
  (args) =>
    Effect.gen(function* () {
      const scopedConfig = yield* readScopedConfig(args.scope);
      const change = yield* Schema.decodeUnknown(configSettingChangeSchema, { onExcessProperty: "error" })({
        setting: args.setting,
        value: args.value,
      });
      const key = configSettingKeys[change.setting];
      const nextConfig = yield* Schema.decodeUnknown(bagConfigSchema, { onExcessProperty: "error" })({
        ...scopedConfig.current,
        [key]: change.value,
      });
      const owner = yield* writeScopedConfig({ scopedConfig, nextConfig });
      if (args.format === "json") {
        yield* TerminalUI.json({
          _tag: "configured",
          scope: args.scope,
          setting: args.setting,
          value: nextConfig[key],
          owner,
        });
      } else {
        yield* TerminalUI.success(`${configLabels[key]} → ${String(nextConfig[key])}`);
      }
    }),
).pipe(Command.withDescription("Set one managed setting"));

const resetCommand = Command.make(
  "reset",
  { setting: optionalSettingArgument, scope: scopeOption, yes: yesOption, format: formatOption },
  (args) =>
    Effect.gen(function* () {
      const terminal = yield* Terminal.Terminal;
      const isTTY = yield* terminal.isTTY;
      const resetsEverything = Option.isNone(args.setting);
      if (resetsEverything && !args.yes && !isTTY) {
        return yield* new CliUsageError({ issue: "Non-interactive full config reset requires --yes." });
      }
      if (resetsEverything && !args.yes) {
        const confirmed = yield* TerminalUI.confirm({
          message: `Reset every ${args.scope} setting to its Schema default?`,
          initialValue: false,
        });
        if (!confirmed) {
          yield* presentResetCancellation(args);
          return;
        }
      }

      const scopedConfig = yield* readScopedConfig(args.scope);
      let nextConfig = defaultBagConfig;
      if (Option.isSome(args.setting)) {
        const key = configSettingKeys[args.setting.value];
        nextConfig = yield* Schema.decodeUnknown(bagConfigSchema, { onExcessProperty: "error" })({
          ...scopedConfig.current,
          [key]: defaultBagConfig[key],
        });
      }
      const owner = yield* writeScopedConfig({ scopedConfig, nextConfig });
      if (args.format === "json") {
        yield* TerminalUI.json({
          _tag: "reset",
          scope: args.scope,
          setting: Option.getOrUndefined(args.setting),
          config: nextConfig,
          owner,
        });
      } else if (Option.isSome(args.setting)) {
        const key = configSettingKeys[args.setting.value];
        yield* TerminalUI.success(`${configLabels[key]} reset to ${String(nextConfig[key])}`);
      } else {
        yield* TerminalUI.success(`All ${args.scope} settings reset to Schema defaults.`);
      }
    }),
).pipe(Command.withDescription("Reset one setting or every setting to Schema defaults"));

export const configCommand = Command.make("config").pipe(
  Command.withDescription("Inspect or change managed configuration"),
  Command.withSubcommands([showCommand, setCommand, resetCommand]),
);
