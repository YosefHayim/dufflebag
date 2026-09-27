import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { decodeStreamLine, emptyStreamState } from "./chatFormats.js";
import type { ProviderManifest } from "./providerContract.js";

const decodeWireChunk = (protocolFamily: ProviderManifest["protocolFamily"], wireChunk: unknown) =>
  decodeStreamLine({ protocolFamily, streamLine: JSON.stringify(wireChunk), streamState: emptyStreamState }).pipe(
    Option.map(([, streamEvents]) => streamEvents),
  );

describe("chat formats", () => {
  it.each([
    { protocolFamily: "openai-chat", wireChunk: { choices: [{ delta: { content: "hi" } }] } },
    { protocolFamily: "anthropic-messages", wireChunk: { type: "content_block_delta", delta: { text: "hi" } } },
    { protocolFamily: "google-generative", wireChunk: { candidates: [{ content: { parts: [{ text: "hi" }] } }] } },
    { protocolFamily: "openai-responses", wireChunk: { type: "response.output_text.delta", delta: "hi" } },
  ] as const)("decodes $protocolFamily text", ({ protocolFamily, wireChunk }) => {
    expect(decodeWireChunk(protocolFamily, wireChunk)).toEqual(Option.some([{ _tag: "text", text: "hi" }]));
  });

  it("ignores OpenAI Responses events it does not map", () => {
    expect(decodeWireChunk("openai-responses", { type: "response.created" })).toEqual(Option.some([]));
  });

  it.each([
    { protocolFamily: "openai-chat", wireChunk: { choices: "malformed" } },
    { protocolFamily: "anthropic-messages", wireChunk: { type: 42 } },
    { protocolFamily: "google-generative", wireChunk: { candidates: [{ content: {} }] } },
  ] as const)("rejects a malformed $protocolFamily chunk", ({ protocolFamily, wireChunk }) => {
    expect(Option.isNone(decodeWireChunk(protocolFamily, wireChunk))).toBe(true);
  });
});
