/**
 * Interactive menu: gather the same options the CLI args expose, show an ordered
 * plan, require approval, then invoke the same capability requests as direct commands.
 */

import { Command } from "@effect/cli";
import { FileSystem, Path } from "@effect/platform";
import { Effect, Schema } from "effect";

import { classifyAgents } from "../catalog/agentCatalog.js";
import { featureCatalog, selectedFeatureIds } from "../catalog/featureCatalog.js";
import { type BagConfig, bagConfigSchema, defaultBagConfig } from "../config/bagConfigSchema.js";
import { readConfigFile } from "../config/configFile.js";
import { managedConfigPath } from "../config/configure.js";
import { doctor } from "../doctor.js";
import { dedupCheck } from "../hookIsland/dedupGuard/command/dedupCheck.js";
import { readArtifactReceiptSnapshot } from "../install/artifactReceipt.js";
import { install, receiptPath } from "../install/install.js";
import { uninstall } from "../install/uninstall.js";
import { update } from "../install/update.js";
import { scaffoldWorkflows } from "../scaffoldWorkflows.js";
import {
  type ConfigSetting,
  configKeys,
  configLabels,
  configSettingChangeSchema,
  configSettingKeys,
  configSettings,
  numericSettings,
  readScopedConfig,
  writeScopedConfig,
} from "./configCommand.js";
import { captureHostEvidence, destinationForScope, type HostEvidence } from "./hostEvidence.js";
import { type CliScope, CliUsageError } from "./scopeOptions.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";
import {
  disableVoiceWorker,
  enableVoiceWorker,
  normalizeDictationLanguage,
  writeBagConfigPatch,
  writeSpeechNarrationPolicy,
} from "./voiceCommand.js";

type MenuAction =
  | "install"
  | "update"
  | "uninstall"
  | "config"
  | "doctor"
  | "catalog"
  | "workflow"
  | "dedup"
  | "voice"
  | "stt"
  | "tts"
  | "exit";

type ConfigAction = "show" | "set" | "reset" | "back";
type VoiceAction = "on" | "off" | "status" | "back";
type SttAction = "on" | "off" | "mic-off-delay" | "lang" | "back";
type TtsAction = "on" | "off" | "back";

const resolvePackageRoot = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  const moduleDirectory = yield* path.fromFileUrl(new URL(import.meta.url));
  let directory = path.dirname(moduleDirectory);

  // Walk toward the filesystem root until package.json is found.
  while (true) {
    const candidate = path.join(directory, "package.json");
    if (yield* fileSystem.exists(candidate)) {
      return directory;
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return directory;
    }

    directory = parent;
  }
});

const pickScope = (verb: string) =>
  TerminalUI.selectOne<CliScope>({
    message: `${verb} — which scope?`,
    choices: [
      { title: "global", value: "global", description: "home root · every session" },
      { title: "project", value: "project", description: "this repo · committable" },
    ],
    initial: "global",
  });

const agentSummary = (host: HostEvidence): string => {
  const detected = classifyAgents(host.agentEvidence)
    .filter((agent) => agent.installed)
    .map((agent) => agent.displayName);
  return detected.length > 0 ? detected.join(", ") : "none detected";
};

const pickFeatures = (initial: ReadonlyArray<string>) =>
  TerminalUI.multiSelect({
    message: "Select features (space toggles, enter confirms)",
    choices: featureCatalog.map((feature) => ({
      title: feature.title,
      value: feature.id,
      description: `${feature.id} · ${feature.summary}`,
      selected: initial.includes(feature.id),
    })),
    initial,
  });

const cancelNothingChanged = TerminalUI.outro("Cancelled — nothing was changed.");

