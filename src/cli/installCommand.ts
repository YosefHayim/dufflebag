/**
 * `dufflebag install` — decode request evidence, stage the package, install.
 */

import { Command } from "@effect/cli";
import { Terminal } from "@effect/platform";
import { Effect } from "effect";

import { featureCatalog, selectedFeatureIds } from "../catalog/featureCatalog.js";
import { install } from "../install/install.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { featuresOption, globalOption, parseFeatureIds, projectOption, resolveScope, yesOption } from "./scopeOptions.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

type FeatureChoice = { _tag: "selected"; ids: ReadonlyArray<string> } | { _tag: "defaults" };

const resolveFeatureChoice = (input: {
  featureIds: ReadonlyArray<string> | undefined;
  interactive: boolean;
  assumeYes: boolean;
}) =>
  Effect.gen(function* () {
    if (input.featureIds !== undefined) {
      const choice: FeatureChoice = { _tag: "selected", ids: input.featureIds };
      return choice;
    }

    if (!input.interactive || input.assumeYes) {
      const choice: FeatureChoice = { _tag: "defaults" };
      return choice;
    }

    const selected = yield* TerminalUI.multiSelect({
      message: "Select features to install",
      choices: featureCatalog.map((feature) => ({
        title: feature.title,
        value: feature.id,
        description: feature.summary,
        selected: feature.selectedByDefault,
      })),
      initial: selectedFeatureIds,
    });

    const choice: FeatureChoice = { _tag: "selected", ids: selected };
    return choice;
  });

export const installCommand = Command.make(
  "install",
  {
    project: projectOption,
    global: globalOption,
    features: featuresOption,
    yes: yesOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("install");
      const scope = yield* resolveScope(args);
      const host = yield* captureHostEvidence;
      const stagedPackage = yield* stagePackage;
      const terminal = yield* Terminal.Terminal;
      const isTTY = yield* terminal.isTTY;
      const interaction: { _tag: "scripted" } | { _tag: "interactive" } =
        args.yes || !isTTY ? { _tag: "scripted" } : { _tag: "interactive" };
      const featureIds = parseFeatureIds(args.features);
      const features = yield* resolveFeatureChoice({
        featureIds,
        interactive: interaction._tag === "interactive",
        assumeYes: args.yes,
      });

      if (interaction._tag === "interactive" && !args.yes) {
        const confirmed = yield* TerminalUI.confirm({
          message: `Install into ${scope} scope?`,
          initialValue: true,
        });
        if (!confirmed) {
          yield* TerminalUI.outro("Cancelled — nothing was changed.");
          return;
        }
      }

      const result = yield* install({
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
        result._tag === "installed"
          ? `Installed ${result.features.join(", ")} (${result.scope})`
          : `Already current: ${result.features.join(", ")} (${result.scope})`,
      );
      if (result.agents.length > 0) {
        yield* TerminalUI.info(`Agents: ${result.agents.join(", ")}`);
      }
      yield* TerminalUI.outro("Done.");
    }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(Command.withDescription("Install (or re-run to refresh) the selected features"));
