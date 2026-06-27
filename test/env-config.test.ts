/**
 * Tests for the config layer: validation/clamping of user input, the round-trip
 * between a BagConfig and the `SKILLS_BAG_*` string map, and reading effective
 * values back (with defaults filling gaps). The clamping rule matters because a
 * typo must never be able to disable the guardrail.
 */

import { describe, expect, it } from "vitest";

import { DEFAULTS, fromEnvMap, toEnvMap, validateConfig } from "../src/core/env-config.js";

describe("validateConfig", () => {
  it("passes through valid values", () => {
    expect(validateConfig({ warnPct: 0.15, defaultBudget: 5 })).toEqual({ warnPct: 0.15, defaultBudget: 5 });
  });

  it("clamps out-of-range numbers into the safe band", () => {
    expect(validateConfig({ warnPct: 5 }).warnPct).toBe(0.95); // upper bound
    expect(validateConfig({ defaultBudget: 0 }).defaultBudget).toBe(1); // lower bound
  });

  it("throws when warn >= block (the guard would never warn before blocking)", () => {
    expect(() => validateConfig({ warnPct: 0.3, blockPct: 0.2 })).toThrow(/below blockPct/);
  });

  it("throws on a non-numeric numeric field", () => {
    expect(() => validateConfig({ hardCap: Number("nope") })).toThrow(/expected a number/);
  });

  it("keeps the tts voice as a free string", () => {
    expect(validateConfig({ ttsVoice: "Ava" })).toEqual({ ttsVoice: "Ava" });
  });
});

describe("env round-trip", () => {
  it("toEnvMap emits only provided keys, stringified", () => {
    expect(toEnvMap({ warnPct: 0.15, ttsVoice: "Ava" })).toEqual({
      SKILLS_BAG_WARN_PCT: "0.15",
      SKILLS_BAG_TTS_VOICE: "Ava",
    });
  });

  it("fromEnvMap parses values and falls back to defaults for missing keys", () => {
    const cfg = fromEnvMap({ SKILLS_BAG_WARN_PCT: "0.12" });
    expect(cfg.warnPct).toBe(0.12);
    expect(cfg.blockPct).toBe(DEFAULTS.blockPct); // missing → default
    expect(cfg.ttsVoice).toBe(DEFAULTS.ttsVoice);
  });

  it("fromEnvMap ignores garbage and uses the default", () => {
    expect(fromEnvMap({ SKILLS_BAG_HARD_CAP: "abc" }).hardCap).toBe(DEFAULTS.hardCap);
  });
});

describe("dedup config", () => {
  it("accepts the three valid modes and rejects anything else", () => {
    expect(validateConfig({ dedupMode: "warn" })).toEqual({ dedupMode: "warn" });
    expect(validateConfig({ dedupMode: "OFF" })).toEqual({ dedupMode: "off" }); // case-insensitive
    expect(() => validateConfig({ dedupMode: "loud" })).toThrow(/Invalid dedup mode/);
  });

  it("keeps the skip list as a free string", () => {
    expect(validateConfig({ dedupSkip: "templates, fixtures" })).toEqual({ dedupSkip: "templates, fixtures" });
  });

  it("round-trips mode + skip through the env map", () => {
    expect(toEnvMap({ dedupMode: "deny", dedupSkip: "templates" })).toEqual({
      SKILLS_BAG_DEDUP_MODE: "deny",
      SKILLS_BAG_DEDUP_SKIP: "templates",
    });
  });

  it("omits an empty skip list rather than writing a noise key", () => {
    expect(toEnvMap({ dedupSkip: "" })).toEqual({});
  });

  it("defaults dedup mode to deny and skip to empty when unset", () => {
    const cfg = fromEnvMap({});
    expect(cfg.dedupMode).toBe("deny");
    expect(cfg.dedupSkip).toBe("");
  });

  it("coerces an unknown env mode back to the safe deny default", () => {
    expect(fromEnvMap({ SKILLS_BAG_DEDUP_MODE: "bogus" }).dedupMode).toBe("deny");
  });
});
