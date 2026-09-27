#!/usr/bin/env node
// PreToolUse hook that blocks or warns on a copied function body or type shape; fails open.

import { readFileSync, writeSync } from "node:fs";

import { readConfig } from "../../lib/hookConfig.js";
import { allowAndExit, printDecisionAndExit } from "../../lib/hookOutput.js";
import { loadTypeScript } from "../lib/codeFingerprint.js";
import { type DuplicateDecision, decideDuplicateEdit } from "../lib/duplicateDecision.js";
import { buildDuplicateIndex, isSourcePath } from "../lib/duplicateIndex.js";
import { findDuplicatesInEdit } from "../lib/findDuplicates.js";

type EditEvent = { filePath: string; addedText: string };

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const stringProperty = (record: Record<string, unknown>, property: string): string => {
  const candidate = record[property];
  return typeof candidate === "string" ? candidate : "";
};

const multiEditText = (candidate: unknown): string =>
  Array.isArray(candidate)
    ? candidate
        .filter(isRecord)
        .map((edit) => stringProperty(edit, "new_string"))
        .join("\n")
    : "";

const decodeEditEvent = (candidate: unknown): EditEvent | undefined => {
  if (!isRecord(candidate) || !isRecord(candidate.tool_input)) return undefined;
  const toolInput = candidate.tool_input;
  const filePath = stringProperty(toolInput, "file_path");
  switch (candidate.tool_name) {
    case "Write":
      return { filePath, addedText: stringProperty(toolInput, "content") };
    case "Edit":
      return { filePath, addedText: stringProperty(toolInput, "new_string") };
    case "MultiEdit":
      return { filePath, addedText: multiEditText(toolInput.edits) };
    default:
      return undefined;
  }
};

const presentDecision = (decision: DuplicateDecision): never => {
  switch (decision._tag) {
    case "allow":
      return allowAndExit();
    case "block":
      return printDecisionAndExit({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: decision.reason,
        },
      });
    case "warn":
      return printDecisionAndExit({
        hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: decision.reason },
      });
  }
};

const runDuplicateCodeGuard = (): never => {
  const config = readConfig();
  if (config.duplicateCodeMode === "off") return allowAndExit();

  const editEvent = decodeEditEvent(JSON.parse(readFileSync(0, "utf8")));
  if (
    !editEvent ||
    !isSourcePath(editEvent.filePath) ||
    editEvent.filePath.includes("node_modules") ||
    !editEvent.addedText.trim()
  ) {
    return allowAndExit();
  }

  // Claude Code and Codex set CLAUDE_PROJECT_DIR for hooks.
  const repoRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const ts = loadTypeScript(repoRoot);
  if (!ts) return allowAndExit();

  const index = buildDuplicateIndex({ repoRoot, skipFolders: config.duplicateCodeSkipFolders, ts });
  const duplicateMatches = findDuplicatesInEdit({
    ts,
    index,
    repoRoot,
    filePath: editEvent.filePath,
    addedText: editEvent.addedText,
  });
  return presentDecision(
    decideDuplicateEdit({ mode: config.duplicateCodeMode, filePath: editEvent.filePath, duplicateMatches }),
  );
};

try {
  runDuplicateCodeGuard();
} catch (failure) {
  if (readConfig().debugLogs) {
    writeSync(2, `duplicate-code-guard error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
  process.exit(0);
}
