/** `dufflebag update [feature-id...]` — preserve installed features unless IDs are explicit. */

import { Args, Command } from "@effect/cli";
import { Effect } from "effect";

import { destinationForScope, scanHost } from "../config/hostScan.js";
import { preparePackage } from "../install/preparePackage.js";
import { update } from "../install/update.js";
import { formatOption, scopeOption } from "./cliOptions.js";
import * as TerminalUI from "./TerminalUI.js";

export const showUpdate = (updateSummary: {
  readonly _tag: "updated" | "unchanged";
  readonly scope: string;
  readonly features: ReadonlyArray<string>;
}) => {
  const features = `${updateSummary.features.join(", ")} (${updateSummary.scope})`;
  return TerminalUI.success(updateSummary._tag === "updated" ? `Updated ${features}` : `Already current: ${features}`);
};

const featureIdsArgument = Args.text({ name: "feature-id" }).pipe(
  Args.repeated,
  Args.withDescription("Replacement feature IDs; omitted preserves the receipt selection"),
);

export const updateCommand = Command.make(
  "update",
  { featureIds: featureIdsArgument, scope: scopeOption, format: formatOption },
  (args) =>
    Effect.gen(function* () {
      if (args.format === "text") yield* TerminalUI.intro("update");
      const host = yield* scanHost;
      const updateSummary = yield* update({
        destination: destinationForScope({ scope: args.scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
        host: { homeRoot: host.homeRoot },
        preparedPackage: yield* preparePackage,
        features: args.featureIds.length === 0 ? { _tag: "preserve" } : { _tag: "selected", ids: args.featureIds },
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "automatic" },
      });
      if (args.format === "json") {
        yield* TerminalUI.json(updateSummary);
        return;
      }

      yield* showUpdate(updateSummary);
      yield* TerminalUI.outro("Done.");
    }),
).pipe(Command.withDescription("Refresh installed features; explicit IDs replace the receipt selection"));
