#!/usr/bin/env node

import { closeSync, existsSync, openSync, statSync, writeSync } from "node:fs";
import path from "node:path";
import { sendTerminalEnter, sendTerminalText, terminalExists } from "../lib/ghosttyTerminal.js";
import { decodeIdleCompactSessionState } from "../lib/idleCompactEvent.js";
import { decideIdleCompactAction } from "../lib/idleCompactGate.js";
import { KILL_SWITCH, LOOP_STATE_DIR, readJson, remove, writeJsonAtomic } from "../lib/state.js";

const POLL_MS = 500;
const ACKNOWLEDGEMENT_SECONDS = 2;
const KEY_LOCK_STALE_MS = 30_000;
const KEY_LOCK = path.join(LOOP_STATE_DIR, ".keys.lock");

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const acquireInputLock = (): boolean => {
  try {
    const descriptor = openSync(KEY_LOCK, "wx");
    writeSync(descriptor, `${process.pid} ${Date.now()}`);
    closeSync(descriptor);
    return true;
  } catch {
    try {
      const age = Date.now() - (existsSync(KEY_LOCK) ? statSync(KEY_LOCK).mtimeMs : Date.now());
      if (age > KEY_LOCK_STALE_MS) {
        remove(KEY_LOCK);
        return acquireInputLock();
      }
    } catch {
      /* fail closed */
    }
    return false;
  }
};

const withInputLock = (send: () => boolean): boolean => {
  if (!acquireInputLock()) return false;
  try {
    return send();
  } finally {
    remove(KEY_LOCK);
  }
};

const main = async (): Promise<void> => {
  const stateFile = process.argv[2];
  if (!stateFile) return;
  const watcherLock = `${stateFile}.watcher`;
  let watcherDescriptor: number;
  try {
    watcherDescriptor = openSync(watcherLock, "wx");
    writeSync(watcherDescriptor, String(process.pid));
    closeSync(watcherDescriptor);
  } catch {
    return;
  }

  try {
    for (;;) {
      if (existsSync(KILL_SWITCH)) return;
      const state = decodeIdleCompactSessionState(readJson(stateFile));
      if (!state) return;

      const action = decideIdleCompactAction({
        phase: state.phase,
        nowMs: Date.now(),
        phaseStartedAtMs: state.phaseStartedAtMs,
        idleSeconds: state.idleSeconds,
        acknowledgementSeconds: ACKNOWLEDGEMENT_SECONDS,
        agentAlive: processAlive(state.agentPid),
        sessionEnded: state.sessionEnded,
        terminalAvailable: terminalExists(state.terminalId),
      });

      if (action._tag === "reap") {
        remove(stateFile);
        return;
      }
      if (action._tag === "submitDraft") {
        writeJsonAtomic(stateFile, { ...state, phase: "awaitingPrompt", phaseStartedAtMs: Date.now() });
        if (!withInputLock(() => sendTerminalEnter(state.terminalId))) {
          remove(stateFile);
          return;
        }
      } else if (action._tag === "compact") {
        writeJsonAtomic(stateFile, { ...state, phase: "compacting", phaseStartedAtMs: Date.now() });
        if (!withInputLock(() => sendTerminalText(state.terminalId, state.compactCommand, true))) {
          remove(stateFile);
          return;
        }
      } else if (action._tag === "park" && state.phase !== "parked") {
        writeJsonAtomic(stateFile, { ...state, phase: "parked", phaseStartedAtMs: Date.now() });
      }
      await sleep(POLL_MS);
    }
  } finally {
    remove(watcherLock);
  }
};

void main().catch(() => process.exit(0));
