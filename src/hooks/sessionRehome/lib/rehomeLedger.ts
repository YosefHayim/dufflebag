// The ledger remembers every decision, so a sweep never re-reads a settled session and SessionStart can say where
// a resumed session went. One JSON record per line; the newest record for a session wins.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import { installRoot } from "../../lib/hookConfig.js";
import { isProcessAlive } from "../../lib/processAlive.js";
import { appendJsonLine, decodeJsonLine } from "./jsonLines.js";

export type RehomeAgent = "claude-code" | "codex";

export type LedgerDecision = "moved" | "stayed" | "uncertain" | "no-signal" | "deleted" | "conflict";

export type LedgerEntry = {
  readonly agent: RehomeAgent;
  readonly sessionId: string;
  readonly decision: LedgerDecision;
  readonly title: string;
  readonly fromFolder: string;
  readonly toFolder: string;
  readonly repoName: string;
  readonly share: number;
  readonly decidedAt: string;
  /** When SessionStart last told the user this session moved; Codex announces each move once. */
  readonly notifiedAt: string;
};

const LEDGER_DECISIONS: ReadonlyArray<LedgerDecision> = [
  "moved",
  "stayed",
  "uncertain",
  "no-signal",
  "deleted",
  "conflict",
];

export const stateFolder = (): string =>
  process.env.DUFFLEBAG_REHOME_STATE_DIR || path.join(installRoot, "state", "session-rehome");

const ledgerFile = (): string => path.join(stateFolder(), "ledger.jsonl");

const ledgerKey = (request: { readonly agent: RehomeAgent; readonly sessionId: string }): string =>
  `${request.agent}:${request.sessionId}`;

const textOf = (record: Record<string, unknown>, property: string): string => {
  const candidate = record[property];
  return typeof candidate === "string" ? candidate : "";
};

const decodeLedgerEntry = (record: Record<string, unknown>): LedgerEntry | undefined => {
  const agent = record.agent === "claude-code" || record.agent === "codex" ? record.agent : undefined;
  const decision = LEDGER_DECISIONS.find((candidate) => candidate === record.decision);
  if (!agent || !decision || !textOf(record, "sessionId")) {
    return undefined;
  }

  return {
    agent,
    sessionId: textOf(record, "sessionId"),
    decision,
    title: textOf(record, "title"),
    fromFolder: textOf(record, "fromFolder"),
    toFolder: textOf(record, "toFolder"),
    repoName: textOf(record, "repoName"),
    share: typeof record.share === "number" ? record.share : 0,
    decidedAt: textOf(record, "decidedAt"),
    notifiedAt: textOf(record, "notifiedAt"),
  };
};

export const readLedger = (): ReadonlyMap<string, LedgerEntry> => {
  const entries = new Map<string, LedgerEntry>();
  const lines = existsSync(ledgerFile()) ? readFileSync(ledgerFile(), "utf8").split("\n") : [];
  for (const entry of lines.map(decodeJsonLine).map(decodeLedgerEntry)) {
    if (entry) {
      entries.set(ledgerKey(entry), entry);
    }
  }
  return entries;
};

export const ledgerEntryFor = (request: {
  readonly ledger: ReadonlyMap<string, LedgerEntry>;
  readonly agent: RehomeAgent;
  readonly sessionId: string;
}): LedgerEntry | undefined => request.ledger.get(ledgerKey(request));

export const recordLedgerEntry = (entry: LedgerEntry): void => {
  mkdirSync(stateFolder(), { recursive: true });
  appendJsonLine({ file: ledgerFile(), line: entry });
};

const sweepStampFile = (): string => path.join(stateFolder(), "last-sweep");

// SessionStart fires on every launch; a full sweep reads every transcript, so it runs at most this often.
export const claimSweepSlot = (minimumSeconds: number): boolean => {
  const stamp = sweepStampFile();
  if (existsSync(stamp) && Date.now() - statSync(stamp).mtimeMs < minimumSeconds * 1_000) {
    return false;
  }

  mkdirSync(stateFolder(), { recursive: true });
  closeSync(openSync(stamp, "a"));
  const now = new Date();
  utimesSync(stamp, now, now);
  return true;
};

const lockFile = (): string => path.join(stateFolder(), "watcher.lock");

// One watcher moves files at a time; a lock left by a dead watcher is taken over.
export const acquireWatcherLock = (): boolean => {
  mkdirSync(stateFolder(), { recursive: true });
  const holder = existsSync(lockFile()) ? Number(readFileSync(lockFile(), "utf8").trim()) : 0;
  if (holder !== process.pid && isProcessAlive(holder)) {
    return false;
  }

  rmSync(lockFile(), { force: true });
  try {
    const descriptor = openSync(lockFile(), "wx");
    writeSync(descriptor, String(process.pid));
    closeSync(descriptor);
    return true;
  } catch {
    return false;
  }
};

export const releaseWatcherLock = (): void => {
  const holder = existsSync(lockFile()) ? Number(readFileSync(lockFile(), "utf8").trim()) : 0;
  if (holder === process.pid) {
    rmSync(lockFile(), { force: true });
  }
};
