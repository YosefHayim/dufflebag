/**
 * Tests for agent classification — the rule that dufflebag reports every probed
 * agent but only ever marks Claude Code as a wireable install target (Cursor and
 * Codex are detected-but-unsupported until issue #5 ships an adapter).
 */

import { describe, expect, it } from "vitest";

import { classifyAgents } from "./agents.js";

describe("classifyAgents", () => {
  it("marks Claude Code, Kimi, and Kiro as supported install targets", () => {
    const agents = classifyAgents({ claudeCode: true, cursor: true, codex: true, kimiCode: true, kiro: true });
    expect(agents.filter((a) => a.supported).map((a) => a.id)).toEqual(["claude-code", "kimi-code", "kiro"]);
  });

  it("reflects the probe's installed flags verbatim", () => {
    const agents = classifyAgents({ claudeCode: true, cursor: false, codex: true, kimiCode: false, kiro: true });
    expect(agents.find((a) => a.id === "claude-code")?.installed).toBe(true);
    expect(agents.find((a) => a.id === "cursor")?.installed).toBe(false);
    expect(agents.find((a) => a.id === "codex")?.installed).toBe(true);
    expect(agents.find((a) => a.id === "kimi-code")?.installed).toBe(false);
    expect(agents.find((a) => a.id === "kiro")?.installed).toBe(true);
  });

  it("always returns the agents in a stable order", () => {
    const agents = classifyAgents({ claudeCode: false, cursor: false, codex: false, kimiCode: false, kiro: false });
    expect(agents.map((a) => a.id)).toEqual(["claude-code", "cursor", "codex", "kimi-code", "kiro"]);
  });
});
