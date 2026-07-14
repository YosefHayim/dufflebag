import { Option, Schema, type SchemaAST } from "effect";

const strictParseOptions = {
  onExcessProperty: "error",
} satisfies SchemaAST.ParseOptions;

export const agentIdSchema = Schema.String.pipe(
  Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: () => "Agent IDs must use kebab-case.",
  }),
  Schema.brand("AgentId"),
  Schema.annotations({
    description: "Stable public coding-agent ID.",
  }),
);

export type AgentId = Schema.Schema.Type<typeof agentIdSchema>;

export const agentDetectionSchema = Schema.Struct({
  homePaths: Schema.Array(Schema.String).annotations({
    description: "Paths relative to the user's home directory that identify the agent.",
  }),
  absolutePaths: Schema.Array(Schema.String).annotations({
    description: "Absolute host paths that identify the agent.",
  }),
  commands: Schema.Array(Schema.String).annotations({
    description: "Executable names on PATH that identify the agent.",
  }),
}).pipe(
  Schema.filter((detection) =>
    detection.homePaths.length + detection.absolutePaths.length + detection.commands.length > 0
      ? []
      : [
          {
            path: ["homePaths"],
            message: "Agent detection must declare at least one marker.",
          },
        ],
  ),
  Schema.annotations({
    parseOptions: strictParseOptions,
  }),
);

export type AgentDetection = Schema.Schema.Type<typeof agentDetectionSchema>;

const yamlSequenceKeySchema = Schema.Struct({
  _tag: Schema.Literal("yamlSequenceKey"),
  key: Schema.NonEmptyTrimmedString,
}).annotations({
  parseOptions: strictParseOptions,
});

const jsonArrayPointerSchema = Schema.Struct({
  _tag: Schema.Literal("jsonArrayPointer"),
  pointer: Schema.NonEmptyTrimmedString,
}).annotations({
  parseOptions: strictParseOptions,
});

const referenceFormatSchema = Schema.Union(yamlSequenceKeySchema, jsonArrayPointerSchema).annotations({
  description: "Structural location where an agent config references its instruction file.",
});

const skillDirectoryTargetSchema = Schema.Struct({
  _tag: Schema.Literal("skillDirectory"),
  directory: Schema.NonEmptyTrimmedString,
}).annotations({
  parseOptions: strictParseOptions,
});

const ruleFileTargetSchema = Schema.Struct({
  _tag: Schema.Literal("ruleFile"),
  directory: Schema.NonEmptyTrimmedString,
  extension: Schema.NonEmptyTrimmedString,
}).annotations({
  parseOptions: strictParseOptions,
});

const instructionFileTargetSchema = Schema.Struct({
  _tag: Schema.Literal("instructionFile"),
  path: Schema.NonEmptyTrimmedString,
}).annotations({
  parseOptions: strictParseOptions,
});

const configReferenceTargetSchema = Schema.Struct({
  _tag: Schema.Literal("configReference"),
  instructionPath: Schema.NonEmptyTrimmedString,
  configPath: Schema.NonEmptyTrimmedString,
  referenceFormat: referenceFormatSchema,
}).annotations({
  parseOptions: strictParseOptions,
});

export const agentTargetSchema = Schema.Union(
  skillDirectoryTargetSchema,
  ruleFileTargetSchema,
  instructionFileTargetSchema,
  configReferenceTargetSchema,
).annotations({
  description: "Native output target selected by format instead of agent identity.",
});

export type AgentTarget = Schema.Schema.Type<typeof agentTargetSchema>;

export const agentDefinitionSchema = Schema.Struct({
  id: agentIdSchema,
  displayName: Schema.NonEmptyTrimmedString.annotations({
    description: "Human-facing agent name used by interactive and diagnostic output.",
  }),
  detection: agentDetectionSchema,
  target: agentTargetSchema,
}).annotations({
  parseOptions: strictParseOptions,
});

export type AgentDefinition = Schema.Schema.Type<typeof agentDefinitionSchema>;

const validateAgentCatalog = (catalog: ReadonlyArray<AgentDefinition>) =>
  new Set(catalog.map((agent) => agent.id)).size === catalog.length
    ? true
    : [
        {
          path: ["id"],
          message: "Agent IDs must be unique.",
        },
      ];

export const agentCatalogSchema = Schema.Array(agentDefinitionSchema).pipe(
  Schema.filter(validateAgentCatalog),
  Schema.annotations({
    parseOptions: strictParseOptions,
  }),
);

