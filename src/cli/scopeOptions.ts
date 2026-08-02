/** Shared public options whose spelling and defaults are part of the CLI contract. */

import { Options } from "@effect/cli";
import { Schema } from "effect";

export const scopes = ["global", "project"] as const;
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

export const outputFormats = ["text", "json"] as const;
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
