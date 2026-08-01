/**
 * Tiny filesystem state layer shared by the guard, control plane, and daemon.
 *
 * The autonomous loop coordinates entirely through marker files under
 * ~/.claude/.ctx-loop-state/<sid>.* (armed, budget, cycles, pid, done, halted,
 * exit) and the guard de-dupes its nudge via ~/.claude/.ctx-guard-state. This
 * mirrors the original Python layout exactly so a half-migrated machine stays
 * consistent. Dependency-free; ships in the hook payload.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const CLAUDE_DIR = path.join(homedir(), ".claude");

export const KILL_SWITCH = path.join(CLAUDE_DIR, ".ctx-guard-off");
export const LOOP_STATE_DIR = path.join(CLAUDE_DIR, ".ctx-loop-state");
export const GUARD_STATE_DIR = path.join(CLAUDE_DIR, ".ctx-guard-state");

/** Path to a loop marker file, e.g. loopFile(sid, "armed"). */
export const loopFile = (sid: string, suffix: string): string => path.join(LOOP_STATE_DIR, `${sid}.${suffix}`);
/** Path to the guard's per-session nudge flag. */
export const guardFlag = (sid: string): string => path.join(GUARD_STATE_DIR, `${sid}.nudged`);
export const idleCompactFile = (agentId: string, sid: string): string =>
  path.join(LOOP_STATE_DIR, `idle-${encodeURIComponent(agentId)}-${encodeURIComponent(sid)}.json`);

export const exists = (file: string): boolean => existsSync(file);

export function readInt(file: string, fallback = 0): number {
  try {
    const n = parseInt(readFileSync(file, "utf8").trim(), 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function writeText(file: string, text: string | number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, String(text), "utf8");
}

export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, file);
}

export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function remove(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}

/** True if the autonomous loop is armed for this session (/autorun). */
export const isArmed = (sid: string): boolean => existsSync(loopFile(sid, "armed"));
