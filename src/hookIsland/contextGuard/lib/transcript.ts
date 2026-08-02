/** Dependency-free transcript discovery and token accounting for context-guard processes. */

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PROJECTS_DIRECTORY = path.join(homedir(), ".claude", "projects");
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const HAIKU_CONTEXT_WINDOW = 200_000;

const MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  "opus-4-8": 1_000_000,
  "opus-4-7": 1_000_000,
  "opus-4-6": 1_000_000,
  "sonnet-4-6": 1_000_000,
  "sonnet-4-5": 200_000,
  "haiku-4-5": 200_000,
};

export type HookInput = {
  transcript_path?: string;
  cwd?: string;
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

type TokenUsage = {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
};

type TranscriptEntry = {
  isSidechain: boolean;
  model: string;
  usage?: TokenUsage;
};

type TranscriptFile = {
  path: string;
  sessionId: string;
  modifiedAt: number;
};

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const numberProperty = (record: Record<string, unknown>, property: string): number => {
  const candidate = record[property];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
};

const stringProperty = (record: Record<string, unknown>, property: string): string => {
  const candidate = record[property];
  return typeof candidate === "string" ? candidate : "";
};

const decodeTranscriptEntry = (candidate: unknown): TranscriptEntry | undefined => {
  if (!isRecord(candidate)) {
    return undefined;
  }

  const messageCandidate = candidate.message;
  if (!isRecord(messageCandidate)) {
    return { isSidechain: candidate.isSidechain === true, model: "" };
  }

  const usageCandidate = messageCandidate.usage;
  if (!isRecord(usageCandidate)) {
    return {
      isSidechain: candidate.isSidechain === true,
      model: stringProperty(messageCandidate, "model"),
    };
  }

  return {
    isSidechain: candidate.isSidechain === true,
    model: stringProperty(messageCandidate, "model"),
    usage: {
      inputTokens: numberProperty(usageCandidate, "input_tokens"),
      cacheCreationInputTokens: numberProperty(usageCandidate, "cache_creation_input_tokens"),
      cacheReadInputTokens: numberProperty(usageCandidate, "cache_read_input_tokens"),
      outputTokens: numberProperty(usageCandidate, "output_tokens"),
    },
  };
};

const inputTokenCount = (usage: TokenUsage): number =>
  usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;

const transcriptEntryFromLine = (line: string): TranscriptEntry | undefined => {
  if (!line.includes('"usage"')) {
    return undefined;
  }

  try {
    const candidate: unknown = JSON.parse(line);
    return decodeTranscriptEntry(candidate);
  } catch {
    return undefined;
  }
};

const inspectTranscriptDirectory = (
  directory: string,
): {
  nestedDirectories: ReadonlyArray<string>;
  transcriptFiles: ReadonlyArray<TranscriptFile>;
} => {
  const nestedDirectories: Array<string> = [];
  const transcriptFiles: Array<TranscriptFile> = [];
  for (const directoryEntry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, directoryEntry.name);
    if (directoryEntry.isDirectory()) {
      nestedDirectories.push(entryPath);
      continue;
    }

    if (directoryEntry.name.endsWith(".jsonl")) {
      transcriptFiles.push({
        path: entryPath,
        sessionId: directoryEntry.name.slice(0, -".jsonl".length),
        modifiedAt: statSync(entryPath).mtimeMs,
      });
    }
  }

  return { nestedDirectories, transcriptFiles };
};

const projectTranscriptFiles = (): ReadonlyArray<TranscriptFile> => {
  if (!existsSync(PROJECTS_DIRECTORY)) {
    return [];
  }

  const pendingDirectories = [PROJECTS_DIRECTORY];
  const transcriptFiles: Array<TranscriptFile> = [];
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    if (directory === undefined) {
      continue;
    }

    const inspection = inspectTranscriptDirectory(directory);
    pendingDirectories.push(...inspection.nestedDirectories);
    transcriptFiles.push(...inspection.transcriptFiles);
  }

  return transcriptFiles;
};

