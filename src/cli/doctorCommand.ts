/**
 * `dufflebag doctor` — read-only health check for global and project scopes.
 */

import { Command } from "@effect/cli";
import { Effect } from "effect";

import { doctor } from "../doctor.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

export const doctorCommand = Command.make("doctor", {}, () =>
  Effect.gen(function* () {
    yield* TerminalUI.intro("doctor");
    const host = yield* captureHostEvidence;
    const stagedPackage = yield* stagePackage;

    const scopes: ReadonlyArray<"global" | "project"> = ["global", "project"];

    // Inspect both scopes so one command covers global and project health.
    for (const scope of scopes) {
      const report = yield* doctor({
        destination: destinationForScope({
          scope,
          homeRoot: host.homeRoot,
          projectRoot: host.projectRoot,
        }),
        stagedPackage,
        platform: host.platform,
        agentEvidence: host.agentEvidence,
      });

      yield* TerminalUI.step(`${scope} scope`);
      yield* TerminalUI.info(
        report.installation._tag === "present"
          ? `installation v${report.installation.version}: ${report.installation.features.join(", ") || "(no features)"}`
          : "installation: missing",
      );
      yield* TerminalUI.info(report.config._tag === "present" ? "config: present" : "config: missing");
      yield* TerminalUI.info(
        `agents: ${
          report.agents
            .filter((agent) => agent.detected || agent.managed)
            .map((agent) => `${agent.displayName}${agent.managed ? "*" : ""}`)
            .join(", ") || "none detected"
        }`,
      );

      // Surface every deterministic discrepancy without authorizing repair.
      for (const discrepancy of report.discrepancies) {
        yield* TerminalUI.warn(discrepancy._tag);
      }
    }

    yield* TerminalUI.outro("Read-only check complete.");
  }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(Command.withDescription("Read-only health check across global + project scopes"));
