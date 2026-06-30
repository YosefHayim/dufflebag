/**
 * Tests for the config layer: validation/clamping of user input, the round-trip
 * between a BagConfig and the `skillsBag*` string map, and reading effective
 * values back (with defaults filling gaps). The clamping rule matters because a
 * typo must never be able to disable the guardrail.
 */

import { describe, expect, it } from "vitest";

import { DEFAULTS, fromEnvMap, toEnvMap, validateConfig } from "../src/core/env-config.js";

describe("validateConfig", () => {
  it("passes through valid values", () => {
    expect(validateConfig({ contextWarnFraction: 0.15, autorunDefaultCycleCount: 5 })).toEqual({
      contextWarnFraction: 0.15,
      autorunDefaultCycleCount: 5,
    });
  });

  it("clamps out-of-range numbers into the safe band", () => {
    expect(validateConfig({ contextWarnFraction: 5 }).contextWarnFraction).toBe(0.95);
    expect(validateConfig({ autorunDefaultCycleCount: 0 }).autorunDefaultCycleCount).toBe(1);
  });

  it("throws when warn >= block (the guard would never warn before blocking)", () => {
    expect(() => validateConfig({ contextWarnFraction: 0.3, contextBlockFraction: 0.2 })).toThrow(/below contextBlockFraction/);
  });

  it("throws on a non-numeric numeric field", () => {
    expect(() => validateConfig({ autorunMaxCycleCount: Number("nope") })).toThrow(/expected a number/);
  });

  it("keeps the speech voice as a free string", () => {
    expect(validateConfig({ speechVoice: "Ava" })).toEqual({ speechVoice: "Ava" });
  });
});

describe("env round-trip", () => {
  it("toEnvMap emits only provided keys, stringified", () => {
    expect(toEnvMap({ contextWarnFraction: 0.15, speechVoice: "Ava" })).toEqual({
      skillsBagContextWarnFraction: "0.15",
      skillsBagSpeechVoice: "Ava",
    });
  });

  it("fromEnvMap parses values and falls back to defaults for missing keys", () => {
    const cfg = fromEnvMap({ skillsBagContextWarnFraction: "0.12" });
    expect(cfg.contextWarnFraction).toBe(0.12);
    expect(cfg.contextBlockFraction).toBe(DEFAULTS.contextBlockFraction);
    expect(cfg.speechVoice).toBe(DEFAULTS.speechVoice);
  });

  it("fromEnvMap ignores garbage and uses the default", () => {
    expect(fromEnvMap({ skillsBagAutorunMaxCycleCount: "abc" }).autorunMaxCycleCount).toBe(DEFAULTS.autorunMaxCycleCount);
  });
});

describe("dedup config", () => {
  it("accepts the three valid modes and rejects anything else", () => {
    expect(validateConfig({ dedupEnforcement: "warn" })).toEqual({ dedupEnforcement: "warn" });
    expect(validateConfig({ dedupEnforcement: "OFF" })).toEqual({ dedupEnforcement: "off" });
    expect(() => validateConfig({ dedupEnforcement: "loud" })).toThrow(/Invalid dedup mode/);
  });

  it("keeps the skip list as a free string", () => {
    expect(validateConfig({ dedupSkipDirectories: "templates, fixtures" })).toEqual({
      dedupSkipDirectories: "templates, fixtures",
    });
  });

  it("round-trips mode + skip through the env map", () => {
    expect(toEnvMap({ dedupEnforcement: "deny", dedupSkipDirectories: "templates" })).toEqual({
      skillsBagDedupEnforcement: "deny",
      skillsBagDedupSkipDirectories: "templates",
    });
  });

  it("omits an empty skip list rather than writing a noise key", () => {
    expect(toEnvMap({ dedupSkipDirectories: "" })).toEqual({});
  });

  it("defaults dedup mode to deny and skip to empty when unset", () => {
    const cfg = fromEnvMap({});
    expect(cfg.dedupEnforcement).toBe("deny");
    expect(cfg.dedupSkipDirectories).toBe("");
  });

  it("coerces an unknown env mode back to the safe deny default", () => {
    expect(fromEnvMap({ skillsBagDedupEnforcement: "bogus" }).dedupEnforcement).toBe("deny");
  });
});
