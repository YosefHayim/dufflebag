/** `dufflebag voice|stt|tts` — local dictation (STT) and response narration (TTS). */

import { Args, Command as CliCommand, Options } from "@effect/cli";
import { FileSystem, Path, Command as PlatformCommand } from "@effect/platform";
import { Effect, Either, Option, Schema } from "effect";

import { featureCatalog } from "../catalog/featureCatalog.js";
import { type BagConfig, defaultBagConfig } from "../config/bagConfigSchema.js";
import { readConfigFile } from "../config/configFile.js";
import { managedConfigPath, planManagedConfig } from "../config/configure.js";
import { readArtifactReceiptSnapshot } from "../install/artifactReceipt.js";
import { install, receiptPath, runtimePath } from "../install/install.js";
import { update } from "../install/update.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { type CliScope, formatOption, scopeOption } from "./scopeOptions.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

const voiceFeatureId = "speak-response";
type VoiceSource = "claude-code" | "codex" | "grok" | "devin" | "manual";
type SpeechResponseMode = BagConfig["speechResponseMode"];

const voiceSources: ReadonlyArray<VoiceSource> = ["claude-code", "codex", "grok", "devin", "manual"];

export class VoiceCommandError extends Schema.TaggedError<VoiceCommandError>()("VoiceCommandError", {
  issue: Schema.NonEmptyString,
}) {
  get message(): string {
    return this.issue;
  }
}

export const nextVoiceFeatures = (selection: {
  current: ReadonlyArray<string>;
  enabled: boolean;
}): ReadonlyArray<string> => {
  const selected = new Set(selection.current);
  if (selection.enabled) {
    selected.add(voiceFeatureId);
  } else {
    selected.delete(voiceFeatureId);
  }
  return featureCatalog.map((feature) => feature.id).filter((id) => selected.has(id));
};

export const normalizeVoiceId = (voice: string): string =>
  /^[MF][1-5]$/i.test(voice.trim()) ? voice.trim().toUpperCase() : "F4";

export const isTtsNarrationEnabled = (mode: SpeechResponseMode): boolean => mode !== "off";

/** Normalize CLI/user dictation language tokens to bag config values. */
export const normalizeDictationLanguage = (raw: string): "en" | "he" | null => {
  const token = raw.trim().toLowerCase().replace(/^lang=/, "");
  if (token === "en" || token === "english" || token === "en-us" || token === "en_us") return "en";
  if (
    token === "he" ||
    token === "he-il" ||
    token === "he_il" ||
    token === "hebrew" ||
    token === "ivrit" ||
    token === "iw"
  ) {
    return "he";
  }
  return null;
};

const sourceOption = Options.choice("source", voiceSources).pipe(
  Options.withDefault("manual"),
  Options.withDescription("Origin label for this spoken text"),
);

const textArgument = Args.text({ name: "text" }).pipe(Args.withDescription("Complete Markdown response to read aloud"));
const promptArgument = Args.text({ name: "prompt" }).pipe(Args.withDescription("Draft prompt to refine locally"));
const speakRefinementOption = Options.boolean("speak").pipe(
  Options.withDescription("Read the refined prompt aloud with synchronized highlighting"),
);
const devinArguments = Args.text({ name: "devin-argument" }).pipe(
  Args.repeated,
  Args.withDescription("Arguments passed to Devin; put -- before Devin flags"),
);

// Effect Command does not always inherit process.env (platform-node-shared
// gates it on extendEnv). Voice needs PATH so `uv` resolves on macOS/Homebrew.
const withProcessEnv = (command: PlatformCommand.Command) => PlatformCommand.env(command, process.env);

const inheritedCommand = (executable: string, args: ReadonlyArray<string>) =>
  withProcessEnv(
    PlatformCommand.make(executable, ...args).pipe(
      PlatformCommand.stdin("inherit"),
      PlatformCommand.stdout("inherit"),
      PlatformCommand.stderr("inherit"),
    ),
  );

