/** Shared public options whose spelling and defaults are part of the CLI contract. */

import { Options } from "@effect/cli";
import { Effect, Schema } from "effect";

import * as TerminalUI from "./TerminalUI.js";

const scopes = ["global", "project"] as const;
export type CliScope = (typeof scopes)[number];

export const scopeOption = Options.choice("scope", scopes).pipe(
  Options.withDefault("global"),
  Options.withDescription("Target the global home installation root (default)"),
);

export const yesOption = Options.boolean("yes").pipe(
  Options.withAlias("y"),
  Options.withDefault(false),
  Options.withDescription("Skip confirmation prompts (CI / scripted)"),
);

const outputFormats = ["text", "json"] as const;
export type OutputFormat = (typeof outputFormats)[number];

export const formatOption = Options.choice("format", outputFormats).pipe(
  Options.withDefault("text"),
  Options.withDescription("Render human-readable text or one JSON document"),
);

export class CliUsageError extends Schema.TaggedError<CliUsageError>()("CliUsageError", {
  issue: Schema.NonEmptyString,
}) {
  get message(): string {
    return this.issue;
  }
}

/** Ask before a destructive change unless `--yes` was passed; without a terminal to ask on, `--yes` is required. */
export const confirmDestructive = (request: {
  readonly yes: boolean;
  readonly question: string;
  readonly missingYesIssue: string;
}) =>
  Effect.gen(function* () {
    if (request.yes) {
      return true;
    }
    if (!(yield* TerminalUI.isInteractiveTerminal)) {
      return yield* new CliUsageError({ issue: request.missingYesIssue });
    }

    return yield* TerminalUI.confirm({ message: request.question, initialValue: false });
  });
