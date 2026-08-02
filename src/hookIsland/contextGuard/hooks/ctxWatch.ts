#!/usr/bin/env node
/**
 * ctx-watch — the autonomous-loop daemon. One per session; does the *mechanical*
 * half of the "stay under the guardrail, finish everything, hands-off" loop. The
 * *intelligent* half (the handoff doc, the done judgement) stays with Claude via
 * context-guard. This daemon only ever presses keys, and only when every safety
 * gate passes. Faithful TS port of the original Python daemon.
 *
 * Loop (only when armed via /autorun):
 *   work → guard nudges past warn% → Claude writes a handoff → daemon sees
 *   (armed ∧ ≥warn% ∧ fresh handoff ∧ idle ∧ Ghostty frontmost ∧ window located)
 *   → types /compact → context shrinks → types a continuation prompt → repeat,
 *   until N cycles (pause), a done-marker (stop), or HARD_CAP (bail).
 *
 * Safety: disarmed by default; fresh-handoff gate; Ghostty-frontmost guard;
 * window-targeted raise (refuse rather than guess); global keystroke mutex;
 * turn-idle gate; budget + hard cap; kill switches; self-reap on stale/dead
 * session. Fail-open everywhere — a daemon bug must never type on bad state.
 */

import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync, writeSync } from "node:fs";
import path from "node:path";

import { readConfig } from "../../../runtime/config.js";
import { decideCycleGate } from "../lib/cycleGate.js";
import { KILL_SWITCH, LOOP_STATE_DIR, loopFile, readInt, remove, writeText } from "../lib/state.js";
import { readOccupancy, resolveTranscriptForSid, tailLines, windowFor } from "../lib/transcript.js";

const cfg = readConfig();
const WARN_PCT = cfg.contextWarnFraction;
const POLL_MS = cfg.autorunPollIntervalSeconds * 1000;
const IDLE_MS = cfg.autorunIdleThresholdSeconds * 1000;
const HARD_CAP = cfg.autorunMaxCycleCount;
const DEFAULT_BUDGET = cfg.autorunDefaultCycleCount;

/** When truthy (`1`/`true`/`yes`), log keystrokes instead of sending them. */
const isDaemonDryRun = (): boolean => {
  const watchStateSource = (process.env.dufflebagDaemonDryrun || "").trim().toLowerCase();
  return watchStateSource === "1" || watchStateSource === "true" || watchStateSource === "yes";
};

const STALE_REAP_MS = 600_000; // no transcript growth this long → session gone
const KEYLOCK_STALE_MS = 30_000; // reclaim a keystroke lock held by a dead daemon
const KEYS_LOCK = path.join(LOOP_STATE_DIR, ".keys.lock");

const CONTINUATION_PROMPT =
  "Resume the autonomous run: read the newest handoff doc in your OS temp dir (handoff*.md) and continue the task " +
  "from exactly where it left off. When the task is genuinely and fully complete with nothing left to do, write the " +
  "done-marker file this run watches for instead of another handoff, then stop.";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const now = (): number => Date.now();

const mtimeMs = (file: string): number => statSync(file).mtimeMs;

const readText = (file: string): string => {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
};

// --- transcript helpers (daemon-specific) -----------------------------------

type TranscriptMessage = { content?: unknown; stop_reason?: string | null };

type TranscriptEntry = {
  isSidechain?: boolean;
  type?: string;
  message?: TranscriptMessage;
};

const objectProperty = (source: object, key: string): unknown => Object.getOwnPropertyDescriptor(source, key)?.value;

const decodeTranscriptMessage = (candidate: unknown): TranscriptMessage | undefined => {
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const content = objectProperty(candidate, "content");
  const stopReasonCandidate = objectProperty(candidate, "stop_reason");
  const stopReason =
    typeof stopReasonCandidate === "string" || stopReasonCandidate === null ? stopReasonCandidate : undefined;
  return { content, stop_reason: stopReason };
};

const decodeTranscriptEntry = (candidate: unknown): TranscriptEntry | null => {
  if (typeof candidate !== "object" || candidate === null) return null;
  const sidechainCandidate = objectProperty(candidate, "isSidechain");
  const typeCandidate = objectProperty(candidate, "type");
  return {
    isSidechain: typeof sidechainCandidate === "boolean" ? sidechainCandidate : undefined,
    type: typeof typeCandidate === "string" ? typeCandidate : undefined,
    message: decodeTranscriptMessage(objectProperty(candidate, "message")),
  };
};

