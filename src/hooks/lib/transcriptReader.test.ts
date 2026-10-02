import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decodeTranscriptLine, readTranscriptLines, readTranscriptTail } from "./transcriptReader.js";

describe("decodeTranscriptLine", () => {
  it("reads a Claude Code entry's turn state and token usage from its message", () => {
    const entry = decodeTranscriptLine(
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-7",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "done" }],
          usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 2, output_tokens: 7 },
        },
      }),
    );
    expect(entry).toEqual({
      isSidechain: false,
      type: "assistant",
      role: "",
      model: "claude-opus-4-7",
      usage: { inputTokens: 10, cacheCreationInputTokens: 5, cacheReadInputTokens: 2, outputTokens: 7 },
      content: [{ type: "text", text: "done" }],
      stopReason: "end_turn",
    });
  });

  it("reads a role-only entry whose content sits on the entry itself", () => {
    const entry = decodeTranscriptLine(JSON.stringify({ role: "user", content: "hello", isSidechain: true }));
    expect(entry).toMatchObject({ type: "", role: "user", content: "hello", isSidechain: true, usage: undefined });
  });

  it("skips blank and malformed lines", () => {
    expect(decodeTranscriptLine("   ")).toBeUndefined();
    expect(decodeTranscriptLine("{not json")).toBeUndefined();
    expect(decodeTranscriptLine("[1, 2]")).toBeUndefined();
  });
});

describe("reading transcript files", () => {
  let folder: string;
  let transcript: string;
  beforeAll(() => {
    folder = mkdtempSync(path.join(tmpdir(), "dufflebag-transcript-"));
    transcript = path.join(folder, "session.jsonl");
    const filler = Array.from({ length: 4_000 }, (_, index) =>
      JSON.stringify({ type: "user", filler: "x".repeat(80), index }),
    );
    writeFileSync(transcript, `${[...filler, JSON.stringify({ type: "assistant", marker: "newest" })].join("\n")}\n`);
  });
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it("reads every line of a transcript", () => {
    expect(readTranscriptLines(transcript)).toHaveLength(4_002);
  });

  it("reads only the tail of a long transcript, newest line included", () => {
    const tail = readTranscriptTail(transcript);
    expect(tail.length).toBeLessThan(4_002);
    expect(tail.at(-2)).toContain('"marker":"newest"');
  });
});
