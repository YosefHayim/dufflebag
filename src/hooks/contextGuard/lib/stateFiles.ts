// State paths under <installRoot>/state/ (~/.claude/dufflebag/state for a global install) and the small
// file helpers shared by the guard, autorun control, and both watchers.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { installRoot } from "../../lib/hookConfig.js";

const STATE_DIR = path.join(installRoot, "state");

export const KILL_SWITCH = path.join(STATE_DIR, "context-guard-off");
export const AUTORUN_STATE_DIR = path.join(STATE_DIR, "autorun");
export const KEYSTROKE_LOCK = path.join(STATE_DIR, "keystroke.lock");

// e.g. autorunFile(sessionId, "armed") → state/autorun/<sessionId>.armed
export const autorunFile = (sessionId: string, suffix: string): string =>
  path.join(AUTORUN_STATE_DIR, `${sessionId}.${suffix}`);

export const nudgeFile = (sessionId: string): string => path.join(STATE_DIR, "context-guard", `${sessionId}.nudged`);

export const idleCompactFile = (agentId: string, sessionId: string): string =>
  path.join(STATE_DIR, "idle-compact", `${encodeURIComponent(agentId)}-${encodeURIComponent(sessionId)}.json`);

export const isArmed = (sessionId: string): boolean => existsSync(autorunFile(sessionId, "armed"));

export const readText = (file: string): string => {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
};

export const readInt = (file: string, fallback = 0): number => {
  const value = parseInt(readText(file), 10);
  return Number.isFinite(value) ? value : fallback;
};

export const writeText = (file: string, text: string | number): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, String(text), "utf8");
};

export const writeJsonAtomic = (file: string, value: unknown): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  const partialFile = `${file}.${process.pid}.tmp`;
  writeFileSync(partialFile, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  renameSync(partialFile, file);
};

export const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

export const remove = (file: string): void => {
  try {
    rmSync(file, { force: true });
  } catch {
    // A leftover state file is harmless; never fail the caller over it.
  }
};
