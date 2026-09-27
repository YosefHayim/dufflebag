#!/usr/bin/env node
// Records agent lifecycle events into the idle compact session file; a session start claims the agent's Ghostty
// terminal and launches the idle compact watcher.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readConfig, resolveIdleCompactSeconds } from "../../lib/hookConfig.js";
import { claimFocusedGhosttyTerminal, claimGhosttyTerminal } from "../lib/ghosttyTerminal.js";
import {
  applyIdleCompactEvent,
  decodeIdleCompactSessionState,
  type IdleCompactEvent,
  normalizeIdleCompactEvent,
} from "../lib/idleCompactSession.js";
import { idleCompactFile, KILL_SWITCH, readJson, writeJsonAtomic } from "../lib/stateFiles.js";

const processStatus = (args: ReadonlyArray<string>): string =>
  execFileSync("ps", args, { encoding: "utf8", timeout: 2_000, stdio: ["ignore", "pipe", "ignore"] }).trim();

const commandContains = (command: string, executable: string): boolean =>
  command.split(/\s+/).some((part) => path.basename(part).toLowerCase() === executable.toLowerCase());

// Walks up from this hook's parent process to the agent's own process.
const findAgentPid = (executable: string): number | null => {
  let pid = process.ppid;
  for (let depth = 0; depth < 12 && pid > 1; depth++) {
    let output = "";
    try {
      output = processStatus(["-p", String(pid), "-o", "ppid=", "-o", "command="]);
    } catch {
      return null;
    }
    const match = /^(\d+)\s+(.+)$/.exec(output);
    if (!match) return null;
    if (commandContains(match[2], executable)) return pid;
    pid = Number(match[1]);
  }
  return null;
};

const terminalDeviceForPid = (pid: number): string | null => {
  try {
    const tty = processStatus(["-p", String(pid), "-o", "tty="]);
    return tty === "" || tty === "??" ? null : `/dev/${tty}`;
  } catch {
    return null;
  }
};

const startSession = (event: IdleCompactEvent): void => {
  const idleSeconds = resolveIdleCompactSeconds({ env: process.env, configValue: readConfig().idleCompactAfter });
  if (idleSeconds === null) return;
  const agentPid = findAgentPid(event.agentId === "claude-code" ? "claude" : event.agentId);
  if (agentPid === null) return;
  const terminalDevice = terminalDeviceForPid(agentPid);
  if (terminalDevice === null) return;
  const focusedTerminal = claimFocusedGhosttyTerminal();
  const terminal =
    focusedTerminal._tag === "claimed" ? focusedTerminal : claimGhosttyTerminal(event.sessionId, terminalDevice);
  if (terminal._tag !== "claimed") return;

  const stateFile = idleCompactFile(event.agentId, event.sessionId);
  writeJsonAtomic(stateFile, {
    agentId: event.agentId,
    sessionId: event.sessionId,
    agentPid,
    terminalId: terminal.terminalId,
    idleSeconds,
    phase: "working",
    phaseStartedAtMs: event.occurredAtMs,
    sessionEnded: false,
    lastEventAtMs: event.occurredAtMs,
  });
  const watcher = path.join(path.dirname(fileURLToPath(import.meta.url)), "idleCompactWatcher.js");
  spawn("node", [watcher, stateFile], { detached: true, stdio: "ignore", env: process.env }).unref();
};

const recordEvent = (): void => {
  if (existsSync(KILL_SWITCH)) return;
  const event = normalizeIdleCompactEvent({
    input: JSON.parse(readFileSync(0, "utf8")),
    environment: process.env,
    occurredAtMs: Date.now(),
  });
  // Under Grok, record only Grok's own events.
  if (!event || (process.env.GROK_SESSION_ID && event.agentId !== "grok")) return;
  if (event.event === "session-started") {
    startSession(event);
    return;
  }
  const stateFile = idleCompactFile(event.agentId, event.sessionId);
  const state = decodeIdleCompactSessionState(readJson(stateFile));
  if (state) writeJsonAtomic(stateFile, applyIdleCompactEvent(state, event));
  else if (event.event === "prompt-started") startSession(event);
};

try {
  recordEvent();
} catch {
  // Fail open: lifecycle automation must never block the coding agent.
} finally {
  process.exit(0);
}