export const agentCatalog = Schema.decodeUnknownSync(
  agentCatalogSchema,
  strictParseOptions,
)([
  {
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
  },
  {
    id: "kiro",
    displayName: "Kiro",
    detection: {
      homePaths: [".kiro"],
      absolutePaths: [],
      commands: ["kiro"],
    },
    target: {
      _tag: "skillDirectory",
      directory: ".kiro/skills",
    },
  },
  {
    id: "kimi-code",
    displayName: "Kimi Code CLI",
    detection: {
      homePaths: [".kimi-code"],
      absolutePaths: [],
      commands: ["kimi"],
    },
    target: {
      _tag: "skillDirectory",
      directory: ".kimi-code/skills",
    },
  },
  {
    id: "devin",
    displayName: "Devin CLI",
    detection: {
      homePaths: [".devin", ".config/devin"],
      absolutePaths: [],
      commands: ["devin"],
    },
    target: {
      _tag: "skillDirectory",
      directory: ".devin/skills",
    },
  },
  {
    id: "cursor",
    displayName: "Cursor",
    detection: {
      homePaths: [".cursor"],
      absolutePaths: ["/Applications/Cursor.app"],
      commands: ["cursor"],
    },
    target: {
      _tag: "ruleFile",
      directory: ".cursor/rules",
      extension: ".mdc",
    },
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    detection: {
      homePaths: [".windsurf"],
      absolutePaths: ["/Applications/Windsurf.app"],
      commands: ["windsurf"],
    },
    target: {
      _tag: "instructionFile",
      path: ".windsurfrules",
    },
  },
  {
    id: "cline",
    displayName: "Cline",
    detection: {
      homePaths: [".cline"],
      absolutePaths: [],
      commands: ["cline"],
    },
    target: {
      _tag: "instructionFile",
      path: ".clinerules",
    },
  },
  {
    id: "codex",
    displayName: "Codex",
    detection: {
      homePaths: [".codex"],
      absolutePaths: [],
      commands: ["codex"],
    },
    target: {
      _tag: "instructionFile",
      path: "AGENTS.md",
    },
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    detection: {
      homePaths: [],
      absolutePaths: [],
      commands: ["gemini"],
    },
    target: {
      _tag: "instructionFile",
      path: "GEMINI.md",
    },
  },
  {
    id: "aider",
    displayName: "Aider",
    detection: {
      homePaths: [],
      absolutePaths: [],
      commands: ["aider"],
    },
    target: {
      _tag: "configReference",
      instructionPath: "AGENTS.md",
      configPath: ".aider.conf.yml",
      referenceFormat: {
        _tag: "yamlSequenceKey",
        key: "read",
      },
    },
  },
  {
    id: "continue",
    displayName: "Continue",
    detection: {
      homePaths: [".continue"],
      absolutePaths: [],
      commands: [],
    },
    target: {
      _tag: "configReference",
      instructionPath: "AGENTS.md",
      configPath: ".continue/config.json",
      referenceFormat: {
        _tag: "jsonArrayPointer",
        pointer: "/rules",
      },
    },
  },
  {
    id: "cody",
    displayName: "Cody",
    detection: {
      homePaths: [".cody"],
      absolutePaths: [],
      commands: [],
    },
    target: {
      _tag: "instructionFile",
      path: ".cody/instructions.md",
    },
  },
  {
    id: "junie",
    displayName: "Junie",
    detection: {
      homePaths: [".junie"],
      absolutePaths: [],
      commands: [],
    },
    target: {
      _tag: "instructionFile",
      path: ".junie/guidelines.md",
    },
  },
]);

export const findAgent = (agentId: string): Option.Option<AgentDefinition> =>
  Option.fromNullable(agentCatalog.find((agent) => agent.id === agentId));

const containsDeclaredMarker = (declaredMarkers: ReadonlyArray<string>, observedMarkers: ReadonlySet<string>): boolean =>
  declaredMarkers.some((marker) => observedMarkers.has(marker));

export const classifyAgents = (evidence: AgentDetection): ReadonlyArray<AgentDefinition> => {
  const homePaths = new Set(evidence.homePaths);
  const absolutePaths = new Set(evidence.absolutePaths);
  const commands = new Set(evidence.commands);

  return agentCatalog.filter(
    (agent) =>
      containsDeclaredMarker(agent.detection.homePaths, homePaths) ||
      containsDeclaredMarker(agent.detection.absolutePaths, absolutePaths) ||
      containsDeclaredMarker(agent.detection.commands, commands),
  );
};