const requireSuccess = (command: PlatformCommand.Command, label: string) =>
  PlatformCommand.exitCode(command).pipe(
    Effect.flatMap((code) =>
      code === 0
        ? Effect.void
        : Effect.fail(new VoiceCommandError({ issue: `${label} exited with status ${String(code)}.` })),
    ),
    Effect.mapError((error) => {
      if (error instanceof VoiceCommandError) return error;
      const issue = error instanceof Error ? error.message : String(error);
      return new VoiceCommandError({ issue: `${label} could not start: ${issue}` });
    }),
  );

const requireUv = requireSuccess(withProcessEnv(PlatformCommand.make("uv", "--version")), "uv");

const voiceBinaryPath = (root: string, path: Path.Path) =>
  path.join(root, runtimePath, "speakResponse", "dufflebag-voice");

const requireInstalledVoice = (root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binary = voiceBinaryPath(root, path);
    if (yield* fileSystem.exists(binary)) {
      return binary;
    }
    return yield* new VoiceCommandError({
      issue: "Voice is not installed here (missing dufflebag-voice). Run `dufflebag stt on` or `dufflebag voice on` first.",
    });
  });

const runVoice = (invocation: { executable: string; args: ReadonlyArray<string>; label: string }) =>
  requireSuccess(inheritedCommand(invocation.executable, invocation.args), invocation.label);

const voiceLocation = (scope: CliScope) =>
  Effect.gen(function* () {
    const host = yield* captureHostEvidence;
    const destination = destinationForScope({
      scope,
      homeRoot: host.homeRoot,
      projectRoot: host.projectRoot,
    });
    return { destination, host, scope };
  });

const readScopedVoiceConfig = (scope: CliScope) =>
  Effect.gen(function* () {
    const location = yield* voiceLocation(scope);
    const path = yield* Path.Path;
    const destinationConfig = yield* readConfigFile(path.join(location.destination.root, managedConfigPath));
    const inheritedConfig =
      destinationConfig._tag === "present"
        ? destinationConfig
        : yield* readConfigFile(path.join(location.host.homeRoot, managedConfigPath));
    const config = inheritedConfig._tag === "present" ? inheritedConfig.config : defaultBagConfig;
    return { location, config };
  });

/** Install speak-response if needed and start the local worker (STT + narrate daemon). */
const enableVoiceWorker = (scope: CliScope) =>
  Effect.gen(function* () {
    const location = yield* voiceLocation(scope);
    const path = yield* Path.Path;
    const snapshot = yield* readArtifactReceiptSnapshot(path.join(location.destination.root, receiptPath));
    const current = snapshot._tag === "present" ? snapshot.receipt.features : [];
    const features = nextVoiceFeatures({ current, enabled: true });
    const destinationConfig = yield* readConfigFile(path.join(location.destination.root, managedConfigPath));
    const inheritedConfig =
      destinationConfig._tag === "present"
        ? destinationConfig
        : yield* readConfigFile(path.join(location.host.homeRoot, managedConfigPath));
    const currentConfig = inheritedConfig._tag === "present" ? inheritedConfig.config : defaultBagConfig;
    const stagedPackage = yield* stagePackage;
    const voiceInstallRequest = {
      destination: location.destination,
      host: { homeRoot: location.host.homeRoot },
      stagedPackage,
      features: { _tag: "selected" as const, ids: features },
      agents: { _tag: "detected" as const, evidence: location.host.agentEvidence },
      interaction: { _tag: "scripted" as const },
      configuration: {
        _tag: "selected" as const,
        config: { ...currentConfig, speechVoice: normalizeVoiceId(currentConfig.speechVoice) },
      },
    };

    if (snapshot._tag === "present") {
      yield* update(voiceInstallRequest);
    } else {
      yield* install(voiceInstallRequest);
    }

    const worker = yield* requireInstalledVoice(location.destination.root);
    // Supertonic prepare still needs uv for the thin TTS bridge.
    yield* requireUv;
    const sttModelHint =
      currentConfig.dictationLanguage === "he"
        ? "ivrit.ai Hebrew whisper-large-v3-turbo (ggml)"
        : "whisper.cpp large-v3-turbo";
    yield* TerminalUI.step(`preparing ${sttModelHint} + Supertonic`);
    yield* runVoice({ executable: worker, args: ["prepare"], label: "Voice preparation" });
    yield* runVoice({ executable: worker, args: ["stop"], label: "Previous voice worker" });
    yield* runVoice({ executable: worker, args: ["start"], label: "Voice worker" });
    return { location, config: currentConfig };
  });