const parseLine = (line: string): TranscriptEntry | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const candidate: unknown = JSON.parse(trimmed);
    return decodeTranscriptEntry(candidate);
  } catch {
    return null;
  }
};

/** Flatten a transcript entry's message content to plain text (best-effort). */
const textBlock = (candidate: unknown): string | null => {
  if (typeof candidate !== "object" || candidate === null) return null;
  const text = objectProperty(candidate, "text");
  return typeof text === "string" ? text : null;
};

const entryText = (entry: TranscriptEntry): string => {
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .flatMap((candidate) => {
        const text = textBlock(candidate);
        return text === null ? [] : [text];
      })
      .join(" ");
  }
  return "";
};

/** The most recent non-sidechain entry, or null. */
const newestMainEntry = (file: string): TranscriptEntry | null => {
  const lines = tailLines(file);
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseLine(lines.at(i) || "");
    if (entry && !entry.isSidechain) return entry;
  }
  return null;
};

/** True if parked at the prompt: transcript quiescent AND last main line is a finished assistant turn. */
const turnIsIdle = (file: string): boolean => {
  try {
    if (now() - mtimeMs(file) < IDLE_MS) return false;
  } catch {
    return false;
  }
  const entry = newestMainEntry(file);
  if (entry?.type !== "assistant") return false;
  return Boolean(entry.message?.stop_reason);
};

/** True if the most recent user line is genuine human input (not the daemon's own continuation). */
const lastUserInputIsHuman = (file: string): boolean => {
  const lines = tailLines(file);
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseLine(lines.at(i) || "");
    if (!entry || entry.isSidechain || entry.type !== "user") continue;
    return !entryText(entry).includes("Resume the autonomous run");
  }
  return false;
};

/** True if a handoff*.md was written to an OS temp dir at/after `sinceMs`. */
const handoffModifiedSince = (file: string, sinceMs: number): boolean => {
  try {
    return mtimeMs(file) >= sinceMs;
  } catch {
    return false;
  }
};

const freshHandoffExists = (sinceMs: number): boolean => {
  const containsFreshHandoff = (base: string): boolean => {
    let names: ReadonlyArray<string>;
    try {
      names = readdirSync(base);
    } catch {
      return false;
    }
    for (const name of names) {
      const lowercaseName = name.toLowerCase();
      if (!lowercaseName.startsWith("handoff") || !lowercaseName.endsWith(".md")) continue;
      if (handoffModifiedSince(path.join(base, name), sinceMs)) return true;
    }
    return false;
  };

  const bases = [process.env.TMPDIR || "/tmp", "/tmp", "/var/tmp"];
  for (const base of bases) {
    if (!base || !existsSync(base)) continue;
    if (containsFreshHandoff(base)) return true;
  }
  return false;
};

// --- AppleScript (Ghostty) ---------------------------------------------------

