// Finds a Claude Code session's transcript and reads its token usage.

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  decodeTranscriptLine,
  readTranscriptLines,
  readTranscriptTail,
  type TokenUsage,
} from "../../lib/transcriptReader.js";

const PROJECTS_DIRECTORY = path.join(homedir(), ".claude", "projects");

// Models with a 200k context window; every other model gets 1M.
const SMALL_WINDOW_MODELS = ["sonnet-4-5", "haiku"];

type TranscriptFile = {
  path: string;
  sessionId: string;
  modifiedAt: number;
};

type TranscriptLocation = {
  transcript_path?: string;
  cwd?: string;
  session_id?: string;
};

const inputTokenCount = (usage: TokenUsage): number =>
  usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;

// Only lines carrying token usage matter, and skipping the rest avoids parsing every turn of a long transcript.
const mainThreadUsage = (line: string): { usage: TokenUsage; model: string } | undefined => {
  if (!line.includes('"usage"')) return undefined;
  const entry = decodeTranscriptLine(line);
  if (!entry || entry.isSidechain || !entry.usage) return undefined;
  return { usage: entry.usage, model: entry.model };
};

const inspectTranscriptDirectory = (
  directory: string,
): { nestedDirectories: ReadonlyArray<string>; transcriptFiles: ReadonlyArray<TranscriptFile> } => {
  const nestedDirectories: Array<string> = [];
  const transcriptFiles: Array<TranscriptFile> = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      nestedDirectories.push(entryPath);
    } else if (entry.name.endsWith(".jsonl")) {
      const sessionId = entry.name.slice(0, -".jsonl".length);
      transcriptFiles.push({ path: entryPath, sessionId, modifiedAt: statSync(entryPath).mtimeMs });
    }
  }
  return { nestedDirectories, transcriptFiles };
};

const projectTranscriptFiles = (): ReadonlyArray<TranscriptFile> => {
  const pendingDirectories = existsSync(PROJECTS_DIRECTORY) ? [PROJECTS_DIRECTORY] : [];
  const transcriptFiles: Array<TranscriptFile> = [];
  for (let directory = pendingDirectories.pop(); directory !== undefined; directory = pendingDirectories.pop()) {
    const inspection = inspectTranscriptDirectory(directory);
    pendingDirectories.push(...inspection.nestedDirectories);
    transcriptFiles.push(...inspection.transcriptFiles);
  }
  return transcriptFiles;
};

const newestTranscript = (transcriptFiles: ReadonlyArray<TranscriptFile>): TranscriptFile | undefined =>
  [...transcriptFiles].sort((left, right) => right.modifiedAt - left.modifiedAt).at(0);

export const windowFor = (model: string): number =>
  SMALL_WINDOW_MODELS.some((modelName) => model.includes(modelName)) ? 200_000 : 1_000_000;

export const resolveTranscript = (location: TranscriptLocation): string | null => {
  if (location.transcript_path && existsSync(location.transcript_path)) return location.transcript_path;
  if (!location.cwd || !location.session_id) return null;
  const projectSlug = location.cwd.replace(/[^A-Za-z0-9]/gu, "-");
  const transcriptPath = path.join(PROJECTS_DIRECTORY, projectSlug, `${location.session_id}.jsonl`);
  return existsSync(transcriptPath) ? transcriptPath : null;
};

// Occupancy is the newest main-thread turn's input tokens, so read backwards from the tail.
export const readContextUsage = (transcriptPath: string): { occupancy: number | null; model: string } => {
  for (const line of [...readTranscriptTail(transcriptPath)].reverse()) {
    const reading = mainThreadUsage(line);
    const occupancy = reading ? inputTokenCount(reading.usage) : 0;
    if (reading && occupancy > 0) return { occupancy, model: reading.model };
  }
  return { occupancy: null, model: "" };
};

// The session of the most recently written transcript.
export const resolveSessionId = (): string | null => {
  const transcriptFile = newestTranscript(projectTranscriptFiles());
  return transcriptFile === undefined ? null : transcriptFile.sessionId;
};

// Falls back to the newest transcript of any session when this session has none.
export const findTranscriptForSession = (sessionId: string): string | null => {
  const transcriptFiles = projectTranscriptFiles();
  const matchingFiles = transcriptFiles.filter((candidate) => candidate.sessionId === sessionId);
  const transcriptFile = newestTranscript(matchingFiles.length > 0 ? matchingFiles : transcriptFiles);
  return transcriptFile === undefined ? null : transcriptFile.path;
};

export const sumTokens = (sessionId: string): { input: number; output: number } => {
  const transcriptFile = projectTranscriptFiles().find((candidate) => candidate.sessionId === sessionId);
  let input = 0;
  let output = 0;
  for (const line of transcriptFile === undefined ? [] : readTranscriptLines(transcriptFile.path)) {
    const reading = mainThreadUsage(line);
    if (!reading) continue;
    input += inputTokenCount(reading.usage);
    output += reading.usage.outputTokens;
  }
  return { input, output };
};
