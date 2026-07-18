#!/usr/bin/env node
/**
 * ctx-loop-ctl — the control plane behind the single `autorun` skill. The skill is
 * thin: it shells out to one of these subcommands based on its argument
 * (`/autorun <n>` → arm, `/autorun stop` → stop, `/autorun exit` → exit). Keeping the
 * logic here (not regenerated per verb) makes arm/pause/exit deterministic and gives
 * all three a single, consistent accounting report.
 *
 *   arm <n>   /autorun       — arm this session with a cycle budget (bare = config default),
 *                              reset counters, clear markers, spawn the daemon if needed.
 *   stop      /autorun stop  — pause: delete the arm flag (daemon keeps observing), report.
 *   exit      /autorun exit  — disarm AND tell the daemon to self-terminate, report.
 *
 * Session id is auto-detected from the newest transcript, so the skills never
 * thread it through. State lives in ~/.claude/.ctx-loop-state/<sid>.*.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readConfig } from "../../../runtime/config.js";
import { loopFile, readInt, remove, writeText } from "../lib/state.js";
import { resolveSessionId, sumTokens } from "../lib/transcript.js";

const DEFAULT_BUDGET = readConfig().autorunDefaultCycleCount;
const RATE_LIMITS_FILE = path.join(homedir(), ".claude", ".last-rate-limits.json");

const daemonPath = (): string => path.join(path.dirname(fileURLToPath(import.meta.url)), "ctxWatch.js");

/** Read a marker file's text content (the halt reason), or "" if absent. */
function readText(file: string): string {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

/** True if the daemon process recorded for this session is still alive. */
function daemonAlive(sid: string): boolean {
  const pid = readInt(loopFile(sid, "pid"), 0);
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Launch the daemon detached if it isn't already holding the lock. */
function spawnDaemon(sid: string): void {
  if (daemonAlive(sid)) return;
  const child = spawn("node", [daemonPath(), sid], { detached: true, stdio: "ignore" });
  child.unref();
}

const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
const fmtPct = (v: unknown): string => (typeof v === "number" ? `${Math.round(v)}%` : "n/a");
function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "n/a";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

const HALT_REASONS: Record<string, string> = {
  "budget-reached": "cycle budget reached",
  "hard-cap": "hard cycle cap hit (anti-runaway)",
  done: "task marked done",
};

/** Best-effort (five_hour_pct, weekly_pct) from the statusline side-channel. */
function rateLimits(): { five?: number; week?: number } {
  try {
    const data = JSON.parse(readFileSync(RATE_LIMITS_FILE, "utf8")) as { five_hour_pct?: number; weekly_pct?: number };
    return { five: data.five_hour_pct, week: data.weekly_pct };
  } catch {
    return {};
  }
}

function report(sid: string, headline: string): void {
  const cycles = readInt(loopFile(sid, "cycles"), 0);
  const budget = readInt(loopFile(sid, "budget"), DEFAULT_BUDGET);
  const started = readInt(loopFile(sid, "started"), 0);
  const elapsed = started ? Date.now() / 1000 - started : 0;
  const { input, output } = sumTokens(sid);
  const { five, week } = rateLimits();
  const halt = readText(loopFile(sid, "halted"));

  const lines = [
    headline,
    `  • cycles run     : ${cycles} / ${budget} budget`,
    `  • tokens in      : ${fmtTokens(input)}`,
    `  • tokens out     : ${fmtTokens(output)}`,
    `  • session time   : ${fmtDuration(elapsed)}`,
    `  • 5h usage       : ${fmtPct(five)}`,
    `  • weekly usage   : ${fmtPct(week)}`,
  ];
  if (halt) lines.push(`  • last auto-halt : ${HALT_REASONS[halt] ?? halt}`);
  console.log(lines.join("\n"));
}

function cmdArm(sid: string, args: string[]): void {
  let budget = DEFAULT_BUDGET;
  if (args[0]) {
    const n = parseInt(args[0], 10);
    if (Number.isFinite(n)) budget = Math.max(1, n);
  }
  writeText(loopFile(sid, "budget"), budget);
  writeText(loopFile(sid, "cycles"), 0);
  for (const suffix of ["done", "halted", "exit"]) remove(loopFile(sid, suffix));
  if (!readInt(loopFile(sid, "started"), 0)) writeText(loopFile(sid, "started"), Math.floor(Date.now() / 1000));
  writeText(loopFile(sid, "armed"), "");
  spawnDaemon(sid);
  console.log(
    `🟢 Autorun ARMED — budget ${budget} cycle(s).\n` +
      "   The ctx-watch daemon will /compact + auto-resume each time context nears the guardrail and a fresh handoff exists, " +
      "until the budget is spent, you /autorun stop, or the task is marked done.\n" +
      "   Safety: it types only into THIS session's Ghostty window (located by title, idle-only) and refuses rather than guess. " +
      "Global kill: touch ~/.claude/.ctx-guard-off",
  );
}

function cmdStop(sid: string): void {
  remove(loopFile(sid, "armed"));
  report(sid, "⏸️  Autorun PAUSED (/autorun stop) — daemon still observing; /autorun to resume.");
}

function cmdExit(sid: string): void {
  remove(loopFile(sid, "armed"));
  writeText(loopFile(sid, "exit"), ""); // daemon self-terminates on its next poll
  report(sid, "🛑 Autorun EXITED (/autorun exit) — daemon shutting down for this session.");
}

function main(): void {
  const cmd = process.argv[2];
  if (!cmd || !["arm", "stop", "exit"].includes(cmd)) {
    console.error("usage: ctxLoopCtl.js {arm <n>|stop|exit}");
    process.exit(2);
  }
  const sid = resolveSessionId();
  if (!sid) {
    console.error("ctx-loop: no active session transcript found.");
    process.exit(1);
  }
  if (cmd === "arm") cmdArm(sid, process.argv.slice(3));
  else if (cmd === "stop") cmdStop(sid);
  else cmdExit(sid);
}

main();
