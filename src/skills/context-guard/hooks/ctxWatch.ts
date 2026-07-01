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

import { readConfig } from "../../../payload/config.js";
import { KILL_SWITCH, LOOP_STATE_DIR, loopFile, readInt, remove, writeText } from "../lib/state.js";
import { readOccupancy, resolveTranscriptForSid, tailLines, windowFor } from "../lib/transcript.js";

const cfg = readConfig();
const WARN_PCT = cfg.contextWarnFraction;
const POLL_MS = cfg.autorunPollIntervalSeconds * 1000;
const IDLE_MS = cfg.autorunIdleThresholdSeconds * 1000;
const HARD_CAP = cfg.autorunMaxCycleCount;
const DEFAULT_BUDGET = cfg.autorunDefaultCycleCount;

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

function readText(file: string): string {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

// --- transcript helpers (daemon-specific) -----------------------------------

interface Entry {
  isSidechain?: boolean;
  type?: string;
  message?: { content?: unknown; stop_reason?: string | null };
}

function parseLine(line: string): Entry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Entry;
  } catch {
    return null;
  }
}

/** Flatten a transcript entry's message content to plain text (best-effort). */
function entryText(entry: Entry): string {
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { text: string } => typeof (b as { text?: unknown }).text === "string")
      .map((b) => b.text)
      .join(" ");
  }
  return "";
}

/** The most recent non-sidechain entry, or null. */
function newestMainEntry(file: string): Entry | null {
  const lines = tailLines(file);
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseLine(lines[i]!);
    if (entry && !entry.isSidechain) return entry;
  }
  return null;
}

/** True if parked at the prompt: transcript quiescent AND last main line is a finished assistant turn. */
function turnIsIdle(file: string): boolean {
  try {
    if (now() - mtimeMs(file) < IDLE_MS) return false;
  } catch {
    return false;
  }
  const entry = newestMainEntry(file);
  if (entry?.type !== "assistant") return false;
  return Boolean(entry.message?.stop_reason);
}

/** True if the most recent user line is genuine human input (not the daemon's own continuation). */
function lastUserInputIsHuman(file: string): boolean {
  const lines = tailLines(file);
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseLine(lines[i]!);
    if (!entry || entry.isSidechain || entry.type !== "user") continue;
    return !entryText(entry).includes("Resume the autonomous run");
  }
  return false;
}

