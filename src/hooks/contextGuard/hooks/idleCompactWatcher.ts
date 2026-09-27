#!/usr/bin/env node
// Background process for one idle compact session: polls its state file and acts on the idle compact decision.

import { closeSync, existsSync, openSync, writeSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { sendTerminalInput, terminalExists } from "../lib/ghosttyTerminal.js";
import { decideIdleCompactAction, type IdleCompactAction, type IdleCompactPhase } from "../lib/idleCompactDecision.js";
import { decodeIdleCompactSessionState, type IdleCompactSessionState } from "../lib/idleCompactSession.js";
import { withKeystrokeLock } from "../lib/keystrokeLock.js";
import { isProcessAlive } from "../lib/processAlive.js";
import { KILL_SWITCH, readJson, remove, writeJsonAtomic } from "../lib/stateFiles.js";

const POLL_MS = 500;
const ACKNOWLEDGEMENT_SECONDS = 2;

// True to keep watching; a failed send forgets the session.
const performAction = async (request: {
  readonly stateFile: string;
  readonly state: IdleCompactSessionState;
  readonly action: IdleCompactAction;
}): Promise<boolean> => {
  const { stateFile, state } = request;
  const enterPhase = (phase: IdleCompactPhase): void =>
    writeJsonAtomic(stateFile, { ...state, phase, phaseStartedAtMs: Date.now() });

  const sendOrForget = async (text: string): Promise<boolean> => {
    if (await withKeystrokeLock(() => sendTerminalInput({ terminalId: state.terminalId, text, submit: true }))) {
      return true;
    }
    remove(stateFile);
    return false;
  };

  switch (request.action._tag) {
    case "reap":
      remove(stateFile);
      return false;
    case "submitDraft":
      enterPhase("awaitingPrompt");
      return sendOrForget("");
    case "compact":
      enterPhase("compacting");
      return sendOrForget("/compact");
    case "park":
      if (state.phase !== "parked") enterPhase("parked");
      return true;
    case "wait":
      return true;
  }
};

const continueWatching = async (stateFile: string): Promise<boolean> => {
  if (existsSync(KILL_SWITCH)) return false;
  const state = decodeIdleCompactSessionState(readJson(stateFile));
  if (!state) return false;
  const action = decideIdleCompactAction({
    phase: state.phase,
    nowMs: Date.now(),
    phaseStartedAtMs: state.phaseStartedAtMs,
    idleSeconds: state.idleSeconds,
    acknowledgementSeconds: ACKNOWLEDGEMENT_SECONDS,
    agentAlive: isProcessAlive(state.agentPid),
    sessionEnded: state.sessionEnded,
    terminalAvailable: terminalExists(state.terminalId),
  });
  return performAction({ stateFile, state, action });
};

// One watcher per state file: the exclusive `.watcher` lock file makes a second start a no-op.
const watchStateFile = async (stateFile: string): Promise<void> => {
  const watcherLock = `${stateFile}.watcher`;
  try {
    const descriptor = openSync(watcherLock, "wx");
    writeSync(descriptor, String(process.pid));
    closeSync(descriptor);
  } catch {
    return;
  }

  try {
    while (await continueWatching(stateFile)) {
      await sleep(POLL_MS);
    }
  } finally {
    remove(watcherLock);
  }
};

const watchedStateFile = process.argv[2];
if (watchedStateFile) watchStateFile(watchedStateFile).catch(() => process.exit(0));
