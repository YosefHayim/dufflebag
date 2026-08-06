import { describe, expect, it } from "vitest";

import {
  isTtsNarrationEnabled,
  nextVoiceFeatures,
  normalizeDictationLanguage,
  normalizeVoiceId,
} from "./voiceCommand.js";

describe("nextVoiceFeatures", () => {
  it("adds voice once in catalog order without losing existing features", () => {
    expect(nextVoiceFeatures({ current: ["dedup-guard", "context-guard"], enabled: true })).toEqual([
      "context-guard",
      "speak-response",
      "dedup-guard",
    ]);
    expect(nextVoiceFeatures({ current: ["context-guard", "speak-response"], enabled: true })).toEqual([
      "context-guard",
      "speak-response",
    ]);
  });

  it("removes only voice when disabled", () => {
    expect(nextVoiceFeatures({ current: ["context-guard", "speak-response", "dedup-guard"], enabled: false })).toEqual([
      "context-guard",
      "dedup-guard",
    ]);
  });
});

describe("normalizeVoiceId", () => {
  it("keeps Supertonic IDs and migrates legacy macOS voice names to F4", () => {
    expect(normalizeVoiceId("m2")).toBe("M2");
    expect(normalizeVoiceId("Samantha")).toBe("F4");
    expect(normalizeVoiceId("")).toBe("F4");
  });
});

describe("isTtsNarrationEnabled", () => {
  it("treats only off as muted narration", () => {
    expect(isTtsNarrationEnabled("off")).toBe(false);
    expect(isTtsNarrationEnabled("auto")).toBe(true);
    expect(isTtsNarrationEnabled("focused")).toBe(true);
    expect(isTtsNarrationEnabled("immediate")).toBe(true);
  });
});

describe("normalizeDictationLanguage", () => {
  it("accepts english and hebrew aliases including lang=he", () => {
    expect(normalizeDictationLanguage("en")).toBe("en");
    expect(normalizeDictationLanguage("english")).toBe("en");
    expect(normalizeDictationLanguage("he")).toBe("he");
    expect(normalizeDictationLanguage("lang=he")).toBe("he");
    expect(normalizeDictationLanguage("hebrew")).toBe("he");
    expect(normalizeDictationLanguage("ivrit")).toBe("he");
    expect(normalizeDictationLanguage("nope")).toBeNull();
  });
});
