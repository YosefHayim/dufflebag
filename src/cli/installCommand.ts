/** `dufflebag install [feature-id...]` — thin adapter over the install capability. */

import { Args, Command } from "@effect/cli";
import { Effect } from "effect";

import { destinationForScope, scanHost } from "../config/hostScan.js";
import { install } from "../install/install.js";
import { preparePackage } from "../install/preparePackage.js";
import { formatOption, scopeOption } from "./cliOptions.js";
import * as TerminalUI from "./TerminalUI.js";

export const showInstallation = (installation: {
  readonly _tag: "installed" | "unchanged";
  readonly scope: string;
  readonly features: ReadonlyArray<string>;
  readonly agents: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const features = `${installation.features.join(", ")} (${installation.scope})`;
    yield* TerminalUI.success(
      installation._tag === "installed" ? `Installed ${features}` : `Already current: ${features}`,
    );
    if (installation.agents.length > 0) yield* TerminalUI.detail(`Agents: ${installation.agents.join(", ")}`);
  });

const featureIdsArgument = Args.text({ name: "feature-id" }).pipe(
  Args.repeated,
  Args.withDescription("Feature IDs from `dufflebag catalog`; omitted means catalog defaults"),
);

export const installCommand = Command.make(
  "install",
  { featureIds: featureIdsArgument, scope: scopeOption, format: formatOption },
  (args) =>
    Effect.gen(function* () {
      if (args.format === "text") yield* TerminalUI.intro("install");
      const host = yield* scanHost;
      const installation = yield* install({
        destination: destinationForScope({ scope: args.scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
        host: { homeRoot: host.homeRoot },
        preparedPackage: yield* preparePackage,
        features: args.featureIds.length === 0 ? { _tag: "defaults" } : { _tag: "selected", ids: args.featureIds },
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "automatic" },
      });
      if (args.format === "json") {
        yield* TerminalUI.json(installation);
        return;
      }

      yield* showInstallation(installation);
      yield* TerminalUI.outro("Done.");
    }),
).pipe(Command.withDescription("Install catalog defaults or the named features"));
