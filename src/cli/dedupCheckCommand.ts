/**
 * `dufflebag dedup check` — CI / pre-commit gate for the dedup-guard feature.
 *
 * Thin Effect CLI adapter over the skill-local gate command. Presentation and
 * exit-code policy live in the skill command (fail-closed is the product).
 */

import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";

import { dedupCheck } from "../skills/dedupGuard/command/dedupCheck.js";
import * as TerminalUI from "./TerminalUI.js";

const targetPathArg = Args.directory({ name: "path", exists: "either" }).pipe(
  Args.optional,
  Args.withDescription("Repository root to scan (default: current working directory)"),
);

const stagedOption = Options.boolean("staged").pipe(
  Options.withDefault(false),
  Options.withDescription("Restrict findings to git-staged source files"),
);

const sinceOption = Options.text("since").pipe(
  Options.optional,
  Options.withDescription("Restrict findings to files changed since this git ref (e.g. main)"),
);

const checkCommand = Command.make(
  "check",
  {
    path: targetPathArg,
    staged: stagedOption,
    since: sinceOption,
  },
  (args) =>
    Effect.gen(function* () {
      if (args.staged && Option.isSome(args.since)) {
        return yield* Effect.fail(new Error("Use either --staged or --since, not both."));
      }

      dedupCheck({
        path: Option.getOrUndefined(args.path),
        staged: args.staged,
        since: Option.getOrUndefined(args.since),
      });
    }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(
  Command.withDescription(
    "Scan a repo for duplicate function bodies / type shapes (exits non-zero on findings)",
  ),
);

export const dedupCommand = Command.make("dedup").pipe(
  Command.withDescription("Dedup-guard tools (scan / CI gate)"),
  Command.withSubcommands([checkCommand]),
);