const runInstall = Effect.gen(function* () {
  const scope = yield* pickScope("Install");
  const host = yield* captureHostEvidence;
  const destination = destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot });
  const features = yield* pickFeatures(selectedFeatureIds);

  const approved = yield* TerminalUI.approveOrderedFlow({
    title: "Install plan",
    steps: [
      { label: "Action", detail: "install features + hooks" },
      { label: "Scope", detail: scope },
      { label: "Destination", detail: destination.root },
      { label: "Features", detail: features.length > 0 ? features.join(", ") : "(none)" },
      { label: "Agents", detail: `${agentSummary(host)} (auto-detected)` },
      { label: "Config", detail: "automatic (reuse / inherit / defaults)" },
    ],
    confirmMessage: "Apply this install plan?",
  });
  if (!approved) {
    yield* cancelNothingChanged;
    return;
  }

  const stagedPackage = yield* stagePackage;
  const installation = yield* install({
    destination,
    host: { homeRoot: host.homeRoot },
    stagedPackage,
    features: { _tag: "selected", ids: features },
    agents: { _tag: "detected", evidence: host.agentEvidence },
    interaction: { _tag: "interactive" },
    configuration: { _tag: "automatic" },
  });

  yield* TerminalUI.success(
    installation._tag === "installed"
      ? `Installed ${installation.features.join(", ")} (${installation.scope})`
      : `Already current: ${installation.features.join(", ")} (${installation.scope})`,
  );
});

const runUpdate = Effect.gen(function* () {
  const scope = yield* pickScope("Update");
  const host = yield* captureHostEvidence;
  const destination = destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot });
  const mode = yield* TerminalUI.selectOne<"preserve" | "selected">({
    message: "Feature selection",
    choices: [
      { title: "Preserve installed set", value: "preserve", description: "refresh payload only" },
      { title: "Choose features", value: "selected", description: "replace receipt selection" },
    ],
    initial: "preserve",
  });

  let featureDetail = "preserve receipt selection";
  let features: { readonly _tag: "preserve" } | { readonly _tag: "selected"; readonly ids: ReadonlyArray<string> } = {
    _tag: "preserve",
  };

  if (mode === "selected") {
    const ids = yield* pickFeatures(selectedFeatureIds);
    features = { _tag: "selected", ids };
    featureDetail = ids.length > 0 ? ids.join(", ") : "(none)";
  }

  const approved = yield* TerminalUI.approveOrderedFlow({
    title: "Update plan",
    steps: [
      { label: "Action", detail: "update / refresh installation" },
      { label: "Scope", detail: scope },
      { label: "Destination", detail: destination.root },
      { label: "Features", detail: featureDetail },
      { label: "Agents", detail: `${agentSummary(host)} (auto-detected)` },
      { label: "Config", detail: "automatic" },
    ],
    confirmMessage: "Apply this update plan?",
  });
  if (!approved) {
    yield* cancelNothingChanged;
    return;
  }

  const stagedPackage = yield* stagePackage;
  const updateExecution = yield* update({
    destination,
    host: { homeRoot: host.homeRoot },
    stagedPackage,
    features,
    agents: { _tag: "detected", evidence: host.agentEvidence },
    interaction: { _tag: "interactive" },
    configuration: { _tag: "automatic" },
  });

  yield* TerminalUI.success(
    updateExecution._tag === "updated"
      ? `Updated ${updateExecution.features.join(", ")} (${updateExecution.scope})`
      : `Already current: ${updateExecution.features.join(", ")} (${updateExecution.scope})`,
  );
});

const runUninstall = Effect.gen(function* () {
  const scope = yield* pickScope("Uninstall");
  const host = yield* captureHostEvidence;
  const destination = destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot });

  const approved = yield* TerminalUI.approveOrderedFlow({
    title: "Uninstall plan",
    steps: [
      { label: "Action", detail: "remove receipt-owned installation" },
      { label: "Scope", detail: scope },
      { label: "Destination", detail: destination.root },
      { label: "Safety", detail: "only receipt-authorized artifacts are removed" },
    ],
    confirmMessage: `Uninstall dufflebag from ${scope}?`,
  });
  if (!approved) {
    yield* cancelNothingChanged;
    return;
  }

  const uninstallation = yield* uninstall({
    destination,
    host: { homeRoot: host.homeRoot },
    interaction: { _tag: "interactive" },
  });

  yield* TerminalUI.success(
    uninstallation._tag === "uninstalled"
      ? `Uninstalled ${uninstallation.scope} installation.`
      : `No ${uninstallation.scope} installation present.`,
  );
});

