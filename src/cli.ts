#!/usr/bin/env node
/**
 * dufflebag CLI entry point.
 *
 * Command structure + help/version are handled by commander; the interactive
 * UX (spinners, prompts, multiselect) lives in the command modules via the
 * @clack/prompts wrapper. Scope defaults to global; `--project` targets
 * ./.claude.
 */

import path from "node:path";

import { Command } from "commander";

import { config, dedupCheck, doctor, install, menu, scaffoldCi, uninstall } from "./commands/index.js";
import type { BagConfig, FeatureId, Scope } from "./core/index.js";
import { DEDUP_MODES, fail, isDedupMode, packageRoot, parseNumber, readJson } from "./core/index.js";

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
  num("warn", "contextWarnFraction");
  num("block", "contextBlockFraction");
  num("budget", "autorunDefaultCycleCount");
  num("hardCap", "autorunMaxCycleCount");
  num("poll", "autorunPollIntervalSeconds");
  num("idle", "autorunIdleThresholdSeconds");
  num("ttsRate", "speechWordsPerMinute");
  if (typeof opts.ttsVoice === "string") patch.speechVoice = opts.ttsVoice;
  if (typeof opts.dedupMode === "string") {
    const mode = opts.dedupMode.trim().toLowerCase();
    if (!isDedupMode(mode)) throw new Error(`Invalid --dedup-mode: ${opts.dedupMode} (expected ${DEDUP_MODES.join("|")})`);
    patch.dedupEnforcement = mode;
  }
  if (typeof opts.dedupSkip === "string") patch.dedupSkipDirectories = opts.dedupSkip;
  return patch;
}

const program = new Command();

program
  .name("dufflebag")
  .description(
    "Install a personal bag of AI coding agent skills & hooks for Claude Code, Kimi, and Kiro (context guard, autonomous loop, TTS).",
  )
  .version(VERSION, "-v, --version");

program
  .command("menu")
  .description("Interactive menu — the default when you run `dufflebag` in a terminal with no command")
  .action(() => menu());

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
  .description("Surgically remove everything dufflebag added")
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
  .option("--dedup-mode <deny|warn|off>", "dedup-guard enforcement level")
  .option("--dedup-skip <dirs>", "extra dirs dedup-guard ignores (comma list)")
  .action((opts) => config({ scope: scopeOf(opts), patch: configPatch(opts) }));

const dedup = program.command("dedup").description("Duplicate-code utilities (the dedup-guard feature)");
dedup
  .command("check [path]")
  .description("Scan for duplicate functions/types; exits non-zero on findings (pre-commit / CI gate)")
  .option("--staged", "only report dups touching git-staged files")
  .option("--since <ref>", "only report dups touching files changed since <ref> (e.g. main)")
  .action((pathArg: string | undefined, opts: { staged?: boolean; since?: string }) =>
    dedupCheck({ path: pathArg, staged: Boolean(opts.staged), since: opts.since }),
  );

program
  .command("doctor")
  .description("Read-only health check across global + project scopes")
  .action(() => doctor());

program
  .command("scaffold-ci [path]")
  .description("Copy the CI + publish workflow set into a repo (each repo owns its CI)")
  .option("-f, --force", "overwrite existing workflow files (resync from dufflebag)")
  .action((pathArg: string | undefined, opts: { force?: boolean }) => scaffoldCi({ path: pathArg, force: Boolean(opts.force) }));

// Bare invocation in a terminal opens the interactive menu; with any argument
// (a command, -h, -v) or when piped/CI (no TTY), defer to commander as usual.
const bare = process.argv.length <= 2 && process.stdin.isTTY;
(bare ? menu() : program.parseAsync(process.argv)).catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
