/**
 * `dufflebag scaffold-ci` — copy CI + publish workflow templates into a repo.
 */

import { Args, Command, Options } from "@effect/cli";
import { FileSystem, Path } from "@effect/platform";
import { Effect, Option } from "effect";

import { scaffoldWorkflows } from "../scaffoldWorkflows.js";
import * as TerminalUI from "./TerminalUI.js";

const targetPathArg = Args.directory({ name: "path", exists: "either" }).pipe(
  Args.optional,
  Args.withDescription("Target repository root (default: current working directory)"),
);

const forceOption = Options.boolean("force").pipe(
  Options.withAlias("f"),
  Options.withDefault(false),
  Options.withDescription("Overwrite existing workflow files (resync from dufflebag)"),
);

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

export const scaffoldWorkflowsCommand = Command.make(
  "scaffold-ci",
  {
    path: targetPathArg,
    force: forceOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("scaffold-ci");
      const path = yield* Path.Path;
      const packageRoot = yield* resolvePackageRoot;
      const targetRoot = path.resolve(Option.getOrElse(args.path, () => process.cwd()));
      yield* TerminalUI.step(`target: ${targetRoot}`);

      const result = yield* scaffoldWorkflows({
        targetRoot,
        templateDirectory: path.join(packageRoot, "templates", "workflows"),
        force: args.force,
      });

      const lines = [
        ...result.written.map((name) => `✓ .github/workflows/${name}`),
        ...result.skipped.map((name) => `• .github/workflows/${name} exists — kept (use --force to overwrite)`),
      ];
      yield* TerminalUI.note(lines.join("\n"), result.written.length > 0 ? "Scaffolded" : "Nothing written (all present)");
      yield* TerminalUI.outro("Next: register the npm trusted publisher (repo + publish.yml) — see the publish.yml header.");
    }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(Command.withDescription("Copy the CI + publish workflow set into a repo (each repo owns its CI)"));
