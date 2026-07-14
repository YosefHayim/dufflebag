import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { agentCatalog, agentCatalogSchema, agentDefinitionSchema, classifyAgents, findAgent } from "./agentCatalog.js";

const expectedAgents = [
  ["claude-code", "Claude Code"],
  ["kiro", "Kiro"],
  ["kimi-code", "Kimi Code CLI"],
  ["devin", "Devin CLI"],
  ["cursor", "Cursor"],
  ["windsurf", "Windsurf"],
  ["cline", "Cline"],
  ["codex", "Codex"],
  ["gemini", "Gemini CLI"],
  ["aider", "Aider"],
  ["continue", "Continue"],
  ["cody", "Cody"],
  ["junie", "Junie"],
];

const expectedDetection = [
  ["claude-code", [".claude"], [], ["claude"]],
  ["kiro", [".kiro"], [], ["kiro"]],
  ["kimi-code", [".kimi-code"], [], ["kimi"]],
  ["devin", [".devin", ".config/devin"], [], ["devin"]],
  ["cursor", [".cursor"], ["/Applications/Cursor.app"], ["cursor"]],
  ["windsurf", [".windsurf"], ["/Applications/Windsurf.app"], ["windsurf"]],
  ["cline", [".cline"], [], ["cline"]],
  ["codex", [".codex"], [], ["codex"]],
  ["gemini", [], [], ["gemini"]],
  ["aider", [], [], ["aider"]],
  ["continue", [".continue"], [], []],
  ["cody", [".cody"], [], []],
  ["junie", [".junie"], [], []],
];

const expectedTargets = [
  ["claude-code", { _tag: "skillDirectory", directory: ".claude/skills" }],
  ["kiro", { _tag: "skillDirectory", directory: ".kiro/skills" }],
  ["kimi-code", { _tag: "skillDirectory", directory: ".kimi-code/skills" }],
  ["devin", { _tag: "skillDirectory", directory: ".devin/skills" }],
  ["cursor", { _tag: "ruleFile", directory: ".cursor/rules", extension: ".mdc" }],
  ["windsurf", { _tag: "instructionFile", path: ".windsurfrules" }],
  ["cline", { _tag: "instructionFile", path: ".clinerules" }],
  ["codex", { _tag: "instructionFile", path: "AGENTS.md" }],
  ["gemini", { _tag: "instructionFile", path: "GEMINI.md" }],
  [
    "aider",
    {
      _tag: "configReference",
      instructionPath: "AGENTS.md",
      configPath: ".aider.conf.yml",
      referenceFormat: {
        _tag: "yamlSequenceKey",
        key: "read",
      },
    },
  ],
  [
    "continue",
    {
      _tag: "configReference",
      instructionPath: "AGENTS.md",
      configPath: ".continue/config.json",
      referenceFormat: {
        _tag: "jsonArrayPointer",
        pointer: "/rules",
      },
    },
  ],
  ["cody", { _tag: "instructionFile", path: ".cody/instructions.md" }],
  ["junie", { _tag: "instructionFile", path: ".junie/guidelines.md" }],
];

const decodeDefinition = Schema.decodeUnknownSync(agentDefinitionSchema, {
  onExcessProperty: "error",
});

const decodeCatalog = Schema.decodeUnknownSync(agentCatalogSchema, {
  onExcessProperty: "error",
});

const claudeDefinition = {
  id: "claude-code",
  displayName: "Claude Code",
  detection: {
    homePaths: [".claude"],
    absolutePaths: [],
    commands: ["claude"],
  },
  target: {
    _tag: "skillDirectory",
    directory: ".claude/skills",
  },
};

