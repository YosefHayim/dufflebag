#!/usr/bin/env node
/**
 * context-guard — throttles code-writing as the context window fills, forcing a
 * graceful /handoff + /compact wind-down instead of a session ballooning past
 * usable context. TS port of the original Python hook; behavior is identical,
 * but the warn/block thresholds now come from `skillsBag*` env (one source of
 * truth shared with the daemon) instead of hand-synced constants.
 *
 *   Warn band  (>= contextWarnFraction, < contextBlockFraction): allow edits, nudge once to /handoff.
 *   Block band (>= contextBlockFraction):            deny code-mutation tools, EXCEPT writes
 *                                         to the handoff doc itself.
 *
 * Registered on PreToolUse (deny) + PostToolUse/UserPromptSubmit (nudge),
 * matcher Write|Edit|MultiEdit|NotebookEdit. Fail-open: any error → allow.
 */

import { readFileSync, writeSync } from "node:fs";
import path from "node:path";

import { readConfig } from "./lib/config.js";
import { allow, emit } from "./lib/io.js";
import { exists, guardFlag, GUARD_STATE_DIR, isArmed, KILL_SWITCH, loopFile, remove, writeText } from "./lib/state.js";
import { readOccupancy, resolveTranscript, windowFor, type HookInput } from "./lib/transcript.js";

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const pctText = (pct: number): string => `${Math.round(pct * 100)}%`;

/** True if an edit targets the /handoff resume doc (handoff*.md) — always allowed through. */
function isHandoffTarget(toolInput: Record<string, unknown> | undefined): boolean {
  const p = (toolInput?.file_path ?? toolInput?.notebook_path ?? "") as string;
  const base = path.basename(p).toLowerCase();
  return base.includes("handoff") && base.endsWith(".md");
}

/** The two-step wind-down, branched on whether the session is autorun-armed. */
function windDown(sid: string): string {
  if (!isArmed(sid)) {
    return (
      "1) Run the /handoff skill now to save a resume doc — handoff*.md writes are still allowed.\n" +
      '2) Then tell the user, in plain text: "I\'ve hit the context guardrail — please run ' +
      '/compact (or /clear) and I\'ll continue from the handoff doc."'
    );
  }
  return (
    "This session is autorun-armed — the daemon will /compact for you once a fresh handoff exists and the turn is idle. So:\n" +
    "1) If work remains: run the /handoff skill now to save a resume doc (handoff*.md writes still allowed). The daemon compacts, then auto-resumes.\n" +
    `2) If the task is GENUINELY and FULLY complete: create the done-marker \`${loopFile(sid, "done")}\` (an empty file) instead of a handoff, and stop. Do NOT invent follow-up work to keep the loop running.`
  );
}

function handlePreToolUse(data: HookInput, pct: number, model: string, window: number, blockPct: number): void {
  if (pct < blockPct) allow();
  if (data.tool_name && WRITE_TOOLS.has(data.tool_name) && isHandoffTarget(data.tool_input)) allow();
  const sid = data.session_id ?? "session";
  const reason =
    `\u{1F6D1} Context guard: session is at ${pctText(pct)} of ${model || "this model"}'s ` +
    `${window.toLocaleString("en-US")}-token window (>= ${pctText(blockPct)} hard limit). Stop writing code.\n` +
    `${windDown(sid)}\n` +
    "Do not attempt further code edits until the context is compacted. (Override: `touch ~/.claude/.ctx-guard-off`.)";
  emit({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  });
}

/** Nudge once per warn-band entry (shared by PostToolUse + UserPromptSubmit). */
function emitNudgeOnce(data: HookInput, pct: number, window: number, event: string, warnPct: number, blockPct: number): void {
  const sid = data.session_id ?? "session";
  const flag = guardFlag(sid);
  if (pct < warnPct) {
    remove(flag);
    allow();
  }
  if (pct >= blockPct || exists(flag)) allow();
  writeText(path.join(GUARD_STATE_DIR, `${sid}.nudged`), "");
  const message =
    `⚠️ Context guard: session is at ${pctText(pct)} of the ${window.toLocaleString("en-US")}-token window — ` +
    `approaching the ${pctText(blockPct)} hard limit. Wrap up NOW.\n${windDown(sid)}\nAvoid starting new code work.`;
  emit({ hookSpecificOutput: { hookEventName: event, additionalContext: message } });
}

function main(): void {
  if (exists(KILL_SWITCH)) allow();
  let data: HookInput;
  try {
    data = JSON.parse(readFileSync(0, "utf8")) as HookInput;
  } catch {
    allow();
  }
  const transcript = resolveTranscript(data!);
  if (!transcript) allow();
  const { occupancy, model } = readOccupancy(transcript!);
  if (!occupancy) allow();
  const { contextWarnFraction, contextBlockFraction } = readConfig();
  const window = windowFor(model);
  const pct = occupancy! / window;
  const event = data!.hook_event_name;
  if (event === "PreToolUse") handlePreToolUse(data!, pct, model, window, contextBlockFraction);
  if (event === "PostToolUse" || event === "UserPromptSubmit")
    emitNudgeOnce(data!, pct, window, event, contextWarnFraction, contextBlockFraction);
  allow();
}

try {
  main();
} catch (e) {
  if (readConfig().debugEnabled) writeSync(2, `guard error: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(0); // fail-open: never block a tool because the guard itself errored.
}