/** Reload the installed worker after model/language changes (no-op when voice is not installed). */
const reloadVoiceWorkerIfInstalled = (scope: CliScope) =>
  Effect.gen(function* () {
    const location = yield* voiceLocation(scope);
    const path = yield* Path.Path;
    const fileSystem = yield* FileSystem.FileSystem;
    const worker = voiceBinaryPath(location.destination.root, path);
    if (!(yield* fileSystem.exists(worker))) {
      return false as const;
    }
    const { config } = yield* readScopedVoiceConfig(scope);
    yield* requireUv;
    const sttModelHint =
      config.dictationLanguage === "he"
        ? "ivrit.ai Hebrew whisper-large-v3-turbo (ggml)"
        : "whisper.cpp large-v3-turbo";
    yield* TerminalUI.step(`reloading worker with ${sttModelHint}`);
    yield* runVoice({ executable: worker, args: ["prepare"], label: "Voice preparation" });
    yield* runVoice({ executable: worker, args: ["stop"], label: "Previous voice worker" });
    yield* runVoice({ executable: worker, args: ["start"], label: "Voice worker" });
    return true as const;
  });

const stopInstalledVoiceWorker = (root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binary = voiceBinaryPath(root, path);
    if (!(yield* fileSystem.exists(binary))) {
      return false;
    }
    // `reset` kills daemons/overlays/TTS and clears pid locks; prefer it over soft stop.
    yield* runVoice({
      executable: binary,
      args: ["reset"],
      label: "Voice worker",
    });
    return true;
  });

const purgeSpeakResponseRuntime = (root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const runtimeDirectory = path.join(root, runtimePath, "speakResponse");
    if (yield* fileSystem.exists(runtimeDirectory)) {
      yield* fileSystem.remove(runtimeDirectory, { recursive: true, force: true });
    }
  });

/** Stop the worker and remove only the speak-response feature. */
const disableVoiceWorker = (scope: CliScope) =>
  Effect.gen(function* () {
    const location = yield* voiceLocation(scope);
    const path = yield* Path.Path;
    // Always kill background workers first so hooks cannot keep a live process around.
    yield* stopInstalledVoiceWorker(location.destination.root);

    const snapshot = yield* readArtifactReceiptSnapshot(path.join(location.destination.root, receiptPath));
    if (snapshot._tag === "missing" || !snapshot.receipt.features.some((feature) => feature === voiceFeatureId)) {
      // Feature already deselected, but orphans (or a stale binary) may still exist after upgrades.
      yield* purgeSpeakResponseRuntime(location.destination.root);
      return { location, alreadyOff: true as const };
    }

    yield* update({
      destination: location.destination,
      host: { homeRoot: location.host.homeRoot },
      stagedPackage: yield* stagePackage,
      features: { _tag: "selected", ids: nextVoiceFeatures({ current: snapshot.receipt.features, enabled: false }) },
      agents: { _tag: "detected", evidence: location.host.agentEvidence },
      interaction: { _tag: "scripted" },
      configuration: { _tag: "automatic" },
    });
    // Second kill while the binary may still exist: a Stop hook can race and re-spawn mid-update.
    yield* stopInstalledVoiceWorker(location.destination.root);
    // Receipt-driven restore covers receipted paths; purge residual upgrade orphans
    // (e.g. dufflebag-voice when the receipt still listed voice.py).
    yield* purgeSpeakResponseRuntime(location.destination.root);
    return { location, alreadyOff: false as const };
  });

