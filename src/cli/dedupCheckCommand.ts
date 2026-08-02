/** `dufflebag dedup [workspace]` — duplicate-code gate for local work and CI. */

import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";

import { dedupCheck } from "../hookIsland/dedupGuard/command/dedupCheck.js";
import { CliUsageError, formatOption } from "./scopeOptions.js";

const workspaceArgument = Args.directory({ name: "workspace", exists: "either" }).pipe(
  Args.optional,
  Args.withDescription("Repository root to scan (default: current working directory)"),
);

const stagedOption = Options.boolean("staged").pipe(
  Options.withDefault(false),
  Options.withDescription("Restrict findings to git-staged source files"),
);

const sinceOption = Options.text("since").pipe(
  Options.optional,
  Options.withDescription("Restrict findings to files changed since this git ref"),
);

export const dedupCommand = Command.make(
  "dedup",
  {
    workspace: workspaceArgument,
    staged: stagedOption,
    since: sinceOption,
    format: formatOption,
  },
  (args) =>
    Effect.gen(function* () {
      if (args.staged && Option.isSome(args.since)) {
        return yield* new CliUsageError({ issue: "Use either --staged or --since, not both." });
      }

      dedupCheck({
        workspace: Option.getOrUndefined(args.workspace),
        staged: args.staged,
        since: Option.getOrUndefined(args.since),
        format: args.format,
      });
    }),
).pipe(Command.withDescription("Find duplicate function bodies and type shapes"));
