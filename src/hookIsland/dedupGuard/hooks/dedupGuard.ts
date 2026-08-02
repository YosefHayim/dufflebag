#!/usr/bin/env node
/** Claude Code PreToolUse adapter for the dependency-free duplicate-code guard. */

import { readFileSync, writeSync } from "node:fs";

import { readConfig } from "../../../runtime/config.js";
import { allow, emit } from "../../../runtime/io.js";
import { type DedupDecision, decideDuplicateEdit } from "../lib/dedupDecision.js";
import {
  buildIndex,
  findDuplicatesInAddedText,
  isSourcePath,
  loadTypeScript,
  parseSkipList,
  resolveRepoRoot,
} from "../lib/dupIndex.js";

type DecodedEditEvent = {
  toolName: "Write" | "Edit" | "MultiEdit";
  filePath: string;
  addedText: string;
};

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const stringProperty = (record: Record<string, unknown>, property: string): string => {
  const candidate = record[property];
  return typeof candidate === "string" ? candidate : "";
};

const multiEditText = (candidate: unknown): string => {
  if (!Array.isArray(candidate)) {
    return "";
  }

  return candidate
    .filter(isRecord)
    .map((edit) => stringProperty(edit, "new_string"))
    .join("\n");
};

const decodeEditEvent = (candidate: unknown): DecodedEditEvent | undefined => {
  if (!isRecord(candidate)) {
    return undefined;
  }

  const toolName = stringProperty(candidate, "tool_name");
  if (toolName !== "Write" && toolName !== "Edit" && toolName !== "MultiEdit") {
    return undefined;
  }

  const toolInputCandidate = candidate.tool_input;
  if (!isRecord(toolInputCandidate)) {
    return undefined;
  }

  const filePath = stringProperty(toolInputCandidate, "file_path");
  switch (toolName) {
    case "Write":
      return { toolName, filePath, addedText: stringProperty(toolInputCandidate, "content") };
    case "Edit":
      return { toolName, filePath, addedText: stringProperty(toolInputCandidate, "new_string") };
    case "MultiEdit":
      return { toolName, filePath, addedText: multiEditText(toolInputCandidate.edits) };
  }
};

const presentDecision = (decision: DedupDecision): never => {
  switch (decision._tag) {
    case "allow":
      return allow();
    case "deny":
      return emit({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: decision.reason,
        },
      });
    case "warn":
      return emit({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: decision.reason } });
  }
};

const runDedupGuard = (): never => {
  const config = readConfig();
  if (config.dedupEnforcement === "off") {
    return allow();
  }

  const hookEventCandidate: unknown = JSON.parse(readFileSync(0, "utf8"));
  const editEvent = decodeEditEvent(hookEventCandidate);
  if (!editEvent || !isSourcePath(editEvent.filePath) || editEvent.filePath.includes("node_modules")) {
    return allow();
  }

  if (!editEvent.addedText.trim()) {
    return allow();
  }

  const repoRoot = resolveRepoRoot();
  const typescript = loadTypeScript(repoRoot);
  if (!typescript) {
    return allow();
  }

  const duplicateIndex = buildIndex({
    repoRoot,
    skipDirs: parseSkipList(config.dedupSkipDirectories),
    ts: typescript,
  });
  const duplicateHits = findDuplicatesInAddedText({
    ts: typescript,
    index: duplicateIndex,
    repoRoot,
    filePath: editEvent.filePath,
    addedText: editEvent.addedText,
  });
  return presentDecision(
    decideDuplicateEdit({ mode: config.dedupEnforcement, filePath: editEvent.filePath, duplicateHits }),
  );
};

try {
  runDedupGuard();
} catch (failure) {
  if (readConfig().debugEnabled) {
    writeSync(2, `dedup-guard error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
  process.exit(0);
}
