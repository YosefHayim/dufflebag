import { describe, expect, it } from "vitest";

import { claimTerminalScript, decodeClaimResult, terminalInputScript, versionSupportsTerminalInput } from "./ghosttyTerminal.js";

describe("Ghostty terminal control", () => {
  it("claims exactly one temporary terminal title and returns its stable ID", () => {
    const script = claimTerminalScript("dufflebag-session-1");

    expect(script).toContain('whose name is "dufflebag-session-1"');
    expect(script).toContain('if n is 0 then return "NONE"');
    expect(script).toContain('if n > 1 then return "AMBIGUOUS"');
    expect(script).toContain("id of target");
  });

  it("targets one stable ID without referring to focus", () => {
    const script = terminalInputScript("term-2", "/compact", true);

    expect(script).toContain('whose id is "term-2"');
    expect(script).toContain('input text "/compact" to target');
    expect(script).toContain('send key "enter" to target');
    expect(script).not.toContain("focused terminal");
    expect(script).not.toContain("front window");
  });

  it("escapes AppleScript string content", () => {
    expect(terminalInputScript('term"2', 'say "hi"\\there', false)).toContain('whose id is "term\\"2"');
    expect(terminalInputScript('term"2', 'say "hi"\\there', false)).toContain('input text "say \\"hi\\"\\\\there"');
  });

  it.each([
    ["OK\tterm-2", { _tag: "claimed", terminalId: "term-2" }],
    ["NONE", { _tag: "refused", reason: "terminal-not-proven" }],
    ["AMBIGUOUS", { _tag: "refused", reason: "terminal-not-proven" }],
    ["", { _tag: "refused", reason: "ghostty-unavailable" }],
  ])("decodes claim result %s", (output, expected) => {
    expect(decodeClaimResult(output)).toEqual(expected);
  });

  it.each([
    ["1.3.0", true],
    ["1.3.1", true],
    ["2.0.0", true],
    ["1.2.9", false],
    ["dev", false],
  ])("checks Ghostty version %s", (version, supported) => {
    expect(versionSupportsTerminalInput(version)).toBe(supported);
  });
});
