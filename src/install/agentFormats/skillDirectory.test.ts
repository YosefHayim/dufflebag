import { Either } from "effect";
import { describe, expect, it } from "vitest";

import { sha256Bytes } from "../artifactReceipt.js";
import { planSkillDirectory } from "./skillDirectory.js";

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

const agent = {
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

const right = <Value, Error>(result: Either.Either<Value, Error>): Value => {
  if (Either.isLeft(result)) {
    throw result.left;
  }

  return result.right;
};

describe("planSkillDirectory", () => {
  it("copies only exact allowlist matches in deterministic order and substitutes every declared token", () => {
    const observations = [
      missingObservation(".claude/skills/autorun/SKILL.md"),
      missingObservation(".claude/skills/autorun/scripts/a.mjs"),
      missingObservation(".claude/skills/autorun/scripts/z.mjs"),
    ];
    const result = planSkillDirectory({
      agent,
      skills: [
        {
          installedSkill: {
            _tag: "skill",
            id: "autorun",
            shippedPaths: ["SKILL.md", "scripts"],
          },
          sourceFiles: [
            { path: "scripts/z.mjs", bytes: bytes("node @@CTL@@ stop") },
            { path: "scripts-old/ignored.mjs", bytes: bytes("ignored") },
            { path: "README.md", bytes: bytes("ignored") },
            { path: "SKILL.md", bytes: bytes("@@CTL@@ arm @@CTL@@") },
            { path: "scripts/a.mjs", bytes: bytes("node @@CTL@@ arm") },
          ],
        },
      ],
      observations,
      priorArtifacts: [],
      templateValues: {
        ctl: ".claude/dufflebag/hooks/ctxLoopCtl.js",
      },
    });

    const candidates = right(result);
    expect(candidates.map(({ artifact }) => artifact.path)).toEqual(observations.map(({ path }) => path));
    expect(candidates.map(({ artifact }) => artifact.kind)).toEqual(["skill", "skill", "skill"]);
    expect(candidates.map(({ artifact }) => artifact.owner)).toEqual([
      { _tag: "agent", agentIds: ["claude-code"] },
      { _tag: "agent", agentIds: ["claude-code"] },
      { _tag: "agent", agentIds: ["claude-code"] },
    ]);
    expect(new TextDecoder().decode(candidates[0]?.bytes)).toBe(
      ".claude/dufflebag/hooks/ctxLoopCtl.js arm .claude/dufflebag/hooks/ctxLoopCtl.js",
    );
    expect(new TextDecoder().decode(candidates[1]?.bytes)).toBe("node .claude/dufflebag/hooks/ctxLoopCtl.js arm");
  });

  it("carries whole-file restoration evidence only after matching the prior receipt", () => {
    const path = ".claude/skills/example/SKILL.md";
    const installed = bytes("old installed");
    const original = bytes("user original");
    const previousArtifact = {
      path,
      owner: { _tag: "agent", agentIds: ["claude-code"] },
      kind: "skill",
      ownership: {
        _tag: "wholeFile",
        installedSha256: sha256Bytes(installed),
        prior: {
          _tag: "file",
          bytes: original,
          sha256: sha256Bytes(original),
        },
      },
    };
    const result = planSkillDirectory({
      agent,
      skills: [
        {
          installedSkill: { _tag: "skill", id: "example", shippedPaths: ["SKILL.md"] },
          sourceFiles: [{ path: "SKILL.md", bytes: bytes("new installed") }],
        },
      ],
      observations: [fileObservation(path, installed)],
      priorArtifacts: [previousArtifact],
      templateValues: { ctl: "ctl.js" },
    });

    const candidate = right(result)[0];
    expect(candidate?.artifact.ownership).toMatchObject({
      prior: {
        _tag: "file",
        bytes: original,
        sha256: sha256Bytes(original),
      },
    });
  });

  it("rejects unmatched allowlist entries, overlapping destinations, unresolved tokens, and edited owned files", () => {
    const baseInput = {
      agent,
      observations: [missingObservation(".claude/skills/example/SKILL.md")],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    };
    const unmatched = planSkillDirectory({
      ...baseInput,
      skills: [
        {
          installedSkill: { _tag: "skill", id: "example", shippedPaths: ["SKILL.md", "scripts"] },
          sourceFiles: [{ path: "SKILL.md", bytes: bytes("body") }],
        },
      ],
    });
    const duplicate = planSkillDirectory({
      ...baseInput,
      skills: [
        {
          installedSkill: { _tag: "skill", id: "example", shippedPaths: ["SKILL.md", "scripts", "scripts/a.mjs"] },
          sourceFiles: [
            { path: "SKILL.md", bytes: bytes("body") },
            { path: "scripts/a.mjs", bytes: bytes("script") },
          ],
        },
      ],
      observations: [missingObservation(".claude/skills/example/SKILL.md"), missingObservation(".claude/skills/example/scripts/a.mjs")],
    });
    const unresolved = planSkillDirectory({
      ...baseInput,
      skills: [
        {
          installedSkill: { _tag: "skill", id: "example", shippedPaths: ["SKILL.md"] },
          sourceFiles: [{ path: "SKILL.md", bytes: bytes("run @@UNKNOWN@@") }],
        },
      ],
    });
    const edited = planSkillDirectory({
      ...baseInput,
      skills: [
        {
          installedSkill: { _tag: "skill", id: "example", shippedPaths: ["SKILL.md"] },
          sourceFiles: [{ path: "SKILL.md", bytes: bytes("new") }],
        },
      ],
      observations: [fileObservation(".claude/skills/example/SKILL.md", bytes("edited"))],
      priorArtifacts: [
        {
          path: ".claude/skills/example/SKILL.md",
          owner: { _tag: "agent", agentIds: ["claude-code"] },
          kind: "skill",
          ownership: {
            _tag: "wholeFile",
            installedSha256: sha256Bytes(bytes("installed")),
            prior: { _tag: "missing" },
          },
        },
      ],
    });

    expect(Either.isLeft(unmatched) && unmatched.left.code).toBe("allowlist-unmatched");
    expect(Either.isLeft(duplicate) && duplicate.left.code).toBe("duplicate-destination");
    expect(Either.isLeft(unresolved) && unresolved.left.code).toBe("unresolved-template");
    expect(Either.isLeft(edited) && edited.left.code).toBe("ownership-conflict");
  });

  it("strictly rejects a non-directory target and excess request fields", () => {
    const wrongTarget = planSkillDirectory({
      agent: {
        ...agent,
        target: { _tag: "instructionFile", path: "AGENTS.md" },
      },
      skills: [],
      observations: [],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });
    const excess = planSkillDirectory({
      agent,
      skills: [],
      observations: [],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
      ignored: true,
    });

    expect(Either.isLeft(wrongTarget) && wrongTarget.left.code).toBe("target-mismatch");
    expect(Either.isLeft(excess) && excess.left.code).toBe("invalid-input");
  });
});
