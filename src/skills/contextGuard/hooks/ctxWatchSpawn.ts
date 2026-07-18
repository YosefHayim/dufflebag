#!/usr/bin/env node
/**
 * ctx-watch-spawn — SessionStart hook glue. Reads the hook's stdin JSON, pulls
 * the session id, and launches the ctx-watch daemon fully detached and DISARMED
 * (it only ever acts after /autorun). Idempotent: the daemon refuses to
 * double-spawn via its PID lockfile, so a re-fired SessionStart is harmless.
 * Always exits 0 so a spawn failure never blocks the session from starting.
 *
 * The detached child freezes env at spawn. Claude Code injects settings.json
 * `env` into the session (and therefore this hook), but we still pass the
 * effective `dufflebag*` map explicitly so the daemon cannot silently fall
 * back to built-in defaults if inheritance is incomplete.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { planDaemonSpawn } from "../../../runtime/config.js";
import { exists, KILL_SWITCH, loopFile, writeText } from "../lib/state.js";

const main = (): void => {
  let sid = "";
  try {
    sid = (JSON.parse(readFileSync(0, "utf8")) as { session_id?: string }).session_id ?? "";
  } catch {
    return;
  }
  if (!sid) return;
  if (exists(KILL_SWITCH)) return; // global kill switch

  const daemonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "ctxWatch.js");
  const plan = planDaemonSpawn({ sessionId: sid, daemonPath });
  // Snapshot what the daemon freezes so `dufflebag doctor` can compare with managed config.
  writeText(loopFile(sid, "config"), JSON.stringify(plan.configSnapshot));
  const child = spawn(plan.command, [...plan.args], plan.options);
  child.unref();
};

try {
  main();
} catch {
  /* never block session start */
} finally {
  process.exit(0);
}