/** Persist selected bag-config fields without changing the feature selection. */
const writeBagConfigPatch = (scope: CliScope, patch: Partial<BagConfig>) =>
  Effect.gen(function* () {
    const { location, config } = yield* readScopedVoiceConfig(scope);
    const nextConfig = { ...config, ...patch };
    const unchanged = (Object.keys(patch) as Array<keyof BagConfig>).every(
      (key) => config[key] === nextConfig[key],
    );
    if (unchanged) {
      return { location, config, changed: false as const };
    }
    const path = yield* Path.Path;
    const snapshot = yield* readArtifactReceiptSnapshot(path.join(location.destination.root, receiptPath));
    if (snapshot._tag === "present") {
      yield* update({
        destination: location.destination,
        host: { homeRoot: location.host.homeRoot },
        stagedPackage: yield* stagePackage,
        features: { _tag: "preserve" },
        agents: { _tag: "detected", evidence: location.host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "selected", config: nextConfig },
      });
    } else {
      const fileSystem = yield* FileSystem.FileSystem;
      const configPath = path.join(location.destination.root, managedConfigPath);
      const prior = yield* readConfigFile(configPath);
      const previousConfigFile =
        prior._tag === "present" ? { _tag: "priorFile" as const, bytes: prior.bytes } : { _tag: "missing" as const };
      const plan = planManagedConfig({
        scope,
        selection: { _tag: "selected", config: nextConfig },
        previousConfigFile,
      });
      if (Either.isLeft(plan)) {
        return yield* new VoiceCommandError({ issue: plan.left.message });
      }
      yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true });
      yield* fileSystem.writeFile(configPath, plan.right.managedConfigWrite.bytes);
    }
    return { location, config: nextConfig, changed: true as const };
  });

const writeSpeechResponseMode = (scope: CliScope, mode: SpeechResponseMode) =>
  writeBagConfigPatch(scope, { speechResponseMode: mode });

const holdControlHint = "Hold Control to dictate; release to finish.";
const ttsHint = "Agent responses are narrated when speech-response-mode is not off.";

// ── voice (full surface, kept for speak/refine/devin/status) ─────────────────

const onCommand = CliCommand.make(
  "on",
  {
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("voice on");
      const { location, config } = yield* enableVoiceWorker(args.scope);
      yield* TerminalUI.success(`Voice is on (${location.scope}).`);
      yield* TerminalUI.detail(holdControlHint);
      yield* TerminalUI.detail(
        isTtsNarrationEnabled(config.speechResponseMode)
          ? `TTS narration: ${config.speechResponseMode} (toggle with \`dufflebag tts on|off\`).`
          : "TTS narration: off (enable with `dufflebag tts on`).",
      );
      if (config.promptRefinementMode === "review") {
        yield* TerminalUI.detail("Double-tap Control to refine the copied prompt, then press ⌘V to paste it.");
      }
      yield* TerminalUI.outro("Ready.");
    }),
).pipe(CliCommand.withDescription("Install and start local voice (STT worker; TTS follows speech-response-mode)"));

const offCommand = CliCommand.make(
  "off",
  {
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("voice off");
      const { location, alreadyOff } = yield* disableVoiceWorker(args.scope);
      yield* TerminalUI.success(
        alreadyOff ? `Voice is already off (${location.scope}).` : `Voice is off (${location.scope}).`,
      );
      yield* TerminalUI.outro("Done.");
    }),
).pipe(CliCommand.withDescription("Stop voice and remove only the voice feature"));

