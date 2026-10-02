#!/usr/bin/env node
// SessionStart hook: when a resumed session was moved by session-rehome, says where it went; also starts an
// occasional background sweep that catches sessions whose agent exited without a SessionEnd. Fails open.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { allowAndExit, printDecisionAndExit } from "../../lib/hookOutput.js";
import { movedSessionNotice } from "../lib/movedSessionNotice.js";
import {
  claimSweepSlot,
  ledgerEntryFor,
  type RehomeAgent,
  readLedger,
  recordLedgerEntry,
} from "../lib/rehomeLedger.js";

type SessionStartEvent = { readonly sessionId: string; readonly source: string; readonly cwd: string };

const SWEEP_EVERY_SECONDS = 10 * 60;

const textProperty = (candidate: object, property: string): string => {
  const value = Object.getOwnPropertyDescriptor(candidate, property)?.value;
  return typeof value === "string" ? value : "";
};

const decodeSessionStart = (candidate: unknown): SessionStartEvent | undefined => {
  if (typeof candidate !== "object" || candidate === null || !textProperty(candidate, "session_id")) {
    return undefined;
  }

  return {
    sessionId: textProperty(candidate, "session_id"),
    source: textProperty(candidate, "source"),
    cwd: textProperty(candidate, "cwd"),
  };
};

const agentFrom = (agentId: string | undefined): RehomeAgent | undefined =>
  agentId === "claude-code" || agentId === "codex" ? agentId : undefined;

// The watcher sits beside this file with the same extension: .js when installed, .ts under tsx in tests.
const startSweepIfDue = (): void => {
  if (!claimSweepSlot(SWEEP_EVERY_SECONDS)) {
    return;
  }

  const hookFile = fileURLToPath(import.meta.url);
  const watcherFile = path.join(path.dirname(hookFile), `rehomeWatcher${path.extname(hookFile)}`);
  spawn(process.execPath, [...process.execArgv, watcherFile, "--sweep"], { detached: true, stdio: "ignore" }).unref();
};

const announceMovedSession = (): never => {
  const agent = agentFrom(process.env.DUFFLEBAG_AGENT_ID);
  const sessionStart = decodeSessionStart(JSON.parse(readFileSync(0, "utf8")));
  if (!agent || !sessionStart) {
    return allowAndExit();
  }

  startSweepIfDue();
  const entry = ledgerEntryFor({ ledger: readLedger(), agent, sessionId: sessionStart.sessionId });
  const homeRoot = process.env.HOME || os.homedir();
  const notice =
    sessionStart.source === "resume" && entry
      ? movedSessionNotice({ entry, cwd: sessionStart.cwd, homeRoot })
      : undefined;
  if (!entry || !notice) {
    return allowAndExit();
  }

  if (agent === "codex") {
    recordLedgerEntry({ ...entry, notifiedAt: new Date().toISOString() });
  }
  return printDecisionAndExit({
    systemMessage: notice.userMessage,
    ...(notice.agentContext
      ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: notice.agentContext } }
      : {}),
  });
};

try {
  announceMovedSession();
} catch {
  process.exit(0);
}
