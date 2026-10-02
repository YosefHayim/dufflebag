// Claude Code keeps each session at ~/.claude/projects/<launch folder, every [^A-Za-z0-9-] → "-">/<session>.jsonl,
// with an optional <session>/ folder of subagent transcripts and saved tool output beside it. `/resume` lists the
// current folder's sessions, and `claude --resume <id>` scans every folder but refuses when two copies exist.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { isProcessAlive } from "../../lib/processAlive.js";
import { readTranscriptTail } from "../../lib/transcriptReader.js";
import { appendJsonLine, decodeJsonLine, isRecord } from "./jsonLines.js";

export type ClaudeSession = {
  readonly sessionId: string;
  readonly transcriptFile: string;
  readonly projectFolder: string;
  /** Where the session lives now: the last `relocated` line, else the folder it was started in. */
  readonly homeFolder: string;
};

// e.g. "5cc2fa97-8a4b-4379-b0f0-4141d18275da.jsonl"
const TRANSCRIPT_NAME_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/u;
const HEAD_BYTES = 64 * 1024;

export const claudeConfigRoot = (homeRoot: string): string =>
  process.env.CLAUDE_CONFIG_DIR || path.join(homeRoot, ".claude");

const projectsRoot = (homeRoot: string): string => path.join(claudeConfigRoot(homeRoot), "projects");

// Matches Claude Code's own folder naming, e.g. "/Users/me/Desktop/Code/vybekiit" → "-Users-me-Desktop-Code-vybekiit".
export const projectFolderFor = (request: { readonly homeRoot: string; readonly folder: string }): string =>
  path.join(projectsRoot(request.homeRoot), request.folder.replace(/[^A-Za-z0-9-]/gu, "-"));

const headLines = (file: string): ReadonlyArray<string> => {
  const descriptor = openSync(file, "r");
  try {
    const bytes = Buffer.alloc(HEAD_BYTES);
    const byteCount = readSync(descriptor, bytes, 0, HEAD_BYTES, 0);
    return bytes.subarray(0, byteCount).toString("utf8").split("\n");
  } finally {
    closeSync(descriptor);
  }
};

const homeFolderOf = (transcriptFile: string): string => {
  const relocatedCwd = readTranscriptTail(transcriptFile)
    .map(decodeJsonLine)
    .filter((line) => line.type === "relocated" && typeof line.relocatedCwd === "string")
    .map((line) => String(line.relocatedCwd))
    .at(-1);
  const startCwd = headLines(transcriptFile)
    .map(decodeJsonLine)
    .map((line) => line.cwd)
    .find((cwd): cwd is string => typeof cwd === "string");
  return relocatedCwd || startCwd || "";
};

const sessionsInFolder = (projectFolder: string): ReadonlyArray<ClaudeSession> =>
  readdirSync(projectFolder).flatMap((name) => {
    const sessionId = TRANSCRIPT_NAME_PATTERN.exec(name)?.[1];
    if (!sessionId) {
      return [];
    }

    const transcriptFile = path.join(projectFolder, name);
    return [{ sessionId, transcriptFile, projectFolder, homeFolder: homeFolderOf(transcriptFile) }];
  });

export const listClaudeSessions = (homeRoot: string): ReadonlyArray<ClaudeSession> => {
  const root = projectsRoot(homeRoot);
  if (!existsSync(root)) {
    return [];
  }

  const sessions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => sessionsInFolder(path.join(root, entry.name)));
  const copies = new Map<string, number>();
  for (const session of sessions) {
    copies.set(session.sessionId, (copies.get(session.sessionId) || 0) + 1);
  }
  // `claude --resume` already refuses an id stored in two project folders; moving either copy could lose work.
  return sessions.filter((session) => copies.get(session.sessionId) === 1);
};

// Finds one session by file name alone, without reading every transcript the way a full listing does.
export const findClaudeSession = (request: {
  readonly homeRoot: string;
  readonly sessionId: string;
}): ClaudeSession | undefined => {
  const root = projectsRoot(request.homeRoot);
  const projectFolders = (existsSync(root) ? readdirSync(root) : [])
    .map((name) => path.join(root, name))
    .filter((folder) => existsSync(path.join(folder, `${request.sessionId}.jsonl`)));
  const [projectFolder] = projectFolders;
  if (!projectFolder || projectFolders.length > 1) {
    return undefined;
  }

  const transcriptFile = path.join(projectFolder, `${request.sessionId}.jsonl`);
  return { sessionId: request.sessionId, transcriptFile, projectFolder, homeFolder: homeFolderOf(transcriptFile) };
};

const readJsonFile = (file: string): Record<string, unknown> => {
  try {
    const candidate: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isRecord(candidate) ? candidate : {};
  } catch {
    return {};
  }
};

const jsonFilesIn = (folder: string): ReadonlyArray<string> => {
  try {
    return readdirSync(folder, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(folder, name));
  } catch {
    return [];
  }
};

// ~/.claude/sessions/<pid>.json names the session each running Claude process holds, and a background job's
// state.json points at its transcript by absolute path, so moving either would break a live owner.
export const claudeSessionIsLive = (request: {
  readonly homeRoot: string;
  readonly session: ClaudeSession;
  readonly quietSeconds: number;
}): boolean => {
  const configRoot = claudeConfigRoot(request.homeRoot);
  const heldByProcess = jsonFilesIn(path.join(configRoot, "sessions"))
    .map(readJsonFile)
    .some((entry) => entry.sessionId === request.session.sessionId && isProcessAlive(Number(entry.pid)));
  const ownedByJob = jsonFilesIn(path.join(configRoot, "jobs"))
    .filter((file) => path.basename(file) === "state.json")
    .map(readJsonFile)
    .some((state) => state.sessionId === request.session.sessionId);
  const recentlyWritten = Date.now() - statSync(request.session.transcriptFile).mtimeMs < request.quietSeconds * 1_000;
  return heldByProcess || ownedByJob || recentlyWritten;
};

