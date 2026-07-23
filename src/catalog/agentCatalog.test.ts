import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  agentCatalog,
  agentCatalogSchema,
  agentDefinitionSchema,
  agentEvidenceSchema,
  agentTargetSchema,
  classifyAgents,
  findAgent,
} from "./agentCatalog.js";

const expectedAgents = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    detection: { homePaths: [".claude"], absolutePaths: [], commands: ["claude"] },
    target: { _tag: "skillDirectory", path: ".claude/skills" },
    nativeHooks: { _tag: "claudeJson", configPath: ".claude/settings.json", compactCommand: "/compact" },
  },
  {
    id: "kiro",
    displayName: "Kiro",
    detection: { homePaths: [".kiro"], absolutePaths: [], commands: ["kiro"] },
    target: { _tag: "skillDirectory", path: ".kiro/skills" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "kimi-code",
    displayName: "Kimi Code CLI",
    detection: { homePaths: [".kimi-code"], absolutePaths: [], commands: ["kimi"] },
    target: { _tag: "skillDirectory", path: ".kimi-code/skills" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "devin",
    displayName: "Devin CLI",
    detection: { homePaths: [".devin", ".config/devin"], absolutePaths: [], commands: ["devin"] },
    target: { _tag: "skillDirectory", path: ".devin/skills" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "cursor",
    displayName: "Cursor",
    detection: { homePaths: [".cursor"], absolutePaths: ["/Applications/Cursor.app"], commands: ["cursor"] },
    target: { _tag: "ruleFile", directory: ".cursor/rules", extension: ".mdc" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    detection: { homePaths: [".windsurf"], absolutePaths: ["/Applications/Windsurf.app"], commands: ["windsurf"] },
    target: { _tag: "instructionFile", path: ".windsurfrules" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "cline",
    displayName: "Cline",
    detection: { homePaths: [".cline"], absolutePaths: [], commands: ["cline"] },
    target: { _tag: "instructionFile", path: ".clinerules" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "codex",
    displayName: "Codex",
    detection: { homePaths: [".codex"], absolutePaths: [], commands: ["codex"] },
    target: { _tag: "skillDirectory", path: ".agents/skills" },
    nativeHooks: { _tag: "codexJson", configPath: ".codex/hooks.json", compactCommand: "/compact" },
  },
  {
    id: "grok",
    displayName: "Grok",
    detection: { homePaths: [".grok"], absolutePaths: [], commands: ["grok"] },
    target: { _tag: "skillDirectory", path: ".grok/skills" },
    nativeHooks: { _tag: "grokJson", configPath: ".grok/hooks/dufflebag.json", compactCommand: "/compact" },
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    detection: { homePaths: [], absolutePaths: [], commands: ["gemini"] },
    target: { _tag: "instructionFile", path: "GEMINI.md" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "aider",
    displayName: "Aider",
    detection: { homePaths: [], absolutePaths: [], commands: ["aider"] },
    target: {
      _tag: "configReference",
      instructionPath: "AGENTS.md",
      configPath: ".aider.conf.yml",
      referenceFormat: "yamlReadArray",
    },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "continue",
    displayName: "Continue",
    detection: { homePaths: [".continue"], absolutePaths: [], commands: [] },
    target: {
      _tag: "configReference",
      instructionPath: "AGENTS.md",
      configPath: ".continue/config.json",
      referenceFormat: "jsonRulesArray",
    },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "cody",
    displayName: "Cody",
    detection: { homePaths: [".cody"], absolutePaths: [], commands: [] },
    target: { _tag: "instructionFile", path: ".cody/instructions.md" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "junie",
    displayName: "Junie",
    detection: { homePaths: [".junie"], absolutePaths: [], commands: [] },
    target: { _tag: "instructionFile", path: ".junie/guidelines.md" },
    nativeHooks: { _tag: "unsupported" },
  },
];

const validAgentFixture = {
  id: "example-agent",
  displayName: "Example Agent",
  detection: { homePaths: [".example"], absolutePaths: ["/Applications/Example.app"], commands: ["example"] },
  target: { _tag: "instructionFile", path: "EXAMPLE.md" },
  nativeHooks: { _tag: "unsupported" },
};

const decodeCatalog = (input: unknown) =>
  Schema.decodeUnknownEither(agentCatalogSchema, {
    onExcessProperty: "error",
  })(input);

const decodeDefinition = (input: unknown) =>
  Schema.decodeUnknownEither(agentDefinitionSchema, {
    onExcessProperty: "error",
  })(input);

const decodeTarget = (input: unknown) =>
  Schema.decodeUnknownEither(agentTargetSchema, {
    onExcessProperty: "error",
  })(input);

const decodeEvidence = (input: unknown) =>
  Schema.decodeUnknownEither(agentEvidenceSchema, {
    onExcessProperty: "error",
  })(input);

describe("agentCatalog", () => {
  it("decodes the exact approved agents in stable display order", () => {
    expect(agentCatalog).toEqual(expectedAgents);
    expect(agentCatalog).toHaveLength(14);
  });

  it("uses every target format and keeps IDs unique", () => {
    expect(new Set(agentCatalog.map((agent) => agent.id)).size).toBe(agentCatalog.length);
    expect({
      skillDirectory: agentCatalog.filter((agent) => agent.target._tag === "skillDirectory").length,
      ruleFile: agentCatalog.filter((agent) => agent.target._tag === "ruleFile").length,
      instructionFile: agentCatalog.filter((agent) => agent.target._tag === "instructionFile").length,
      configReference: agentCatalog.filter((agent) => agent.target._tag === "configReference").length,
    }).toEqual({ skillDirectory: 6, ruleFile: 1, instructionFile: 5, configReference: 2 });
  });

  it("keeps human-facing display names in the catalog", () => {
    expect(agentCatalog.map((agent) => agent.displayName)).toEqual([
      "Claude Code",
      "Kiro",
      "Kimi Code CLI",
      "Devin CLI",
      "Cursor",
      "Windsurf",
      "Cline",
      "Codex",
      "Grok",
      "Gemini CLI",
      "Aider",
      "Continue",
      "Cody",
      "Junie",
    ]);
  });

  it("finds agents with Option and represents absence", () => {
    expect(Option.map(findAgent("kimi-code"), (agent) => agent.displayName)).toEqual(Option.some("Kimi Code CLI"));
    expect(findAgent("missing-agent")).toEqual(Option.none());
  });

  it("declares verified native hook adapters without inferring support from detection", () => {
    expect(Option.map(findAgent("claude-code"), (agent) => agent.nativeHooks)).toEqual(
      Option.some({ _tag: "claudeJson", configPath: ".claude/settings.json", compactCommand: "/compact" }),
    );
    expect(Option.map(findAgent("codex"), (agent) => agent.nativeHooks)).toEqual(
      Option.some({ _tag: "codexJson", configPath: ".codex/hooks.json", compactCommand: "/compact" }),
    );
    expect(Option.map(findAgent("grok"), (agent) => agent.nativeHooks)).toEqual(
      Option.some({ _tag: "grokJson", configPath: ".grok/hooks/dufflebag.json", compactCommand: "/compact" }),
    );
    expect(Option.map(findAgent("kimi-code"), (agent) => agent.nativeHooks)).toEqual(Option.some({ _tag: "unsupported" }));
  });

  it("stores Aider and Continue behavior in referenceFormat data", () => {
    expect(Option.map(findAgent("aider"), (agent) => agent.target)).toEqual(
      Option.some({
        _tag: "configReference",
        instructionPath: "AGENTS.md",
        configPath: ".aider.conf.yml",
        referenceFormat: "yamlReadArray",
      }),
    );
    expect(Option.map(findAgent("continue"), (agent) => agent.target)).toEqual(
      Option.some({
        _tag: "configReference",
        instructionPath: "AGENTS.md",
        configPath: ".continue/config.json",
        referenceFormat: "jsonRulesArray",
      }),
    );
  });
});

describe("agentCatalogSchema", () => {
  it("accepts a complete definition and rejects duplicate IDs", () => {
    expect(Either.isRight(decodeDefinition(validAgentFixture))).toBe(true);

    const result = decodeCatalog([validAgentFixture, { ...validAgentFixture, displayName: "Duplicate Agent" }]);

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("Agent IDs must be unique");
  });

  it.each([
    {
      name: "agent definitions",
      input: { ...validAgentFixture, unexpected: true },
      decode: decodeDefinition,
    },
    {
      name: "agent detection",
      input: { ...validAgentFixture, detection: { ...validAgentFixture.detection, unexpected: true } },
      decode: decodeDefinition,
    },
    {
      name: "skill-directory targets",
      input: { _tag: "skillDirectory", path: ".example/skills", unexpected: true },
      decode: decodeTarget,
    },
    {
      name: "rule-file targets",
      input: { _tag: "ruleFile", directory: ".example/rules", extension: ".mdc", unexpected: true },
      decode: decodeTarget,
    },
    {
      name: "instruction-file targets",
      input: { _tag: "instructionFile", path: "EXAMPLE.md", unexpected: true },
      decode: decodeTarget,
    },
    {
      name: "config-reference targets",
      input: {
        _tag: "configReference",
        instructionPath: "EXAMPLE.md",
        configPath: ".example/config.json",
        referenceFormat: "jsonRulesArray",
        unexpected: true,
      },
      decode: decodeTarget,
    },
  ])("rejects excess properties in $name", ({ input, decode }) => {
    const result = decode(input);

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("is unexpected");
  });

  it("requires all three explicit detection arrays", () => {
    expect(Either.isLeft(decodeEvidence({ homePaths: [], absolutePaths: [] }))).toBe(true);
    expect(Either.isLeft(decodeEvidence({ homePaths: [], commands: [] }))).toBe(true);
    expect(Either.isLeft(decodeEvidence({ absolutePaths: [], commands: [] }))).toBe(true);
  });
});

describe("classifyAgents", () => {
  it("uses OR semantics across every evidence kind and preserves catalog order", () => {
    const classified = classifyAgents({
      homePaths: [".continue", ".claude"],
      absolutePaths: ["/Applications/Windsurf.app"],
      commands: ["gemini", "cursor", "grok"],
    });

    expect(classified.filter((agent) => agent.installed).map((agent) => agent.id)).toEqual([
      "claude-code",
      "cursor",
      "windsurf",
      "grok",
      "gemini",
      "continue",
    ]);
    expect(classified.map((agent) => agent.id)).toEqual(agentCatalog.map((agent) => agent.id));
  });

  it("returns every agent as not installed for empty evidence", () => {
    const classified = classifyAgents({ homePaths: [], absolutePaths: [], commands: [] });

    expect(classified).toHaveLength(14);
    expect(classified.every((agent) => !agent.installed)).toBe(true);
  });

  it("derives display names from the catalog without a redundant supported flag", () => {
    const classified = classifyAgents({ homePaths: [], absolutePaths: [], commands: ["aider"] });

    expect(classified.map((agent) => agent.displayName)).toEqual(agentCatalog.map((agent) => agent.displayName));
    expect(classified.find((agent) => agent.id === "aider")).toEqual({
      id: "aider",
      displayName: "Aider",
      installed: true,
    });
    expect(classified.every((agent) => !("supported" in agent))).toBe(true);
  });
});
