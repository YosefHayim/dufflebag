#!/usr/bin/env node
/** Cursor afterFileEdit adapter for the dependency-free duplicate-code guard. */

import { readFileSync, writeSync } from "node:fs";

import { readConfig } from "../../../runtime/config.js";
import { allow } from "../../../runtime/io.js";
import {
  buildIndex,
  findDuplicatesInAddedText,
  isSourcePath,
  loadTypeScript,
  parseSkipList,
  resolveRepoRoot,
} from "../lib/dupIndex.js";

type CursorEdit = {
  filePath: string;
  content: string;
};

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const firstString = (record: Record<string, unknown>, properties: ReadonlyArray<string>): string => {
  for (const property of properties) {
    const candidate = record[property];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return "";
};

const decodeCursorEdit = (candidate: unknown): CursorEdit | undefined => {
  if (!isRecord(candidate)) {
    return undefined;
  }

  return {
    filePath: firstString(candidate, ["file_path", "filePath", "path"]),
    content: firstString(candidate, ["new_content", "newContent", "content", "after"]),
  };
};

const runCursorDedupGuard = (): never => {
  const config = readConfig();
  if (config.dedupEnforcement === "off") {
    return allow();
  }

  const hookEventCandidate: unknown = JSON.parse(readFileSync(0, "utf8"));
  const cursorEdit = decodeCursorEdit(hookEventCandidate);
  if (
    !cursorEdit ||
    !isSourcePath(cursorEdit.filePath) ||
    cursorEdit.filePath.includes("node_modules") ||
    !cursorEdit.content.trim()
  ) {
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
    filePath: cursorEdit.filePath,
    addedText: cursorEdit.content,
  });
  if (duplicateHits.length === 0) {
    return allow();
  }

  const duplicateLines = duplicateHits.map(
    (duplicateHit) =>
      `• ${duplicateHit.kind} \`${duplicateHit.name}\` is structurally identical to ` +
      `\`${duplicateHit.existing.name}\` at ${duplicateHit.existing.file}:${duplicateHit.existing.line}`,
  );
  const message = [
    `⚠️ dedup-guard: ${cursorEdit.filePath} introduces duplicate code:`,
    ...duplicateLines,
    "Reuse the existing declaration or append `// dup-ignore` to a genuine exception.",
  ].join("\n");

  writeSync(2, `${message}\n`);
  writeSync(1, JSON.stringify({ agentMessage: message }));
  return process.exit(0);
};

try {
  runCursorDedupGuard();
} catch (failure) {
  if (readConfig().debugEnabled) {
    writeSync(2, `dedup-cursor error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
  process.exit(0);
}
