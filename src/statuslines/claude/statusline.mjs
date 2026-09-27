#!/usr/bin/env node
// Claude Code status line. Line 1: folder · branch · model · context · 5-hour and weekly limits.
// Line 2: messages, compacts, session tokens, and duration. Dependency-free; reads Claude's stdin JSON.
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const STATE_DIR = path.join(homedir(), ".claude", "dufflebag", "state");
const ANSI = { green: "\x1b[32m", blue: "\x1b[34m", red: "\x1b[31m", dim: "\x1b[2m", reset: "\x1b[0m" };
const SEPARATOR = `${ANSI.dim} · ${ANSI.reset}`;
const EMPTY_STATS = {
  offset: 0,
  user: 0,
  claude: 0,
  compacts: 0,
  input: 0,
  output: 0,
  lastId: "",
  lastTextId: "",
  lastOutput: 0,
};

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

const writeJson = (file, value) => {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value)}\n`);
  } catch {
    // The status line must render even when state cannot be saved.
  }
};

const shortCount = (count) => {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
};

const duration = (milliseconds) => {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(milliseconds / 1_000)}s`;
};

// Green while there is room, blue past half, red from 80%.
const limitColor = (used) => {
  if (used >= 80) return ANSI.red;
  if (used >= 50) return ANSI.blue;
  return ANSI.green;
};

const percent = (used) => `${limitColor(used)}${Math.round(used)}%${ANSI.reset}/100%`;

const gitBranch = (cwd) => {
  try {
    return execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    }).trim();
  } catch {
    return "";
  }
};

const promptText = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.some((block) => block.type === "tool_result")) return undefined;
  return content.find((block) => block.type === "text")?.text || "";
};

// Only what the person typed: task notices and command output start with "<", interruptions with "[",
// and slash commands with "/".
const isUserPrompt = (entry) => {
  if (entry.type !== "user" || entry.isMeta || entry.isSidechain || entry.isCompactSummary) return false;
  const text = promptText(entry.message?.content);
  return text !== undefined && !/^[<[/]/.test(text.trimStart());
};

// One assistant reply spans several lines (thinking, text, tool calls) that share a message id and usage.
const countAssistant = (stats, message) => {
  const usage = message.usage;
  if (message.content?.some((block) => block.type === "text") && message.id !== stats.lastTextId) {
    stats.lastTextId = message.id;
    stats.claude += 1;
  }
  if (message.id !== stats.lastId) {
    stats.lastId = message.id;
    stats.lastOutput = 0;
    // New input only: cache reads resend the whole context on every call.
    if (usage) stats.input += usage.input_tokens + usage.cache_creation_input_tokens;
  }
  if (usage && usage.output_tokens > stats.lastOutput) {
    stats.output += usage.output_tokens - stats.lastOutput;
    stats.lastOutput = usage.output_tokens;
  }
};

const readNewLines = (transcriptPath, offset, size) => {
  const buffer = Buffer.alloc(size - offset);
  const descriptor = openSync(transcriptPath, "r");
  try {
    readSync(descriptor, buffer, 0, buffer.length, offset);
  } finally {
    closeSync(descriptor);
  }
  const end = buffer.lastIndexOf(10) + 1;
  return { lines: buffer.subarray(0, end).toString("utf8").split("\n"), bytes: end };
};

// Counts are cached per session, so each refresh reads only lines added since the last one.
const transcriptStats = (sessionId, transcriptPath) => {
  const cacheFile = path.join(STATE_DIR, "statusline", `${sessionId}.json`);
  const size = statSync(transcriptPath).size;
  const cached = readJson(cacheFile);
  const stats = cached && cached.offset <= size ? cached : { ...EMPTY_STATS };
  if (stats.offset === size) return stats;
  const { lines, bytes } = readNewLines(transcriptPath, stats.offset, size);
  for (const line of lines) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === "system" && entry.subtype === "compact_boundary") stats.compacts += 1;
      else if (isUserPrompt(entry)) stats.user += 1;
      else if (entry.type === "assistant" && !entry.isSidechain && entry.message) countAssistant(stats, entry.message);
    } catch {
      // A partly written line is read again on the next refresh.
    }
  }
  stats.offset += bytes;
  writeJson(cacheFile, stats);
  return stats;
};

const contextUsage = (window) => {
  const usage = window?.current_usage;
  if (!usage || !window.context_window_size) return "";
  const used = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
  return `${shortCount(used)}/${shortCount(window.context_window_size)}`;
};

const input = readJson(0) || {};
const cwd = input.workspace?.current_dir || input.cwd || process.cwd();
const fiveHour = input.rate_limits?.five_hour?.used_percentage;
const weekly = input.rate_limits?.seven_day?.used_percentage;
if (typeof fiveHour === "number" || typeof weekly === "number") {
  // The autorun report reads the same limits from here.
  writeJson(path.join(STATE_DIR, "rate-limits.json"), { five_hour_pct: fiveHour, weekly_pct: weekly });
}

const firstLine = [
  path.basename(cwd),
  gitBranch(cwd),
  input.model?.display_name,
  contextUsage(input.context_window),
  typeof fiveHour === "number" ? `5H ${percent(fiveHour)}` : "",
  typeof weekly === "number" ? `W ${percent(weekly)}` : "",
];

const secondLine = [];
if (input.session_id && input.transcript_path) {
  try {
    const stats = transcriptStats(input.session_id, input.transcript_path);
    secondLine.push(
      `User:${stats.user} & Claude:${stats.claude}`,
      `Total ${stats.user + stats.claude}`,
      `Compacts:${stats.compacts}`,
      `In:${shortCount(stats.input)} Out:${shortCount(stats.output)}`,
    );
  } catch {
    // No transcript yet: show only the first line.
  }
}
if (input.cost?.total_duration_ms) secondLine.push(duration(input.cost.total_duration_ms));

console.log(firstLine.filter(Boolean).join(SEPARATOR));
if (secondLine.length > 0) console.log(secondLine.join(SEPARATOR));