const statusCommand = CliCommand.make(
  "status",
  {
    scope: scopeOption,
    format: formatOption,
  },
  (args) =>
    Effect.gen(function* () {
      if (args.format === "text") yield* TerminalUI.intro("voice status");
      const { location, config } = yield* readScopedVoiceConfig(args.scope);
      const path = yield* Path.Path;
      const snapshot = yield* readArtifactReceiptSnapshot(path.join(location.destination.root, receiptPath));
      const installed =
        snapshot._tag === "present" && snapshot.receipt.features.some((feature) => feature === voiceFeatureId);
      if (!installed) {
        if (args.format === "json") {
          yield* TerminalUI.json({
            installed: false,
            scope: location.scope,
            stt: "off",
            tts: config.speechResponseMode,
          });
        } else {
          yield* TerminalUI.note(
            `feature  off\nscope    ${location.scope}\nstt      off\ntts      ${config.speechResponseMode}`,
            "Voice",
          );
          yield* TerminalUI.outro("Enable with `dufflebag stt on` (dictation) or `dufflebag tts on` (narration).");
        }
        return;
      }

      const worker = yield* requireInstalledVoice(location.destination.root);
      const status = yield* PlatformCommand.string(withProcessEnv(PlatformCommand.make(worker, "status")));
      if (args.format === "json") {
        yield* TerminalUI.json({
          installed: true,
          scope: location.scope,
          stt: "on",
          tts: config.speechResponseMode,
          worker: status.trim(),
        });
      } else {
        yield* TerminalUI.note(
          `feature  on\nscope    ${location.scope}\nstt      on\ntts      ${config.speechResponseMode}\nworker   ${status.trim()}`,
          "Voice",
        );
        yield* TerminalUI.outro(`${holdControlHint} Toggle TTS with \`dufflebag tts on|off\`.`);
      }
    }),
).pipe(CliCommand.withDescription("Show install, worker, STT, and TTS state"));

const speakCommand = CliCommand.make(
  "speak",
  {
    text: textArgument,
    source: sourceOption,
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      const location = yield* voiceLocation(args.scope);
      const worker = yield* requireInstalledVoice(location.destination.root);
      yield* runVoice({
        executable: worker,
        args: ["speak", "--text", args.text, "--source", args.source],
        label: "Voice narration",
      });
    }),
).pipe(CliCommand.withDescription("Read one complete Markdown response aloud"));

const refineCommand = CliCommand.make(
  "refine",
  {
    prompt: promptArgument,
    speak: speakRefinementOption,
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      const location = yield* voiceLocation(args.scope);
      const worker = yield* requireInstalledVoice(location.destination.root);
      yield* runVoice({
        executable: worker,
        args: ["refine", "--text", args.prompt, ...(args.speak ? ["--speak"] : [])],
        label: "Prompt refinement",
      });
    }),
).pipe(CliCommand.withDescription("Refine one prompt with Apple's local on-device model"));

const devinCommand = CliCommand.make(
  "devin",
  {
    arguments: devinArguments,
    scope: scopeOption,
  },
  (args) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TerminalUI.intro("voice devin");
        const location = yield* voiceLocation(args.scope);
        const worker = yield* requireInstalledVoice(location.destination.root);
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sessionRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-devin-voice-" });
        const exportPath = path.join(sessionRoot, "session.atif.json");
        const watcherCommand = inheritedCommand(worker, ["watch-devin", "--path", exportPath]);
        const watcher = yield* Effect.acquireRelease(
          PlatformCommand.start(watcherCommand),
          (process) => process.kill().pipe(Effect.catchAll(() => Effect.void)),
        );
        yield* TerminalUI.detail(`Watching Devin's official ATIF export (watcher ${String(watcher.pid)}).`);
        yield* requireSuccess(inheritedCommand("devin", ["--export", exportPath, ...args.arguments]), "Devin");
        yield* TerminalUI.outro("Devin session ended; voice watcher stopped.");
      }),
    ),
).pipe(CliCommand.withDescription("Run Devin and narrate complete turns from its official ATIF export"));

export const voiceCommand = CliCommand.make("voice").pipe(
  CliCommand.withDescription("Natural local response narration and caret dictation"),
  CliCommand.withSubcommands([onCommand, offCommand, statusCommand, speakCommand, refineCommand, devinCommand]),
);

