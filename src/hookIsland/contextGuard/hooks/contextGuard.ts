#!/usr/bin/env node
/** Claude Code context-occupancy guard with a fail-open process boundary. */

import { readFileSync, writeSync } from "node:fs";
import path from "node:path";

import { readConfig } from "../../../runtime/config.js";
import { allow, emit } from "../../../runtime/io.js";
import { exists, GUARD_STATE_DIR, guardFlag, isArmed, KILL_SWITCH, loopFile, remove, writeText } from "../lib/state.js";
import { type HookInput, readOccupancy, resolveTranscript, windowFor } from "../lib/transcript.js";

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const optionalString = (record: Record<string, unknown>, property: string): string | undefined => {
  const candidate = record[property];
  return typeof candidate === "string" ? candidate : undefined;
};

const decodeHookInput = (candidate: unknown): HookInput | undefined => {
  if (!isRecord(candidate)) {
    return undefined;
  }

  const toolInputCandidate = candidate.tool_input;
  return {
    transcript_path: optionalString(candidate, "transcript_path"),
    cwd: optionalString(candidate, "cwd"),
    session_id: optionalString(candidate, "session_id"),
    hook_event_name: optionalString(candidate, "hook_event_name"),
    tool_name: optionalString(candidate, "tool_name"),
    tool_input: isRecord(toolInputCandidate) ? toolInputCandidate : undefined,
  };
};

const percentageText = (fraction: number): string => `${Math.round(fraction * 100)}%`;

const isHandoffTarget = (toolInput: Record<string, unknown> | undefined): boolean => {
  if (!toolInput) {
    return false;
  }

  const filePath = optionalString(toolInput, "file_path");
  const notebookPath = optionalString(toolInput, "notebook_path");
  const targetPath = filePath === undefined ? notebookPath : filePath;
  if (targetPath === undefined) {
    return false;
  }

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
    "This session is autorun-armed, so the daemon compacts after a fresh handoff exists and the turn is idle.\n" +
    "1) If work remains, run /handoff now.\n" +
    `2) If the task is genuinely complete, create \`${loopFile(sessionId, "done")}\` and stop.`
  );
};

const handlePreToolUse = (request: {
  hookInput: HookInput;
  occupancyFraction: number;
  model: string;
  contextWindow: number;
  blockFraction: number;
}): never => {
  if (request.occupancyFraction < request.blockFraction) {
    return allow();
  }

  if (
    request.hookInput.tool_name &&
    WRITE_TOOLS.has(request.hookInput.tool_name) &&
    isHandoffTarget(request.hookInput.tool_input)
  ) {
    return allow();
  }

  const sessionId = request.hookInput.session_id === undefined ? "session" : request.hookInput.session_id;
  const modelName = request.model.length === 0 ? "this model" : request.model;
  const reason =
    `🛑 Context guard: session is at ${percentageText(request.occupancyFraction)} of ${modelName}'s ` +
    `${request.contextWindow.toLocaleString("en-US")}-token window ` +
    `(≥ ${percentageText(request.blockFraction)} hard limit). Stop writing code.\n` +
    `${windDownInstructions(sessionId)}\n` +
    "Do not attempt further code edits until the context is compacted.";

  return emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
};

const emitNudgeOnce = (request: {
  hookInput: HookInput;
  occupancyFraction: number;
  contextWindow: number;
  eventName: string;
  warnFraction: number;
  blockFraction: number;
}): never => {
  const sessionId = request.hookInput.session_id === undefined ? "session" : request.hookInput.session_id;
  const nudgeFlag = guardFlag(sessionId);
  if (request.occupancyFraction < request.warnFraction) {
    remove(nudgeFlag);
    return allow();
  }

  if (request.occupancyFraction >= request.blockFraction || exists(nudgeFlag)) {
    return allow();
  }

  writeText(path.join(GUARD_STATE_DIR, `${sessionId}.nudged`), "");
  const message =
    `⚠️ Context guard: session is at ${percentageText(request.occupancyFraction)} of the ` +
    `${request.contextWindow.toLocaleString("en-US")}-token window — approaching the ` +
    `${percentageText(request.blockFraction)} hard limit. Wrap up now.\n` +
    `${windDownInstructions(sessionId)}\nAvoid starting new code work.`;
  return emit({ hookSpecificOutput: { hookEventName: request.eventName, additionalContext: message } });
};

const runContextGuard = (): never => {
  if (exists(KILL_SWITCH)) {
    return allow();
  }

  const hookEventCandidate: unknown = JSON.parse(readFileSync(0, "utf8"));
  const hookInput = decodeHookInput(hookEventCandidate);
  if (!hookInput) {
    return allow();
  }

  const transcript = resolveTranscript(hookInput);
  if (!transcript) {
    return allow();
  }

  const occupancyReading = readOccupancy(transcript);
  if (occupancyReading.occupancy === null) {
    return allow();
  }

  const config = readConfig();
  const contextWindow = windowFor(occupancyReading.model);
  const occupancyFraction = occupancyReading.occupancy / contextWindow;
  const eventName = hookInput.hook_event_name;
  if (eventName === "PreToolUse") {
    return handlePreToolUse({
      hookInput,
      occupancyFraction,
      model: occupancyReading.model,
      contextWindow,
      blockFraction: config.contextBlockFraction,
    });
  }

  if (eventName === "PostToolUse" || eventName === "UserPromptSubmit") {
    return emitNudgeOnce({
      hookInput,
      occupancyFraction,
      contextWindow,
      eventName,
      warnFraction: config.contextWarnFraction,
      blockFraction: config.contextBlockFraction,
    });
  }

  return allow();
};

try {
  runContextGuard();
} catch (failure) {
  if (readConfig().debugEnabled) {
    writeSync(2, `guard error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
  process.exit(0);
}
