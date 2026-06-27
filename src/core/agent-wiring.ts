/**
 * Multi-agent wiring for the dedup-guard feature.
 *
 * The base installer wires Claude Code via settings.json (see `settings.ts`).
 * This module adds the other two surfaces, each in its own native format and
 * each removed just as surgically:
 *
 *  - **Cursor** → `.cursor/hooks.json` `afterFileEdit` entry (warn-tier; Cursor
 *    has no native before-edit deny). Bag entries are path-identified by the
 *    `/skills-bag/` marker, exactly like the Claude hooks.
 *  - **Codex / any AGENTS.md-reading agent** → a managed block in `AGENTS.md`.
 *    Codex's PreToolUse hook only intercepts Bash, so it can't block an edit;
 *    the reliable lever is the instruction file plus the `dedup check` command.
 *
 * The block/JSON mutators are pure (string/clone in, string/clone out) so the
 * merge logic is unit-testable without disk; thin IO wrappers sit at the bottom.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readJson, writeJson } from "./fs-utils.js";
import { isBagCommand } from "./paths.js";

// ── Cursor hooks.json ────────────────────────────────────────────────────────

/** A single Cursor hook command leaf. */
export interface CursorHookCommand {
  command: string;
  [key: string]: unknown;
}

/** The slice of `.cursor/hooks.json` we touch; unknown keys pass through untouched. */
export interface CursorHooksFile {
  version?: number;
  hooks?: Record<string, CursorHookCommand[]>;
  [key: string]: unknown;
}

/** Strip every bag-owned command from a Cursor hooks file, collapsing empty event arrays. */
export function removeCursorBagHooks(input: CursorHooksFile): CursorHooksFile {
  const file = structuredClone(input);
  if (!file.hooks) return file;
  for (const event of Object.keys(file.hooks)) {
    const kept = (file.hooks[event] ?? []).filter((h) => !isBagCommand(h.command ?? ""));
    if (kept.length > 0) file.hooks[event] = kept;
    else delete file.hooks[event];
  }
  return file;
}

/** Idempotently register the dedup `afterFileEdit` command alongside any user hooks. */
export function mergeCursorHook(input: CursorHooksFile, command: string): CursorHooksFile {
  const file = removeCursorBagHooks(input);
  file.version ??= 1;
  file.hooks ??= {};
  (file.hooks.afterFileEdit ??= []).push({ command });
  return file;
}

// ── AGENTS.md managed block ──────────────────────────────────────────────────

const BLOCK_START = "<!-- skills-bag:dedup-guard start -->";
const BLOCK_END = "<!-- skills-bag:dedup-guard end -->";

/** The instruction injected into AGENTS.md so agents that can't hook edits still avoid duplication. */
export const DEDUP_AGENTS_RULE = [
  "## No duplicate code — skills-bag dedup-guard",
  "",
  "Before adding a function or an `interface`/`type`, search for an existing one to reuse — never paste a structural copy of a body or shape under a new name. Reuse it (import the function, or derive the type via `Pick`/`Omit`/`extends`/`.extend()`).",
  "",
  "Run `npx skills-bag dedup check --since main` (or `--staged`) to find duplicates — it exits non-zero on findings (CI/pre-commit gate). Annotate a genuine exception with `// dup-ignore` on the declaration's first line.",
].join("\n");

/** A managed block, ready to splice into a markdown file. */
const block = (body: string): string => `${BLOCK_START}\n${body}\n${BLOCK_END}`;

/** Insert or replace the dedup managed block in `text` (idempotent). Appends when absent. */
export function upsertManagedBlock(text: string, body: string): string {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(0, start) + block(body) + text.slice(end + BLOCK_END.length);
  }
  const base = text.trimEnd();
  return base.length > 0 ? `${base}\n\n${block(body)}\n` : `${block(body)}\n`;
}

/** Remove the dedup managed block (and the blank line that preceded it), if present. */
export function stripManagedBlock(text: string): string {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) return text;
  const before = text.slice(0, start).replace(/\n+$/, "");
  const after = text.slice(end + BLOCK_END.length).replace(/^\n+/, "");
  return [before, after].filter((part) => part.length > 0).join("\n\n") + (after.length > 0 || before.length > 0 ? "\n" : "");
}

// ── IO layer ─────────────────────────────────────────────────────────────────

/** The project (or home) root that holds `.cursor/` and `AGENTS.md` for a layout. */
export const rootDirOf = (claudeDir: string): string => path.dirname(claudeDir);

export const cursorHooksPath = (claudeDir: string): string => path.join(rootDirOf(claudeDir), ".cursor", "hooks.json");
export const agentsFilePath = (claudeDir: string): string => path.join(rootDirOf(claudeDir), "AGENTS.md");

/** Write the dedup `afterFileEdit` command into `.cursor/hooks.json`, preserving user hooks. */
export function writeCursorHook(claudeDir: string, command: string): string {
  const file = cursorHooksPath(claudeDir);
  const current = readJson<CursorHooksFile>(file) ?? {};
  writeJson(file, mergeCursorHook(current, command));
  return file;
}

/** Remove bag-owned Cursor hooks; leaves the file (and user hooks) otherwise intact. */
export function unwriteCursorHook(claudeDir: string): void {
  const file = cursorHooksPath(claudeDir);
  const current = readJson<CursorHooksFile>(file);
  if (current) writeJson(file, removeCursorBagHooks(current));
}

/** Insert/refresh the dedup managed block in AGENTS.md (created if absent). */
export function writeAgentsBlock(claudeDir: string): string {
  const file = agentsFilePath(claudeDir);
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, upsertManagedBlock(current, DEDUP_AGENTS_RULE), "utf8");
  return file;
}

/** Remove the dedup managed block from AGENTS.md, if present (no-op when absent — never rewrites needlessly). */
export function removeAgentsBlock(claudeDir: string): void {
  const file = agentsFilePath(claudeDir);
  if (!existsSync(file)) return;
  const current = readFileSync(file, "utf8");
  const stripped = stripManagedBlock(current);
  if (stripped !== current) writeFileSync(file, stripped, "utf8");
}
