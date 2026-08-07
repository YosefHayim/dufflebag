/** `dufflebag config show|set|reset|pick-refine` — managed configuration as explicit verbs. */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Args, Command, Options } from "@effect/cli";
import { FileSystem, Path, Terminal } from "@effect/platform";
import { Effect, Either, Option, Schema } from "effect";

import { type BagConfig, bagConfigSchema, defaultBagConfig } from "../config/bagConfigSchema.js";
import { type ConfigFileSnapshot, readConfigFile } from "../config/configFile.js";
import { managedConfigPath, planManagedConfig } from "../config/configure.js";
import { readArtifactReceiptSnapshot } from "../install/artifactReceipt.js";
import { receiptPath, runtimePath } from "../install/install.js";
import { update } from "../install/update.js";
import { captureHostEvidence, destinationForScope, type HostEvidence } from "./hostEvidence.js";
import { type CliScope, CliUsageError, formatOption, scopeOption, yesOption } from "./scopeOptions.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

const promptRefinementScriptCandidates = (scopeRoot: string): ReadonlyArray<string> => {
  // import.meta.url is either:
  //   …/dist/src/cli/configCommand.js  (published / pnpm global)
  //   …/src/cli/configCommand.ts       (tsx monorepo)
  const here = dirname(fileURLToPath(import.meta.url));
  const home = process.env.HOME?.trim() || "";
  const candidates = [
    // Installed runtime for the active scope ($HOME or project root).
    join(scopeRoot, runtimePath, "speakResponse", "prompt_refinement.py"),
  ];
  // Global voice install often exists even when config scope is project.
  if (home && home !== scopeRoot) {
    candidates.push(join(home, runtimePath, "speakResponse", "prompt_refinement.py"));
  }
  // Package-shipped source (package.json "files" includes src/hookIsland).
  // From dist/src/cli → ../../../src/hookIsland/… ; from src/cli → ../hookIsland/…
  candidates.push(
    join(here, "..", "..", "..", "src", "hookIsland", "speakResponse", "prompt_refinement.py"),
    join(here, "..", "hookIsland", "speakResponse", "prompt_refinement.py"),
  );
  return candidates;
};