export type ClaudeMove =
  | { readonly _tag: "moved"; readonly transcriptFile: string }
  | { readonly _tag: "conflict"; readonly existingFile: string };

// Mirrors Claude Code's own relocateSessionTranscript: move the transcript and its folder, then append the
// `relocated` line whose relocatedCwd tells /resume which project the session now belongs to.
export const moveClaudeSession = (request: {
  readonly homeRoot: string;
  readonly session: ClaudeSession;
  readonly targetFolder: string;
}): ClaudeMove => {
  const targetProjectFolder = projectFolderFor({ homeRoot: request.homeRoot, folder: request.targetFolder });
  const targetTranscript = path.join(targetProjectFolder, path.basename(request.session.transcriptFile));
  const sourceSessionFolder = path.join(request.session.projectFolder, request.session.sessionId);
  const targetSessionFolder = path.join(targetProjectFolder, request.session.sessionId);
  if (existsSync(targetTranscript) || existsSync(targetSessionFolder)) {
    return { _tag: "conflict", existingFile: targetTranscript };
  }

  mkdirSync(targetProjectFolder, { recursive: true });
  renameSync(request.session.transcriptFile, targetTranscript);
  const relocated = { type: "relocated", sessionId: request.session.sessionId, relocatedCwd: request.targetFolder };
  try {
    if (existsSync(sourceSessionFolder)) {
      renameSync(sourceSessionFolder, targetSessionFolder);
    }
    appendJsonLine({ file: targetTranscript, line: relocated });
  } catch (moveError) {
    // A half-done move would split the transcript from its subagents; put everything back in the old folder.
    if (existsSync(targetSessionFolder) && !existsSync(sourceSessionFolder)) {
      renameSync(targetSessionFolder, sourceSessionFolder);
    }
    renameSync(targetTranscript, request.session.transcriptFile);
    throw moveError;
  }
  return { _tag: "moved", transcriptFile: targetTranscript };
};

const scratchRoots = (homeRoot: string): ReadonlyArray<string> => {
  const userId = process.getuid?.();
  const scratchParents = [process.env.CLAUDE_CODE_TMPDIR, path.join(claudeConfigRoot(homeRoot), "tmp"), "/tmp"];
  return userId === undefined
    ? []
    : scratchParents.flatMap((parent) => (parent ? [path.join(parent, `claude-${userId}`)] : []));
};

const scratchFoldersFor = (request: { readonly homeRoot: string; readonly sessionId: string }) =>
  scratchRoots(request.homeRoot).flatMap((root) => {
    try {
      return readdirSync(root).map((projectName) => path.join(root, projectName, request.sessionId));
    } catch {
      return [];
    }
  });

// A live Claude process may append between our read and our rename, so a grown file is re-read and filtered again.
const removeHistoryLines = (request: { readonly homeRoot: string; readonly sessionIds: ReadonlySet<string> }) => {
  const historyFile = path.join(claudeConfigRoot(request.homeRoot), "history.jsonl");
  for (let attempt = 0; attempt < 5 && existsSync(historyFile); attempt += 1) {
    const sizeBefore = statSync(historyFile).size;
    const keptLines = readFileSync(historyFile, "utf8")
      .split("\n")
      .filter((line) => !line.trim() || !request.sessionIds.has(String(decodeJsonLine(line).sessionId)));
    const rewrittenFile = `${historyFile}.rehome-${process.pid}`;
    writeFileSync(rewrittenFile, keptLines.join("\n"));
    if (statSync(historyFile).size === sizeBefore) {
      renameSync(rewrittenFile, historyFile);
      return;
    }
    rmSync(rewrittenFile, { force: true });
  }
};

export const deleteClaudeSessions = (request: {
  readonly homeRoot: string;
  readonly sessions: ReadonlyArray<ClaudeSession>;
}): void => {
  const configRoot = claudeConfigRoot(request.homeRoot);
  for (const session of request.sessions) {
    const sessionFolders = [
      path.join(session.projectFolder, session.sessionId),
      path.join(configRoot, "file-history", session.sessionId),
      path.join(configRoot, "session-env", session.sessionId),
      ...scratchFoldersFor({ homeRoot: request.homeRoot, sessionId: session.sessionId }),
    ];
    for (const removable of [session.transcriptFile, ...sessionFolders]) {
      rmSync(removable, { recursive: true, force: true });
    }
  }
  removeHistoryLines({
    homeRoot: request.homeRoot,
    sessionIds: new Set(request.sessions.map((session) => session.sessionId)),
  });
};

// A deleted repo's project folder also holds its auto-memory; it goes once no session is left in it.
export const removeEmptyProjectFolder = (request: { readonly homeRoot: string; readonly folder: string }): boolean => {
  const projectFolder = projectFolderFor(request);
  if (!existsSync(projectFolder) || readdirSync(projectFolder).some((name) => TRANSCRIPT_NAME_PATTERN.test(name))) {
    return false;
  }

  rmSync(projectFolder, { recursive: true, force: true });
  return true;
};
