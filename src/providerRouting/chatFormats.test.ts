import { Either } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeAnthropicStreamChunk,
  decodeGoogleStreamChunk,
  decodeOpenAiResponsesStreamChunk,
  decodeOpenAiStreamChunk,
} from "./chatFormats.js";

describe("chat formats", () => {
  it.each([
    {
      family: "OpenAI Chat",
      decodeChunk: decodeOpenAiStreamChunk,
      wireChunk: { choices: [{ delta: { content: "hi" } }] },
    },
    {
      family: "Anthropic",
      decodeChunk: decodeAnthropicStreamChunk,
      wireChunk: { type: "content_block_delta", delta: { text: "hi" } },
    },
    {
      family: "Google",
      decodeChunk: decodeGoogleStreamChunk,
      wireChunk: { candidates: [{ content: { parts: [{ text: "hi" }] } }] },
    },
    {
      family: "OpenAI Responses",
      decodeChunk: decodeOpenAiResponsesStreamChunk,
      wireChunk: { type: "response.output_text.delta", delta: "hi" },
    },
  ])("decodes $family text", ({ decodeChunk, wireChunk }) => {
    expect(Either.getOrThrow(decodeChunk(wireChunk))).toEqual([{ _tag: "text", text: "hi" }]);
  });

  it("ignores OpenAI Responses events it does not map", () => {
    expect(Either.getOrThrow(decodeOpenAiResponsesStreamChunk({ type: "response.created" }))).toEqual([]);
  });

  it.each([
    { family: "OpenAI Chat", decodeChunk: decodeOpenAiStreamChunk, wireChunk: { choices: "malformed" } },
    { family: "Anthropic", decodeChunk: decodeAnthropicStreamChunk, wireChunk: { type: 42 } },
    { family: "Google", decodeChunk: decodeGoogleStreamChunk, wireChunk: { candidates: [{ content: {} }] } },
  ])("rejects a malformed $family chunk", ({ decodeChunk, wireChunk }) => {
    expect(Either.isLeft(decodeChunk(wireChunk))).toBe(true);
  });
});