const runDoctor = Effect.gen(function* () {
  const host = yield* captureHostEvidence;
  const stagedPackage = yield* stagePackage;
  const scopes: ReadonlyArray<CliScope> = ["global", "project"];

  // Inspect both scopes from the menu the same way as the explicit command.
  for (const scope of scopes) {
    const report = yield* doctor({
      destination: destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
      stagedPackage,
      platform: host.platform,
      agentEvidence: host.agentEvidence,
    });
    yield* TerminalUI.step(
      `${scope}: ${report.installation._tag === "present" ? `v${report.installation.version}` : "missing"}`,
    );
    if (report.installation._tag === "present" && report.installation.features.length > 0) {
      yield* TerminalUI.detail(report.installation.features.join(", "));
    }
    if (report.discrepancies.length > 0) {
      yield* TerminalUI.warn(`${String(report.discrepancies.length)} discrepancy(ies)`);
    }
  }
});

const runCatalog = Effect.gen(function* () {
  yield* TerminalUI.intro("catalog");
  const lines = featureCatalog.map(
    (feature) =>
      `${feature.id.padEnd(24)} ${feature.title}${feature.selectedByDefault ? " · default" : ""}\n${"".padEnd(26)}${feature.summary}`,
  );
  yield* TerminalUI.note(lines.join("\n"), "Features");
});

const runWorkflow = Effect.gen(function* () {
  const path = yield* Path.Path;
  const packageRoot = yield* resolvePackageRoot;
  const defaultWorkspace = path.resolve(process.cwd());
  const workspace = yield* TerminalUI.optionalText({
    message: "Target workspace (repository root)",
    fallback: defaultWorkspace,
  });
  const targetRoot = path.resolve(workspace);
  const overwrite = yield* TerminalUI.confirm({
    message: "Overwrite existing workflow files?",
    initialValue: false,
  });

  const approved = yield* TerminalUI.approveOrderedFlow({
    title: "Workflow scaffold plan",
    steps: [
      { label: "Action", detail: "copy CI + publish workflow templates" },
      { label: "Workspace", detail: targetRoot },
      { label: "Overwrite", detail: overwrite ? "yes" : "no (skip existing)" },
      { label: "Templates", detail: path.join(packageRoot, "templates", "workflows") },
    ],
    confirmMessage: "Apply this workflow scaffold plan?",
  });
  if (!approved) {
    yield* cancelNothingChanged;
    return;
  }

  const workflowScaffold = yield* scaffoldWorkflows({
    targetRoot,
    templateDirectory: path.join(packageRoot, "templates", "workflows"),
    force: overwrite,
  });
  yield* TerminalUI.success(
    `wrote ${String(workflowScaffold.written.length)}, skipped ${String(workflowScaffold.skipped.length)}`,
  );
});

const runDedup = Effect.gen(function* () {
  const path = yield* Path.Path;
  const defaultWorkspace = path.resolve(process.cwd());
  const workspace = yield* TerminalUI.optionalText({
    message: "Workspace to scan",
    fallback: defaultWorkspace,
  });
  const mode = yield* TerminalUI.selectOne<"all" | "staged" | "since">({
    message: "Scan mode",
    choices: [
      { title: "Full workspace", value: "all", description: "scan the whole tree" },
      { title: "Staged only", value: "staged", description: "git-staged source files" },
      { title: "Since git ref", value: "since", description: "files changed since a ref" },
    ],
    initial: "all",
  });

  let since: string | undefined;
  if (mode === "since") {
    since = yield* TerminalUI.optionalText({
      message: "Git ref (e.g. origin/main, HEAD~3)",
      fallback: "HEAD~1",
    });
  }

  const targetRoot = path.resolve(workspace);
  let modeDetail: string = mode;
  if (mode === "since") {
    modeDetail = `since ${since === undefined ? "?" : since}`;
  }
  yield* TerminalUI.presentOrderedFlow({
    title: "Dedup scan",
    steps: [
      { label: "Action", detail: "find duplicate function bodies and type shapes" },
      { label: "Workspace", detail: targetRoot },
      { label: "Mode", detail: modeDetail },
    ],
  });

  // Read-only gate: no filesystem mutation, so no approval gate beyond the plan preview.
  dedupCheck({
    workspace: targetRoot,
    staged: mode === "staged",
    since: mode === "since" ? since : undefined,
    format: "text",
  });
});

const choiceSettings: Partial<Record<ConfigSetting, ReadonlyArray<string>>> = {
  "speech-response-mode": ["auto", "focused", "immediate", "off"],
  "speech-read-along": ["true", "false"],
  "prompt-refinement-mode": ["off", "review"],
  "dictation-language": ["en", "he"],
  "dedup-enforcement": ["deny", "warn", "off"],
  "debug-enabled": ["true", "false"],
  "speech-voice": ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"],
};