// ── stt (dictation / hold-Control) ───────────────────────────────────────────

const sttOnCommand = CliCommand.make(
  "on",
  {
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("stt on");
      const { location, config } = yield* enableVoiceWorker(args.scope);
      yield* TerminalUI.success(`STT is on (${location.scope}).`);
      yield* TerminalUI.detail(holdControlHint);
      if (!isTtsNarrationEnabled(config.speechResponseMode)) {
        yield* TerminalUI.detail("TTS is off — agent replies stay silent. Enable with `dufflebag tts on`.");
      } else {
        yield* TerminalUI.detail(`TTS narration mode: ${config.speechResponseMode}.`);
      }
      yield* TerminalUI.outro("Ready.");
    }),
).pipe(CliCommand.withDescription("Install and start local dictation (hold Control to speak)"));

const sttOffCommand = CliCommand.make(
  "off",
  {
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("stt off");
      const { location, alreadyOff } = yield* disableVoiceWorker(args.scope);
      yield* TerminalUI.success(
        alreadyOff ? `STT is already off (${location.scope}).` : `STT is off (${location.scope}).`,
      );
      yield* TerminalUI.detail("Stopped the voice worker (dictation and live narration).");
      yield* TerminalUI.outro("Done.");
    }),
).pipe(CliCommand.withDescription("Stop dictation and remove the local voice worker"));

const micOffDelayMilliseconds = Args.integer({ name: "milliseconds" }).pipe(
  Args.withDescription("Milliseconds to keep the mic open after Control is released (0–2000)"),
  Args.optional,
);

const sttMicOffDelayCommand = CliCommand.make(
  "mic-off-delay",
  {
    milliseconds: micOffDelayMilliseconds,
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("stt mic-off-delay");
      if (Option.isNone(args.milliseconds)) {
        const { location, config } = yield* readScopedVoiceConfig(args.scope);
        yield* TerminalUI.note(
          `scope              ${location.scope}\nmic-off-delay (ms)  ${String(config.dictationMicOffDelayMs)}`,
          "dictation release tail",
        );
        yield* TerminalUI.detail(
          "After you release Control, the mic stays open this long so trailing words are not clipped.",
        );
        yield* TerminalUI.outro("Set with `dufflebag stt mic-off-delay <milliseconds>` (0–2000).");
        return;
      }

      const milliseconds = args.milliseconds.value;
      if (milliseconds < 0 || milliseconds > 2000) {
        return yield* new VoiceCommandError({
          issue: "mic-off-delay must be between 0 and 2000 milliseconds.",
        });
      }

      const { location, config, changed } = yield* writeBagConfigPatch(args.scope, {
        dictationMicOffDelayMs: milliseconds,
      });
      yield* TerminalUI.success(
        changed
          ? `mic-off-delay → ${String(config.dictationMicOffDelayMs)} ms (${location.scope}).`
          : `mic-off-delay already ${String(config.dictationMicOffDelayMs)} ms (${location.scope}).`,
      );
      yield* TerminalUI.detail("Applied on the next Control release (no worker restart needed).");
      yield* TerminalUI.outro("Done.");
    }),
).pipe(
  CliCommand.withDescription(
    "Show or set post-release mic open time in ms (catches trailing words; default 200)",
  ),
);

const dictationLanguageArgument = Args.text({ name: "language" }).pipe(
  Args.withDescription("Dictation language: en | he (aliases: english, hebrew, ivrit, lang=he)"),
  Args.optional,
);

