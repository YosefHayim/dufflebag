/** `dufflebag workflow scaffold` — copy CI and publish workflow templates. */

import { Args, Command, Options } from "@effect/cli";
import { FileSystem, Path } from "@effect/platform";
import { Effect, Option } from "effect";

import { scaffoldWorkflows } from "../scaffoldWorkflows.js";
import { formatOption } from "./scopeOptions.js";
import * as TerminalUI from "./TerminalUI.js";

const workspaceArgument = Args.directory({ name: "workspace", exists: "either" }).pipe(
  Args.optional,
  Args.withDescription("Target repository root (default: current working directory)"),
);

const overwriteOption = Options.boolean("overwrite").pipe(
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

const scaffoldCommand = Command.make(
  "scaffold",
  {
    workspace: workspaceArgument,
    overwrite: overwriteOption,
    format: formatOption,
  },
  (args) =>
    Effect.gen(function* () {
      if (args.format === "text") yield* TerminalUI.intro("workflow scaffold");
      const path = yield* Path.Path;
      const packageRoot = yield* resolvePackageRoot;
      const targetRoot = path.resolve(Option.getOrElse(args.workspace, () => process.cwd()));
      if (args.format === "text") yield* TerminalUI.step(`workspace: ${targetRoot}`);

      const workflowScaffold = yield* scaffoldWorkflows({
        targetRoot,
        templateDirectory: path.join(packageRoot, "templates", "workflows"),
        force: args.overwrite,
      });

      if (args.format === "json") {
        yield* TerminalUI.json({ workspace: targetRoot, ...workflowScaffold });
        return;
      }

      const lines = [
        ...workflowScaffold.written.map((name) => `✓ .github/workflows/${name}`),
        ...workflowScaffold.skipped.map(
          (name) => `• .github/workflows/${name} exists — kept (use --overwrite to replace)`,
        ),
      ];
      yield* TerminalUI.note(
        lines.join("\n"),
        workflowScaffold.written.length > 0 ? "Scaffolded" : "Nothing written (all present)",
      );
      yield* TerminalUI.outro(
        "Next: register the npm trusted publisher (repo + publish.yml) — see the publish.yml header.",
      );
    }),
).pipe(Command.withDescription("Copy the single-gate CI + publish workflow set into a repo"));

export const workflowCommand = Command.make("workflow").pipe(
  Command.withDescription("Manage reusable repository workflows"),
  Command.withSubcommands([scaffoldCommand]),
);
