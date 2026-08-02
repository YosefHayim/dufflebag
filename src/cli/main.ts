#!/usr/bin/env node
/**
 * dufflebag CLI entry point — single Effect runtime edge.
 *
 * Only this file may call NodeRuntime.runMain / Effect.run*.
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CliConfig, Command, ValidationError } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, ParseResult } from "effect";

import { catalogCommand } from "./catalogCommand.js";
import { configCommand } from "./configCommand.js";
import { dedupCommand } from "./dedupCheckCommand.js";
import { doctorCommand } from "./doctorCommand.js";
import { installCommand } from "./installCommand.js";
import { menuCommand } from "./menuCommand.js";
import { workflowCommand } from "./scaffoldWorkflowsCommand.js";
import { CliUsageError } from "./scopeOptions.js";
import * as TerminalUI from "./TerminalUI.js";
import { uninstallCommand } from "./uninstallCommand.js";
import { updateCommand } from "./updateCommand.js";
import { voiceCommand } from "./voiceCommand.js";

// An unreadable or malformed package.json is indistinguishable from an absent
// one here: both mean "keep walking up", so both surface as undefined.
const declaredPackageVersion = (directory: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string"
      ? parsed.version
      : "0.0.0";
  } catch {
    return undefined;
  }
};

const readPackageVersion = (): string => {
  let directory = dirname(fileURLToPath(import.meta.url));

  // Walk toward the filesystem root until package.json is found.
  while (true) {
    const declared = declaredPackageVersion(directory);
    if (declared !== undefined) {
      return declared;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      return "0.0.0";
    }

    directory = parent;
  }
};

const VERSION = readPackageVersion();

const dufflebag = Command.make("dufflebag").pipe(
  Command.withDescription(
    "Install a personal bag of AI coding-agent skills, hooks, natural voice, and copyable workflows.",
  ),
  Command.withSubcommands([
    installCommand,
    updateCommand,
    uninstallCommand,
    menuCommand,
    catalogCommand,
    configCommand,
    doctorCommand,
    dedupCommand,
    workflowCommand,
    voiceCommand,
  ]),
);

const cli = Command.run(dufflebag, {
  name: "dufflebag",
  version: VERSION,
});

const presentCliFailure = (error: unknown) => {
  const exitCode =
    ValidationError.isValidationError(error) || ParseResult.isParseError(error) || error instanceof CliUsageError
      ? 2
      : 1;
  const presentation = ValidationError.isValidationError(error) ? Effect.void : TerminalUI.presentError(error);
  return presentation.pipe(
    Effect.zipRight(
      Effect.sync(() => {
        process.exitCode = exitCode;
      }),
    ),
  );
};

const program = Effect.gen(function* () {
  const bareInvocation = process.argv.length <= 2;

  if (bareInvocation) {
    yield* cli(["node", "dufflebag", "--help"]);
    return;
  }

  const invocationArguments = process.argv[2] === "-V" ? ["node", "dufflebag", "--version"] : process.argv;
  yield* cli(invocationArguments);
}).pipe(
  Effect.catchAll(presentCliFailure),
  Effect.onInterrupt(() =>
    Effect.sync(() => {
      process.exitCode = 130;
    }),
  ),
  Effect.provide(NodeContext.layer),
  Effect.provide(CliConfig.layer({ showBuiltIns: false })),
);

// Exported for tests that exercise request assembly without starting the runtime.
export { cli, dufflebag, VERSION };

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
