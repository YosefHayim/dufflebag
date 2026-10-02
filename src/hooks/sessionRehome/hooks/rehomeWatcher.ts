#!/usr/bin/env node
// Detached watcher behind the session-rehome hooks, and the command for a manual pass:
//   node rehomeWatcher.js --sweep [--all] [--dry-run] [--json] [--agent claude-code|codex|all]
//   node rehomeWatcher.js --session <id> --agent <agent> [--wait]
//   node rehomeWatcher.js --sweep --delete-repo aria --assign 5cc2fa97=vybekiit
// Fails open: a crash leaves every session where it was.

import { writeSync } from "node:fs";
import os from "node:os";
import { parseArgs } from "node:util";

import { readConfig } from "../../lib/hookConfig.js";
import { claudeSessionIsLive, findClaudeSession } from "../lib/claudeSessions.js";
import { codexThreadIsLive, listCodexThreads } from "../lib/codexThreads.js";
import { discoverRepos } from "../lib/localRepos.js";
import { acquireWatcherLock, type RehomeAgent, releaseWatcherLock } from "../lib/rehomeLedger.js";
import { runSweep, type SessionPlan } from "../lib/sessionSweep.js";

type WatcherOptions = {
  readonly agents: ReadonlyArray<RehomeAgent>;
  readonly sessionId: string;
  readonly wait: boolean;
  readonly sweep: boolean;
  readonly reevaluate: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly deletedRepoNames: ReadonlySet<string>;
  readonly assignments: ReadonlyMap<string, string>;
};

// A sweep leaves anything written in the last five minutes alone; a session handed over by SessionEnd only needs
// its agent to finish the last write.
const SWEEP_QUIET_SECONDS = 300;
const ENDED_SESSION_QUIET_SECONDS = 5;
const WAIT_POLL_MILLISECONDS = 2_000;
const WAIT_LIMIT_MILLISECONDS = 10 * 60 * 1_000;

const USAGE = `usage: rehomeWatcher --sweep [--all] [--dry-run] [--json] [--agent claude-code|codex|all]
       rehomeWatcher --session <id> [--agent <agent>] [--wait]
       options: --delete-repo <name>[,<name>] --assign <session-id-prefix>=<repo>\n`;

const agentsFor = (agentOption: string): ReadonlyArray<RehomeAgent> => {
  switch (agentOption) {
    case "claude-code":
      return ["claude-code"];
    case "codex":
      return ["codex"];
    default:
      return ["claude-code", "codex"];
  }
};

// e.g. ["aria,tend", "extension-installer"] → {"aria", "tend", "extension-installer"}
const splitNames = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  values
    .flatMap((value) => value.split(","))
    .map((name) => name.trim())
    .filter(Boolean);

// e.g. "5cc2fa97=vybekiit" → ["5cc2fa97", "vybekiit"]
const decodeAssignments = (values: ReadonlyArray<string>): ReadonlyMap<string, string> =>
  new Map(
    values.flatMap((value) => {
      const [sessionPrefix, repoName] = value.split("=").map((part) => part.trim());
      return sessionPrefix && repoName ? [[sessionPrefix, repoName] as const] : [];
    }),
  );

const decodeWatcherOptions = (argv: ReadonlyArray<string>): WatcherOptions => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      agent: { type: "string", default: "all" },
      session: { type: "string", default: "" },
      wait: { type: "boolean", default: false },
      sweep: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "delete-repo": { type: "string", multiple: true, default: [] },
      assign: { type: "string", multiple: true, default: [] },
    },
    strict: true,
  });
  return {
    agents: agentsFor(values.agent),
    sessionId: values.session,
    wait: values.wait,
    sweep: values.sweep,
    reevaluate: values.all || values.session !== "",
    dryRun: values["dry-run"],
    json: values.json,
    deletedRepoNames: new Set(splitNames(values["delete-repo"])),
    assignments: decodeAssignments(values.assign),
  };
};

const pause = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const sessionStillLive = async (request: { readonly homeRoot: string; readonly options: WatcherOptions }) => {
  const { homeRoot, options } = request;
  const claudeSession = options.agents.includes("claude-code")
    ? findClaudeSession({ homeRoot, sessionId: options.sessionId })
    : undefined;
  if (claudeSession) {
    return claudeSessionIsLive({ homeRoot, session: claudeSession, quietSeconds: ENDED_SESSION_QUIET_SECONDS });
  }

  const codexThread = options.agents.includes("codex")
    ? (await listCodexThreads(homeRoot)).find((thread) => thread.threadId === options.sessionId)
    : undefined;
  return codexThread
    ? codexThreadIsLive({ homeRoot, thread: codexThread, quietSeconds: ENDED_SESSION_QUIET_SECONDS })
    : false;
};

// SessionEnd runs before the agent's last writes and exit, so the hand-over waits for the agent to let go.
const waitUntilReady = async (request: { readonly homeRoot: string; readonly options: WatcherOptions }) => {
  const deadline = Date.now() + WAIT_LIMIT_MILLISECONDS;
  while (Date.now() < deadline) {
    if (!(await sessionStillLive(request)) && acquireWatcherLock()) {
      return true;
    }
    await pause(WAIT_POLL_MILLISECONDS);
  }
  return false;
};

const formatPlan = (plan: SessionPlan): string => {
  const target = plan.action === "move" ? `→ ${plan.repoName} (${Math.round(plan.share * 100)}%)` : plan.repoName;
  const candidates = plan.candidates.map((candidate) => `${candidate.repoName} ${Math.round(candidate.share * 100)}%`);
  const detail = plan.action === "uncertain" ? `candidates: ${candidates.join(", ") || "none"}` : target;
  return [
    plan.agent.padEnd(11),
    plan.sessionId,
    plan.action.padEnd(9),
    plan.status.padEnd(9),
    plan.fromFolder,
    detail,
    JSON.stringify(plan.title.slice(0, 80)),
  ].join("  ");
};

const printPlans = (request: { readonly plans: ReadonlyArray<SessionPlan>; readonly json: boolean }): void => {
  const report = request.json
    ? `${JSON.stringify(request.plans, null, 2)}\n`
    : request.plans.map((plan) => `${formatPlan(plan)}\n`).join("");
  writeSync(1, report);
};

const runWatcher = async (): Promise<void> => {
  const options = decodeWatcherOptions(process.argv.slice(2));
  if (!options.sweep && !options.sessionId) {
    writeSync(2, USAGE);
    return;
  }

  const homeRoot = process.env.HOME || os.homedir();
  const ready = options.wait ? await waitUntilReady({ homeRoot, options }) : acquireWatcherLock();
  if (!ready) {
    return;
  }

  try {
    const repos = discoverRepos({
      homeRoot,
      rootFolders: readConfig().sessionRehomeRoots,
      deletedRepoNames: [...options.deletedRepoNames],
    });
    const plans = await runSweep({
      homeRoot,
      repos,
      agents: options.agents,
      sessionId: options.sessionId,
      reevaluate: options.reevaluate,
      dryRun: options.dryRun,
      deletedRepoNames: options.deletedRepoNames,
      assignments: options.assignments,
      quietSeconds: options.sessionId ? ENDED_SESSION_QUIET_SECONDS : SWEEP_QUIET_SECONDS,
    });
    printPlans({ plans, json: options.json });
  } finally {
    releaseWatcherLock();
  }
};

runWatcher().catch((failure: unknown) => {
  if (readConfig().debugLogs) {
    writeSync(2, `session-rehome error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
  process.exit(0);
});
