/** `dufflebag update [feature-id...]` — preserve installed features unless IDs are explicit. */

import { Args, Command } from "@effect/cli";
import { Effect } from "effect";

import { update } from "../install/update.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { formatOption, scopeOption } from "./scopeOptions.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

const featureIdsArgument = Args.text({ name: "feature-id" }).pipe(
  Args.repeated,
  Args.withDescription("Replacement feature IDs; omitted preserves the receipt selection"),
);

export const updateCommand = Command.make(
  "update",
  {
    featureIds: featureIdsArgument,
    scope: scopeOption,
    format: formatOption,
  },
  (args) =>
    Effect.gen(function* () {
      if (args.format === "text") yield* TerminalUI.intro("update");
      const host = yield* captureHostEvidence;
      const stagedPackage = yield* stagePackage;
      const updateExecution = yield* update({
        destination: destinationForScope({
          scope: args.scope,
          homeRoot: host.homeRoot,
          projectRoot: host.projectRoot,
        }),
        host: { homeRoot: host.homeRoot },
        stagedPackage,
        features: args.featureIds.length === 0 ? { _tag: "preserve" } : { _tag: "selected", ids: args.featureIds },
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "automatic" },
      });

      if (args.format === "json") {
        yield* TerminalUI.json(updateExecution);
        return;
      }

      yield* TerminalUI.success(
        updateExecution._tag === "updated"
          ? `Updated ${updateExecution.features.join(", ")} (${updateExecution.scope})`
          : `Already current: ${updateExecution.features.join(", ")} (${updateExecution.scope})`,
      );
      yield* TerminalUI.outro("Done.");
    }),
).pipe(Command.withDescription("Refresh installed features; explicit IDs replace the receipt selection"));