const isNumericSetting = (setting: ConfigSetting): boolean => {
  for (const candidate of numericSettings) {
    if (candidate === setting) {
      return true;
    }
  }
  return false;
};

const promptSettingValue = (setting: ConfigSetting, current: string) =>
  Effect.gen(function* () {
    const choices = choiceSettings[setting];
    if (choices !== undefined) {
      return yield* TerminalUI.selectOne({
        message: `Value for ${setting}`,
        choices: choices.map((value) => ({
          title: value === "" ? "(empty)" : value,
          value,
          description: value === current ? "current" : undefined,
        })),
        initial: choices.includes(current) ? current : choices[0],
      });
    }

    return yield* TerminalUI.optionalText({
      message: `Value for ${setting}${isNumericSetting(setting) ? " (number)" : ""}`,
      fallback: current,
    });
  });

const runConfigShow = Effect.gen(function* () {
  const scope = yield* pickScope("Config show");
  const mode = yield* TerminalUI.selectOne<"all" | "one">({
    message: "Show",
    choices: [
      { title: "All settings", value: "all" },
      { title: "One setting", value: "one" },
    ],
    initial: "all",
  });
  const scopedConfig = yield* readScopedConfig(scope);

  if (mode === "one") {
    const setting = yield* TerminalUI.selectOne<ConfigSetting>({
      message: "Setting",
      choices: configSettings.map((id) => ({
        title: id,
        value: id,
        description: configLabels[configSettingKeys[id]],
      })),
      initial: configSettings[0],
    });
    const key = configSettingKeys[setting];
    yield* TerminalUI.note(`${configLabels[key]}  ${String(scopedConfig.current[key])}`, "managed config");
    return;
  }

  const lines = configKeys.map((key) => `${configLabels[key].padEnd(40)} ${String(scopedConfig.current[key])}`);
  yield* TerminalUI.note(lines.join("\n"), "managed config");
});

const runConfigSet = Effect.gen(function* () {
  const scope = yield* pickScope("Config set");
  const setting = yield* TerminalUI.selectOne<ConfigSetting>({
    message: "Setting to change",
    choices: configSettings.map((id) => ({
      title: id,
      value: id,
      description: configLabels[configSettingKeys[id]],
    })),
    initial: configSettings[0],
  });

  const scopedConfig = yield* readScopedConfig(scope);
  const key = configSettingKeys[setting];
  const current = String(scopedConfig.current[key]);
  const settingValueText = yield* promptSettingValue(setting, current);

  const change = yield* Schema.decodeUnknown(configSettingChangeSchema, { onExcessProperty: "error" })({
    setting,
    value: settingValueText,
  }).pipe(Effect.mapError((error) => new CliUsageError({ issue: String(error) })));

  const nextConfig = yield* Schema.decodeUnknown(bagConfigSchema, { onExcessProperty: "error" })({
    ...scopedConfig.current,
    [key]: change.value,
  }).pipe(Effect.mapError((error) => new CliUsageError({ issue: String(error) })));

  const approved = yield* TerminalUI.approveOrderedFlow({
    title: "Config set plan",
    steps: [
      { label: "Action", detail: "set managed setting" },
      { label: "Scope", detail: scope },
      { label: "Setting", detail: setting },
      { label: "From", detail: current },
      { label: "To", detail: String(nextConfig[key]) },
      { label: "Path", detail: scopedConfig.configPath },
    ],
    confirmMessage: "Apply this config change?",
  });
  if (!approved) {
    yield* cancelNothingChanged;
    return;
  }

  const owner = yield* writeScopedConfig({ scopedConfig, nextConfig });
  yield* TerminalUI.success(`${configLabels[key]} → ${String(nextConfig[key])} (${owner})`);
});

