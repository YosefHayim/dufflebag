/**
 * Tests for agent classification — the rule that dufflebag reports every probed
 * agent but only ever marks Claude Code as a wireable install target (Cursor and
 * Codex are detected-but-unsupported until issue #5 ships an adapter).
 */

import { describe, expect, it } from "vitest";

import { classifyAgents } from "./agents.js";

describe("classifyAgents", () => {
  it("marks Claude Code as the only supported install target", () => {
    const agents = classifyAgents({ claudeCode: true, cursor: true, codex: true });
    expect(agents.filter((a) => a.supported).map((a) => a.id)).toEqual(["claude-code"]);
  });

  it("reflects the probe's installed flags verbatim", () => {
    const agents = classifyAgents({ claudeCode: true, cursor: false, codex: true });
    expect(agents.find((a) => a.id === "claude-code")?.installed).toBe(true);
    expect(agents.find((a) => a.id === "cursor")?.installed).toBe(false);
    expect(agents.find((a) => a.id === "codex")?.installed).toBe(true);
  });

  it("always returns the three agents in a stable order", () => {
    const agents = classifyAgents({ claudeCode: false, cursor: false, codex: false });
    expect(agents.map((a) => a.id)).toEqual(["claude-code", "cursor", "codex"]);
  });
});
