#!/usr/bin/env node
// Nudges /handoff at the warn percent and denies new code edits at the block percent; fails open.

import { existsSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";

import { readConfig } from "../../lib/hookConfig.js";
import { allowAndExit, printDecisionAndExit } from "../../lib/hookOutput.js";
import { readContextUsage, resolveTranscript, windowFor } from "../lib/sessionTranscript.js";
import { autorunFile, isArmed, KILL_SWITCH, nudgeFile, remove, writeText } from "../lib/stateFiles.js";

type HookInput = {
  transcript_path?: string;
  cwd?: string;
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

type Occupancy = {
  sessionId: string;
  percent: number;
  contextWindow: number;
  blockPercent: number;
};

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const optionalString = (record: Record<string, unknown>, property: string): string | undefined => {
  const candidate = record[property];
  return typeof candidate === "string" ? candidate : undefined;
};

const decodeHookInput = (candidate: unknown): HookInput | undefined => {
  if (!isRecord(candidate)) return undefined;
  return {
    transcript_path: optionalString(candidate, "transcript_path"),
    cwd: optionalString(candidate, "cwd"),
    session_id: optionalString(candidate, "session_id"),
    hook_event_name: optionalString(candidate, "hook_event_name"),
    tool_name: optionalString(candidate, "tool_name"),
    tool_input: isRecord(candidate.tool_input) ? candidate.tool_input : undefined,
  };
};

const percentageText = (percent: number): string => `${Math.round(percent)}%`;

// handoff*.md writes stay allowed past the block percent so the session can still save its resume doc.
const isHandoffWrite = (hookInput: HookInput): boolean => {
  if (!hookInput.tool_name || !WRITE_TOOLS.has(hookInput.tool_name) || !hookInput.tool_input) return false;
  const filePath = optionalString(hookInput.tool_input, "file_path");
  const targetPath = filePath === undefined ? optionalString(hookInput.tool_input, "notebook_path") : filePath;
  if (targetPath === undefined) return false;
  const basename = path.basename(targetPath).toLowerCase();
  return basename.includes("handoff") && basename.endsWith(".md");
};

const windDownInstructions = (sessionId: string): string => {
  if (!isArmed(sessionId)) {
    return (
      "1) Run the /handoff skill now to save a resume doc — handoff*.md writes are still allowed.\n" +
      "2) Then tell the user: \"I've hit the context guardrail — please run /compact (or /clear) and I'll continue from the handoff doc.\""
    );
  }

  return (
    "This session is autorun-armed, so the autorun watcher compacts after a fresh handoff exists and the turn is idle.\n" +
    "1) If work remains, run /handoff now.\n" +
    `2) If the task is genuinely complete, create \`${autorunFile(sessionId, "done")}\` and stop.`
  );
};

const guardCodeEdit = (request: { hookInput: HookInput; occupancy: Occupancy; model: string }): never => {
  const { occupancy } = request;
  if (occupancy.percent < occupancy.blockPercent || isHandoffWrite(request.hookInput)) return allowAndExit();

  const modelName = request.model.length === 0 ? "this model" : request.model;
  const reason =
    `🛑 Context guard: session is at ${percentageText(occupancy.percent)} of ${modelName}'s ` +
    `${occupancy.contextWindow.toLocaleString("en-US")}-token window ` +
    `(≥ ${percentageText(occupancy.blockPercent)} hard limit). Stop writing code.\n` +
    `${windDownInstructions(occupancy.sessionId)}\n` +
    "Do not attempt further code edits until the context is compacted.";
  return printDecisionAndExit({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  });
};

// Nudge once per warn-band entry; dropping below the warn percent re-arms the nudge.
const nudgeOnce = (request: { occupancy: Occupancy; eventName: string; warnPercent: number }): never => {
  const { occupancy } = request;
  const nudgeFlag = nudgeFile(occupancy.sessionId);
  if (occupancy.percent < request.warnPercent) {
    remove(nudgeFlag);
    return allowAndExit();
  }

  if (occupancy.percent >= occupancy.blockPercent || existsSync(nudgeFlag)) return allowAndExit();

  writeText(nudgeFlag, "");
  const message =
    `⚠️ Context guard: session is at ${percentageText(occupancy.percent)} of the ` +
    `${occupancy.contextWindow.toLocaleString("en-US")}-token window — approaching the ` +
    `${percentageText(occupancy.blockPercent)} hard limit. Wrap up now.\n` +
    `${windDownInstructions(occupancy.sessionId)}\nAvoid starting new code work.`;
  return printDecisionAndExit({ hookSpecificOutput: { hookEventName: request.eventName, additionalContext: message } });
};

const runContextGuard = (): never => {
  if (existsSync(KILL_SWITCH)) return allowAndExit();

  const hookInput = decodeHookInput(JSON.parse(readFileSync(0, "utf8")));
  const transcript = hookInput ? resolveTranscript(hookInput) : null;
  if (!hookInput || !transcript) return allowAndExit();

  const usage = readContextUsage(transcript);
  if (usage.occupancy === null) return allowAndExit();

  const config = readConfig();
  const contextWindow = windowFor(usage.model);
  const occupancy: Occupancy = {
    sessionId: hookInput.session_id === undefined ? "session" : hookInput.session_id,
    percent: (usage.occupancy * 100) / contextWindow,
    contextWindow,
    blockPercent: config.contextBlockPercent,
  };
  const eventName = hookInput.hook_event_name;
  if (eventName === "PreToolUse") return guardCodeEdit({ hookInput, occupancy, model: usage.model });
  if (eventName === "PostToolUse" || eventName === "UserPromptSubmit") {
    return nudgeOnce({ occupancy, eventName, warnPercent: config.contextWarnPercent });
  }
  return allowAndExit();
};

try {
  runContextGuard();
} catch (failure) {
  if (readConfig().debugLogs) {
    writeSync(2, `guard error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
  process.exit(0);
}