const resolvePromptRefinementScript = (scopeRoot: string): string | null => {
  const seen = new Set<string>();
  for (const candidate of promptRefinementScriptCandidates(scopeRoot)) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

type PickedRefine = {
  readonly backend: string;
  readonly model: string;
  readonly reasoningEffort: string;
};

export const runPickRefineMenu = (request: {
  readonly scopeRoot: string;
  readonly gui: boolean;
}): Effect.Effect<PickedRefine, Error, never> =>
  Effect.tryPromise({
    try: async () => {
      const script = resolvePromptRefinementScript(request.scopeRoot);
      if (!script) {
        throw new Error("prompt_refinement.py not found. Run `dufflebag voice on` (or install speak-response) first.");
      }
      const { spawnSync } = await import("node:child_process");
      const args = [script, "--pick-menu", ...(request.gui ? ["--gui"] : [])];
      // Ensure user-local CLIs (codex/claude/pi/opencode via pnpm) are visible even
      // when the parent shell has a minimal PATH (GUI launchers, some terminals).
      const home = typeof process.env.HOME === "string" ? process.env.HOME : "";
      const inheritedPath =
        typeof process.env.PATH === "string" && process.env.PATH.length > 0 ? process.env.PATH : "/usr/bin:/bin";
      const pathExtra = [
        `${home}/.local/bin`,
        `${home}/.grok/bin`,
        `${home}/Library/pnpm`,
        `${home}/Library/pnpm/bin`,
        "/usr/local/bin",
        "/opt/homebrew/bin",
      ].join(":");
      const pickRefineProcess = spawnSync("python3", args, {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${pathExtra}:${inheritedPath}`,
        },
        stdio: ["inherit", "pipe", "inherit"],
      });
      if (pickRefineProcess.status !== 0) {
        const err = (pickRefineProcess.stderr || pickRefineProcess.stdout || "pick-refine cancelled").trim();
        throw new Error(err || "pick-refine cancelled");
      }
      const pickRefineStdout = (pickRefineProcess.stdout || "").trim();
      // Progress goes to stderr; stdout must be JSON only. Tolerate trailing noise.
      const jsonStart = pickRefineStdout.indexOf("{");
      const jsonEnd = pickRefineStdout.lastIndexOf("}");
      const jsonSlice =
        jsonStart >= 0 && jsonEnd > jsonStart ? pickRefineStdout.slice(jsonStart, jsonEnd + 1) : pickRefineStdout;
      let decoded: unknown;
      try {
        decoded = JSON.parse(jsonSlice);
      } catch {
        throw new Error(`pick-refine returned non-JSON stdout: ${pickRefineStdout.slice(0, 400)}`);
      }
      if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
        throw new Error(`pick-refine returned non-object JSON: ${pickRefineStdout.slice(0, 400)}`);
      }
      const pickRefineDocument: Record<string, unknown> = Object.create(null);
      for (const [key, value] of Object.entries(decoded)) {
        pickRefineDocument[key] = value;
      }
      const backendValue = pickRefineDocument.backend;
      const modelValue = pickRefineDocument.model;
      const effortValue = pickRefineDocument.reasoningEffort;
      const backend = typeof backendValue === "string" ? backendValue.trim() : "";
      const model = typeof modelValue === "string" ? modelValue.trim() : "";
      if (!backend || !model) {
        throw new Error(`pick-refine returned incomplete JSON: ${pickRefineStdout}`);
      }
      const effortText = typeof effortValue === "string" ? effortValue.trim().toLowerCase() : "";
      return {
        backend,
        model,
        reasoningEffort: effortText || "low",
      } satisfies PickedRefine;
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });

export const configSettings = [
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
  "prompt-refinement-backend",
  "prompt-refinement-model",
  "prompt-refinement-reasoning-effort",
  "prompt-refinement-show-raw-first",
  "prompt-refinement-auto-submit",
  "prompt-refinement-delivery",
  "prompt-refinement-cmux-command",
  "prompt-refinement-cmux-auto-submit",
  "dictation-replacements",
  "dictation-mic-off-delay-ms",
  "dictation-language",
  "dedup-enforcement",
  "dedup-skip-directories",
  "debug-enabled",
] as const;

export type ConfigSetting = (typeof configSettings)[number];
type ConfigKey = keyof BagConfig;

const configSettingChoices = configSettings.map((setting): [string, ConfigSetting] => [setting, setting]);

const settingArgument = Args.choice(configSettingChoices, { name: "setting" }).pipe(
  Args.withDescription("Managed setting name"),
);

const optionalSettingArgument = settingArgument.pipe(Args.optional);

const settingValueArgument = Args.text({ name: "value" }).pipe(Args.withDescription("New setting value"));

export const numericSettings = [
  "context-warn-fraction",
  "context-block-fraction",
  "autorun-default-cycle-count",
  "autorun-max-cycle-count",
  "autorun-poll-interval-seconds",
  "autorun-idle-threshold-seconds",
  "speech-words-per-minute",
  "dictation-mic-off-delay-ms",
] as const;

export const booleanSettings = [
  "speech-read-along",
  "prompt-refinement-show-raw-first",
  "prompt-refinement-auto-submit",
  "prompt-refinement-cmux-auto-submit",
  "debug-enabled",
] as const;

export const stringSettings = [
  "idle-auto-compact",
  "speech-voice",
  "speech-response-mode",
  "prompt-refinement-mode",
  "prompt-refinement-backend",
  "prompt-refinement-model",
  "prompt-refinement-reasoning-effort",
  "prompt-refinement-delivery",
  "prompt-refinement-cmux-command",
  "dictation-replacements",
  "dictation-language",
  "dedup-enforcement",
  "dedup-skip-directories",
] as const;

export const configSettingChangeSchema = Schema.Union(
  Schema.Struct({ setting: Schema.Literal(...numericSettings), value: Schema.NumberFromString }),
  Schema.Struct({ setting: Schema.Literal(...booleanSettings), value: Schema.BooleanFromString }),
  Schema.Struct({ setting: Schema.Literal(...stringSettings), value: Schema.String }),
);

export const configSettingKeys: Record<ConfigSetting, ConfigKey> = {
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
  "prompt-refinement-backend": "promptRefinementBackend",
  "prompt-refinement-model": "promptRefinementModel",
  "prompt-refinement-reasoning-effort": "promptRefinementReasoningEffort",
  "prompt-refinement-show-raw-first": "promptRefinementShowRawFirst",
  "prompt-refinement-auto-submit": "promptRefinementAutoSubmit",
  "prompt-refinement-delivery": "promptRefinementDelivery",
  "prompt-refinement-cmux-command": "promptRefinementCmuxCommand",
  "prompt-refinement-cmux-auto-submit": "promptRefinementCmuxAutoSubmit",
  "dictation-replacements": "dictationReplacements",
  "dictation-mic-off-delay-ms": "dictationMicOffDelayMs",
  "dictation-language": "dictationLanguage",
  "dedup-enforcement": "dedupEnforcement",
  "dedup-skip-directories": "dedupSkipDirectories",
  "debug-enabled": "debugEnabled",
};

export const configLabels: Record<ConfigKey, string> = {
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
  promptRefinementMode: "prompt refinement mode (off|review|stt|both)",
  promptRefinementBackend: "prompt refinement backend (codex|grok|ollama|opencode|…)",
  promptRefinementModel: "prompt refinement model id",
  promptRefinementReasoningEffort: "prompt refinement reasoning effort",
  promptRefinementShowRawFirst: "prompt refinement show raw STT first",
  promptRefinementAutoSubmit: "prompt refinement auto-submit Enter after refined paste",
  promptRefinementDelivery: "prompt refinement delivery (caret|cmux-new|cmux-resume)",
  promptRefinementCmuxCommand: "prompt refinement cmux command template",
  promptRefinementCmuxAutoSubmit: "prompt refinement cmux auto-submit (Enter)",
  dictationReplacements: "dictation replacements",
  dictationMicOffDelayMs: "dictation mic-off delay (ms)",
  dictationLanguage: "dictation language (en|he)",
  dedupEnforcement: "dedup enforcement",
  dedupSkipDirectories: "dedup skip directories",
  debugEnabled: "debug diagnostics",
};

export const configKeys: ReadonlyArray<ConfigKey> = Object.values(configSettingKeys);

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

export const readScopedConfig = (scope: CliScope) =>
  Effect.gen(function* () {
    const host = yield* captureHostEvidence;
    const path = yield* Path.Path;
    const destination = destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot });
    const configPath = path.join(destination.root, managedConfigPath);
    const snapshot = yield* readConfigFile(configPath);
    const current = snapshot._tag === "present" ? snapshot.config : defaultBagConfig;
    return { scope, host, destination, configPath, snapshot, current } satisfies ScopedConfig;
  });

export const writeScopedConfig = (request: { readonly scopedConfig: ScopedConfig; readonly nextConfig: BagConfig }) =>
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
      // Special: `config set prompt-refinement-model menu` (or backend menu) opens
      // the dynamic multi-provider picker instead of writing the literal "menu".
      const menuTrigger =
        (args.setting === "prompt-refinement-model" ||
          args.setting === "prompt-refinement-backend" ||
          args.setting === "prompt-refinement-mode") &&
        args.value.trim().toLowerCase() === "menu";
      if (menuTrigger) {
        yield* TerminalUI.intro("config pick-refine");
        const scopedConfig = yield* readScopedConfig(args.scope);
        const picked = yield* runPickRefineMenu({
          scopeRoot: scopedConfig.destination.root,
          gui: true,
        }).pipe(Effect.mapError((error) => new CliUsageError({ issue: error.message })));
        const effort =
          picked.reasoningEffort === "" ||
          picked.reasoningEffort === "low" ||
          picked.reasoningEffort === "medium" ||
          picked.reasoningEffort === "high" ||
          picked.reasoningEffort === "xhigh" ||
          picked.reasoningEffort === "minimal"
            ? picked.reasoningEffort || "low"
            : "low";
        const nextConfig = yield* Schema.decodeUnknown(bagConfigSchema, { onExcessProperty: "error" })({
          ...scopedConfig.current,
          promptRefinementBackend: picked.backend,
          promptRefinementModel: picked.model,
          promptRefinementReasoningEffort: effort,
        });
        const owner = yield* writeScopedConfig({ scopedConfig, nextConfig });
        if (args.format === "json") {
          yield* TerminalUI.json({
            _tag: "configured",
            scope: args.scope,
            setting: "pick-refine",
            value: {
              backend: nextConfig.promptRefinementBackend,
              model: nextConfig.promptRefinementModel,
              reasoningEffort: nextConfig.promptRefinementReasoningEffort,
            },
            owner,
          });
        } else {
          yield* TerminalUI.success(
            `refine → ${nextConfig.promptRefinementBackend}/${nextConfig.promptRefinementModel} effort=${nextConfig.promptRefinementReasoningEffort}`,
          );
        }
        return;
      }

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
).pipe(Command.withDescription("Set one managed setting (use value `menu` for refine model picker)"));

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

const guiOption = Options.boolean("gui").pipe(
  Options.withDescription("Force macOS GUI dialogs for pick-refine (default: TTY menu in terminal)"),
);

const pickRefineCommand = Command.make(
  "pick-refine",
  { scope: scopeOption, format: formatOption, gui: guiOption },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("config pick-refine");
      const scopedConfig = yield* readScopedConfig(args.scope);
      // GUI when --gui, or when not a TTY (e.g. launched from a shortcut).
      const terminal = yield* Terminal.Terminal;
      const isTTY = yield* terminal.isTTY;
      const useGui = args.gui || !isTTY;
      const picked = yield* runPickRefineMenu({
        scopeRoot: scopedConfig.destination.root,
        gui: useGui,
      }).pipe(Effect.mapError((error) => new CliUsageError({ issue: error.message })));
      const effort =
        picked.reasoningEffort === "" ||
        picked.reasoningEffort === "low" ||
        picked.reasoningEffort === "medium" ||
        picked.reasoningEffort === "high" ||
        picked.reasoningEffort === "xhigh" ||
        picked.reasoningEffort === "minimal"
          ? picked.reasoningEffort || "low"
          : "low";
      const nextConfig = yield* Schema.decodeUnknown(bagConfigSchema, { onExcessProperty: "error" })({
        ...scopedConfig.current,
        promptRefinementBackend: picked.backend,
        promptRefinementModel: picked.model,
        promptRefinementReasoningEffort: effort,
      });
      const owner = yield* writeScopedConfig({ scopedConfig, nextConfig });
      if (args.format === "json") {
        yield* TerminalUI.json({
          _tag: "configured",
          scope: args.scope,
          backend: nextConfig.promptRefinementBackend,
          model: nextConfig.promptRefinementModel,
          reasoningEffort: nextConfig.promptRefinementReasoningEffort,
          owner,
        });
      } else {
        yield* TerminalUI.success(
          `refine → ${nextConfig.promptRefinementBackend}/${nextConfig.promptRefinementModel} effort=${nextConfig.promptRefinementReasoningEffort}`,
        );
        yield* TerminalUI.detail(
          "Restart voice if the daemon is already running: dufflebag voice off && dufflebag voice on",
        );
      }
    }),
).pipe(
  Command.withDescription(
    "Interactively pick refine backend + model + effort from providers on this machine (codex, claude, grok, ollama, …)",
  ),
);

export const configCommand = Command.make("config").pipe(
  Command.withDescription("Inspect or change managed configuration"),
  Command.withSubcommands([showCommand, setCommand, resetCommand, pickRefineCommand]),
);
