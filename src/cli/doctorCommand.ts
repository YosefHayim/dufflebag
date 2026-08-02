/**
 * `dufflebag doctor` — read-only health check for global and project scopes.
 */

import { Command } from "@effect/cli";
import { Effect } from "effect";

import { type DoctorReport, doctor } from "../doctor.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { formatOption } from "./scopeOptions.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

type DoctorScope = DoctorReport["scope"];
type ObservedDaemon = DoctorReport["daemons"][number];
type ObservedDiscrepancy = DoctorReport["discrepancies"][number];

const abbreviatedSessionId = (sessionId: string): string =>
  sessionId.length > 12 ? `${sessionId.slice(0, 8)}…` : sessionId;

const renderInstallationLine = (installation: DoctorReport["installation"]): string =>
  installation._tag === "present"
    ? `installation v${installation.version}: ${installation.features.join(", ") || "(no features)"}`
    : "installation: missing";

const renderAgentsLine = (agents: DoctorReport["agents"]): string =>
  `agents: ${
    agents
      .filter((agent) => agent.detected || agent.managed)
      .map((agent) => `${agent.displayName}${agent.managed ? "*" : ""} [idle hooks: ${agent.nativeHookSupport}]`)
      .join(", ") || "none detected"
  }`;

const reportDaemon = (daemon: ObservedDaemon) => {
  const sessionLabel = abbreviatedSessionId(daemon.sessionId);
  if (daemon.snapshot._tag === "missing") {
    return TerminalUI.warn(`daemon ${sessionLabel}: live, no config snapshot — restart the session`);
  }

  return TerminalUI.detail(
    `daemon ${sessionLabel}: frozen warn ${daemon.snapshot.config.contextWarnFraction} · budget ${daemon.snapshot.config.autorunDefaultCycleCount} · cap ${daemon.snapshot.config.autorunMaxCycleCount}`,
  );
};

const reportDaemons = (observation: { scope: DoctorScope; daemons: DoctorReport["daemons"] }) =>
  Effect.gen(function* () {
    if (observation.daemons.length > 0) {
      // Summarize each live daemon's spawn-time config vs managed config.
      yield* Effect.forEach(observation.daemons, reportDaemon);
      return;
    }

    if (observation.scope === "global") {
      yield* TerminalUI.detail("daemon: none running (config freezes at next SessionStart)");
    }
  });

const reportDiscrepancy = (discrepancy: ObservedDiscrepancy) => {
  if (discrepancy._tag === "daemonConfigMismatch") {
    return TerminalUI.warn(
      `daemonConfigMismatch ${discrepancy.sessionId}: ${discrepancy.key} managed=${discrepancy.managedValue} daemon=${discrepancy.daemonValue}`,
    );
  }

  if (discrepancy._tag === "daemonConfigSnapshotMissing") {
    return TerminalUI.warn(`daemonConfigSnapshotMissing ${discrepancy.sessionId}`);
  }

  return TerminalUI.warn(discrepancy._tag);
};

const reportScopeHealth = (inspection: { scope: DoctorScope; report: DoctorReport }) =>
  Effect.gen(function* () {
    yield* TerminalUI.step(`${inspection.scope} scope`);
    yield* TerminalUI.detail(renderInstallationLine(inspection.report.installation));
    yield* TerminalUI.detail(inspection.report.config._tag === "present" ? "config: present" : "config: missing");
    yield* TerminalUI.detail(renderAgentsLine(inspection.report.agents));
    yield* reportDaemons({ scope: inspection.scope, daemons: inspection.report.daemons });

    // Surface every deterministic discrepancy without authorizing repair.
    yield* Effect.forEach(inspection.report.discrepancies, reportDiscrepancy);
  });

export const doctorCommand = Command.make("doctor", { format: formatOption }, (args) =>
  Effect.gen(function* () {
    if (args.format === "text") yield* TerminalUI.intro("doctor");
    const host = yield* captureHostEvidence;
    const stagedPackage = yield* stagePackage;

    const scopes: ReadonlyArray<DoctorScope> = ["global", "project"];
    const inspections: Array<{ scope: DoctorScope; report: DoctorReport }> = [];

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
      inspections.push({ scope, report });
    }

    const unhealthy = inspections.some((inspection) => inspection.report.discrepancies.length > 0);
    if (unhealthy) process.exitCode = 1;
    if (args.format === "json") {
      yield* TerminalUI.json({ _tag: unhealthy ? "unhealthy" : "healthy", scopes: inspections });
      return;
    }

    yield* Effect.forEach(inspections, reportScopeHealth);
    yield* TerminalUI.outro("Read-only check complete.");
  }),
).pipe(Command.withDescription("Read-only health check across global + project scopes"));
