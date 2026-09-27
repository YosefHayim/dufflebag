#!/usr/bin/env node
// The background process behind /autorun, one per session. Once armed, when context passes the warn percent and
// a fresh handoff exists, it types /compact and then a continuation prompt into this session's Ghostty window.
// It presses keys only when every check passes, refuses rather than guesses, and exits quietly on any error.

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { readConfig } from "../../lib/hookConfig.js";
import { decodeTranscriptLine, readTranscriptTail, type TranscriptEntry } from "../../lib/transcriptReader.js";
import { appleScriptString, runAppleScript } from "../lib/appleScript.js";
import { decideAutorunStep } from "../lib/autorunDecision.js";
import { withKeystrokeLock } from "../lib/keystrokeLock.js";
import { isProcessAlive } from "../lib/processAlive.js";
import { findTranscriptForSession, readContextUsage, windowFor } from "../lib/sessionTranscript.js";
import {
  AUTORUN_STATE_DIR,
  autorunFile,
  isArmed,
  KILL_SWITCH,
  readInt,
  readText,
  remove,
  writeText,
} from "../lib/stateFiles.js";

// No transcript growth for this long means the session is gone.
const STALE_SESSION_MS = 600_000;
// The window title is resynced only this soon after the session's last write, while its window likely has focus.
const RECENT_WRITE_MS = 90_000;
const RESUME_DEADLINE_MS = 180_000;

const CONTINUATION_MARKER = "Resume the autonomous run";
const CONTINUATION_PROMPT =
  `${CONTINUATION_MARKER}: read the newest handoff doc in your OS temp dir (handoff*.md) and continue the task ` +
  "from exactly where it left off. When the task is genuinely and fully complete with nothing left to do, write the " +
  "done-marker file this run watches for instead of another handoff, then stop.";

type TerminalText = { readonly text: string; readonly submit: boolean };

type WatchTick = { readonly exit: boolean; readonly warnEnteredAt: number | null };

// Settings are read on every use, so `dufflebag config set` reaches a running watcher.
const checkEveryMs = (): number => readConfig().autorunCheckEverySeconds * 1000;

const idleAfterMs = (): number => readConfig().autorunIdleAfterSeconds * 1000;

// DUFFLEBAG_AUTORUN_DRY_RUN logs keystrokes instead of sending them, for safe manual verification.
const isDryRun = (): boolean => {
  const dryRunSetting = (process.env.DUFFLEBAG_AUTORUN_DRY_RUN || "").trim().toLowerCase();
  return dryRunSetting === "1" || dryRunSetting === "true" || dryRunSetting === "yes";
};

const modifiedWithinMs = (file: string, milliseconds: number): boolean => {
  try {
    return Date.now() - statSync(file).mtimeMs < milliseconds;
  } catch {
    return false;
  }
};

const blockText = (candidate: unknown): ReadonlyArray<string> => {
  if (typeof candidate !== "object" || candidate === null) return [];
  const text = Object.getOwnPropertyDescriptor(candidate, "text")?.value;
  return typeof text === "string" ? [text] : [];
};

const entryText = (entry: TranscriptEntry): string => {
  if (typeof entry.content === "string") return entry.content;
  return Array.isArray(entry.content) ? entry.content.flatMap(blockText).join(" ") : "";
};

const newestMainEntries = (file: string): ReadonlyArray<TranscriptEntry> =>
  [...readTranscriptTail(file)].reverse().flatMap((line) => {
    const entry = decodeTranscriptLine(line);
    return entry && !entry.isSidechain ? [entry] : [];
  });

// Parked at the prompt: the transcript is quiet and the last main entry is a finished assistant turn.
const turnIsIdle = (file: string): boolean => {
  try {
    if (Date.now() - statSync(file).mtimeMs < idleAfterMs()) return false;
  } catch {
    return false;
  }
  const entry = newestMainEntries(file).at(0);
  return entry?.type === "assistant" && Boolean(entry.stopReason);
};

const lastUserInputIsHuman = (file: string): boolean => {
  const entry = newestMainEntries(file).find((candidate) => candidate.type === "user");
  return entry !== undefined && !entryText(entry).includes(CONTINUATION_MARKER);
};

const handoffWrittenSince = (folder: string, sinceMs: number): boolean => {
  let names: ReadonlyArray<string>;
  try {
    names = readdirSync(folder);
  } catch {
    return false;
  }
  return names.some((name) => {
    const lowercaseName = name.toLowerCase();
    if (!lowercaseName.startsWith("handoff") || !lowercaseName.endsWith(".md")) return false;
    try {
      return statSync(path.join(folder, name)).mtimeMs >= sinceMs;
    } catch {
      return false;
    }
  });
};

