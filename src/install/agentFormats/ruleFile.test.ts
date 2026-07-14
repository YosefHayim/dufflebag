import { createHash } from "node:crypto";

import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { findAgent } from "../../catalog/agentCatalog.js";
import { findFeature } from "../../catalog/featureCatalog.js";
import { planRuleFiles, ruleFilePlanSchema, ruleFileRequestSchema } from "./ruleFile.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const cursor = Option.getOrThrow(findAgent("cursor"));
const missingPrevious = { _tag: "missing" };
const priorBytes = textEncoder.encode("user-authored rule\n");
const priorFile = { _tag: "priorFile", bytes: priorBytes };

const installedSkillFor = (featureId: string) => {
  const feature = Option.getOrThrow(findFeature(featureId));
  if (feature.installedSkill._tag !== "skill") {
    throw new Error(`Feature ${featureId} does not install a skill.`);
  }

  return feature.installedSkill;
};

const autorunSkill = installedSkillFor("autonomous-loop");
const pngToCodeSkill = installedSkillFor("png-to-code");

const ruleFileRequest = {
  agent: cursor,
  ctl: "/workspace/.claude/dufflebag/hooks/ctxLoopCtl.js",
  skills: [
    {
      installedSkill: autorunSkill,
      markdown: "---\nname: autorun\ndescription: Run autonomously.\n---\nStart with @@CTL@@.\n",
    },
    {
      installedSkill: pngToCodeSkill,
      markdown: "Convert a PNG.\n\n---\nThis divider is body content.\n",
    },
  ],
  previousFiles: [
    { path: ".cursor/rules/autorun.mdc", previous: missingPrevious },
    { path: ".cursor/rules/png-to-code.mdc", previous: priorFile },
  ],
};

