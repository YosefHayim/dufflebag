#!/usr/bin/env node
/**
 * dedup-guard (Claude Code) — a PreToolUse hook that blocks a Write/Edit when
 * the code being added is a structural copy of a function body or object-type
 * shape that already exists in the repo. The thin I/O adapter for Claude over
 * the shared {@link ./lib/dupIndex} engine: read the tool payload, build the
 * repo index (resolving the repo's own `typescript`), match, and emit Claude's
 * deny/allow envelope.
 *
 *   mode=deny (default): a match → `permissionDecision: "deny"` (the write is
 *                        blocked); annotate genuine exceptions with `// dup-ignore`.
 *   mode=warn:           a match → allow, but surface the collision as context.
 *   mode=off:            allow everything (the feature is inert).
 *
 * Registered on PreToolUse, matcher Write|Edit|MultiEdit. Fail-open: any error
 * (including a repo without `typescript`) exits 0 and allows the tool through —
 * a guard must never brick editing because of its own bug.
 */

import { readFileSync, writeSync } from "node:fs";

import { readConfig } from "./lib/config.js";
import {
  buildIndex,
  findDuplicatesInAddedText,
  isSourcePath,
  loadTypeScript,
  parseSkipList,
  resolveRepoRoot,
  type DupHit,
} from "./lib/dupIndex.js";
import { allow, emit } from "./lib/io.js";

/** The slice of a Write/Edit/MultiEdit tool input we read added text from. */
interface ToolInput {
  file_path?: string;
  content?: string;
  new_string?: string;
  edits?: { new_string?: string }[];
}
interface HookInput {
  tool_name?: string;
  tool_input?: ToolInput;
}

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

/** Pull the added text out of whichever editing tool fired. */
function addedTextFor(toolName: string, input: ToolInput): string {
  if (toolName === "Write") return input.content ?? "";
  if (toolName === "Edit") return input.new_string ?? "";
  if (toolName === "MultiEdit") return (input.edits ?? []).map((e) => e.new_string ?? "").join("\n");
  return "";
}

/** Format the deny/warn message: where each duplicate is, and what to do about it. */
function reason(filePath: string, hits: DupHit[], blocked: boolean): string {
  const body = hits
    .map(
      (h) =>
        `  +${h.line}  ${h.kind} \`${h.name}\`\n` +
        `        → structurally identical to \`${h.existing.name}\` at ${h.existing.file}:${h.existing.line}`,
    )
    .join("\n");
  const head = blocked
    ? "✋ Duplicate code blocked — DRY: extend before you create."
    : "⚠️ Possible duplicate (allowed — dedup mode is `warn`).";
  return [
    head,
    "",
    `${filePath}:`,
    body,
    "",
    "Reuse the existing one — import the function, or derive the type via `Pick`/`Omit`/`extends`/`.extend()` — instead of copying it.",
    "Genuinely independent code that just looks identical? Append `// dup-ignore` to that declaration's first line.",
  ].join("\n");
}

function main(): void {
  const cfg = readConfig();
  const mode = cfg.dedupEnforcement;
  if (mode === "off") allow();

  let data: HookInput;
  try {
    data = JSON.parse(readFileSync(0, "utf8")) as HookInput;
  } catch {
    allow();
  }

  const toolName = data!.tool_name ?? "";
  const input = data!.tool_input ?? {};
  const filePath = input.file_path ?? "";
  if (!EDIT_TOOLS.has(toolName) || !isSourcePath(filePath) || filePath.includes("node_modules")) allow();

  const added = addedTextFor(toolName, input);
  if (!added.trim()) allow();

  const repoRoot = resolveRepoRoot();
  const ts = loadTypeScript(repoRoot);
  if (!ts) allow(); // no TypeScript in the repo → can't check; fail open.

  const skipDirs = parseSkipList(cfg.dedupSkipDirectories);
  const index = buildIndex({ repoRoot, skipDirs, ts: ts! });
  const hits = findDuplicatesInAddedText(ts!, index, repoRoot, filePath, added);
  if (hits.length === 0) allow();

  if (mode === "deny") {
    emit({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason(filePath, hits, true) },
    });
  }
  emit({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: reason(filePath, hits, false) } });
}

try {
  main();
} catch (e) {
  if (readConfig().debugEnabled) writeSync(2, `dedup-guard error: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(0); // fail-open: never block a tool because the guard itself errored.
}
