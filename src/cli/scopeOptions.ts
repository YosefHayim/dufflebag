/**
 * Shared CLI scope options for install, update, uninstall, and config.
 */

import { Options } from "@effect/cli";
import { Effect, Option, Schema } from "effect";

export class ScopeOptionError extends Schema.TaggedError<ScopeOptionError>()("ScopeOptionError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable mutually exclusive scope option failure.",
  }),
}) {
  get message(): string {
    return this.issue;
  }
}

export const projectOption = Options.boolean("project").pipe(
  Options.withDefault(false),
  Options.withDescription("Target the project installation root (committable per-repo)"),
);

export const globalOption = Options.boolean("global").pipe(
  Options.withDefault(false),
  Options.withDescription("Target the global home installation root (default)"),
);

export const yesOption = Options.boolean("yes").pipe(
  Options.withAlias("y"),
  Options.withDefault(false),
  Options.withDescription("Skip confirmation prompts (CI / scripted)"),
);

export const featuresOption = Options.text("features").pipe(
  Options.optional,
  Options.withDescription("Comma-separated feature ids from the catalog"),
);

export const resolveScope = (input: { project: boolean; global: boolean }): Effect.Effect<"global" | "project", ScopeOptionError> => {
  if (input.project && input.global) {
    return Effect.fail(
      new ScopeOptionError({
        issue: "Use either --project or --global, not both.",
      }),
    );
  }

  const scope: "global" | "project" = input.project ? "project" : "global";
  return Effect.succeed(scope);
};

export const parseFeatureIds = (raw: Option.Option<string>): ReadonlyArray<string> | undefined => {
  if (Option.isNone(raw)) {
    return undefined;
  }

  const ids = raw.value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return ids.length > 0 ? ids : undefined;
};
