// The autorun and idle compact watchers both take this lock before typing, so their keystrokes never interleave.

import { closeSync, mkdirSync, openSync, statSync, writeSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { KEYSTROKE_LOCK, remove } from "./stateFiles.js";

// Typing takes well under a second, so a lock this old belongs to a watcher that died mid-send.
const STALE_AFTER_MS = 30_000;
const WAIT_FOR_LOCK_MS = 20_000;
const RETRY_EVERY_MS = 300;

const errorCode = (failure: unknown): unknown =>
  typeof failure === "object" && failure !== null ? Object.getOwnPropertyDescriptor(failure, "code")?.value : undefined;

const tryLock = (): "acquired" | "busy" | "failed" => {
  try {
    mkdirSync(path.dirname(KEYSTROKE_LOCK), { recursive: true });
    const descriptor = openSync(KEYSTROKE_LOCK, "wx");
    writeSync(descriptor, String(process.pid));
    closeSync(descriptor);
    return "acquired";
  } catch (failure) {
    return errorCode(failure) === "EEXIST" ? "busy" : "failed";
  }
};

const lockIsStale = (): boolean => {
  try {
    return Date.now() - statSync(KEYSTROKE_LOCK).mtimeMs > STALE_AFTER_MS;
  } catch {
    return false;
  }
};

const acquireKeystrokeLock = async (): Promise<boolean> => {
  const deadline = Date.now() + WAIT_FOR_LOCK_MS;
  while (Date.now() < deadline) {
    const attempt = tryLock();
    if (attempt === "acquired") return true;
    if (attempt === "failed") return false;
    if (lockIsStale()) remove(KEYSTROKE_LOCK);
    else await sleep(RETRY_EVERY_MS);
  }
  return false;
};

// False when the lock stays busy for WAIT_FOR_LOCK_MS or `send` fails.
export const withKeystrokeLock = async (send: () => boolean): Promise<boolean> => {
  if (!(await acquireKeystrokeLock())) return false;
  try {
    return send();
  } finally {
    remove(KEYSTROKE_LOCK);
  }
};
