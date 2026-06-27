#!/usr/bin/env node
/**
 * skills-bag CLI entry point.
 *
 * Command structure + help/version are handled by commander; the interactive
 * UX (spinners, prompts, multiselect) lives in the command modules via the
 * @clack/prompts wrapper. Scope defaults to global; `--project` targets
 * ./.claude.
 */

import path from "node:path";

import { Command } from "commander";

import { config } from "./commands/config.js";
import { doctor } from "./commands/doctor.js";
import { install } from "./commands/install.js";
import { uninstall } from "./commands/uninstall.js";
import { parseNumber } from "./core/env-config.js";
import { packageRoot, readJson } from "./core/fs-utils.js";
import { fail } from "./core/ui.js";
import type { BagConfig, FeatureId, Scope } from "./core/types.js";

const VERSION = readJson<{ version: string }>(path.join(packageRoot(), "package.json"))?.version ?? "0.0.0";

interface ScopeOpts {
  project?: boolean;
  global?: boolean;
}
const scopeOf = (opts: ScopeOpts): Scope => (opts.project ? "project" : "global");

const parseFeatures = (raw: unknown): FeatureId[] | undefined =>
  typeof raw === "string"
    ? (raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as FeatureId[])
    : undefined;

/** Collect the numeric/string config flags actually passed into a BagConfig patch. */
function configPatch(opts: Record<string, unknown>): Partial<BagConfig> {
  const patch: Partial<BagConfig> = {};
  const num = (flag: string, key: keyof BagConfig): void => {
    const parsed = parseNumber(opts[flag] as string | undefined);
    if (parsed != null) (patch[key] as number) = parsed;
  };
  num("warn", "warnPct");
  num("block", "blockPct");
  num("budget", "defaultBudget");
  num("hardCap", "hardCap");
  num("poll", "pollSeconds");
  num("idle", "idleSeconds");
  num("ttsRate", "ttsRate");
  if (typeof opts.ttsVoice === "string") patch.ttsVoice = opts.ttsVoice;
  return patch;
}

const program = new Command();

program
  .name("skills-bag")
  .description("Install a personal bag of Claude Code skills & hooks (context guard, autonomous loop, TTS).")
  .version(VERSION, "-v, --version");

const withScope = (cmd: Command): Command =>
  cmd.option("--global", "target ~/.claude (default)").option("--project", "target ./.claude (committable, per-repo)");

withScope(program.command("install"))
  .description("Install (or re-run to refresh) the selected features")
  .option("--features <list>", "comma list: context-guard, autonomous-loop, speak-response")
  .option("-y, --yes", "skip prompts (CI / scripted)")
  .action(async (opts) => {
    await install({ scope: scopeOf(opts), features: parseFeatures(opts.features), assumeYes: Boolean(opts.yes) });
  });

withScope(program.command("update"))
  .description("Refresh hook code, keep your features + config")
  .option("--features <list>", "override the installed feature set")
  .option("-y, --yes", "skip prompts")
  .action(async (opts) => {
    await install({ scope: scopeOf(opts), features: parseFeatures(opts.features), assumeYes: Boolean(opts.yes), isUpdate: true });
  });

withScope(program.command("uninstall"))
  .description("Surgically remove everything skills-bag added")
  .action((opts) => uninstall({ scope: scopeOf(opts) }));

withScope(program.command("config"))
  .description("Show or change tunables (warn %, budget, TTS, …)")
  .option("--warn <0-1>", "nudge-to-handoff threshold")
  .option("--block <0-1>", "hard-deny-edits threshold")
  .option("--budget <n>", "default autorun cycles")
  .option("--hard-cap <n>", "max autorun cycles (anti-runaway)")
  .option("--poll <s>", "daemon poll interval")
  .option("--idle <s>", "daemon idle gate")
  .option("--tts-voice <name>", "macOS `say` voice")
  .option("--tts-rate <n>", "TTS words per minute")
  .action((opts) => config({ scope: scopeOf(opts), patch: configPatch(opts) }));

program
  .command("doctor")
  .description("Read-only health check across global + project scopes")
  .action(() => doctor());

program.parseAsync(process.argv).catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
