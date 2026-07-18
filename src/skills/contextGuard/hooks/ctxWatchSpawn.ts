#!/usr/bin/env node
/**
 * ctx-watch-spawn — SessionStart hook glue. Reads the hook's stdin JSON, pulls
 * the session id, and launches the ctx-watch daemon fully detached and DISARMED
 * (it only ever acts after /autorun). Idempotent: the daemon refuses to
 * double-spawn via its PID lockfile, so a re-fired SessionStart is harmless.
 * Always exits 0 so a spawn failure never blocks the session from starting.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exists, KILL_SWITCH } from "../lib/state.js";

function main(): void {
  let sid = "";
  try {
    sid = (JSON.parse(readFileSync(0, "utf8")) as { session_id?: string }).session_id ?? "";
  } catch {
    return;
  }
  if (!sid) return;
  if (exists(KILL_SWITCH)) return; // global kill switch

  const daemon = path.join(path.dirname(fileURLToPath(import.meta.url)), "ctxWatch.js");
  const child = spawn("node", [daemon, sid], { detached: true, stdio: "ignore" });
  child.unref();
}

try {
  main();
} catch {
  /* never block session start */
} finally {
  process.exit(0);
}
