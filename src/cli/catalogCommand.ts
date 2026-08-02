/** `dufflebag catalog` — list the public feature IDs accepted by install and update. */

import { Command } from "@effect/cli";
import { Effect } from "effect";

import { featureCatalog } from "../catalog/featureCatalog.js";
import { formatOption } from "./scopeOptions.js";
import * as TerminalUI from "./TerminalUI.js";

const catalogEntries = featureCatalog.map((feature) => ({
  id: feature.id,
  title: feature.title,
  summary: feature.summary,
  selectedByDefault: feature.selectedByDefault,
  platform: feature.platform,
}));

export const catalogCommand = Command.make("catalog", { format: formatOption }, (args) =>
  Effect.gen(function* () {
    if (args.format === "json") {
      yield* TerminalUI.json({ features: catalogEntries });
      return;
    }

    yield* TerminalUI.intro("catalog");
    const lines = catalogEntries.map(
      (feature) =>
        `${feature.id.padEnd(24)} ${feature.title}${feature.selectedByDefault ? " · default" : ""}\n${"".padEnd(26)}${feature.summary}`,
    );
    yield* TerminalUI.note(lines.join("\n"), "Features");
    yield* TerminalUI.outro("Install with `dufflebag install <feature-id>...`.");
  }),
).pipe(Command.withDescription("List installable feature IDs and catalog defaults"));
