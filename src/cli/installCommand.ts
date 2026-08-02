/** `dufflebag install [feature-id...]` — thin adapter over the install capability. */

import { Args, Command } from "@effect/cli";
import { Effect } from "effect";

import { install } from "../install/install.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { formatOption, scopeOption } from "./scopeOptions.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

const featureIdsArgument = Args.text({ name: "feature-id" }).pipe(
  Args.repeated,
  Args.withDescription("Feature IDs from `dufflebag catalog`; omitted means catalog defaults"),
);

export const installCommand = Command.make(
  "install",
  {
    featureIds: featureIdsArgument,
    scope: scopeOption,
    format: formatOption,
  },
  (args) =>
    Effect.gen(function* () {
      if (args.format === "text") yield* TerminalUI.intro("install");
      const host = yield* captureHostEvidence;
      const stagedPackage = yield* stagePackage;
      const installation = yield* install({
        destination: destinationForScope({
          scope: args.scope,
          homeRoot: host.homeRoot,
          projectRoot: host.projectRoot,
        }),
        host: { homeRoot: host.homeRoot },
        stagedPackage,
        features: args.featureIds.length === 0 ? { _tag: "defaults" } : { _tag: "selected", ids: args.featureIds },
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "automatic" },
      });

      if (args.format === "json") {
        yield* TerminalUI.json(installation);
        return;
      }

      yield* TerminalUI.success(
        installation._tag === "installed"
          ? `Installed ${installation.features.join(", ")} (${installation.scope})`
          : `Already current: ${installation.features.join(", ")} (${installation.scope})`,
      );
      if (installation.agents.length > 0) yield* TerminalUI.detail(`Agents: ${installation.agents.join(", ")}`);
      yield* TerminalUI.outro("Done.");
    }),
).pipe(Command.withDescription("Install catalog defaults or the named features"));
