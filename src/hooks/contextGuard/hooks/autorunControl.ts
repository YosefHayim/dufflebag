#!/usr/bin/env node
// Control commands behind the `autorun` skill: `arm <n>` (/autorun), `stop` (/autorun stop, pause while the watcher
// keeps observing), and `exit` (/autorun exit, disarm and stop the watcher). The session is the newest transcript.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readConfig } from "../../lib/hookConfig.js";
import { isProcessAlive } from "../../lib/processAlive.js";
import { resolveSessionId, sumTokens } from "../lib/sessionTranscript.js";
import { autorunFile, KILL_SWITCH, readInt, readText, remove, writeText } from "../lib/stateFiles.js";

const DEFAULT_BUDGET = readConfig().autorunDefaultCycles;
const RATE_LIMITS_FILE = path.join(homedir(), ".claude", "dufflebag", "state", "rate-limits.json");

const HALT_REASONS: Record<string, string> = {
  "budget-reached": "cycle budget reached",
  "hard-cap": "hard cycle cap hit (anti-runaway)",
  done: "task marked done",
};

// The watcher reads config.json itself, so it only needs the session ID.
const startWatcher = (sessionId: string): void => {
  if (isProcessAlive(readInt(autorunFile(sessionId, "pid")))) return;
  const watcherPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "autorunWatcher.js");
  spawn("node", [watcherPath, sessionId], { detached: true, stdio: "ignore" }).unref();
};

const formatTokens = (tokenCount: number): string => {
  if (tokenCount >= 1_000_000) return `${(tokenCount / 1_000_000).toFixed(1)}M`;
  if (tokenCount >= 1_000) return `${(tokenCount / 1_000).toFixed(1)}k`;
  return String(tokenCount);
};

const formatPercent = (percent: number | undefined): string =>
  percent === undefined ? "n/a" : `${Math.round(percent)}%`;

const formatDuration = (seconds: number): string => {
  if (seconds <= 0) return "n/a";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds % 60)}s`;
};

const numberOrUndefined = (candidate: object, key: string): number | undefined => {
  const value = Object.getOwnPropertyDescriptor(candidate, key)?.value;
  return typeof value === "number" ? value : undefined;
};

// Best-effort usage percentages from the status line's side channel.
const rateLimits = (): { fiveHour?: number; weekly?: number } => {
  try {
    const candidate: unknown = JSON.parse(readFileSync(RATE_LIMITS_FILE, "utf8"));
    if (typeof candidate !== "object" || candidate === null) return {};
    return {
      fiveHour: numberOrUndefined(candidate, "five_hour_pct"),
      weekly: numberOrUndefined(candidate, "weekly_pct"),
    };
  } catch {
    return {};
  }
};

const printReport = (sessionId: string, headline: string): void => {
  const cycles = readInt(autorunFile(sessionId, "cycles"));
  const budget = readInt(autorunFile(sessionId, "budget"), DEFAULT_BUDGET);
  const started = readInt(autorunFile(sessionId, "started"));
  const { input, output } = sumTokens(sessionId);
  const { fiveHour, weekly } = rateLimits();
  const halt = readText(autorunFile(sessionId, "halted"));
  const lines = [
    headline,
    `  • cycles run     : ${cycles} / ${budget} budget`,
    `  • tokens in      : ${formatTokens(input)}`,
    `  • tokens out     : ${formatTokens(output)}`,
    `  • session time   : ${formatDuration(started ? Date.now() / 1000 - started : 0)}`,
    `  • 5h usage       : ${formatPercent(fiveHour)}`,
    `  • weekly usage   : ${formatPercent(weekly)}`,
  ];
  if (halt) lines.push(`  • last auto-halt : ${HALT_REASONS[halt] || halt}`);
  console.log(lines.join("\n"));
};

const armAutorun = (sessionId: string, budgetArgument: string | undefined): void => {
  const requestedBudget = budgetArgument ? parseInt(budgetArgument, 10) : Number.NaN;
  const budget = Number.isFinite(requestedBudget) ? Math.max(1, requestedBudget) : DEFAULT_BUDGET;
  writeText(autorunFile(sessionId, "budget"), budget);
  writeText(autorunFile(sessionId, "cycles"), 0);
  for (const suffix of ["done", "halted", "exit"]) remove(autorunFile(sessionId, suffix));
  if (!readInt(autorunFile(sessionId, "started"))) {
    writeText(autorunFile(sessionId, "started"), Math.floor(Date.now() / 1000));
  }
  writeText(autorunFile(sessionId, "armed"), "");
  startWatcher(sessionId);
  console.log(
    `🟢 Autorun ARMED — budget ${budget} cycle(s).\n` +
      "   The autorun watcher will /compact + auto-resume each time context nears the guardrail and a fresh handoff exists, " +
      "until the budget is spent, you /autorun stop, or the task is marked done.\n" +
      "   Safety: it types only into THIS session's Ghostty window (located by title, idle-only) and refuses rather than guess. " +
      `Global kill: touch ${KILL_SWITCH}`,
  );
};

const pauseAutorun = (sessionId: string): void => {
  remove(autorunFile(sessionId, "armed"));
  printReport(sessionId, "⏸️  Autorun PAUSED (/autorun stop) — the watcher is still observing; /autorun to resume.");
};

const exitAutorun = (sessionId: string): void => {
  remove(autorunFile(sessionId, "armed"));
  writeText(autorunFile(sessionId, "exit"), "");
  printReport(sessionId, "🛑 Autorun EXITED (/autorun exit) — the watcher is shutting down for this session.");
};

const runAutorunControl = (): void => {
  const command = process.argv[2];
  if (command !== "arm" && command !== "stop" && command !== "exit") {
    console.error("usage: autorunControl.js {arm <n>|stop|exit}");
    process.exit(2);
  }
  const sessionId = resolveSessionId();
  if (!sessionId) {
    console.error("autorun: no active session transcript found.");
    process.exit(1);
  }
  if (command === "arm") armAutorun(sessionId, process.argv[3]);
  else if (command === "stop") pauseAutorun(sessionId);
  else exitAutorun(sessionId);
};

runAutorunControl();
