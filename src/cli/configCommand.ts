/**
 * `dufflebag config` — show or set managed configuration tunables.
 *
 * Show reads the managed config file (or schema defaults). Set decodes a
 * partial patch through bagConfigSchema. When an ownership receipt exists,
 * set reconciles through `update` with the selected config so the receipt
 * re-syncs. Without a receipt, set writes the managed config file directly
 * (pre-install tuning).
 */

import { Command, Options } from "@effect/cli";
import { FileSystem, Path } from "@effect/platform";
import { Effect, Either, Option, Schema } from "effect";

import { bagConfigSchema, defaultBagConfig } from "../config/bagConfigSchema.js";
import { readConfigFile } from "../config/configFile.js";
import { managedConfigPath, planManagedConfig } from "../config/configure.js";
import { readArtifactReceiptSnapshot } from "../install/artifactReceipt.js";
import { receiptPath } from "../install/install.js";
import { update } from "../install/update.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { globalOption, projectOption, resolveScope } from "./scopeOptions.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

const warnFractionOption = Options.float("warn").pipe(
  Options.optional,
  Options.withDescription("Context occupancy fraction that starts warning for a handoff"),
);

const blockFractionOption = Options.float("block").pipe(
  Options.optional,
  Options.withDescription("Context occupancy fraction that blocks new code edits"),
);

const budgetOption = Options.integer("budget").pipe(
  Options.optional,
  Options.withDescription("Autorun cycle budget used when no count is provided"),
);

const hardCapOption = Options.integer("hard-cap").pipe(
  Options.optional,
  Options.withDescription("Hard upper limit for an autorun cycle budget"),
);

const pollOption = Options.integer("poll").pipe(Options.optional, Options.withDescription("Seconds between autorun daemon observations"));

const idleOption = Options.integer("idle").pipe(
  Options.optional,
  Options.withDescription("Seconds without activity before autorun treats a turn as idle"),
);

const ttsVoiceOption = Options.text("tts-voice").pipe(
  Options.optional,
  Options.withDescription("macOS speech voice name; empty selects the system default"),
);

const ttsRateOption = Options.integer("tts-rate").pipe(
  Options.optional,
  Options.withDescription("Speech response rate in words per minute"),
);

const dedupModes: ReadonlyArray<"deny" | "warn" | "off"> = ["deny", "warn", "off"];

const dedupModeOption = Options.choice("dedup-mode", dedupModes).pipe(
  Options.optional,
  Options.withDescription("Duplicate-code enforcement mode"),
);

const dedupSkipOption = Options.text("dedup-skip").pipe(
  Options.optional,
  Options.withDescription("Comma-separated directories excluded from duplicate-code enforcement"),
);

const assignOptional = <Value>(target: Record<string, unknown>, key: string, value: Option.Option<Value>): void => {
  if (Option.isSome(value)) {
    target[key] = value.value;
  }
};

const buildConfigPatch = (args: {
  warn: Option.Option<number>;
  block: Option.Option<number>;
  budget: Option.Option<number>;
  hardCap: Option.Option<number>;
  poll: Option.Option<number>;
  idle: Option.Option<number>;
  ttsVoice: Option.Option<string>;
  ttsRate: Option.Option<number>;
  dedupMode: Option.Option<"deny" | "warn" | "off">;
  dedupSkip: Option.Option<string>;
}): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  assignOptional(patch, "contextWarnFraction", args.warn);
  assignOptional(patch, "contextBlockFraction", args.block);
  assignOptional(patch, "autorunDefaultCycleCount", args.budget);
  assignOptional(patch, "autorunMaxCycleCount", args.hardCap);
  assignOptional(patch, "autorunPollIntervalSeconds", args.poll);
  assignOptional(patch, "autorunIdleThresholdSeconds", args.idle);
  assignOptional(patch, "speechVoice", args.ttsVoice);
  assignOptional(patch, "speechWordsPerMinute", args.ttsRate);
  assignOptional(patch, "dedupEnforcement", args.dedupMode);
  assignOptional(patch, "dedupSkipDirectories", args.dedupSkip);
  return patch;
};

const CONFIG_LABELS: Record<keyof typeof defaultBagConfig, string> = {
  contextWarnFraction: "context warn (nudge /handoff)",
  contextBlockFraction: "context block (deny edits)",
  autorunDefaultCycleCount: "autorun default cycles",
  autorunMaxCycleCount: "autorun max cycles",
  autorunPollIntervalSeconds: "autorun poll interval (s)",
  autorunIdleThresholdSeconds: "autorun idle threshold (s)",
  idleAutoCompact: "idle auto-compact (off|duration)",
  speechVoice: "speech voice",
  speechWordsPerMinute: "speech rate (wpm)",
  dedupEnforcement: "dedup enforcement (deny|warn|off)",
  dedupSkipDirectories: "dedup skip directories",
  debugEnabled: "debug logging",
};

