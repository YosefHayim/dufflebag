#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readConfig, resolveAutoCompactSeconds } from "../../../runtime/config.js";
import { claimGhosttyTerminal } from "../lib/ghosttyTerminal.js";
import {
  applyIdleCompactEvent,
  decodeIdleCompactSessionState,
  type IdleCompactEvent,
  normalizeIdleCompactEvent,
} from "../lib/idleCompactEvent.js";
import { exists, idleCompactFile, KILL_SWITCH, readJson, writeJsonAtomic } from "../lib/state.js";

const commandForAgent = (agentId: string): string => {
  if (agentId === "claude-code") return "claude";
  return agentId;
};

const commandContains = (command: string, executable: string): boolean =>
  command.split(/\s+/).some((part) => path.basename(part).toLowerCase() === executable.toLowerCase());

const findAgentPid = (executable: string): number | null => {
  let pid = process.ppid;
  for (let depth = 0; depth < 12 && pid > 1; depth++) {
    let output = "";
    try {
      output = execFileSync("ps", ["-p", String(pid), "-o", "ppid=", "-o", "command="], {
        encoding: "utf8",
        timeout: 2_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
    const match = /^(\d+)\s+(.+)$/.exec(output);
    if (!match) return null;
    if (commandContains(match[2] ?? "", executable)) return pid;
    pid = Number(match[1]);
  }
  return null;
};

const providerMatches = (event: IdleCompactEvent): boolean => {
  if (process.env.GROK_SESSION_ID && event.agentId !== "grok") return false;
  return true;
};

const startSession = (event: IdleCompactEvent): void => {
  const idleSeconds = resolveAutoCompactSeconds(event.agentId, process.env, readConfig().idleAutoCompact);
  if (idleSeconds === null) return;
  const executable = process.env.DUFFLEBAG_AGENT_COMMAND ?? commandForAgent(event.agentId);
  const agentPid = findAgentPid(executable);
  if (agentPid === null) return;
  const terminal = claimGhosttyTerminal(event.sessionId);
  if (terminal._tag !== "claimed") return;

  const stateFile = idleCompactFile(event.agentId, event.sessionId);
  writeJsonAtomic(stateFile, {
    agentId: event.agentId,
    sessionId: event.sessionId,
    agentPid,
    terminalId: terminal.terminalId,
    compactCommand: process.env.DUFFLEBAG_COMPACT_COMMAND ?? "/compact",
    idleSeconds,
    phase: "working",
    phaseStartedAtMs: event.occurredAtMs,
    sessionEnded: false,
    lastEventAtMs: event.occurredAtMs,
  });
  const watcher = path.join(path.dirname(fileURLToPath(import.meta.url)), "idleCompactWatch.js");
  const child = spawn("node", [watcher, stateFile], { detached: true, stdio: "ignore", env: process.env });
  child.unref();
};

const main = (): void => {
  if (exists(KILL_SWITCH)) return;
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const event = normalizeIdleCompactEvent(input, process.env, Date.now());
  if (!event || !providerMatches(event)) return;
  if (event.event === "session-started") {
    startSession(event);
    return;
  }
  const stateFile = idleCompactFile(event.agentId, event.sessionId);
  const state = decodeIdleCompactSessionState(readJson(stateFile));
  if (!state) return;
  writeJsonAtomic(stateFile, applyIdleCompactEvent(state, event));
};

try {
  main();
} catch {
  /* fail-open: lifecycle automation must never block the coding agent */
} finally {
  process.exit(0);
}