// The handoff skill writes handoff*.md into an OS temp folder.
const freshHandoffExists = (sinceMs: number): boolean =>
  [process.env.TMPDIR || "/tmp", "/tmp", "/var/tmp"].some((folder) => handoffWrittenSince(folder, sinceMs));

const ghosttyIsFrontmost = (): boolean => {
  const frontmost = runAppleScript(
    'tell application "System Events" to get name of first process whose frontmost is true',
    5_000,
  );
  return frontmost?.toLowerCase() === "ghostty";
};

const focusedWindowTitle = (): string | null =>
  runAppleScript(
    'tell application "System Events" to tell process "Ghostty" to get title of (value of attribute "AXFocusedWindow")',
    5_000,
  ) || null;

// Raises this session's Ghostty window and confirms it took focus; "OK" only when both succeed.
const locateAndRaise = (targetTitle: string): string => {
  const escapedTitle = appleScriptString(targetTitle);
  const script = `tell application "System Events"
  tell process "Ghostty"
    if not (frontmost) then return "NOT_FRONTMOST"
    set wins to windows
    set n to count of wins
    set target to missing value
    if n is 1 then
      set target to item 1 of wins
    else
      if "${escapedTitle}" is "" then return "NONE"
      set m to 0
      repeat with w in wins
        set t to ""
        try
          set t to title of w
        end try
        if t is equal to "${escapedTitle}" then
          set m to m + 1
          set target to w
        end if
      end repeat
      if m is 0 then return "NONE"
      if m > 1 then return "AMBIGUOUS"
    end if
    perform action "AXRaise" of target
    delay 0.2
    set ftitle to ""
    try
      set ftitle to title of (value of attribute "AXFocusedWindow")
    end try
    set ttitle to ""
    try
      set ttitle to title of target
    end try
    if ftitle is equal to ttitle then
      return "OK"
    else
      return "VERIFY_FAIL"
    end if
  end tell
end tell`;
  return runAppleScript(script) || "ERR";
};

const typeText = (request: TerminalText): boolean => {
  if (isDryRun()) {
    console.error(
      `[dufflebag dry-run] would keystroke ${JSON.stringify(request.text)}${request.submit ? " + Return" : ""}`,
    );
    return true;
  }
  const lines = [`tell application "System Events" to keystroke "${appleScriptString(request.text)}"`];
  // Key code 36 is Return.
  if (request.submit) lines.push("delay 0.2", 'tell application "System Events" to key code 36');
  return runAppleScript(lines.join("\n")) !== null;
};

const inject = (request: TerminalText & { readonly sessionId: string }): Promise<boolean> =>
  withKeystrokeLock(
    () => locateAndRaise(readText(autorunFile(request.sessionId, "wtitle"))) === "OK" && typeText(request),
  );

const titleClaimedByOther = (sessionId: string, title: string): boolean => {
  let names: ReadonlyArray<string>;
  try {
    names = readdirSync(AUTORUN_STATE_DIR);
  } catch {
    return false;
  }
  return names.some(
    (name) =>
      name.endsWith(".wtitle") &&
      name !== `${sessionId}.wtitle` &&
      readText(path.join(AUTORUN_STATE_DIR, name)) === title,
  );
};

// Records the window title only when it is provably this session's: the turn is idle, a human typed last, and
// Ghostty is frontmost.
const resyncWindowTitle = (sessionId: string, transcript: string): void => {
  if (!turnIsIdle(transcript) || !modifiedWithinMs(transcript, RECENT_WRITE_MS)) return;
  if (!lastUserInputIsHuman(transcript) || !ghosttyIsFrontmost()) return;
  const title = focusedWindowTitle();
  if (title && !titleClaimedByOther(sessionId, title)) writeText(autorunFile(sessionId, "wtitle"), title);
};

const sessionIsStale = (transcript: string): boolean => {
  try {
    return Date.now() - statSync(transcript).mtimeMs > STALE_SESSION_MS;
  } catch {
    return true;
  }
};

const shouldExit = (sessionId: string, transcript: string): boolean =>
  existsSync(KILL_SWITCH) ||
  existsSync(autorunFile(sessionId, "exit")) ||
  !existsSync(transcript) ||
  sessionIsStale(transcript);

