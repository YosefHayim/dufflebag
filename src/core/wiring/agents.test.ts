/**
 * Tests for agent classification — verifies that dufflebag correctly maps probe
 * signals to the detected agent list, with all agents marked as supported
 * install targets.
 */

import { describe, expect, it } from "vitest";

import { classifyAgents } from "./agents.js";

const allTrue = {
  claudeCode: true,
  cursor: true,
  codex: true,
  kimiCode: true,
  kiro: true,
  windsurf: true,
  cline: true,
  gemini: true,
  aider: true,
  continue: true,
  cody: true,
  junie: true,
};

const allFalse = {
  claudeCode: false,
  cursor: false,
  codex: false,
  kimiCode: false,
  kiro: false,
  windsurf: false,
  cline: false,
  gemini: false,
  aider: false,
  continue: false,
  cody: false,
  junie: false,
};

describe("classifyAgents", () => {
  it("marks all agents as supported install targets", () => {
    const agents = classifyAgents(allTrue);
    expect(agents.every((a) => a.supported)).toBe(true);
  });

  it("reflects the probe's installed flags verbatim", () => {
    const agents = classifyAgents({ ...allFalse, claudeCode: true, codex: true, kiro: true });
    expect(agents.find((a) => a.id === "claude-code")?.installed).toBe(true);
    expect(agents.find((a) => a.id === "cursor")?.installed).toBe(false);
    expect(agents.find((a) => a.id === "codex")?.installed).toBe(true);
    expect(agents.find((a) => a.id === "kimi-code")?.installed).toBe(false);
    expect(agents.find((a) => a.id === "kiro")?.installed).toBe(true);
    expect(agents.find((a) => a.id === "windsurf")?.installed).toBe(false);
    expect(agents.find((a) => a.id === "cline")?.installed).toBe(false);
    expect(agents.find((a) => a.id === "gemini")?.installed).toBe(false);
    expect(agents.find((a) => a.id === "aider")?.installed).toBe(false);
    expect(agents.find((a) => a.id === "continue")?.installed).toBe(false);
    expect(agents.find((a) => a.id === "cody")?.installed).toBe(false);
    expect(agents.find((a) => a.id === "junie")?.installed).toBe(false);
  });

  it("always returns the agents in a stable order", () => {
    const agents = classifyAgents(allFalse);
    expect(agents.map((a) => a.id)).toEqual([
      "claude-code",
      "kiro",
      "kimi-code",
      "cursor",
      "windsurf",
      "cline",
      "codex",
      "gemini",
      "aider",
      "continue",
      "cody",
      "junie",
    ]);
  });
});