/** Run an AppleScript, returning trimmed stdout or null on any error/nonzero exit. */
const osa = (script: string, timeoutMs = 5000): string | null => {
  try {
    return execFileSync("osascript", ["-e", script], {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

// e.g. `say "hi\there"` → `say \"hi\\there\"` for AppleScript string literals
const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Focus guard: true only if Ghostty is the frontmost app. Fail-closed. */
const ghosttyIsFrontmost = (): boolean => {
  const out = osa('tell application "System Events" to get name of first process whose frontmost is true');
  return out?.toLowerCase() === "ghostty";
};

/** Title of Ghostty's focused window, or null. */
const focusedWindowTitle = (): string | null => {
  const out = osa(
    'tell application "System Events" to tell process "Ghostty" to get title of (value of attribute "AXFocusedWindow")',
  );
  return out || null;
};

/** Raise THIS session's Ghostty window and confirm focus. Returns a status string. */
const locateAndRaise = (targetTitle: string): string => {
  const safe = esc(targetTitle);
  const script = `tell application "System Events"
  tell process "Ghostty"
    if not (frontmost) then return "NOT_FRONTMOST"
    set wins to windows
    set n to count of wins
    set target to missing value
    if n is 1 then
      set target to item 1 of wins
    else
      if "${safe}" is "" then return "NONE"
      set m to 0
      repeat with w in wins
        set t to ""
        try
          set t to title of w
        end try
        if t is equal to "${safe}" then
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
  return osa(script, 10_000) || "ERR";
};

/** Type literal text (and optionally Return) into the focused window. */
type TerminalText = { readonly text: string; readonly submit: boolean };

const typeText = (request: TerminalText): boolean => {
  if (isDaemonDryRun()) {
    // Safe manual verification: locate/raise still run; keystrokes are logged only.
    console.error(
      `[dufflebag dry-run] would keystroke ${JSON.stringify(request.text)}${request.submit ? " + Return" : ""}`,
    );
    return true;
  }
  const lines = [`tell application "System Events" to keystroke "${esc(request.text)}"`];
  if (request.submit) {
    lines.push("delay 0.2");
    lines.push('tell application "System Events" to key code 36'); // Return
  }
  return osa(lines.join("\n"), 10_000) !== null;
};

// --- global keystroke mutex --------------------------------------------------

type LockAttempt = "acquired" | "busy" | "failed";

const tryKeysLock = (): LockAttempt => {
  try {
    const descriptor = openSync(KEYS_LOCK, "wx");
    writeSync(descriptor, `${process.pid} ${Math.floor(now() / 1000)}`);
    closeSync(descriptor);
    return "acquired";
  } catch (failure) {
    const errorCode = typeof failure === "object" && failure !== null ? objectProperty(failure, "code") : undefined;
    return errorCode === "EEXIST" ? "busy" : "failed";
  }
};

const staleKeysLock = (): boolean => {
  const recordedAt = readText(KEYS_LOCK).split(/\s+/).at(1);
  const heldAt = recordedAt === undefined ? 0 : Number(recordedAt) * 1000;
  return now() - heldAt > KEYLOCK_STALE_MS;
};

const acquireKeysLock = async (timeoutMs = 20_000): Promise<boolean> => {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const attempt = tryKeysLock();
    if (attempt === "acquired") return true;
    if (attempt === "failed") return false;
    if (staleKeysLock()) remove(KEYS_LOCK);
    else await sleep(300);
  }
  return false;
};

const releaseKeysLock = (): void => remove(KEYS_LOCK);

/** Serialized, window-targeted keystroke send. Safe-by-refusal. */
type InjectionRequest = TerminalText & { readonly sessionId: string };

const inject = async (request: InjectionRequest): Promise<boolean> => {
  if (!(await acquireKeysLock())) return false;
  try {
    if (locateAndRaise(readText(loopFile(request.sessionId, "wtitle"))) !== "OK") return false;
    return typeText(request);
  } finally {
    releaseKeysLock();
  }
};

// --- conservative window-title capture ---------------------------------------

const titleClaimedByOther = (sid: string, title: string): boolean => {
  let names: string[];
  try {
    names = readdirSync(LOOP_STATE_DIR);
  } catch {
    return false;
  }
  const mine = `${sid}.wtitle`;
  for (const name of names) {
    if (name.endsWith(".wtitle") && name !== mine && readText(path.join(LOOP_STATE_DIR, name)) === title) return true;
  }
  return false;
};

/** Snapshot this session's window title only when provably safe (see Python notes). */
const maybeResyncTitle = (sid: string, transcript: string): void => {
  if (!turnIsIdle(transcript)) return;
  try {
    if (now() - mtimeMs(transcript) >= 90_000) return;
  } catch {
    return;
  }
  if (!lastUserInputIsHuman(transcript)) return;
  if (!ghosttyIsFrontmost()) return;
  const fresh = focusedWindowTitle();
  if (fresh && !titleClaimedByOther(sid, fresh)) writeText(loopFile(sid, "wtitle"), fresh);
};

// --- lifecycle ---------------------------------------------------------------

const alreadyRunning = (sid: string): boolean => {
  const pid = readInt(loopFile(sid, "pid"), 0);
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const claimLock = (sid: string): void => writeText(loopFile(sid, "pid"), process.pid);

const releaseLock = (sid: string): void => remove(loopFile(sid, "pid"));

const disarm = (sid: string): void => remove(loopFile(sid, "armed"));

/** Reasons to self-terminate, or null to keep running. */
const shouldExit = (sid: string, transcript: string | null): string | null => {
  if (existsSync(KILL_SWITCH)) return "global kill switch";
  if (existsSync(loopFile(sid, "exit"))) return "/autorun exit";
  if (!transcript || !existsSync(transcript)) return "no transcript";
  try {
    if (now() - mtimeMs(transcript) > STALE_REAP_MS) return "session stale";
  } catch {
    return "transcript unreadable";
  }
  return null;
};

// --- the loop ----------------------------------------------------------------

/** One compact + resume keystroke pair. Returns true once the compact was sent. */
const doCycle = async (sid: string, transcript: string): Promise<boolean> => {
  if (!(await inject({ sessionId: sid, text: "/compact", submit: true }))) return false;
  const deadline = now() + 180_000;
  await sleep(POLL_MS);
  while (now() < deadline) {
    if (existsSync(loopFile(sid, "done"))) return true;
    if (turnIsIdle(transcript) && (await inject({ sessionId: sid, text: CONTINUATION_PROMPT, submit: true }))) {
      return true;
    }
    await sleep(POLL_MS);
  }
  return true;
};

type WatchTick = { readonly exit: boolean; readonly warnEnteredAt: number | null };

const nextWarnEnteredAt = (request: {
  readonly armed: boolean;
  readonly occupancy: number | null;
  readonly atOrAboveWarn: boolean;
  readonly previous: number | null;
}): number | null => {
  if (!request.armed || (request.occupancy !== null && !request.atOrAboveWarn)) return null;
  if (request.atOrAboveWarn && request.previous === null) return now();
  return request.previous;
};

const advanceWatch = async (sid: string, previousWarnEnteredAt: number | null): Promise<WatchTick> => {
  const transcript = resolveTranscriptForSid(sid);
  if (shouldExit(sid, transcript) || transcript === null) return { exit: true, warnEnteredAt: previousWarnEnteredAt };

  const armed = existsSync(loopFile(sid, "armed"));
  if (armed) maybeResyncTitle(sid, transcript);

  const { occupancy, model } = readOccupancy(transcript);
  const windowTokens = windowFor(model);
  const cycles = readInt(loopFile(sid, "cycles"), 0);
  const budget = readInt(loopFile(sid, "budget"), DEFAULT_BUDGET);
  const atOrAboveWarn = occupancy !== null && occupancy / windowTokens >= WARN_PCT;
  const warnEnteredAt = nextWarnEnteredAt({ armed, occupancy, atOrAboveWarn, previous: previousWarnEnteredAt });
  const probeLiveGates = armed && occupancy !== null && atOrAboveWarn && cycles < HARD_CAP && cycles < budget;
  const decision = decideCycleGate({
    armed,
    occupancy,
    windowTokens,
    warnFraction: WARN_PCT,
    cycles,
    budget,
    hardCap: HARD_CAP,
    freshHandoff: probeLiveGates && warnEnteredAt !== null && freshHandoffExists(warnEnteredAt),
    turnIdle: probeLiveGates && turnIsIdle(transcript),
    ghosttyFrontmost: probeLiveGates && ghosttyIsFrontmost(),
    // Window location is re-checked under the keystroke lock inside inject.
    windowLocated: true,
    done: probeLiveGates && existsSync(loopFile(sid, "done")),
  });

  if (decision.kind === "observe" || decision.kind === "wait") return { exit: false, warnEnteredAt };
  if (decision.kind === "halt") {
    writeText(loopFile(sid, "halted"), decision.reason);
    disarm(sid);
    return { exit: false, warnEnteredAt: null };
  }
  if (!(await doCycle(sid, transcript))) return { exit: false, warnEnteredAt };
  writeText(loopFile(sid, "cycles"), cycles + 1);
  return { exit: false, warnEnteredAt: null };
};

const run = async (sid: string): Promise<void> => {
  if (alreadyRunning(sid)) return;
  claimLock(sid);
  writeText(loopFile(sid, "started"), Math.floor(now() / 1000));
  let watchTick: WatchTick = { exit: false, warnEnteredAt: null };
  try {
    while (!watchTick.exit) {
      await sleep(POLL_MS);
      watchTick = await advanceWatch(sid, watchTick.warnEnteredAt);
    }
  } finally {
    releaseLock(sid);
  }
};

const main = (): void => {
  const sid = process.argv[2] || process.env.CLAUDE_SESSION_ID || "";
  if (!sid) process.exit(0);
  run(sid).catch(() => {
    releaseLock(sid);
    process.exit(0);
  });
};

main();
