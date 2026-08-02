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

const reclaimStaleInputLock = (): boolean => {
  try {
    const lockModifiedAt = existsSync(KEY_LOCK) ? statSync(KEY_LOCK).mtimeMs : Date.now();
    if (Date.now() - lockModifiedAt <= KEY_LOCK_STALE_MS) return false;
    remove(KEY_LOCK);
    return true;
  } catch {
    return false;
  }
};

const acquireInputLock = (): boolean => {
  try {
    const descriptor = openSync(KEY_LOCK, "wx");
    writeSync(descriptor, `${process.pid} ${Math.floor(Date.now() / 1_000)}`);
    closeSync(descriptor);
    return true;
  } catch {}
  return reclaimStaleInputLock() && acquireInputLock();
};

const withInputLock = (send: () => boolean): boolean => {
  if (!acquireInputLock()) return false;
  try {
    return send();
  } finally {
    remove(KEY_LOCK);
  }
};

type CompactAction = ReturnType<typeof decideIdleCompactAction>;
type CompactState = NonNullable<ReturnType<typeof decodeIdleCompactSessionState>>;

const performAction = (request: {
  readonly stateFile: string;
  readonly state: CompactState;
  readonly action: CompactAction;
}): boolean => {
  switch (request.action._tag) {
    case "reap":
      remove(request.stateFile);
      return false;
    case "submitDraft":
      writeJsonAtomic(request.stateFile, {
        ...request.state,
        phase: "awaitingPrompt",
        phaseStartedAtMs: Date.now(),
      });
      if (withInputLock(() => sendTerminalEnter(request.state.terminalId))) return true;
      remove(request.stateFile);
      return false;
    case "compact":
      writeJsonAtomic(request.stateFile, { ...request.state, phase: "compacting", phaseStartedAtMs: Date.now() });
      if (
        withInputLock(() =>
          sendTerminalText({
            terminalId: request.state.terminalId,
            text: request.state.compactCommand,
            submit: true,
          }),
        )
      ) {
        return true;
      }
      remove(request.stateFile);
      return false;
    case "park":
      if (request.state.phase !== "parked") {
        writeJsonAtomic(request.stateFile, { ...request.state, phase: "parked", phaseStartedAtMs: Date.now() });
      }
      return true;
    case "wait":
      return true;
  }
};

const continueWatching = (stateFile: string): boolean => {
  if (existsSync(KILL_SWITCH)) return false;
  const state = decodeIdleCompactSessionState(readJson(stateFile));
  if (!state) return false;
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
  return performAction({ stateFile, state, action });
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
    while (continueWatching(stateFile)) {
      await sleep(POLL_MS);
    }
  } finally {
    remove(watcherLock);
  }
};

void main().catch(() => process.exit(0));
