import { Either } from "effect";
import { describe, expect, it } from "vitest";

import { agentCatalog } from "../../catalog/agentCatalog.js";
import { type JsonValue, sha256Bytes, sha256JsonValue } from "../artifactReceipt.js";
import { planConfigReference } from "./configReference.js";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const missingObservation = (path: string) => ({
  path,
  snapshot: {
    _tag: "missing",
  },
});

const fileObservation = (path: string, value: Uint8Array) => ({
  path,
  snapshot: {
    _tag: "file",
    bytes: value,
    sha256: sha256Bytes(value),
  },
});

const skill = {
  installedSkill: { _tag: "skill", id: "example", shippedPaths: ["SKILL.md"] },
  sourceFiles: [{ path: "SKILL.md", bytes: bytes("body") }],
};

const yamlAgent = {
  id: "continue",
  displayName: "Swapped YAML fixture",
  detection: {
    homePaths: [],
    absolutePaths: [],
    commands: ["fixture"],
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
};

const jsonAgent = {
  id: "aider",
  displayName: "Swapped JSON fixture",
  detection: {
    homePaths: [],
    absolutePaths: [],
    commands: ["fixture"],
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
};

const right = <Value, Error>(result: Either.Either<Value, Error>): Value => {
  if (Either.isLeft(result)) {
    throw result.left;
  }

  return result.right;
};

const candidateAt = <Value extends { readonly artifact: { readonly path: string } }>(values: ReadonlyArray<Value>, path: string): Value => {
  const value = values.find(({ artifact }) => artifact.path === path);
  if (value === undefined) {
    throw new Error(`Missing candidate at ${path}.`);
  }

  return value;
};

type JsonArrayPrior = { readonly _tag: "missing" } | { readonly _tag: "value"; readonly value: ReadonlyArray<string> };

const jsonReceiptArtifact = (installed: ReadonlyArray<string>, prior: JsonArrayPrior) => ({
  path: ".continue/config.json",
  owner: { _tag: "agent", agentIds: ["aider"] },
  kind: "configReference",
  ownership: {
    _tag: "jsonValues",
    entries: [
      {
        pointer: "/rules",
        installed: {
          _tag: "value",
          value: installed,
          sha256: sha256JsonValue(installed),
        },
        prior,
      },
    ],
    priorDocument: { _tag: "existing" },
  },
});

describe("planConfigReference", () => {
  it("chooses YAML from the reference tag and adds a missing key without changing prior bytes", () => {
    const prior = bytes('# keep this comment\r\nmode: "safe"\r\n');
    const result = planConfigReference({
      agent: yamlAgent,
      skills: [skill],
      observations: [missingObservation("AGENTS.md"), fileObservation(".aider.conf.yml", prior)],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });

    const candidates = right(result);
    const config = candidateAt(candidates, ".aider.conf.yml");
    expect(candidates.map(({ artifact }) => artifact.kind)).toEqual(["instruction", "configReference"]);
    expect(new TextDecoder().decode(config.bytes)).toBe('# keep this comment\r\nmode: "safe"\r\n\r\nread:\r\n  - AGENTS.md\r\n');
    expect(config.artifact).toMatchObject({
      owner: { _tag: "agent", agentIds: ["continue"] },
      ownership: {
        _tag: "yamlSequenceValue",
        key: "read",
        reference: "AGENTS.md",
        priorPresence: { _tag: "absent" },
        priorKeyPresence: { _tag: "absent" },
        priorDocument: { _tag: "existing" },
      },
    });
  });

  it("creates a valid YAML sequence when the config document is missing", () => {
    const result = planConfigReference({
      agent: yamlAgent,
      skills: [skill],
      observations: [missingObservation("AGENTS.md"), missingObservation(".aider.conf.yml")],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });

    const config = candidateAt(right(result), ".aider.conf.yml");
    expect(new TextDecoder().decode(config.bytes)).toBe("read:\n  - AGENTS.md\n");
    expect(config.artifact.ownership).toMatchObject({
      _tag: "yamlSequenceValue",
      key: "read",
      reference: "AGENTS.md",
      priorDocument: { _tag: "missing" },
    });
  });

  it("rejects an unsafe YAML key before creating a missing config document", () => {
    const unsafeYamlAgent = {
      ...yamlAgent,
      target: {
        ...yamlAgent.target,
        referenceFormat: {
          _tag: "yamlSequenceKey",
          key: "read key",
        },
      },
    };
    const result = planConfigReference({
      agent: unsafeYamlAgent,
      skills: [skill],
      observations: [missingObservation("AGENTS.md"), missingObservation(".aider.conf.yml")],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });

    expect(Either.isLeft(result) && result.left.code).toBe("target-invalid");
  });

  it("chooses JSON from the reference tag and returns the original bytes when the rule is already exact", () => {
    const prior = bytes('{\n    "rules": ["AGENTS.md"],\n    "keep": { "spacing": true }\n}\n');
    const result = planConfigReference({
      agent: jsonAgent,
      skills: [skill],
      observations: [missingObservation("AGENTS.md"), fileObservation(".continue/config.json", prior)],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });

    const config = candidateAt(right(result), ".continue/config.json");
    expect(config.bytes).toEqual(prior);
    expect(config.artifact).toMatchObject({
      owner: { _tag: "agent", agentIds: ["aider"] },
      ownership: {
        _tag: "jsonValues",
        entries: [
          {
            pointer: "/rules",
            installed: {
              _tag: "value",
              value: ["AGENTS.md"],
            },
            prior: {
              _tag: "value",
              value: ["AGENTS.md"],
            },
          },
        ],
        priorDocument: { _tag: "existing" },
      },
    });
  });

  it("adds one JSON rule while preserving unrelated semantic content", () => {
    const result = planConfigReference({
      agent: jsonAgent,
      skills: [skill],
      observations: [
        missingObservation("AGENTS.md"),
        fileObservation(".continue/config.json", bytes('{"rules":["RULES.md"],"keep":{"value":42}}')),
      ],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });

    const config = candidateAt(right(result), ".continue/config.json");
    const parsed: JsonValue = JSON.parse(new TextDecoder().decode(config.bytes));
    expect(parsed).toEqual({ rules: ["RULES.md", "AGENTS.md"], keep: { value: 42 } });
  });

  it("rejects a JSON receipt installed for a different instruction reference", () => {
    const installed = ["OTHER.md"];
    const installedBytes = bytes(JSON.stringify({ rules: installed }));
    const result = planConfigReference({
      agent: jsonAgent,
      skills: [skill],
      observations: [missingObservation("AGENTS.md"), fileObservation(".continue/config.json", installedBytes)],
      priorArtifacts: [
        {
          path: ".continue/config.json",
          owner: { _tag: "agent", agentIds: ["aider"] },
          kind: "configReference",
          ownership: {
            _tag: "jsonValues",
            entries: [
              {
                pointer: "/rules",
                installed: {
                  _tag: "value",
                  value: installed,
                  sha256: sha256JsonValue(installed),
                },
                prior: { _tag: "missing" },
              },
            ],
            priorDocument: { _tag: "existing" },
          },
        },
      ],
      templateValues: { ctl: "ctl.js" },
    });

    expect(Either.isLeft(result) && result.left.code).toBe("ownership-conflict");
  });

  it("rejects JSON receipts that cannot be the exact append-once transition from their prior state", () => {
    const invalidTransitions: ReadonlyArray<{
      readonly prior: JsonArrayPrior;
      readonly installed: ReadonlyArray<string>;
    }> = [
      {
        prior: { _tag: "missing" },
        installed: ["RULES.md", "AGENTS.md"],
      },
      {
        prior: { _tag: "value", value: ["RULES.md"] },
        installed: ["AGENTS.md", "RULES.md"],
      },
      {
        prior: { _tag: "value", value: ["RULES.md", "AGENTS.md"] },
        installed: ["RULES.md", "AGENTS.md", "OTHER.md"],
      },
    ];

    invalidTransitions.forEach(({ prior, installed }) => {
      const result = planConfigReference({
        agent: jsonAgent,
        skills: [skill],
        observations: [
          missingObservation("AGENTS.md"),
          fileObservation(".continue/config.json", bytes(JSON.stringify({ rules: installed }))),
        ],
        priorArtifacts: [jsonReceiptArtifact(installed, prior)],
        templateValues: { ctl: "ctl.js" },
      });

      expect(Either.isLeft(result) && result.left.code).toBe("ownership-conflict");
    });
  });

  it("accepts an exact append-once JSON receipt and retains unrelated prior rules", () => {
    const prior = ["RULES.md"];
    const installed = [...prior, "AGENTS.md"];
    const result = planConfigReference({
      agent: jsonAgent,
      skills: [skill],
      observations: [
        missingObservation("AGENTS.md"),
        fileObservation(".continue/config.json", bytes(JSON.stringify({ rules: installed }))),
      ],
      priorArtifacts: [jsonReceiptArtifact(installed, { _tag: "value", value: prior })],
      templateValues: { ctl: "ctl.js" },
    });

    const config = candidateAt(right(result), ".continue/config.json");
    expect(config.artifact.ownership).toMatchObject({
      _tag: "jsonValues",
      entries: [
        {
          pointer: "/rules",
          installed: { _tag: "value", value: ["RULES.md", "AGENTS.md"] },
          prior: { _tag: "value", value: ["RULES.md"] },
        },
      ],
    });
  });

  it("accepts an unchanged JSON receipt when the prior array already contained the reference", () => {
    const installed = ["RULES.md", "AGENTS.md"];
    const result = planConfigReference({
      agent: jsonAgent,
      skills: [skill],
      observations: [
        missingObservation("AGENTS.md"),
        fileObservation(".continue/config.json", bytes(JSON.stringify({ rules: installed }))),
      ],
      priorArtifacts: [jsonReceiptArtifact(installed, { _tag: "value", value: installed })],
      templateValues: { ctl: "ctl.js" },
    });

    const config = candidateAt(right(result), ".continue/config.json");
    expect(config.bytes).toEqual(bytes(JSON.stringify({ rules: installed })));
    expect(config.artifact.ownership).toMatchObject({
      _tag: "jsonValues",
      entries: [
        {
          installed: { _tag: "value", value: installed },
          prior: { _tag: "value", value: installed },
        },
      ],
    });
  });

  it("accepts a single-reference JSON receipt when the prior pointer was missing", () => {
    const installed = ["AGENTS.md"];
    const result = planConfigReference({
      agent: jsonAgent,
      skills: [skill],
      observations: [
        missingObservation("AGENTS.md"),
        fileObservation(".continue/config.json", bytes(JSON.stringify({ rules: installed }))),
      ],
      priorArtifacts: [jsonReceiptArtifact(installed, { _tag: "missing" })],
      templateValues: { ctl: "ctl.js" },
    });

    const config = candidateAt(right(result), ".continue/config.json");
    expect(config.artifact.ownership).toMatchObject({
      _tag: "jsonValues",
      entries: [
        {
          installed: { _tag: "value", value: ["AGENTS.md"] },
          prior: { _tag: "missing" },
        },
      ],
    });
  });

  it("rejects malformed documents, non-array rules, duplicate references, and missing pointer parents", () => {
    const cases = [
      {
        agent: jsonAgent,
        content: "{",
      },
      {
        agent: jsonAgent,
        content: '{"rules":"AGENTS.md"}',
      },
      {
        agent: jsonAgent,
        content: '{"rules":["AGENTS.md","AGENTS.md"]}',
      },
      {
        agent: {
          ...jsonAgent,
          target: {
            ...jsonAgent.target,
            referenceFormat: { _tag: "jsonArrayPointer", pointer: "/nested/rules" },
          },
        },
        content: "{}",
      },
      {
        agent: yamlAgent,
        content: "read: AGENTS.md\n",
      },
      {
        agent: yamlAgent,
        content: "read:\n  - &owned AGENTS.md\n",
      },
    ];

    cases.forEach(({ agent, content }) => {
      const configPath = agent.target.configPath;
      const result = planConfigReference({
        agent,
        skills: [skill],
        observations: [missingObservation("AGENTS.md"), fileObservation(configPath, bytes(content))],
        priorArtifacts: [],
        templateValues: { ctl: "ctl.js" },
      });

      expect(Either.isLeft(result) && result.left.code).toBe("config-source-invalid");
    });
  });

  it("emits neither an instruction nor a dangling reference when no skills are desired", () => {
    const result = planConfigReference({
      agent: jsonAgent,
      skills: [],
      observations: [],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });

    expect(right(result)).toEqual([]);
  });

  it("validates config-reference paths and formats before accepting an empty desired skill set", () => {
    const invalidAgents = [
      {
        ...jsonAgent,
        target: {
          ...jsonAgent.target,
          configPath: "../escape",
        },
      },
      {
        ...yamlAgent,
        target: {
          ...yamlAgent.target,
          referenceFormat: { _tag: "yamlSequenceKey", key: "read key" },
        },
      },
      {
        ...jsonAgent,
        target: {
          ...jsonAgent.target,
          referenceFormat: { _tag: "jsonArrayPointer", pointer: "rules" },
        },
      },
    ];

    invalidAgents.forEach((agent) => {
      const result = planConfigReference({
        agent,
        skills: [],
        observations: [],
        priorArtifacts: [],
        templateValues: { ctl: "ctl.js" },
      });

      expect(Either.isLeft(result) && result.left.code).toBe("target-invalid");
    });
  });

  it("routes the catalog through four target tags without consulting agent IDs", () => {
    const counts = new Map<string, number>();
    agentCatalog.forEach((agent) => {
      counts.set(agent.target._tag, (counts.get(agent.target._tag) ?? 0) + 1);
    });

    expect(Object.fromEntries(counts)).toEqual({
      skillDirectory: 4,
      ruleFile: 1,
      instructionFile: 6,
      configReference: 2,
    });
    expect(yamlAgent.id).toBe("continue");
    expect(jsonAgent.id).toBe("aider");
  });
});
