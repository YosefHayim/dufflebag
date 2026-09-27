/** `dufflebag workflow scaffold` — copy CI and publish workflow templates. */

import { Args, Command, Options } from "@effect/cli";
import { Path } from "@effect/platform";
import { Effect, Option } from "effect";

import { findPackageRoot } from "../install/packageRoot.js";
import { copyWorkflows } from "../workflows/copyWorkflows.js";
import { formatOption } from "./cliOptions.js";
import * as TerminalUI from "./TerminalUI.js";

export const workflowTemplateDirectory = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.join(yield* findPackageRoot, "src", "templates", "workflows");
});

export const showCopiedWorkflows = (copiedWorkflows: {
  readonly written: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
}) =>
  TerminalUI.note(
    [
      ...copiedWorkflows.written.map((name) => `✓ .github/workflows/${name}`),
      ...copiedWorkflows.skipped.map(
        (name) => `• .github/workflows/${name} exists — kept (use --overwrite to replace)`,
      ),
    ].join("\n"),
    copiedWorkflows.written.length > 0 ? "Scaffolded" : "Nothing written (all present)",
  );

const workspaceArgument = Args.directory({ name: "workspace", exists: "either" }).pipe(
  Args.optional,
  Args.withDescription("Target repository root (default: current working directory)"),
);

const overwriteOption = Options.boolean("overwrite").pipe(
  Options.withDefault(false),
  Options.withDescription("Overwrite existing workflow files (resync from dufflebag)"),
);

const scaffoldCommand = Command.make(
  "scaffold",
  { workspace: workspaceArgument, overwrite: overwriteOption, format: formatOption },
  (args) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const targetRoot = path.resolve(Option.getOrElse(args.workspace, () => process.cwd()));
      if (args.format === "text") {
        yield* TerminalUI.intro("workflow scaffold");
        yield* TerminalUI.step(`workspace: ${targetRoot}`);
      }

      const copiedWorkflows = yield* copyWorkflows({
        targetRoot,
        templateDirectory: yield* workflowTemplateDirectory,
        force: args.overwrite,
      });
      if (args.format === "json") {
        yield* TerminalUI.json({ workspace: targetRoot, ...copiedWorkflows });
        return;
      }

      yield* showCopiedWorkflows(copiedWorkflows);
      yield* TerminalUI.outro(
        "Next: register the npm trusted publisher (repo + publish.yml) — see the publish.yml header.",
      );
    }),
).pipe(Command.withDescription("Copy the single-gate CI + publish workflow set into a repo"));

export const workflowCommand = Command.make("workflow").pipe(
  Command.withDescription("Manage reusable repository workflows"),
  Command.withSubcommands([scaffoldCommand]),
);
