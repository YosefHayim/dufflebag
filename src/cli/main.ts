#!/usr/bin/env node
/**
 * dufflebag CLI entry point — single Effect runtime edge.
 *
 * Only this file may call NodeRuntime.runMain / Effect.run*.
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "@effect/cli";
import { Terminal } from "@effect/platform";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";

import { configCommand } from "./configCommand.js";
import { dedupCommand } from "./dedupCheckCommand.js";
import { doctorCommand } from "./doctorCommand.js";
import { installCommand } from "./installCommand.js";
import { runMenu } from "./menuCommand.js";
import { scaffoldWorkflowsCommand } from "./scaffoldWorkflowsCommand.js";
import { uninstallCommand } from "./uninstallCommand.js";
import { updateCommand } from "./updateCommand.js";

const readPackageVersion = (): string => {
  let directory = dirname(fileURLToPath(import.meta.url));

  // Walk toward the filesystem root until package.json is found.
  while (true) {
    try {
      const raw = readFileSync(join(directory, "package.json"), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") {
        return parsed.version;
      }

      return "0.0.0";
    } catch {
      const parent = dirname(directory);
      if (parent === directory) {
        return "0.0.0";
      }

      directory = parent;
    }
  }
};

const VERSION = readPackageVersion();

const dufflebag = Command.make("dufflebag").pipe(
  Command.withDescription(
    "Install a personal bag of AI coding agent skills & hooks for Claude Code, Kimi, and Kiro (context guard, autonomous loop, TTS).",
  ),
  Command.withSubcommands([
    installCommand,
    updateCommand,
    uninstallCommand,
    configCommand,
    doctorCommand,
    dedupCommand,
    scaffoldWorkflowsCommand,
  ]),
);

const cli = Command.run(dufflebag, {
  name: "dufflebag",
  version: VERSION,
});

const program = Effect.gen(function* () {
  const terminal = yield* Terminal.Terminal;
  const isTTY = yield* terminal.isTTY;
  const bareInvocation = process.argv.length <= 2;

  if (bareInvocation && isTTY) {
    yield* runMenu;
    return;
  }

  if (bareInvocation && !isTTY) {
    // Non-TTY bare invocation must not hang: print help and exit.
    yield* cli(["node", "dufflebag", "--help"]);
    return;
  }

  yield* cli(process.argv);
}).pipe(Effect.provide(NodeContext.layer));

// Exported for tests that exercise request assembly without starting the runtime.
export { dufflebag, cli, VERSION };

export const isBareArgv = (argv: ReadonlyArray<string>): boolean => argv.length <= 2;

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
// e.g. ".../main.ts" → ".../main.js" so tsx and compiled entry compare equal
let isDirectRun = invoked === thisFile || invoked === thisFile.replace(/\.ts$/, ".js");
if (!isDirectRun && invoked !== undefined) {
  try {
    // npm bin is a symlink into node_modules; realpath makes argv match import.meta.url
    isDirectRun = realpathSync(invoked) === thisFile;
  } catch {
    // ignore missing/unreadable argv path
  }
}

// Single runtime edge for the main application package — only when invoked as the entrypoint.
if (isDirectRun) {
  NodeRuntime.runMain(program);
}
