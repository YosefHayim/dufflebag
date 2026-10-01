#!/usr/bin/env node
// SessionEnd hook that deletes the ended Claude Code session's own scratch folder; fails open.

import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

// e.g. "5cc2fa97-8a4b-4379-b0f0-4141d18275da" — not "../x" or "*"
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

// Claude Code keeps each session's scratchpad and task output in <CLAUDE_CODE_TMPDIR or /tmp>/claude-<uid>/<project>/<session>.
const claudeScratchRoot = (): string | undefined => {
  const userId = process.getuid?.();
  if (userId === undefined) {
    return undefined;
  }

  return path.join(process.env.CLAUDE_CODE_TMPDIR || "/tmp", `claude-${userId}`);
};

const clearSessionScratch = (): void => {
  const hookInput: unknown = JSON.parse(readFileSync(0, "utf8"));
  const sessionId = isRecord(hookInput) ? hookInput.session_id : undefined;
  const scratchRoot = claudeScratchRoot();
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId) || scratchRoot === undefined) {
    return;
  }

  const projectFolders = readdirSync(scratchRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const projectFolder of projectFolders) {
    rmSync(path.join(scratchRoot, projectFolder.name, sessionId), { recursive: true, force: true });
  }
};

try {
  clearSessionScratch();
} catch {
  // A missing scratch root means there is nothing to clear.
}
process.exit(0);
