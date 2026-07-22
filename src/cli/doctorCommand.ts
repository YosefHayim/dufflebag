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
            .map((agent) => `${agent.displayName}${agent.managed ? "*" : ""} [idle hooks: ${agent.nativeHookSupport}]`)
            .join(", ") || "none detected"
        }`,
      );

      if (report.daemons.length === 0) {
        if (scope === "global") {
          yield* TerminalUI.info("daemon: none running (config freezes at next SessionStart)");
        }
      } else {
        // Summarize each live daemon's spawn-time config vs managed config.
        for (const daemon of report.daemons) {
          const shortSid = daemon.sessionId.length > 12 ? `${daemon.sessionId.slice(0, 8)}…` : daemon.sessionId;
          if (daemon.snapshot._tag === "missing") {
            yield* TerminalUI.warn(`daemon ${shortSid}: live, no config snapshot — restart the session`);
            continue;
          }
          yield* TerminalUI.info(
            `daemon ${shortSid}: frozen warn ${daemon.snapshot.config.contextWarnFraction} · budget ${daemon.snapshot.config.autorunDefaultCycleCount} · cap ${daemon.snapshot.config.autorunMaxCycleCount}`,
          );
        }
      }

      // Surface every deterministic discrepancy without authorizing repair.
      for (const discrepancy of report.discrepancies) {
        if (discrepancy._tag === "daemonConfigMismatch") {
          yield* TerminalUI.warn(
            `daemonConfigMismatch ${discrepancy.sessionId}: ${discrepancy.key} managed=${discrepancy.managedValue} daemon=${discrepancy.daemonValue}`,
          );
          continue;
        }
        if (discrepancy._tag === "daemonConfigSnapshotMissing") {
          yield* TerminalUI.warn(`daemonConfigSnapshotMissing ${discrepancy.sessionId}`);
          continue;
        }
        yield* TerminalUI.warn(discrepancy._tag);
      }
    }

    yield* TerminalUI.outro("Read-only check complete.");
  }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(Command.withDescription("Read-only health check across global + project scopes"));
