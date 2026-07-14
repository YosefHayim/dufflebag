import { Either } from "effect";
import { describe, expect, it } from "vitest";

import { sha256Bytes } from "../artifactReceipt.js";
import { planRuleFiles } from "./ruleFile.js";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const missingObservation = (path: string) => ({
  path,
  snapshot: {
    _tag: "missing",
  },
});

const agent = {
  id: "cursor",
  displayName: "Cursor",
  detection: {
    homePaths: [".cursor"],
    absolutePaths: [],
    commands: ["cursor"],
  },
  target: {
    _tag: "ruleFile",
    directory: ".cursor/rules",
    extension: ".mdc",
  },
};

const right = <Value, Error>(result: Either.Either<Value, Error>): Value => {
  if (Either.isLeft(result)) {
    throw result.left;
  }

  return result.right;
};

describe("planRuleFiles", () => {
  it("removes only leading full-line frontmatter and preserves the remaining CRLF body", () => {
    const path = ".cursor/rules/example.mdc";
    const source = "---\r\nname: example\r\n---\r\n\r\n# @@CTL@@\r\n\r\n---\r\nBody";
    const result = planRuleFiles({
      agent,
      skills: [
        {
          installedSkill: { _tag: "skill", id: "example", shippedPaths: ["SKILL.md", "reference"] },
          sourceFiles: [
            { path: "reference/ignored.md", bytes: bytes("ignored") },
            { path: "SKILL.md", bytes: bytes(source) },
          ],
        },
      ],
      observations: [missingObservation(path)],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });

    const candidate = right(result).at(0);
    expect(candidate?.artifact).toMatchObject({
      path,
      kind: "rule",
      owner: { _tag: "agent", agentIds: ["cursor"] },
      ownership: {
        _tag: "wholeFile",
        installedSha256: sha256Bytes(bytes("# ctl.js\r\n\r\n---\r\nBody")),
        prior: { _tag: "missing" },
      },
    });
    expect(new TextDecoder().decode(candidate?.bytes)).toBe("# ctl.js\r\n\r\n---\r\nBody");
  });

  it("emits exactly one ordered rule per installed skill", () => {
    const result = planRuleFiles({
      agent,
      skills: [
        {
          installedSkill: { _tag: "skill", id: "second", shippedPaths: ["SKILL.md"] },
          sourceFiles: [{ path: "SKILL.md", bytes: bytes("second") }],
        },
        {
          installedSkill: { _tag: "skill", id: "first", shippedPaths: ["SKILL.md"] },
          sourceFiles: [{ path: "SKILL.md", bytes: bytes("first") }],
        },
      ],
      observations: [missingObservation(".cursor/rules/second.mdc"), missingObservation(".cursor/rules/first.mdc")],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });

    expect(right(result).map(({ artifact }) => artifact.path)).toEqual([".cursor/rules/second.mdc", ".cursor/rules/first.mdc"]);
  });

  it("rejects a missing allowlisted SKILL.md, an unclosed leading block, and unresolved template text", () => {
    const base = {
      agent,
      observations: [missingObservation(".cursor/rules/example.mdc")],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    };
    const notAllowlisted = planRuleFiles({
      ...base,
      skills: [
        {
          installedSkill: { _tag: "skill", id: "example", shippedPaths: ["README.md"] },
          sourceFiles: [
            { path: "SKILL.md", bytes: bytes("body") },
            { path: "README.md", bytes: bytes("readme") },
          ],
        },
      ],
    });
    const unclosed = planRuleFiles({
      ...base,
      skills: [
        {
          installedSkill: { _tag: "skill", id: "example", shippedPaths: ["SKILL.md"] },
          sourceFiles: [{ path: "SKILL.md", bytes: bytes("---\nname: example\n# body") }],
        },
      ],
    });
    const unresolved = planRuleFiles({
      ...base,
      skills: [
        {
          installedSkill: { _tag: "skill", id: "example", shippedPaths: ["SKILL.md"] },
          sourceFiles: [{ path: "SKILL.md", bytes: bytes("run @@OTHER@@") }],
        },
      ],
    });

    expect(Either.isLeft(notAllowlisted) && notAllowlisted.left.code).toBe("skill-source-invalid");
    expect(Either.isLeft(unclosed) && unclosed.left.code).toBe("frontmatter-unclosed");
    expect(Either.isLeft(unresolved) && unresolved.left.code).toBe("unresolved-template");
  });

  it("rejects non-UTF-8 SKILL.md bytes instead of rewriting them", () => {
    const result = planRuleFiles({
      agent,
      skills: [
        {
          installedSkill: { _tag: "skill", id: "example", shippedPaths: ["SKILL.md"] },
          sourceFiles: [{ path: "SKILL.md", bytes: new Uint8Array([0xc3, 0x28]) }],
        },
      ],
      observations: [missingObservation(".cursor/rules/example.mdc")],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });

    expect(Either.isLeft(result) && result.left.code).toBe("skill-source-invalid");
  });
});