const sttLangCommand = CliCommand.make(
  "lang",
  {
    language: dictationLanguageArgument,
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("stt lang");
      if (Option.isNone(args.language)) {
        const { location, config } = yield* readScopedVoiceConfig(args.scope);
        const model =
          config.dictationLanguage === "he"
            ? "ivrit.ai whisper-large-v3-turbo ggml"
            : "whisper.cpp large-v3-turbo (default)";
        yield* TerminalUI.note(
          `scope     ${location.scope}\nlang      ${config.dictationLanguage}\nmodel     ${model}`,
          "dictation language",
        );
        yield* TerminalUI.detail("Hebrew (he) downloads/loads the ivrit.ai ggml model on next prepare/start.");
        yield* TerminalUI.outro("Set with `dufflebag stt lang he` or `dufflebag stt lang en`.");
        return;
      }

      const normalized = normalizeDictationLanguage(args.language.value);
      if (normalized === null) {
        return yield* new VoiceCommandError({
          issue: `Unknown dictation language "${args.language.value}". Use en or he (aliases: english, hebrew, ivrit).`,
        });
      }

      const { location, config, changed } = yield* writeBagConfigPatch(args.scope, {
        dictationLanguage: normalized,
      });
      const model =
        config.dictationLanguage === "he"
          ? "ivrit.ai whisper-large-v3-turbo ggml"
          : "whisper.cpp large-v3-turbo (default)";
      yield* TerminalUI.success(
        changed
          ? `lang → ${config.dictationLanguage} (${location.scope}); model: ${model}.`
          : `lang already ${config.dictationLanguage} (${location.scope}); model: ${model}.`,
      );

      if (changed) {
        const reloaded = yield* reloadVoiceWorkerIfInstalled(args.scope);
        if (reloaded) {
          yield* TerminalUI.detail("Worker reloaded so the matching STT model is in memory.");
        } else {
          yield* TerminalUI.detail("Voice worker not installed yet — model applies on `dufflebag stt on`.");
        }
      } else {
        yield* TerminalUI.detail("No config change; worker left as-is.");
      }
      yield* TerminalUI.outro("Done.");
    }),
).pipe(
  CliCommand.withDescription(
    "Show or set dictation language (en default; he = ivrit.ai Hebrew model)",
  ),
);

export const sttCommand = CliCommand.make("stt").pipe(
  CliCommand.withDescription("Speech-to-text dictation (hold Control)"),
  CliCommand.withSubcommands([sttOnCommand, sttOffCommand, sttMicOffDelayCommand, sttLangCommand]),
);

// ── tts (agent response narration) ───────────────────────────────────────────

const ttsOnCommand = CliCommand.make(
  "on",
  {
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("tts on");
      // Narration needs the speak-response feature + worker inbox; STT rides along.
      const { location } = yield* enableVoiceWorker(args.scope);
      const { config, changed } = yield* writeSpeechResponseMode(args.scope, "auto");
      yield* TerminalUI.success(
        changed
          ? `TTS is on (${location.scope}) — speech-response-mode → auto.`
          : `TTS is on (${location.scope}) — speech-response-mode already ${config.speechResponseMode}.`,
      );
      yield* TerminalUI.detail(ttsHint);
      yield* TerminalUI.detail(`${holdControlHint} (STT is available while the worker runs.)`);
      yield* TerminalUI.outro("Ready.");
    }),
).pipe(CliCommand.withDescription("Enable agent response narration (speech-response-mode auto)"));

const ttsOffCommand = CliCommand.make(
  "off",
  {
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("tts off");
      const { location, changed } = yield* writeSpeechResponseMode(args.scope, "off");
      yield* TerminalUI.success(
        changed
          ? `TTS is off (${location.scope}) — speech-response-mode → off.`
          : `TTS is already off (${location.scope}).`,
      );
      yield* TerminalUI.detail(
        "Dictation is unchanged. Turn STT off with `dufflebag stt off` if you want the worker stopped too.",
      );
      yield* TerminalUI.outro("Done.");
    }),
).pipe(CliCommand.withDescription("Disable agent response narration without stopping dictation"));

export const ttsCommand = CliCommand.make("tts").pipe(
  CliCommand.withDescription("Text-to-speech response narration"),
  CliCommand.withSubcommands([ttsOnCommand, ttsOffCommand]),
);
