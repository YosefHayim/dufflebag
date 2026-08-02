/** `dufflebag voice` — tiny lifecycle and Devin adapters for local voice. */

import { Args, Command as CliCommand, Options } from "@effect/cli";
import { FileSystem, Path, Command as PlatformCommand } from "@effect/platform";
import { Effect, Schema } from "effect";

import { featureCatalog } from "../catalog/featureCatalog.js";
import { defaultBagConfig } from "../config/bagConfigSchema.js";
import { readConfigFile } from "../config/configFile.js";
import { managedConfigPath } from "../config/configure.js";
import { readArtifactReceiptSnapshot } from "../install/artifactReceipt.js";
import { install, receiptPath, runtimePath } from "../install/install.js";
import { update } from "../install/update.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { type CliScope, formatOption, scopeOption } from "./scopeOptions.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

const voiceFeatureId = "speak-response";
type VoiceSource = "claude-code" | "codex" | "grok" | "devin" | "manual";

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

const inheritedCommand = (executable: string, args: ReadonlyArray<string>) =>
  PlatformCommand.make(executable, ...args).pipe(
    PlatformCommand.stdin("inherit"),
    PlatformCommand.stdout("inherit"),
    PlatformCommand.stderr("inherit"),
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

const requireUv = requireSuccess(PlatformCommand.make("uv", "--version"), "uv");

const voiceScriptPath = (root: string, path: Path.Path) => path.join(root, runtimePath, "speakResponse", "voice.py");

const requireInstalledVoice = (root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const script = voiceScriptPath(root, path);
    if (!(yield* fileSystem.exists(script))) {
      return yield* new VoiceCommandError({ issue: "Voice is not installed here. Run `dufflebag voice on` first." });
    }
    return script;
  });

const runVoice = (invocation: { script: string; args: ReadonlyArray<string>; label: string }) =>
  requireSuccess(
    inheritedCommand("uv", ["run", "--frozen", "--script", invocation.script, ...invocation.args]),
    invocation.label,
  );

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

const onCommand = CliCommand.make(
  "on",
  {
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("voice on");
      yield* requireUv;
      const location = yield* voiceLocation(args.scope);
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
        features: { _tag: "selected", ids: features },
        agents: { _tag: "detected", evidence: location.host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration: {
          _tag: "selected",
          config: { ...currentConfig, speechVoice: normalizeVoiceId(currentConfig.speechVoice) },
        },
      };

      if (snapshot._tag === "present") {
        yield* update(voiceInstallRequest);
      } else {
        yield* install(voiceInstallRequest);
      }

      const script = yield* requireInstalledVoice(location.destination.root);
      yield* TerminalUI.step("preparing pinned local speech models");
      yield* runVoice({ script, args: ["prepare"], label: "Voice preparation" });
      yield* runVoice({ script, args: ["stop"], label: "Previous voice worker" });
      yield* runVoice({ script, args: ["start"], label: "Voice worker" });
      yield* TerminalUI.success(`Voice is on (${location.scope}).`);
      yield* TerminalUI.detail("Tap Control to stop narration; hold it to dictate; release it to finish.");
      if (currentConfig.promptRefinementMode === "review") {
        yield* TerminalUI.detail("Double-tap Control to refine the copied prompt, then press ⌘V to paste it.");
      }

      yield* TerminalUI.outro("Ready.");
    }),
).pipe(CliCommand.withDescription("Install and start local voice"));

const offCommand = CliCommand.make(
  "off",
  {
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("voice off");
      const location = yield* voiceLocation(args.scope);
      const path = yield* Path.Path;
      const fileSystem = yield* FileSystem.FileSystem;
      const script = voiceScriptPath(location.destination.root, path);
      if (yield* fileSystem.exists(script)) {
        yield* requireUv;
        yield* runVoice({ script, args: ["stop"], label: "Voice worker" });
      }

      const snapshot = yield* readArtifactReceiptSnapshot(path.join(location.destination.root, receiptPath));
      if (snapshot._tag === "missing" || !snapshot.receipt.features.some((feature) => feature === voiceFeatureId)) {
        yield* TerminalUI.success(`Voice is already off (${location.scope}).`);
        yield* TerminalUI.outro("Done.");
        return;
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
      yield* TerminalUI.success(`Voice is off (${location.scope}).`);
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
      const location = yield* voiceLocation(args.scope);
      const path = yield* Path.Path;
      const snapshot = yield* readArtifactReceiptSnapshot(path.join(location.destination.root, receiptPath));
      const installed =
        snapshot._tag === "present" && snapshot.receipt.features.some((feature) => feature === voiceFeatureId);
      if (!installed) {
        if (args.format === "json") yield* TerminalUI.json({ installed: false, scope: location.scope });
        else {
          yield* TerminalUI.note(`feature  off\nscope    ${location.scope}`, "Voice");
          yield* TerminalUI.outro("Enable with `dufflebag voice on`.");
        }
        return;
      }

      yield* requireUv;
      const script = yield* requireInstalledVoice(location.destination.root);
      const status = yield* PlatformCommand.string(
        PlatformCommand.make("uv", "run", "--frozen", "--script", script, "status"),
      );
      if (args.format === "json")
        yield* TerminalUI.json({ installed: true, scope: location.scope, worker: status.trim() });
      else {
        yield* TerminalUI.note(`feature  on\nscope    ${location.scope}\nworker   ${status.trim()}`, "Voice");
        yield* TerminalUI.outro("Tap Control to stop narration; hold it to dictate; release it to finish.");
      }
    }),
).pipe(CliCommand.withDescription("Show install, worker, and dictation state"));

const speakCommand = CliCommand.make(
  "speak",
  {
    text: textArgument,
    source: sourceOption,
    scope: scopeOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* requireUv;
      const location = yield* voiceLocation(args.scope);
      const script = yield* requireInstalledVoice(location.destination.root);
      yield* runVoice({
        script,
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
      yield* requireUv;
      const location = yield* voiceLocation(args.scope);
      const script = yield* requireInstalledVoice(location.destination.root);
      yield* runVoice({
        script,
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
        yield* requireUv;
        const location = yield* voiceLocation(args.scope);
        const script = yield* requireInstalledVoice(location.destination.root);
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sessionRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-devin-voice-" });
        const exportPath = path.join(sessionRoot, "session.atif.json");
        const watcher = yield* Effect.acquireRelease(
          PlatformCommand.start(
            inheritedCommand("uv", ["run", "--frozen", "--script", script, "watch-devin", "--path", exportPath]),
          ),
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