const unwrap = <Right, Left>(result: Either.Either<Right, Left>): Right =>
  Either.getOrThrowWith(result, (error) => new Error(String(error)));

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("planRuleFiles", () => {
  it("plans one ordered rule write per installed skill with exact ownership", () => {
    const plan = unwrap(planRuleFiles(ruleFileRequest));

    expect(plan.writes.map((write) => write.artifact.path)).toEqual([".cursor/rules/autorun.mdc", ".cursor/rules/png-to-code.mdc"]);
    expect(plan.writes.map((write) => textDecoder.decode(write.bytes))).toEqual([
      "Start with /workspace/.claude/dufflebag/hooks/ctxLoopCtl.js.\n",
      "Convert a PNG.\n\n---\nThis divider is body content.\n",
    ]);

    const firstWrite = Option.getOrThrow(Option.fromNullable(plan.writes.at(0)));
    const secondWrite = Option.getOrThrow(Option.fromNullable(plan.writes.at(1)));

    expect(firstWrite.artifact.kind).toEqual({ _tag: "rule" });
    expect(firstWrite.artifact.owner).toEqual({ _tag: "agent", agentIds: ["cursor"] });
    expect(firstWrite.artifact.ownership).toEqual({
      _tag: "wholeFile",
      installedHash: hashBytes(firstWrite.bytes),
      previous: missingPrevious,
    });
    expect(secondWrite.artifact.ownership).toEqual({
      _tag: "wholeFile",
      installedHash: hashBytes(secondWrite.bytes),
      previous: priorFile,
    });
  });

  it("strips CRLF frontmatter without trimming the markdown body", () => {
    const request = {
      ...ruleFileRequest,
      ctl: "$&/ctl",
      skills: [
        {
          installedSkill: autorunSkill,
          markdown: "---\r\nname: autorun\r\n---\r\n\r\n  Run @@CTL@@.\r\n",
        },
      ],
      previousFiles: [{ path: ".cursor/rules/autorun.mdc", previous: missingPrevious }],
    };

    const plan = unwrap(planRuleFiles(request));
    const write = Option.getOrThrow(Option.fromNullable(plan.writes.at(0)));

    expect(textDecoder.decode(write.bytes)).toBe("\r\n  Run $&/ctl.\r\n");
  });

  it.each([
    {
      name: "an unterminated leading frontmatter block",
      request: {
        ...ruleFileRequest,
        skills: [
          {
            installedSkill: autorunSkill,
            markdown: "---\nname: autorun\nNo closing delimiter.\n",
          },
        ],
        previousFiles: [{ path: ".cursor/rules/autorun.mdc", previous: missingPrevious }],
      },
      issue: "frontmatter",
    },
    {
      name: "a frontmatter-only markdown body",
      request: {
        ...ruleFileRequest,
        skills: [
          {
            installedSkill: autorunSkill,
            markdown: "---\nname: autorun\n---\n",
          },
        ],
        previousFiles: [{ path: ".cursor/rules/autorun.mdc", previous: missingPrevious }],
      },
      issue: "body",
    },
    {
      name: "duplicate installed skill IDs",
      request: {
        ...ruleFileRequest,
        skills: [ruleFileRequest.skills[0], ruleFileRequest.skills[0]],
        previousFiles: [ruleFileRequest.previousFiles[0], ruleFileRequest.previousFiles[0]],
      },
      issue: "unique",
    },
    {
      name: "duplicate previous-file paths",
      request: {
        ...ruleFileRequest,
        previousFiles: [ruleFileRequest.previousFiles[0], ruleFileRequest.previousFiles[0]],
      },
      issue: "unique",
    },
    {
      name: "a missing previous-file state",
      request: { ...ruleFileRequest, previousFiles: ruleFileRequest.previousFiles.slice(0, 1) },
      issue: "exactly match",
    },
    {
      name: "an extra previous-file state",
      request: {
        ...ruleFileRequest,
        previousFiles: [...ruleFileRequest.previousFiles, { path: ".cursor/rules/extra.mdc", previous: missingPrevious }],
      },
      issue: "exactly match",
    },
    {
      name: "a non-rule-file target",
      request: {
        ...ruleFileRequest,
        agent: { ...cursor, target: { _tag: "instructionFile", path: "AGENTS.md" } },
      },
      issue: "ruleFile",
    },
    {
      name: "an altered catalog rule target",
      request: {
        ...ruleFileRequest,
        agent: { ...cursor, target: { _tag: "ruleFile", directory: ".other/rules", extension: ".mdc" } },
        previousFiles: [
          { path: ".other/rules/autorun.mdc", previous: missingPrevious },
          { path: ".other/rules/png-to-code.mdc", previous: priorFile },
        ],
      },
      issue: "catalog",
    },
    {
      name: "an unknown installed skill definition",
      request: {
        ...ruleFileRequest,
        skills: [
          {
            installedSkill: { _tag: "skill", id: "invented", shippedPaths: ["SKILL.md"] },
            markdown: "Invented skill.\n",
          },
        ],
        previousFiles: [{ path: ".cursor/rules/invented.mdc", previous: missingPrevious }],
      },
      issue: "catalog",
    },
    {
      name: "an unknown agent owner",
      request: { ...ruleFileRequest, agent: { ...cursor, id: "unknown-agent" } },
      issue: "catalog",
    },
    {
      name: "an unknown request property",
      request: { ...ruleFileRequest, unexpected: true },
      issue: "unexpected",
    },
  ])("rejects $name", ({ request, issue }) => {
    const result = planRuleFiles(request);

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain(issue);
  });

  it("strictly rejects unknown nested request properties", () => {
    const result = Schema.decodeUnknownEither(ruleFileRequestSchema, {
      onExcessProperty: "error",
    })({
      ...ruleFileRequest,
      skills: [{ ...ruleFileRequest.skills[0], unexpected: true }],
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("unexpected");
  });

  it.each(["   ", "@@CTL@@", "node @@CTL@@ status"])("rejects a non-concrete control command %j", (ctl) => {
    expect(Either.isLeft(planRuleFiles({ ...ruleFileRequest, ctl }))).toBe(true);
  });

  it("rejects a result whose ownership hash drifts from its bytes", () => {
    const plan = unwrap(planRuleFiles(ruleFileRequest));
    const firstWrite = Option.getOrThrow(Option.fromNullable(plan.writes.at(0)));
    const result = Schema.validateEither(ruleFilePlanSchema, {
      onExcessProperty: "error",
    })({
      ...plan,
      writes: [
        {
          ...firstWrite,
          artifact: {
            ...firstWrite.artifact,
            ownership: { ...firstWrite.artifact.ownership, installedHash: "0".repeat(64) },
          },
        },
        ...plan.writes.slice(1),
      ],
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("exact desired bytes");
  });
});
