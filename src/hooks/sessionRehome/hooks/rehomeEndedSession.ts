#!/usr/bin/env node
// SessionEnd hook: hands the ended Claude Code session or Codex thread to a detached rehome watcher and exits at once,
// because both agents give SessionEnd hooks only a second or two. Fails open.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Claude Code session IDs are UUIDv4 and Codex thread IDs UUIDv7 — never "../x" or "*".
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const sessionIdFrom = (candidate: unknown): string => {
  if (typeof candidate !== "object" || candidate === null) {
    return "";
  }

  const sessionId = Object.getOwnPropertyDescriptor(candidate, "session_id")?.value;
  return typeof sessionId === "string" && SESSION_ID_PATTERN.test(sessionId) ? sessionId : "";
};

const agentFrom = (agentId: string | undefined): string =>
  agentId === "claude-code" || agentId === "codex" ? agentId : "";

const handOverEndedSession = (): void => {
  const agent = agentFrom(process.env.DUFFLEBAG_AGENT_ID);
  const sessionId = sessionIdFrom(JSON.parse(readFileSync(0, "utf8")));
  if (!agent || !sessionId) {
    return;
  }

  // The watcher sits beside this file with the same extension: .js when installed, .ts under tsx in tests, where
  // execArgv carries the tsx loader.
  const hookFile = fileURLToPath(import.meta.url);
  const watcherFile = path.join(path.dirname(hookFile), `rehomeWatcher${path.extname(hookFile)}`);
  spawn(process.execPath, [...process.execArgv, watcherFile, "--agent", agent, "--session", sessionId, "--wait"], {
    detached: true,
    stdio: "ignore",
  }).unref();
};

try {
  handOverEndedSession();
} catch {
  // Never block or delay the agent's exit.
}
process.exit(0);
