#!/usr/bin/env node
/**
 * dedup-guard (Cursor) — an `afterFileEdit` hook that surfaces duplicate code
 * after a write. Cursor has NO native before-edit deny hook (only `before*`
 * shell/MCP/read hooks can block), so this is the honest best Cursor can do
 * natively: detect the collision the moment it lands and tell the agent to fix
 * it. Hard-blocking on Cursor requires routing the Claude `dedup-guard.js`
 * through Cursor's Claude-compatible Third-Party Hooks — tracked as a follow-up.
 *
 * Because `afterFileEdit` fires post-write, this warns under BOTH `deny` and
 * `warn` modes (it physically can't block); `off` stays silent. Shares the
 * {@link ./lib/dupIndex} engine with the Claude hook and `dedup check`.
 *
 * Fail-open: any error exits 0 with no output.
 */

import { readFileSync, writeSync } from "node:fs";

import { parseDedupMode } from "./lib/config.js";
import { buildIndex, findDuplicatesInAddedText, isSourcePath, loadTypeScript, parseSkipList, resolveRepoRoot } from "./lib/dupIndex.js";
import { allow } from "./lib/io.js";

/**
 * Cursor's afterFileEdit payload shape is normalized defensively — field names
 * have shifted across versions, so we read the first present of each candidate
 * (boundary normalization rather than trusting one exact key).
 */
interface CursorPayload {
  [key: string]: unknown;
}

/** First present string among candidate keys, else "". */
function pick(payload: CursorPayload, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function main(): void {
  const mode = parseDedupMode(process.env.SKILLS_BAG_DEDUP_MODE);
  if (mode === "off") allow();

  let payload: CursorPayload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8")) as CursorPayload;
  } catch {
    allow();
  }

  const filePath = pick(payload!, ["file_path", "filePath", "path"]);
  const content = pick(payload!, ["new_content", "newContent", "content", "after"]);
  if (!filePath || !isSourcePath(filePath) || filePath.includes("node_modules") || !content.trim()) allow();

  const repoRoot = resolveRepoRoot();
  const ts = loadTypeScript(repoRoot);
  if (!ts) allow();

  const skipDirs = parseSkipList(process.env.SKILLS_BAG_DEDUP_SKIP);
  const index = buildIndex({ repoRoot, skipDirs, ts: ts! });
  const hits = findDuplicatesInAddedText(ts!, index, repoRoot, filePath, content);
  if (hits.length === 0) allow();

  const lines = hits.map((h) => `• ${h.kind} \`${h.name}\` is structurally identical to \`${h.existing.name}\` at ${h.existing.file}:${h.existing.line}`);
  const message = [
    `⚠️ dedup-guard: ${filePath} introduces duplicate code:`,
    ...lines,
    "Reuse the existing one (import the function / derive the type) instead of copying it, or append `// dup-ignore` to a genuine exception.",
  ].join("\n");

  // afterFileEdit can't block; surface to the agent (stdout JSON) and the logs (stderr).
  writeSync(2, `${message}\n`);
  writeSync(1, JSON.stringify({ agentMessage: message }));
  process.exit(0);
}

try {
  main();
} catch (e) {
  if (process.env.SKILLS_BAG_DEBUG) writeSync(2, `dedup-cursor error: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(0);
}