const runConfigReset = Effect.gen(function* () {
  const scope = yield* pickScope("Config reset");
  const mode = yield* TerminalUI.selectOne<"all" | "one">({
    message: "Reset",
    choices: [
      { title: "One setting", value: "one" },
      { title: "All settings", value: "all", description: "Schema defaults" },
    ],
    initial: "one",
  });

  const scopedConfig = yield* readScopedConfig(scope);
  let nextConfig: BagConfig = defaultBagConfig;
  let settingLabel = "every setting";
  let fromDetail = "(current snapshot)";
  let toDetail = "Schema defaults";

  if (mode === "one") {
    const setting = yield* TerminalUI.selectOne<ConfigSetting>({
      message: "Setting to reset",
      choices: configSettings.map((id) => ({
        title: id,
        value: id,
        description: configLabels[configSettingKeys[id]],
      })),
      initial: configSettings[0],
    });
    const key = configSettingKeys[setting];
    settingLabel = setting;
    fromDetail = String(scopedConfig.current[key]);
    toDetail = String(defaultBagConfig[key]);
    nextConfig = yield* Schema.decodeUnknown(bagConfigSchema, { onExcessProperty: "error" })({
      ...scopedConfig.current,
      [key]: defaultBagConfig[key],
    }).pipe(Effect.mapError((error) => new CliUsageError({ issue: String(error) })));
  }

  const approved = yield* TerminalUI.approveOrderedFlow({
    title: "Config reset plan",
    steps: [
      { label: "Action", detail: mode === "all" ? "reset all settings" : "reset one setting" },
      { label: "Scope", detail: scope },
      { label: "Setting", detail: settingLabel },
      { label: "From", detail: fromDetail },
      { label: "To", detail: toDetail },
      { label: "Path", detail: scopedConfig.configPath },
    ],
    confirmMessage: "Apply this config reset?",
  });
  if (!approved) {
    yield* cancelNothingChanged;
    return;
  }

  yield* writeScopedConfig({ scopedConfig, nextConfig });
  yield* TerminalUI.success(mode === "all" ? `All ${scope} settings reset.` : `${settingLabel} reset to ${toDetail}`);
});

const runConfig = Effect.gen(function* () {
  const action = yield* TerminalUI.selectOne<ConfigAction>({
    message: "Config",
    choices: [
      { title: "Show", value: "show", description: "inspect managed settings" },
      { title: "Set", value: "set", description: "change one setting" },
      { title: "Reset", value: "reset", description: "restore Schema defaults" },
      { title: "Back", value: "back" },
    ],
    initial: "show",
  });

  switch (action) {
    case "show":
      yield* runConfigShow;
      break;
    case "set":
      yield* runConfigSet;
      break;
    case "reset":
      yield* runConfigReset;
      break;
    case "back":
      return;
  }
});

const runVoice = Effect.gen(function* () {
  const action = yield* TerminalUI.selectOne<VoiceAction>({
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

  if (action === "status") {
    const host = yield* captureHostEvidence;
    const destination = destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot });
    const path = yield* Path.Path;
    const snapshot = yield* readArtifactReceiptSnapshot(path.join(destination.root, receiptPath));
    const installed =
      snapshot._tag === "present" && snapshot.receipt.features.some((feature) => feature === "speak-response");
    const configFile = yield* readConfigFile(path.join(destination.root, managedConfigPath));
    const inherited =
      configFile._tag === "present" ? configFile : yield* readConfigFile(path.join(host.homeRoot, managedConfigPath));
    const config = inherited._tag === "present" ? inherited.config : defaultBagConfig;
    yield* TerminalUI.presentOrderedFlow({
      title: "Voice status",
      steps: [
        { label: "Scope", detail: scope },
        { label: "Root", detail: destination.root },
        { label: "Feature", detail: installed ? "on" : "off" },
        { label: "STT", detail: installed ? "on" : "off" },
        { label: "TTS", detail: config.speechResponseMode },
      ],
    });
    return;
  }

  const approved = yield* TerminalUI.approveOrderedFlow({
    title: `Voice ${action} plan`,
    steps: [
      {
        label: "Action",
        detail: action === "on" ? "install speak-response + start worker" : "stop worker + remove speak-response",
      },
      { label: "Scope", detail: scope },
      {
        label: "Equivalent CLI",
        detail: `dufflebag voice ${action} --scope ${scope}`,
      },
    ],
    confirmMessage: `Apply voice ${action}?`,
  });
  if (!approved) {
    yield* cancelNothingChanged;
    return;
  }

  if (action === "on") {
    const { location, config } = yield* enableVoiceWorker(scope);
    yield* TerminalUI.success(`Voice is on (${location.scope}).`);
    yield* TerminalUI.detail(`TTS mode: ${config.speechResponseMode}`);
  } else {
    const { location, alreadyOff } = yield* disableVoiceWorker(scope);
    yield* TerminalUI.success(
      alreadyOff ? `Voice is already off (${location.scope}).` : `Voice is off (${location.scope}).`,
    );
  }
});