const newestTranscript = (transcriptFiles: ReadonlyArray<TranscriptFile>): TranscriptFile | undefined =>
  [...transcriptFiles].sort((left, right) => right.modifiedAt - left.modifiedAt).at(0);

export const windowFor = (model: string | undefined): number => {
  if (model === undefined || model.length === 0) {
    return DEFAULT_CONTEXT_WINDOW;
  }

  const modelKeys = Object.keys(MODEL_CONTEXT_WINDOWS).sort((left, right) => right.length - left.length);
  for (const modelKey of modelKeys) {
    const contextWindow = MODEL_CONTEXT_WINDOWS[modelKey];
    if (model.includes(modelKey) && contextWindow !== undefined) {
      return contextWindow;
    }
  }

  return model.includes("haiku") ? HAIKU_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW;
};

export const resolveTranscript = (hookInput: HookInput): string | null => {
  if (hookInput.transcript_path && existsSync(hookInput.transcript_path)) {
    return hookInput.transcript_path;
  }

  if (!hookInput.cwd || !hookInput.session_id) {
    return null;
  }

  const projectSlug = hookInput.cwd.replace(/[^A-Za-z0-9]/gu, "-");
  const transcriptPath = path.join(PROJECTS_DIRECTORY, projectSlug, `${hookInput.session_id}.jsonl`);
  return existsSync(transcriptPath) ? transcriptPath : null;
};

export const tailLines = (file: string): ReadonlyArray<string> => {
  const fileSize = statSync(file).size;
  const start = fileSize > TRANSCRIPT_TAIL_BYTES ? fileSize - TRANSCRIPT_TAIL_BYTES : 0;
  const byteCount = fileSize - start;
  const bytes = Buffer.allocUnsafe(byteCount);
  const descriptor = openSync(file, "r");
  try {
    readSync(descriptor, bytes, 0, byteCount, start);
  } finally {
    closeSync(descriptor);
  }
  return bytes.toString("utf8").split("\n");
};

export const readOccupancy = (transcriptPath: string): { occupancy: number | null; model: string } => {
  const lines = tailLines(transcriptPath);
  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = lines.at(lineIndex);
    if (line === undefined) {
      continue;
    }

    const transcriptEntry = transcriptEntryFromLine(line.trim());
    if (!transcriptEntry || transcriptEntry.isSidechain || !transcriptEntry.usage) {
      continue;
    }

    const occupancy = inputTokenCount(transcriptEntry.usage);
    if (occupancy > 0) {
      return { occupancy, model: transcriptEntry.model };
    }
  }

  return { occupancy: null, model: "" };
};

export const resolveSessionId = (): string | null => {
  const transcriptFile = newestTranscript(projectTranscriptFiles());
  return transcriptFile === undefined ? null : transcriptFile.sessionId;
};

export const transcriptPath = (sessionId: string): string | null => {
  const transcriptFile = projectTranscriptFiles().find((candidate) => candidate.sessionId === sessionId);
  return transcriptFile === undefined ? null : transcriptFile.path;
};

export const resolveTranscriptForSid = (sessionId: string): string | null => {
  const transcriptFiles = projectTranscriptFiles();
  const matchingFiles = transcriptFiles.filter((candidate) => candidate.sessionId === sessionId);
  const transcriptFile = newestTranscript(matchingFiles.length > 0 ? matchingFiles : transcriptFiles);
  return transcriptFile === undefined ? null : transcriptFile.path;
};

export const sumTokens = (sessionId: string): { input: number; output: number } => {
  const file = transcriptPath(sessionId);
  if (!file) {
    return { input: 0, output: 0 };
  }

  let input = 0;
  let output = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const transcriptEntry = transcriptEntryFromLine(line);
    if (!transcriptEntry || transcriptEntry.isSidechain || !transcriptEntry.usage) {
      continue;
    }

    input += inputTokenCount(transcriptEntry.usage);
    output += transcriptEntry.usage.outputTokens;
  }

  return { input, output };
};
