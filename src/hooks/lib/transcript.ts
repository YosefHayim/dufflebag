/**
 * Transcript reading utilities shared by the guard, the control plane, and the
 * daemon. Self-contained (Node built-ins only) so it ships in the hook payload.
 *
 * Claude Code never hands hooks a token count, so occupancy is derived the same
 * way the original Python did: read the tail of the session JSONL, find the most
 * recent main-thread (non-sidechain) assistant line, and sum its usage —
 * `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` —
 * because the cache fields dominate once prompt caching kicks in.
 */

import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HOME = homedir();
const PROJECTS_DIR = path.join(HOME, ".claude", "projects");

/** Only ever read the last 256 KiB of a transcript. */
const TAIL_BYTES = 256 * 1024;

/** Model id substring → context window (tokens), longest key wins. */
const MODEL_WINDOWS: Record<string, number> = {
  "opus-4-8": 1_000_000,
  "opus-4-7": 1_000_000,
  "opus-4-6": 1_000_000,
  "sonnet-4-6": 1_000_000,
  "sonnet-4-5": 200_000,
  "haiku-4-5": 200_000,
};
const DEFAULT_WINDOW = 1_000_000;
const HAIKU_WINDOW = 200_000;

/** Hook stdin payload fields we care about. */
export interface HookInput {
  transcript_path?: string;
  cwd?: string;
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}
interface TranscriptLine {
  isSidechain?: boolean;
  message?: { usage?: Usage; model?: string };
}

/** Context window for a model id, via the explicit map then haiku/default fallback. */
export function windowFor(model: string | undefined): number {
  if (model) {
    for (const key of Object.keys(MODEL_WINDOWS).sort((a, b) => b.length - a.length)) {
      if (model.includes(key)) return MODEL_WINDOWS[key]!;
    }
    if (model.includes("haiku")) return HAIKU_WINDOW;
  }
  return DEFAULT_WINDOW;
}

/** Transcript path from stdin, else reconstructed from cwd + session_id (CC's slug scheme). */
export function resolveTranscript(data: HookInput): string | null {
  if (data.transcript_path && existsSync(data.transcript_path)) return data.transcript_path;
  if (!data.cwd || !data.session_id) return null;
  const slug = data.cwd.replace(/[^A-Za-z0-9]/g, "-");
  const candidate = path.join(PROJECTS_DIR, slug, `${data.session_id}.jsonl`);
  return existsSync(candidate) ? candidate : null;
}

/** Read only the tail of a file as UTF-8 lines. */
export function tailLines(file: string): string[] {
  const size = statSync(file).size;
  const start = size > TAIL_BYTES ? size - TAIL_BYTES : 0;
  const length = size - start;
  const buf = Buffer.allocUnsafe(length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, length, start);
  } finally {
    closeSync(fd);
  }
  return buf.toString("utf8").split("\n");
}

const usageOf = (u: Usage | undefined): number =>
  (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);

/** (occupancyTokens, model) from the latest main-thread usage line, or nulls if none. */
export function readOccupancy(transcriptPath: string): { occupancy: number | null; model: string } {
  const lines = tailLines(transcriptPath);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line || !line.includes('"usage"')) continue;
    let entry: TranscriptLine;
    try {
      entry = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }
    if (entry.isSidechain || !entry.message?.usage) continue;
    const occupancy = usageOf(entry.message.usage);
    if (occupancy > 0) return { occupancy, model: entry.message.model ?? "" };
  }
  return { occupancy: null, model: "" };
}

/** Newest-mtime transcript basename = the session a skill is running in. */
export function resolveSessionId(): string | null {
  if (!existsSync(PROJECTS_DIR)) return null;
  const found: { sid: string; mtime: number }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".jsonl"))
        found.push({ sid: entry.name.slice(0, -".jsonl".length), mtime: statSync(full).mtimeMs });
    }
  };
  walk(PROJECTS_DIR);
  return found.sort((a, b) => b.mtime - a.mtime)[0]?.sid ?? null;
}

/** Absolute path to a session's transcript, searching the projects tree. */
export function transcriptPath(sid: string): string | null {
  if (!existsSync(PROJECTS_DIR)) return null;
  let found: string | null = null;
  const walk = (dir: string): void => {
    if (found) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === `${sid}.jsonl`) found = full;
    }
  };
  walk(PROJECTS_DIR);
  return found;
}

/**
 * Daemon resolver: the newest-mtime transcript named for this session id, else
 * the newest transcript overall (so a renamed/relocated file still tracks).
 */
export function resolveTranscriptForSid(sid: string): string | null {
  if (!existsSync(PROJECTS_DIR)) return null;
  const direct: { path: string; mtime: number }[] = [];
  const all: { path: string; mtime: number }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".jsonl")) {
        const record = { path: full, mtime: statSync(full).mtimeMs };
        if (entry.name === `${sid}.jsonl`) direct.push(record);
        all.push(record);
      }
    }
  };
  walk(PROJECTS_DIR);
  const pool = direct.length > 0 ? direct : all;
  const newest = pool.sort((a, b) => b.mtime - a.mtime)[0];
  return newest?.path ?? null;
}

/** (inputInclCache, output) summed across the whole transcript for a session. */
export function sumTokens(sid: string): { input: number; output: number } {
  const file = transcriptPath(sid);
  if (!file) return { input: 0, output: 0 };
  let input = 0;
  let output = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"usage"')) continue;
    let entry: TranscriptLine;
    try {
      entry = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }
    if (entry.isSidechain || !entry.message?.usage) continue;
    input += usageOf(entry.message.usage);
    output += entry.message.usage.output_tokens ?? 0;
  }
  return { input, output };
}
