import { describe, expect, it } from "vitest";

import { agentAutoCompactEnvironmentKey, decodeAutoCompactDuration } from "./autoCompactDuration.js";

describe("idle auto-compact duration", () => {
  it.each([
    ["10s", 10],
    ["30s", 30],
    ["2m", 120],
    ["1h", 3_600],
    ["1d", 86_400],
  ])("decodes %s", (input, seconds) => {
    expect(decodeAutoCompactDuration(input)).toEqual({ _tag: "enabled", seconds });
  });

  it("decodes off without a timer", () => {
    expect(decodeAutoCompactDuration("off")).toEqual({ _tag: "off" });
  });

  it.each(["", "9s", "86401s", "1.5m", "1w", "OFF", " 1m "])("rejects %s", (input) => {
    expect(() => decodeAutoCompactDuration(input)).toThrow();
  });

  it.each([
    ["codex", "DUFFLEBAG_CODEX_AUTO_COMPACT"],
    ["claude-code", "DUFFLEBAG_CLAUDE_CODE_AUTO_COMPACT"],
    ["kimi-code", "DUFFLEBAG_KIMI_CODE_AUTO_COMPACT"],
  ])("derives the environment key for %s", (agentId, expected) => {
    expect(agentAutoCompactEnvironmentKey(agentId)).toBe(expected);
  });
});
