/** `dufflebag voice` — tiny lifecycle and Devin adapters for local voice. */

import { Args, Command as CliCommand, Options } from "@effect/cli";
import { FileSystem, Path, Command as PlatformCommand } from "@effect/platform";
import { Effect, Option, Schema } from "effect";

import { featureCatalog } from "../catalog/featureCatalog.js";
import { defaultBagConfig } from "../config/bagConfigSchema.js";
import { readConfigFile } from "../config/configFile.js";
import { managedConfigPath } from "../config/configure.js";
import { readArtifactReceiptSnapshot } from "../install/artifactReceipt.js";
import { install, receiptPath, runtimePath } from "../install/install.js";
import { update } from "../install/update.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { globalOption, projectOption, resolveScope } from "./scopeOptions.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

const voiceFeatureId = "speak-response";
type VoiceAgent = "claude-code" | "codex" | "grok" | "devin";

const voiceAgents: ReadonlyArray<[string, VoiceAgent]> = [
  ["claude", "claude-code"],
  ["claude-code", "claude-code"],
  ["codex", "codex"],
  ["grok", "grok"],
  ["devin", "devin"],
];

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

const agentArgument = Args.choice<VoiceAgent>(voiceAgents, { name: "agent" }).pipe(
  Args.optional,
  Args.withDescription("Response source: claude, codex, grok, or devin"),
);

const exampleOption = Options.text("example").pipe(
  Options.optional,
  Options.withDescription("Speak this text immediately after enabling voice"),
);

const exampleSources: ReadonlyArray<VoiceAgent | "example"> = ["claude-code", "codex", "grok", "devin", "example"];

const sourceOption = Options.choice("source", exampleSources).pipe(
  Options.withDefault("example"),
  Options.withDescription("Agent label shown for this spoken example"),
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
    Effect.mapError((error) =>
      error instanceof VoiceCommandError
        ? error
        : new VoiceCommandError({
            issue: `${label} could not start: ${error instanceof Error ? error.message : String(error)}`,
          }),
    ),
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

const voiceLocation = (scopeArgs: { project: boolean; global: boolean }) =>
  Effect.gen(function* () {
    const scope = yield* resolveScope(scopeArgs);
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
    agent: agentArgument,
    example: exampleOption,
    project: projectOption,
    global: globalOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("voice on");
      yield* requireUv;
      const location = yield* voiceLocation(args);
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

      if (Option.isSome(args.example)) {
        const source = Option.getOrElse(args.agent, () => "example");
        yield* TerminalUI.step(`speaking ${source} example`);
        yield* runVoice({
          script,
          args: ["example", "--text", args.example.value, "--source", source],
          label: "Voice example",
        });
      }

      if (Option.isSome(args.agent) && args.agent.value === "devin") {
        yield* TerminalUI.detail("Run Devin through `dufflebag voice devin` to narrate every completed turn.");
      }
      yield* TerminalUI.outro("Ready.");
    }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(CliCommand.withDescription("Install/start voice; optionally play --example text"));

const offCommand = CliCommand.make(
  "off",
  {
    project: projectOption,
    global: globalOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("voice off");
      const location = yield* voiceLocation(args);
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
    }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(CliCommand.withDescription("Stop voice and remove only the voice feature"));

const statusCommand = CliCommand.make(
  "status",
  {
    project: projectOption,
    global: globalOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("voice status");
      const location = yield* voiceLocation(args);
      const path = yield* Path.Path;
      const snapshot = yield* readArtifactReceiptSnapshot(path.join(location.destination.root, receiptPath));
      const installed =
        snapshot._tag === "present" && snapshot.receipt.features.some((feature) => feature === voiceFeatureId);
      if (!installed) {
        yield* TerminalUI.note(`feature  off\nscope    ${location.scope}`, "Voice");
        yield* TerminalUI.outro("Enable with `dufflebag voice on`.");
        return;
      }

      yield* requireUv;
      const script = yield* requireInstalledVoice(location.destination.root);
      const status = yield* PlatformCommand.string(
        PlatformCommand.make("uv", "run", "--frozen", "--script", script, "status"),
      );
      yield* TerminalUI.note(`feature  on\nscope    ${location.scope}\nworker   ${status.trim()}`, "Voice");
      yield* TerminalUI.outro("Tap Control to stop narration; hold it to dictate; release it to finish.");
    }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(CliCommand.withDescription("Show install, worker, and dictation state"));

const exampleCommand = CliCommand.make(
  "example",
  {
    text: textArgument,
    source: sourceOption,
    project: projectOption,
    global: globalOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* requireUv;
      const location = yield* voiceLocation(args);
      const script = yield* requireInstalledVoice(location.destination.root);
      yield* runVoice({
        script,
        args: ["example", "--text", args.text, "--source", args.source],
        label: "Voice example",
      });
    }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(CliCommand.withDescription("Read one complete Markdown response aloud"));

const refineCommand = CliCommand.make(
  "refine",
  {
    prompt: promptArgument,
    speak: speakRefinementOption,
    project: projectOption,
    global: globalOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* requireUv;
      const location = yield* voiceLocation(args);
      const script = yield* requireInstalledVoice(location.destination.root);
      yield* runVoice({
        script,
        args: ["refine", "--text", args.prompt, ...(args.speak ? ["--speak"] : [])],
        label: "Prompt refinement",
      });
    }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(CliCommand.withDescription("Refine one prompt with Apple's local on-device model"));

const devinCommand = CliCommand.make(
  "devin",
  {
    arguments: devinArguments,
    project: projectOption,
    global: globalOption,
  },
  (args) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TerminalUI.intro("voice devin");
        yield* requireUv;
        const location = yield* voiceLocation(args);
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
      }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
    ),
).pipe(CliCommand.withDescription("Run Devin and narrate complete turns from its official ATIF export"));

export const voiceCommand = CliCommand.make("voice").pipe(
  CliCommand.withDescription("Natural local response narration and caret dictation"),
  CliCommand.withSubcommands([onCommand, offCommand, statusCommand, exampleCommand, refineCommand, devinCommand]),
);
