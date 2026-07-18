/**
 * `dufflebag update` — refresh staged runtime while preserving features/config.
 */

import { Command } from "@effect/cli";
import { Terminal } from "@effect/platform";
import { Effect } from "effect";

import { update } from "../install/update.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { featuresOption, globalOption, parseFeatureIds, projectOption, resolveScope, yesOption } from "./scopeOptions.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

export const updateCommand = Command.make(
  "update",
  {
    project: projectOption,
    global: globalOption,
    features: featuresOption,
    yes: yesOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("update");
      const scope = yield* resolveScope(args);
      const host = yield* captureHostEvidence;
      const stagedPackage = yield* stagePackage;
      const terminal = yield* Terminal.Terminal;
      const isTTY = yield* terminal.isTTY;
      const interaction: { _tag: "scripted" } | { _tag: "interactive" } =
        args.yes || !isTTY ? { _tag: "scripted" } : { _tag: "interactive" };
      const featureIds = parseFeatureIds(args.features);
      const features: { _tag: "preserve" } | { _tag: "selected"; ids: ReadonlyArray<string> } =
        featureIds === undefined ? { _tag: "preserve" } : { _tag: "selected", ids: featureIds };

      if (interaction._tag === "interactive" && !args.yes) {
        const confirmed = yield* TerminalUI.confirm({
          message: `Update ${scope} installation?`,
          initialValue: true,
        });
        if (!confirmed) {
          yield* TerminalUI.outro("Cancelled — nothing was changed.");
          return;
        }
      }

      const result = yield* update({
        destination: destinationForScope({
          scope,
          homeRoot: host.homeRoot,
          projectRoot: host.projectRoot,
        }),
        host: { homeRoot: host.homeRoot },
        stagedPackage,
        features,
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction,
        configuration: { _tag: "automatic" },
      });

      yield* TerminalUI.success(
        result._tag === "updated"
          ? `Updated ${result.features.join(", ")} (${result.scope})`
          : `Already current: ${result.features.join(", ")} (${result.scope})`,
      );
      yield* TerminalUI.outro("Done.");
    }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(Command.withDescription("Refresh hook code, keep your features + config"));
