#!/usr/bin/env node
/** Queue one complete final response for Dufflebag's local voice worker. */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (value: JsonRecord, names: ReadonlyArray<string>) => {
  for (const name of names) {
    const candidate = value[name];
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return "";
};

const parseJson = (value: string): unknown => JSON.parse(value);

const blockType = (value: unknown) => (isRecord(value) && typeof value.type === "string" ? value.type : "");

const entryContent = (entry: JsonRecord) => {
  if (isRecord(entry.message)) {
    return entry.message.content;
  }
  return entry.content;
};

const isGenuineUser = (entry: unknown) => {
  if (!isRecord(entry) || (entry.type !== "user" && entry.role !== "user")) {
    return false;
  }
  const content = entryContent(entry);
  if (typeof content === "string") {
    return true;
  }
  return Array.isArray(content) && content.every((block) => blockType(block) !== "tool_result");
};

const assistantText = (entry: unknown) => {
  if (!isRecord(entry) || (entry.type !== "assistant" && entry.role !== "assistant")) {
    return [];
  }
  const content = entryContent(entry);
  if (typeof content === "string") {
    return content.trim() ? [content] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((block) =>
    isRecord(block) && block.type === "text" && typeof block.text === "string" && block.text.trim() ? [block.text] : [],
  );
};

const responseFromTranscript = (transcriptPath: string) => {
  const entries = readFileSync(transcriptPath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map(parseJson);
  let start = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (isGenuineUser(entries[index])) {
      start = index + 1;
      break;
    }
  }
  return entries.slice(start).flatMap(assistantText).join("\n\n");
};

const agentId = () => {
  const flag = process.argv.indexOf("--dufflebag-agent-id");
  const value = flag >= 0 ? process.argv[flag + 1] : "";
  return value?.trim() || "unknown-agent";
};

const isFinalGrokEvent = (input: JsonRecord) => {
  const reason = stringField(input, ["reason", "hook_reason", "hookReason"]);
  return !reason || ["complete", "completed", "end_turn", "stop"].includes(reason) || reason.endsWith(":end_turn");
};

const directResponse = (input: JsonRecord) =>
  stringField(input, ["last_assistant_message", "lastAssistantMessage", "last_agent_message", "lastAgentMessage"]);

const voiceStateHome = () => {
  const override = process.env.DUFFLEBAG_VOICE_HOME?.trim();
  if (override) {
    return path.resolve(override);
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local"), "dufflebag", "voice");
  }
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "dufflebag", "voice");
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"), "dufflebag", "voice");
};

const queueResponse = (markdown: string, source: string, responseId: string) => {
  const inbox = path.join(voiceStateHome(), "inbox");
  mkdirSync(inbox, { recursive: true });
  const id = `${Date.now()}-${randomUUID()}`;
  const destination = path.join(inbox, `${id}.json`);
  const temporary = path.join(inbox, `.${id}.tmp`);
  writeFileSync(
    temporary,
    JSON.stringify({
      markdown,
      received_at: Date.now() / 1_000,
      response_id: responseId,
      source,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  renameSync(temporary, destination);
};

const startWorker = () => {
  const voicePath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "voice.py");
  const worker = spawn("uv", ["run", "--frozen", "--script", voicePath, "start"], {
    cwd: path.dirname(voicePath),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  worker.on("error", () => undefined);
  worker.unref();
};

const main = () => {
  const input = parseJson(readFileSync(0, "utf8"));
  if (!isRecord(input)) {
    return;
  }
  const source = agentId();
  if (source === "grok" && !isFinalGrokEvent(input)) {
    return;
  }

  const transcriptPath = stringField(input, ["transcript_path", "transcriptPath"]);
  const markdown = directResponse(input) || (transcriptPath ? responseFromTranscript(transcriptPath) : "");
  if (!markdown.trim()) {
    return;
  }

  const responseId = stringField(input, ["response_id", "responseId", "turn_id", "turnId"]);
  queueResponse(markdown, source, responseId);
  startWorker();
};

try {
  main();
} catch {
  // Agent hooks must never block the coding session.
}