// Types /compact, then the continuation once the compacted turn goes idle. True once /compact was sent.
const runCycle = async (sessionId: string, transcript: string): Promise<boolean> => {
  if (!(await inject({ sessionId, text: "/compact", submit: true }))) return false;
  const deadline = Date.now() + RESUME_DEADLINE_MS;
  await sleep(checkEveryMs());
  while (Date.now() < deadline) {
    if (existsSync(autorunFile(sessionId, "done"))) return true;
    if (turnIsIdle(transcript) && (await inject({ sessionId, text: CONTINUATION_PROMPT, submit: true }))) return true;
    await sleep(checkEveryMs());
  }
  return true;
};

// When the session entered the warn band; a handoff counts as fresh only if written after it.
const nextWarnEnteredAt = (request: {
  readonly armed: boolean;
  readonly occupancy: number | null;
  readonly atOrAboveWarn: boolean;
  readonly previous: number | null;
}): number | null => {
  if (!request.armed || (request.occupancy !== null && !request.atOrAboveWarn)) return null;
  if (request.atOrAboveWarn && request.previous === null) return Date.now();
  return request.previous;
};

const advanceWatch = async (sessionId: string, previousWarnEnteredAt: number | null): Promise<WatchTick> => {
  const transcript = findTranscriptForSession(sessionId);
  if (transcript === null || shouldExit(sessionId, transcript)) {
    return { exit: true, warnEnteredAt: previousWarnEnteredAt };
  }

  const armed = isArmed(sessionId);
  if (armed) resyncWindowTitle(sessionId, transcript);

  const config = readConfig();
  const { occupancy, model } = readContextUsage(transcript);
  const windowTokens = windowFor(model);
  const cycles = readInt(autorunFile(sessionId, "cycles"));
  const budget = readInt(autorunFile(sessionId, "budget"), config.autorunDefaultCycles);
  const atOrAboveWarn = occupancy !== null && (occupancy * 100) / windowTokens >= config.contextWarnPercent;
  const warnEnteredAt = nextWarnEnteredAt({ armed, occupancy, atOrAboveWarn, previous: previousWarnEnteredAt });
  // Probe the file system and AppleScript only when the decision can reach those checks.
  const probeLiveChecks = armed && atOrAboveWarn && cycles < config.autorunMaxCycles && cycles < budget;
  const step = decideAutorunStep({
    armed,
    occupancy,
    windowTokens,
    warnPercent: config.contextWarnPercent,
    cycles,
    budget,
    hardCap: config.autorunMaxCycles,
    freshHandoff: probeLiveChecks && warnEnteredAt !== null && freshHandoffExists(warnEnteredAt),
    turnIdle: probeLiveChecks && turnIsIdle(transcript),
    // The window itself is located again under the keystroke lock inside inject.
    ghosttyFrontmost: probeLiveChecks && ghosttyIsFrontmost(),
    done: probeLiveChecks && existsSync(autorunFile(sessionId, "done")),
  });

  if (step.kind === "observe" || step.kind === "wait") return { exit: false, warnEnteredAt };
  if (step.kind === "halt") {
    writeText(autorunFile(sessionId, "halted"), step.reason);
    remove(autorunFile(sessionId, "armed"));
    return { exit: false, warnEnteredAt: null };
  }
  if (!(await runCycle(sessionId, transcript))) return { exit: false, warnEnteredAt };
  writeText(autorunFile(sessionId, "cycles"), cycles + 1);
  return { exit: false, warnEnteredAt: null };
};

const watchSession = async (sessionId: string): Promise<void> => {
  if (isProcessAlive(readInt(autorunFile(sessionId, "pid")))) return;
  writeText(autorunFile(sessionId, "pid"), process.pid);
  writeText(autorunFile(sessionId, "started"), Math.floor(Date.now() / 1000));
  let watchTick: WatchTick = { exit: false, warnEnteredAt: null };
  try {
    while (!watchTick.exit) {
      await sleep(checkEveryMs());
      watchTick = await advanceWatch(sessionId, watchTick.warnEnteredAt);
    }
  } finally {
    remove(autorunFile(sessionId, "pid"));
  }
};

const watchedSessionId = process.argv[2] || process.env.CLAUDE_SESSION_ID || "";
if (watchedSessionId) {
  watchSession(watchedSessionId).catch(() => {
    remove(autorunFile(watchedSessionId, "pid"));
    process.exit(0);
  });
}