describe("agentCatalog", () => {
  it("decodes all 13 agents in the approved human-facing display order", () => {
    expect(agentCatalog.map((agent) => [agent.id, agent.displayName])).toEqual(expectedAgents);
    expect(agentCatalog.every((agent) => /^[A-Z]/.test(agent.displayName))).toBe(true);
  });

  it("keeps every agent ID unique", () => {
    const agentIds = agentCatalog.map((agent) => agent.id);

    expect(new Set(agentIds).size).toBe(agentIds.length);
  });

  it("preserves all three explicit detection channels for every agent", () => {
    expect(
      agentCatalog.map((agent) => [agent.id, agent.detection.homePaths, agent.detection.absolutePaths, agent.detection.commands]),
    ).toEqual(expectedDetection);
  });

  it("preserves exactly one tagged output target per agent", () => {
    expect(agentCatalog.map((agent) => [agent.id, agent.target])).toEqual(expectedTargets);
    expect(new Set(agentCatalog.map((agent) => agent.target._tag))).toEqual(
      new Set(["skillDirectory", "ruleFile", "instructionFile", "configReference"]),
    );
  });

  it("models Aider YAML and Continue JSON references without branching on agent IDs", () => {
    expect(Option.getOrThrow(findAgent("aider")).target).toEqual({
      _tag: "configReference",
      instructionPath: "AGENTS.md",
      configPath: ".aider.conf.yml",
      referenceFormat: {
        _tag: "yamlSequenceKey",
        key: "read",
      },
    });
    expect(Option.getOrThrow(findAgent("continue")).target).toEqual({
      _tag: "configReference",
      instructionPath: "AGENTS.md",
      configPath: ".continue/config.json",
      referenceFormat: {
        _tag: "jsonArrayPointer",
        pointer: "/rules",
      },
    });
  });

  it("keeps shared AGENTS.md ownership visible as catalog data", () => {
    expect(Option.getOrThrow(findAgent("codex")).target).toEqual({
      _tag: "instructionFile",
      path: "AGENTS.md",
    });
    expect(
      ["aider", "continue"].map((agentId) => {
        const target = Option.getOrThrow(findAgent(agentId)).target;
        return target._tag === "configReference" ? target.instructionPath : undefined;
      }),
    ).toEqual(["AGENTS.md", "AGENTS.md"]);
  });

  it("finds meaningful absence through Option", () => {
    expect(Option.getOrUndefined(findAgent("kimi-code"))?.displayName).toBe("Kimi Code CLI");
    expect(Option.isNone(findAgent("missing-agent"))).toBe(true);
  });

  it("classifies OR evidence once and preserves catalog order", () => {
    expect(
      classifyAgents({
        homePaths: [".devin", ".cursor", ".cody"],
        absolutePaths: ["/Applications/Cursor.app"],
        commands: ["devin", "gemini"],
      }).map((agent) => agent.id),
    ).toEqual(["devin", "cursor", "gemini", "cody"]);
  });

  it("classifies no agents from empty or unrelated evidence", () => {
    expect(
      classifyAgents({
        homePaths: [],
        absolutePaths: [],
        commands: [],
      }),
    ).toEqual([]);
    expect(
      classifyAgents({
        homePaths: [".unknown"],
        absolutePaths: ["/Applications/Unknown.app"],
        commands: ["unknown"],
      }),
    ).toEqual([]);
  });

  it("rejects missing detection channels and agents without any marker", () => {
    expect(() => {
      decodeDefinition({
        ...claudeDefinition,
        detection: {
          homePaths: [".claude"],
          commands: ["claude"],
        },
      });
    }).toThrow();
    expect(() => {
      decodeDefinition({
        ...claudeDefinition,
        detection: {
          homePaths: [],
          absolutePaths: [],
          commands: [],
        },
      });
    }).toThrow("Agent detection must declare at least one marker.");
  });

  it("rejects malformed and duplicate agent IDs", () => {
    expect(() => {
      decodeDefinition({
        ...claudeDefinition,
        id: "ClaudeCode",
      });
    }).toThrow("Agent IDs must use kebab-case.");
    expect(() => {
      decodeCatalog([claudeDefinition, claudeDefinition]);
    }).toThrow("Agent IDs must be unique.");
  });

  it("rejects excess properties at every nested object boundary", () => {
    expect(() => {
      decodeDefinition({
        ...claudeDefinition,
        extra: true,
      });
    }).toThrow();
    expect(() => {
      decodeDefinition({
        ...claudeDefinition,
        detection: {
          ...claudeDefinition.detection,
          extra: true,
        },
      });
    }).toThrow();

    const targetsWithExcess = [
      {
        _tag: "skillDirectory",
        directory: ".claude/skills",
        extra: true,
      },
      {
        _tag: "ruleFile",
        directory: ".cursor/rules",
        extension: ".mdc",
        extra: true,
      },
      {
        _tag: "instructionFile",
        path: "AGENTS.md",
        extra: true,
      },
      {
        _tag: "configReference",
        instructionPath: "AGENTS.md",
        configPath: ".aider.conf.yml",
        referenceFormat: {
          _tag: "yamlSequenceKey",
          key: "read",
        },
        extra: true,
      },
    ];

    targetsWithExcess.forEach((target) => {
      expect(() => {
        decodeDefinition({
          ...claudeDefinition,
          target,
        });
      }).toThrow();
    });
    expect(() => {
      decodeDefinition({
        ...claudeDefinition,
        target: {
          _tag: "configReference",
          instructionPath: "AGENTS.md",
          configPath: ".aider.conf.yml",
          referenceFormat: {
            _tag: "yamlSequenceKey",
            key: "read",
            extra: true,
          },
        },
      });
    }).toThrow();
    expect(() => {
      decodeDefinition({
        ...claudeDefinition,
        target: {
          _tag: "configReference",
          instructionPath: "AGENTS.md",
          configPath: ".continue/config.json",
          referenceFormat: {
            _tag: "jsonArrayPointer",
            pointer: "/rules",
            extra: true,
          },
        },
      });
    }).toThrow();
  });
});