type ConfigKey = keyof typeof defaultBagConfig;

export const configCommand = Command.make(
  "config",
  {
    project: projectOption,
    global: globalOption,
    warn: warnFractionOption,
    block: blockFractionOption,
    budget: budgetOption,
    hardCap: hardCapOption,
    poll: pollOption,
    idle: idleOption,
    ttsVoice: ttsVoiceOption,
    ttsRate: ttsRateOption,
    dedupMode: dedupModeOption,
    dedupSkip: dedupSkipOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("config");
      const scope = yield* resolveScope(args);
      const host = yield* captureHostEvidence;
      const destination = destinationForScope({
        scope,
        homeRoot: host.homeRoot,
        projectRoot: host.projectRoot,
      });
      const path = yield* Path.Path;
      const fileSystem = yield* FileSystem.FileSystem;
      const configPath = path.join(destination.root, managedConfigPath);
      const snapshot = yield* readConfigFile(configPath);
      const current = snapshot._tag === "present" ? snapshot.config : defaultBagConfig;
      const patch = buildConfigPatch(args);

      const configKeys: ReadonlyArray<ConfigKey> = [
        "contextWarnFraction",
        "contextBlockFraction",
        "autorunDefaultCycleCount",
        "autorunMaxCycleCount",
        "autorunPollIntervalSeconds",
        "autorunIdleThresholdSeconds",
        "speechVoice",
        "speechWordsPerMinute",
        "dedupEnforcement",
        "dedupSkipDirectories",
        "debugEnabled",
      ];

      if (Object.keys(patch).length === 0) {
        const rows = configKeys.map((key) => `${CONFIG_LABELS[key].padEnd(34)} ${String(current[key])}`);
        yield* TerminalUI.note(rows.join("\n"), "managed config");
        yield* TerminalUI.outro("Change with e.g. `dufflebag config --warn 0.15 --budget 5`");
        return;
      }

      const nextConfig = yield* Schema.decodeUnknown(bagConfigSchema, {
        onExcessProperty: "error",
      })({
        ...current,
        ...patch,
      }).pipe(Effect.mapError((error) => new Error(`Invalid configuration values: ${String(error)}`)));

      const previousConfigFile: { _tag: "priorFile"; bytes: Uint8Array } | { _tag: "missing" } =
        snapshot._tag === "present" ? { _tag: "priorFile", bytes: snapshot.bytes } : { _tag: "missing" };

      const receiptSnapshot = yield* readArtifactReceiptSnapshot(path.join(destination.root, receiptPath));

      if (receiptSnapshot._tag === "present") {
        if (receiptSnapshot.receipt.scope !== scope) {
          return yield* TerminalUI.presentError(
            new Error(
              `Receipt scope is ${receiptSnapshot.receipt.scope}, but config was requested for ${scope}. Use the matching --project/--global flag.`,
            ),
          );
        }

        // Receipt-aware path: full reconcile so managed-config ownership stays in the receipt.
        const stagedPackage = yield* stagePackage;
        yield* update({
          destination,
          host: { homeRoot: host.homeRoot },
          stagedPackage,
          features: { _tag: "preserve" },
          agents: { _tag: "detected", evidence: host.agentEvidence },
          interaction: { _tag: "scripted" },
          configuration: { _tag: "selected", config: nextConfig },
        });
      } else {
        // Pre-install path: write managed config only (no receipt to re-sync).
        const plan = planManagedConfig({
          scope,
          selection: { _tag: "selected", config: nextConfig },
          previousConfigFile,
        });

        if (Either.isLeft(plan)) {
          return yield* TerminalUI.presentError(plan.left);
        }

        yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true });
        yield* fileSystem.writeFile(configPath, plan.right.managedConfigWrite.bytes);
      }

      // Report each changed key from the applied patch.
      for (const key of configKeys) {
        if (Object.hasOwn(patch, key)) {
          yield* TerminalUI.success(`${CONFIG_LABELS[key]} → ${String(nextConfig[key])}`);
        }
      }
      yield* TerminalUI.outro(receiptSnapshot._tag === "present" ? "Saved and receipt re-synced." : "Saved.");
    }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(Command.withDescription("Show or change tunables (warn %, budget, TTS, …)"));