const runStt = Effect.gen(function* () {
  const action = yield* TerminalUI.selectOne<SttAction>({
    message: "STT (dictation)",
    choices: [
      { title: "On", value: "on", description: "install + start dictation worker" },
      { title: "Off", value: "off", description: "stop worker + remove voice feature" },
      { title: "Mic-off delay", value: "mic-off-delay", description: "post-release tail (ms)" },
      { title: "Language", value: "lang", description: "en or he" },
      { title: "Back", value: "back" },
    ],
    initial: "on",
  });
  if (action === "back") return;

  const scope = yield* pickScope(`STT ${action}`);

  if (action === "on" || action === "off") {
    const approved = yield* TerminalUI.approveOrderedFlow({
      title: `STT ${action} plan`,
      steps: [
        {
          label: "Action",
          detail: action === "on" ? "enable hold-Control dictation" : "disable dictation worker",
        },
        { label: "Scope", detail: scope },
        { label: "Equivalent CLI", detail: `dufflebag stt ${action} --scope ${scope}` },
      ],
      confirmMessage: `Apply stt ${action}?`,
    });
    if (!approved) {
      yield* cancelNothingChanged;
      return;
    }

    if (action === "on") {
      const { location } = yield* enableVoiceWorker(scope);
      yield* TerminalUI.success(`STT is on (${location.scope}).`);
      yield* TerminalUI.detail("Hold Control to dictate; release to finish.");
    } else {
      const { location, alreadyOff } = yield* disableVoiceWorker(scope);
      yield* TerminalUI.success(
        alreadyOff ? `STT is already off (${location.scope}).` : `STT is off (${location.scope}).`,
      );
    }
    return;
  }

  if (action === "mic-off-delay") {
    const millisecondsText = yield* TerminalUI.optionalText({
      message: "Mic-off delay milliseconds (0–2000)",
      fallback: "200",
    });
    const milliseconds = Number(millisecondsText);
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 2000) {
      return yield* new CliUsageError({ issue: "mic-off-delay must be an integer between 0 and 2000." });
    }

    const approved = yield* TerminalUI.approveOrderedFlow({
      title: "STT mic-off-delay plan",
      steps: [
        { label: "Action", detail: "set dictation mic-off delay" },
        { label: "Scope", detail: scope },
        { label: "Milliseconds", detail: String(milliseconds) },
        { label: "Equivalent CLI", detail: `dufflebag stt mic-off-delay ${String(milliseconds)} --scope ${scope}` },
      ],
      confirmMessage: "Apply mic-off-delay?",
    });
    if (!approved) {
      yield* cancelNothingChanged;
      return;
    }

    const { location, config, changed } = yield* writeBagConfigPatch(scope, {
      dictationMicOffDelayMs: milliseconds,
    });
    yield* TerminalUI.success(
      changed
        ? `mic-off-delay → ${String(config.dictationMicOffDelayMs)} ms (${location.scope}).`
        : `mic-off-delay already ${String(config.dictationMicOffDelayMs)} ms (${location.scope}).`,
    );
    return;
  }

  const language = yield* TerminalUI.selectOne<"en" | "he">({
    message: "Dictation language",
    choices: [
      { title: "en — English (whisper.cpp)", value: "en" },
      { title: "he — Hebrew (ivrit.ai)", value: "he" },
    ],
    initial: "en",
  });
  const normalized = normalizeDictationLanguage(language);
  if (normalized === null) {
    return yield* new CliUsageError({ issue: `Unknown dictation language "${language}".` });
  }

  const approved = yield* TerminalUI.approveOrderedFlow({
    title: "STT language plan",
    steps: [
      { label: "Action", detail: "set dictation language" },
      { label: "Scope", detail: scope },
      { label: "Language", detail: normalized },
      { label: "Equivalent CLI", detail: `dufflebag stt lang ${normalized} --scope ${scope}` },
    ],
    confirmMessage: "Apply dictation language?",
  });
  if (!approved) {
    yield* cancelNothingChanged;
    return;
  }

  const { location, config, changed } = yield* writeBagConfigPatch(scope, {
    dictationLanguage: normalized,
  });
  yield* TerminalUI.success(
    changed
      ? `lang → ${config.dictationLanguage} (${location.scope}).`
      : `lang already ${config.dictationLanguage} (${location.scope}).`,
  );
});