/** True if a handoff*.md was written to an OS temp dir at/after `sinceMs`. */
function freshHandoffExists(sinceMs: number): boolean {
  const bases = [process.env.TMPDIR ?? "/tmp", "/tmp", "/var/tmp"];
  for (const base of bases) {
    if (!base || !existsSync(base)) continue;
    let names: string[];
    try {
      names = readdirSync(base);
    } catch {
      continue;
    }
    for (const name of names) {
      const low = name.toLowerCase();
      if (!low.startsWith("handoff") || !low.endsWith(".md")) continue;
      try {
        if (mtimeMs(path.join(base, name)) >= sinceMs) return true;
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}

// --- AppleScript (Ghostty) ---------------------------------------------------

/** Run an AppleScript, returning trimmed stdout or null on any error/nonzero exit. */
function osa(script: string, timeoutMs = 5000): string | null {
  try {
    return execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Focus guard: true only if Ghostty is the frontmost app. Fail-closed. */
function ghosttyIsFrontmost(): boolean {
  const out = osa('tell application "System Events" to get name of first process whose frontmost is true');
  return out?.toLowerCase() === "ghostty";
}

/** Title of Ghostty's focused window, or null. */
function focusedWindowTitle(): string | null {
  const out = osa('tell application "System Events" to tell process "Ghostty" to get title of (value of attribute "AXFocusedWindow")');
  return out || null;
}

/** Raise THIS session's Ghostty window and confirm focus. Returns a status string. */
function locateAndRaise(targetTitle: string): string {
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
  return osa(script, 10_000) ?? "ERR";
}

/** Type literal text (and optionally Return) into the focused window. */
function typeText(text: string, submit: boolean): boolean {
  const lines = [`tell application "System Events" to keystroke "${esc(text)}"`];
  if (submit) {
    lines.push("delay 0.2");
    lines.push('tell application "System Events" to key code 36'); // Return
  }
  return osa(lines.join("\n"), 10_000) !== null;
}

// --- global keystroke mutex --------------------------------------------------

async function acquireKeysLock(timeoutMs = 20_000): Promise<boolean> {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    try {
      const fd = openSync(KEYS_LOCK, "wx");
      writeSync(fd, `${process.pid} ${Math.floor(now() / 1000)}`);
      closeSync(fd);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") return false;
      const parts = readText(KEYS_LOCK).split(/\s+/);
      const heldAt = parts.length > 1 ? Number(parts[1]) * 1000 : 0;
      if (now() - heldAt > KEYLOCK_STALE_MS) {
        remove(KEYS_LOCK);
        continue;
      }
      await sleep(300);
    }
  }
  return false;
}

const releaseKeysLock = (): void => remove(KEYS_LOCK);

/** Serialized, window-targeted keystroke send. Safe-by-refusal. */
async function inject(sid: string, text: string, submit: boolean): Promise<boolean> {
  if (!(await acquireKeysLock())) return false;
  try {
    if (locateAndRaise(readText(loopFile(sid, "wtitle"))) !== "OK") return false;
    return typeText(text, submit);
  } finally {
    releaseKeysLock();
  }
}

// --- conservative window-title capture ---------------------------------------

function titleClaimedByOther(sid: string, title: string): boolean {
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
}

/** Snapshot this session's window title only when provably safe (see Python notes). */
function maybeResyncTitle(sid: string, transcript: string): void {
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
}

// --- lifecycle ---------------------------------------------------------------

function alreadyRunning(sid: string): boolean {
  const pid = readInt(loopFile(sid, "pid"), 0);
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const claimLock = (sid: string): void => writeText(loopFile(sid, "pid"), process.pid);
const releaseLock = (sid: string): void => remove(loopFile(sid, "pid"));
const disarm = (sid: string): void => remove(loopFile(sid, "armed"));

/** Reasons to self-terminate, or null to keep running. */
function shouldExit(sid: string, transcript: string | null): string | null {
  if (existsSync(KILL_SWITCH)) return "global kill switch";
  if (existsSync(loopFile(sid, "exit"))) return "/autorun exit";
  if (!transcript || !existsSync(transcript)) return "no transcript";
  try {
    if (now() - mtimeMs(transcript) > STALE_REAP_MS) return "session stale";
  } catch {
    return "transcript unreadable";
  }
  return null;
}

// --- the loop ----------------------------------------------------------------

/** One compact + resume keystroke pair. Returns true once the compact was sent. */
async function doCycle(sid: string, transcript: string): Promise<boolean> {
  if (!(await inject(sid, "/compact", true))) return false;
  const deadline = now() + 180_000;
  await sleep(POLL_MS);
  while (now() < deadline) {
    if (existsSync(loopFile(sid, "done"))) return true;
    if (turnIsIdle(transcript) && (await inject(sid, CONTINUATION_PROMPT, true))) return true;
    await sleep(POLL_MS);
  }
  return true;
}

async function run(sid: string): Promise<void> {
  if (alreadyRunning(sid)) return;
  claimLock(sid);
  writeText(loopFile(sid, "started"), Math.floor(now() / 1000));
  let warnEnteredAt: number | null = null;
  try {
    for (;;) {
      await sleep(POLL_MS);
      const transcript = resolveTranscriptForSid(sid);

      if (shouldExit(sid, transcript)) break;
      const file = transcript!; // shouldExit guaranteed non-null transcript

      // Disarmed → pure observer.
      if (!existsSync(loopFile(sid, "armed"))) {
        warnEnteredAt = null;
        continue;
      }

      maybeResyncTitle(sid, file);

      const { occupancy, model } = readOccupancy(file);
      if (!occupancy) continue;
      const pct = occupancy / windowFor(model);

      if (pct < WARN_PCT) {
        warnEnteredAt = null;
        continue;
      }
      if (warnEnteredAt === null) warnEnteredAt = now();

      const cycles = readInt(loopFile(sid, "cycles"), 0);
      const budget = readInt(loopFile(sid, "budget"), DEFAULT_BUDGET);
      if (cycles >= HARD_CAP) {
        writeText(loopFile(sid, "halted"), "hard-cap");
        disarm(sid);
        warnEnteredAt = null;
        continue;
      }
      if (cycles >= budget) {
        writeText(loopFile(sid, "halted"), "budget-reached");
        disarm(sid);
        warnEnteredAt = null;
        continue;
      }

      if (!freshHandoffExists(warnEnteredAt)) continue;
      if (!turnIsIdle(file)) continue;
      if (!ghosttyIsFrontmost()) continue;

      if (existsSync(loopFile(sid, "done"))) {
        writeText(loopFile(sid, "halted"), "done");
        disarm(sid);
        warnEnteredAt = null;
        continue;
      }

      if (await doCycle(sid, file)) {
        writeText(loopFile(sid, "cycles"), cycles + 1);
        warnEnteredAt = null;
      }
    }
  } finally {
    releaseLock(sid);
  }
}

function main(): void {
  const sid = process.argv[2] ?? process.env.CLAUDE_SESSION_ID ?? "";
  if (!sid) process.exit(0);
  run(sid).catch(() => {
    releaseLock(sid);
    process.exit(0);
  });
}

main();
