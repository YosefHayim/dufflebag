#!/usr/bin/env node
/**
 * speak-response — minimal TTS for Claude Code (macOS). A `Stop` hook: when a
 * turn finishes, it reads the transcript and speaks only the assistant's prose
 * (code blocks and tool calls stripped) via the built-in `say` command. TS port
 * of the original bash hook; voice and rate come from `SKILLS_BAG_*` env.
 *
 * Fail-open and non-blocking: any error exits 0, and speech is detached so the
 * hook returns instantly. macOS-only — no-ops on other platforms.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { readConfig } from "./lib/config.js";

interface Block {
  type?: string;
  text?: string;
}
interface Entry {
  type?: string;
  message?: { content?: string | Block[] };
}

/** A "genuine" user turn: a real prompt, not a tool_result envelope. */
function isGenuineUser(entry: Entry): boolean {
  if (entry.type !== "user") return false;
  const content = entry.message?.content;
  if (typeof content === "string") return true;
  return Array.isArray(content) && content.every((b) => b.type !== "tool_result");
}

/** Collect assistant text emitted after the last genuine user prompt. */
function proseSinceLastPrompt(entries: Entry[]): string {
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isGenuineUser(entries[i]!)) {
      start = i + 1;
      break;
    }
  }
  const out: string[] = [];
  for (const entry of entries.slice(start)) {
    if (entry.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
    for (const block of entry.message.content) {
      if (block.type === "text" && block.text) out.push(block.text);
    }
  }
  return out.join("\n");
}

/** Strip markdown/code so we speak conversation, not syntax. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "") // fenced code blocks
    .replace(/`([^`]*)`/g, "$1") // inline code → word
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → text
    .replace(/^\s{0,3}#{1,6}\s*/gm, "") // headings
    .replace(/^\s*[-*+]\s+/gm, " ") // bullets
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/[*_~]/g, "") // bold/italic/strike
    .replace(/\s+/g, " ")
    .trim();
}

function main(): void {
  if (process.platform !== "darwin") return; // `say` is macOS-only

  let transcript = "";
  try {
    transcript = (JSON.parse(readFileSync(0, "utf8")) as { transcript_path?: string }).transcript_path ?? "";
  } catch {
    return;
  }
  if (!transcript) return;

  let entries: Entry[];
  try {
    entries = readFileSync(transcript, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Entry);
  } catch {
    return;
  }

  const clean = stripMarkdown(proseSinceLastPrompt(entries));
  if (!clean) return;

  const { ttsVoice, ttsRate } = readConfig();
  // Kill any in-progress speech so turns don't pile up, then detach.
  spawn("pkill", ["-x", "say"], { stdio: "ignore" }).on("error", () => {});
  const args = ["-v", ttsVoice, ...(ttsRate ? ["-r", String(ttsRate)] : []), clean];
  spawn("/usr/bin/say", args, { detached: true, stdio: "ignore" }).unref();
}

try {
  main();
} catch {
  /* fail-open */
} finally {
  process.exit(0);
}