const runTts = Effect.gen(function* () {
  const action = yield* TerminalUI.selectOne<TtsAction>({
    message: "TTS (narration)",
    choices: [
      { title: "On", value: "on", description: "speech-response-mode → auto" },
      { title: "Off", value: "off", description: "speech-response-mode → off" },
      { title: "Back", value: "back" },
    ],
    initial: "on",
  });
  if (action === "back") return;

  const scope = yield* pickScope(`TTS ${action}`);
  const approved = yield* TerminalUI.approveOrderedFlow({
    title: `TTS ${action} plan`,
    steps: [
      {
        label: "Action",
        detail: action === "on" ? "enable response narration" : "disable response narration",
      },
      { label: "Scope", detail: scope },
      {
        label: "Config",
        detail: action === "on" ? "speech-response-mode → auto" : "speech-response-mode → off",
      },
      { label: "Equivalent CLI", detail: `dufflebag tts ${action} --scope ${scope}` },
    ],
    confirmMessage: `Apply tts ${action}?`,
  });
  if (!approved) {
    yield* cancelNothingChanged;
    return;
  }

  if (action === "on") {
    const { location } = yield* enableVoiceWorker(scope);
    const { config, changed } = yield* writeSpeechNarrationPolicy(scope, "auto");
    yield* TerminalUI.success(
      changed
        ? `TTS is on (${location.scope}) — speech-response-mode → auto.`
        : `TTS is on (${location.scope}) — speech-response-mode already ${config.speechResponseMode}.`,
    );
  } else {
    const { location, changed } = yield* writeSpeechNarrationPolicy(scope, "off");
    yield* TerminalUI.success(
      changed
        ? `TTS is off (${location.scope}) — speech-response-mode → off.`
        : `TTS is already off (${location.scope}).`,
    );
  }
});

// Interactive menu: pick an action, gather options, show ordered plan, approve, apply.
export const runMenu = Effect.gen(function* () {
  yield* TerminalUI.intro("menu");
  const action = yield* TerminalUI.selectOne<MenuAction>({
    message: "What would you like to do?",
    choices: [
      { title: "Install", value: "install", description: "features + hooks (plan → approve)" },
      { title: "Update", value: "update", description: "refresh installation" },
      { title: "Uninstall", value: "uninstall", description: "remove receipt-owned install" },
      { title: "Configure", value: "config", description: "show / set / reset" },
      { title: "Doctor", value: "doctor", description: "read-only health check" },
      { title: "Catalog", value: "catalog", description: "list feature IDs" },
      { title: "Workflow scaffold", value: "workflow", description: "CI + publish templates" },
      { title: "Dedup", value: "dedup", description: "duplicate-code scan" },
      { title: "Voice", value: "voice", description: "on / off / status" },
      { title: "STT", value: "stt", description: "dictation on / off / lang" },
      { title: "TTS", value: "tts", description: "narration on / off" },
      { title: "Exit", value: "exit", description: "close the bag" },
    ],
    initial: "install",
  });

  switch (action) {
    case "install":
      yield* runInstall;
      break;
    case "update":
      yield* runUpdate;
      break;
    case "uninstall":
      yield* runUninstall;
      break;
    case "config":
      yield* runConfig;
      break;
    case "doctor":
      yield* runDoctor;
      break;
    case "catalog":
      yield* runCatalog;
      break;
    case "workflow":
      yield* runWorkflow;
      break;
    case "dedup":
      yield* runDedup;
      break;
    case "voice":
      yield* runVoice;
      break;
    case "stt":
      yield* runStt;
      break;
    case "tts":
      yield* runTts;
      break;
    case "exit":
      yield* TerminalUI.outro("Closed.");
      return;
  }

  yield* TerminalUI.outro("Done.");
});

export const menuCommand = Command.make("menu", {}, () => runMenu).pipe(
  Command.withDescription("Interactive TUI: same options as CLI args, ordered plan preview, approve before apply"),
);
