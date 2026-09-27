#!/usr/bin/env node
// SessionStart hook: launches this session's autorun watcher detached and disarmed. A re-fired SessionStart is
// harmless because the watcher refuses to start twice. Always exits 0 so it never blocks the session.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { KILL_SWITCH } from "../lib/stateFiles.js";

const sessionIdFrom = (candidate: unknown): string => {
  if (typeof candidate !== "object" || candidate === null) return "";
  const sessionId = Object.getOwnPropertyDescriptor(candidate, "session_id")?.value;
  return typeof sessionId === "string" ? sessionId : "";
};

const startWatcher = (): void => {
  const sessionId = sessionIdFrom(JSON.parse(readFileSync(0, "utf8")));
  if (!sessionId || existsSync(KILL_SWITCH)) return;
  const watcherPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "autorunWatcher.js");
  spawn("node", [watcherPath, sessionId], { detached: true, stdio: "ignore" }).unref();
};

try {
  startWatcher();
} catch {
  // Never block session start.
} finally {
  process.exit(0);
}
