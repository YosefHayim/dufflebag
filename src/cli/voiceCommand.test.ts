import { describe, expect, it } from "vitest";

import { nextVoiceFeatures, normalizeVoiceId } from "./voiceCommand.js";

describe("nextVoiceFeatures", () => {
  it("adds voice once in catalog order without losing existing features", () => {
    expect(nextVoiceFeatures(["dedup-guard", "context-guard"], true)).toEqual(["context-guard", "speak-response", "dedup-guard"]);
    expect(nextVoiceFeatures(["context-guard", "speak-response"], true)).toEqual(["context-guard", "speak-response"]);
  });

  it("removes only voice when disabled", () => {
    expect(nextVoiceFeatures(["context-guard", "speak-response", "dedup-guard"], false)).toEqual(["context-guard", "dedup-guard"]);
  });
});

describe("normalizeVoiceId", () => {
  it("keeps Supertonic IDs and migrates legacy macOS voice names to F4", () => {
    expect(normalizeVoiceId("m2")).toBe("M2");
    expect(normalizeVoiceId("Samantha")).toBe("F4");
    expect(normalizeVoiceId("")).toBe("F4");
  });
});
