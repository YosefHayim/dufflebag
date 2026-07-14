import { createHash } from "node:crypto";

import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { findAgent } from "../../catalog/agentCatalog.js";
import { featureCatalog, findFeature } from "../../catalog/featureCatalog.js";
import type { PreviousFileValue } from "../artifactReceipt.js";
import { planSkillDirectory, type SkillDirectoryPlan, SkillDirectoryPlanError, skillDirectoryPlanSchema } from "./skillDirectory.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const claudeAgent = Option.getOrThrow(findAgent("claude-code"));
const readmeEditorFeature = Option.getOrThrow(findFeature("readme-editor"));
const missingPrevious: PreviousFileValue = { _tag: "missing" };
const priorSkillBytes = textEncoder.encode("previous skill\n");
const skillDefinition = readmeEditorFeature.installedSkill;
const skillPath = ".claude/skills/readme-editor/SKILL.md";
const guidePath = ".claude/skills/readme-editor/references/nested/guide.md";
const binaryPath = ".claude/skills/readme-editor/references/logo.bin";
const plainPath = ".claude/skills/readme-editor/references/plain.txt";
const plainBytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x6b, 0x65, 0x65, 0x70, 0x0d, 0x0a]);

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const sourceFiles = () => [
  { path: "SKILL.md", bytes: textEncoder.encode("Run `@@CTL@@ status`.\n") },
  { path: "references/nested/guide.md", bytes: textEncoder.encode("Use @@CTL@@ with care.\n") },
  { path: "references/logo.bin", bytes: Uint8Array.from([0xff, 0x40, 0x40, 0x43, 0x54, 0x4c, 0x40, 0x40]) },
  { path: "references/plain.txt", bytes: plainBytes },
  { path: "PRIVATE.md", bytes: textEncoder.encode("do not ship\n") },
  { path: "reference/sibling.md", bytes: textEncoder.encode("not under references\n") },
];

const previousFiles = () => [
  { path: skillPath, previous: { _tag: "priorFile", bytes: priorSkillBytes } },
  { path: guidePath, previous: missingPrevious },
  { path: binaryPath, previous: missingPrevious },
  { path: plainPath, previous: missingPrevious },
];

const request = () => ({
  agent: claudeAgent,
  ctl: "dufflebag ctl",
  skills: [{ installedSkill: skillDefinition, sourceFiles: sourceFiles() }],
  previousFiles: previousFiles(),
});

const unwrap = (result: Either.Either<SkillDirectoryPlan, SkillDirectoryPlanError>): SkillDirectoryPlan =>
  Either.getOrThrowWith(result, (error) => new Error(error.message));

const errorMessage = (input: unknown): string => {
  const result = planSkillDirectory(input);
  if (Either.isRight(result)) {
    throw new Error("Expected skill-directory planning to fail.");
  }

  expect(result.left).toBeInstanceOf(SkillDirectoryPlanError);

  return result.left.message;
};

describe("planSkillDirectory", () => {
  it("copies only exact shipped paths and every file below an allowed directory", () => {
    const plan = unwrap(planSkillDirectory(request()));

    expect(plan.writes.map((write) => write.artifact.path)).toEqual([skillPath, binaryPath, guidePath, plainPath]);
    expect(plan.writes.some((write) => write.artifact.path.includes("PRIVATE"))).toBe(false);
    expect(plan.writes.some((write) => write.artifact.path.includes("reference/sibling"))).toBe(false);
  });

  it("copies every catalog allowlist exactly without accepting sibling prefixes", () => {
    const skills = featureCatalog.flatMap((feature) => {
      if (feature.installedSkill._tag === "none") {
        return [];
      }

      const sourceSnapshot = feature.installedSkill.shippedPaths.flatMap((shippedPath, index) => {
        const stagedPath = /\.[^/]+$/.test(shippedPath) ? shippedPath : `${shippedPath}/nested/allowed.txt`;

        return [
          { path: stagedPath, bytes: textEncoder.encode(`allowed ${index}\n`) },
          { path: `${shippedPath}-sibling/ignored.txt`, bytes: textEncoder.encode(`ignored ${index}\n`) },
        ];
      });

      return [{ installedSkill: feature.installedSkill, sourceFiles: sourceSnapshot }];
    });
    const expectedPaths = skills.flatMap((skill) =>
      skill.sourceFiles
        .filter((file) => !file.path.includes("-sibling/"))
        .map((file) => `.claude/skills/${skill.installedSkill.id}/${file.path}`)
        .sort(),
    );
    const catalogRequest = {
      agent: claudeAgent,
      ctl: "dufflebag ctl",
      skills,
      previousFiles: expectedPaths.map((path) => ({ path, previous: missingPrevious })),
    };

    const plan = unwrap(planSkillDirectory(catalogRequest));

    expect(plan.writes.map((write) => write.artifact.path)).toEqual(expectedPaths);
  });

  it("substitutes the control command in UTF-8 text and preserves other bytes exactly", () => {
    const plan = unwrap(planSkillDirectory(request()));
    const skillWrite = Option.getOrThrow(Option.fromNullable(plan.writes.find((write) => write.artifact.path === skillPath)));
    const guideWrite = Option.getOrThrow(Option.fromNullable(plan.writes.find((write) => write.artifact.path === guidePath)));
    const binaryWrite = Option.getOrThrow(Option.fromNullable(plan.writes.find((write) => write.artifact.path === binaryPath)));
    const plainWrite = Option.getOrThrow(Option.fromNullable(plan.writes.find((write) => write.artifact.path === plainPath)));

    expect(textDecoder.decode(skillWrite.bytes)).toBe("Run `dufflebag ctl status`.\n");
    expect(textDecoder.decode(guideWrite.bytes)).toBe("Use dufflebag ctl with care.\n");
    expect(binaryWrite.bytes).toEqual(Uint8Array.from([0xff, 0x40, 0x40, 0x43, 0x54, 0x4c, 0x40, 0x40]));
    expect(plainWrite.bytes).toEqual(plainBytes);
  });

  it("preserves literal replacement tokens in the concrete control command", () => {
    const plan = unwrap(planSkillDirectory({ ...request(), ctl: "$&/ctl" }));
    const skillWrite = Option.getOrThrow(Option.fromNullable(plan.writes.find((write) => write.artifact.path === skillPath)));

    expect(textDecoder.decode(skillWrite.bytes)).toBe("Run `$&/ctl status`.\n");
  });

  it("returns whole-file ownership with matching hashes and exact previous states", () => {
    const plan = unwrap(planSkillDirectory(request()));
    const skillWrite = Option.getOrThrow(Option.fromNullable(plan.writes.find((write) => write.artifact.path === skillPath)));

    expect(skillWrite.artifact).toMatchObject({
      owner: { _tag: "agent", agentIds: ["claude-code"] },
      path: skillPath,
      kind: { _tag: "skill" },
      ownership: {
        _tag: "wholeFile",
        previous: { _tag: "priorFile", bytes: priorSkillBytes },
      },
    });
    expect(skillWrite.artifact.ownership.installedHash).toBe(hashBytes(skillWrite.bytes));
  });

  it("rejects missing allowlist roots and incomplete or extra previous-file evidence", () => {
    const missingAllowlist = request();
    missingAllowlist.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: sourceFiles().filter((file) => !file.path.startsWith("references/")),
    };
    const missingPrevious = request();
    missingPrevious.previousFiles = previousFiles().filter((file) => file.path !== guidePath);
    const extraPrevious = request();
    extraPrevious.previousFiles = [
      ...previousFiles(),
      { path: ".claude/skills/readme-editor/undeclared.md", previous: { _tag: "missing" } },
    ];

    expect(errorMessage(missingAllowlist)).toContain("Shipped path references");
    expect(errorMessage(missingPrevious)).toContain("requires one exact previous-file state");
    expect(errorMessage(extraPrevious)).toContain("does not belong to a desired skill file");
  });

  it("rejects a shipped file staged as a directory", () => {
    const invalidRequest = request();
    invalidRequest.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: sourceFiles().map((file) =>
        file.path === "SKILL.md" ? { path: "SKILL.md/evil", bytes: textEncoder.encode("not a directory\n") } : file,
      ),
    };
    invalidRequest.previousFiles = previousFiles().map((file) =>
      file.path === skillPath ? { path: ".claude/skills/readme-editor/SKILL.md/evil", previous: missingPrevious } : file,
    );

    expect(errorMessage(invalidRequest)).toContain("file path");
  });

  it("rejects case-insensitive staged-path collisions", () => {
    const invalidRequest = request();
    invalidRequest.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: [...sourceFiles(), { path: "skill.md", bytes: textEncoder.encode("collision\n") }],
    };

    expect(errorMessage(invalidRequest)).toContain("case-insensitive");
  });

  it.each(["references", "REFERENCES"])("rejects an impossible parent file %s beside its descendants", (parentPath) => {
    const invalidRequest = request();
    invalidRequest.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: [...sourceFiles(), { path: parentPath, bytes: textEncoder.encode("parent file\n") }],
    };
    invalidRequest.previousFiles = [...previousFiles(), { path: `.claude/skills/readme-editor/${parentPath}`, previous: missingPrevious }];

    expect(errorMessage(invalidRequest)).toContain("file and directory");
  });

  it("rejects a shipped directory root staged as one file", () => {
    const invalidRequest = request();
    invalidRequest.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: [
        { path: "SKILL.md", bytes: textEncoder.encode("skill\n") },
        { path: "references", bytes: textEncoder.encode("not a directory\n") },
      ],
    };
    invalidRequest.previousFiles = [
      { path: skillPath, previous: { _tag: "priorFile", bytes: priorSkillBytes } },
      { path: ".claude/skills/readme-editor/references", previous: missingPrevious },
    ];

    expect(errorMessage(invalidRequest)).toContain("directory root");
  });

  it.each(["   ", "@@CTL@@", "node @@CTL@@ status"])("rejects a non-concrete control command %j", (ctl) => {
    expect(Either.isLeft(planSkillDirectory({ ...request(), ctl }))).toBe(true);
  });

  it("strictly decodes catalog inputs and validates the generated result", () => {
    const unknownRequestField = { ...request(), unexpected: true };
    const alteredAgent = {
      ...request(),
      agent: { ...claudeAgent, target: { _tag: "skillDirectory", path: ".other/skills" } },
    };
    const alteredSkill = {
      ...request(),
      skills: [
        {
          installedSkill: { ...skillDefinition, shippedPaths: ["SKILL.md"] },
          sourceFiles: sourceFiles(),
        },
      ],
    };
    const plan = unwrap(planSkillDirectory(request()));
    const skillWrite = Option.getOrThrow(Option.fromNullable(plan.writes.find((write) => write.artifact.path === skillPath)));

    const tamperedPlan = {
      writes: [
        {
          ...skillWrite,
          bytes: textEncoder.encode("tampered\n"),
        },
      ],
    };

    expect(Either.isLeft(planSkillDirectory(unknownRequestField))).toBe(true);
    expect(Either.isLeft(planSkillDirectory(alteredAgent))).toBe(true);
    expect(Either.isLeft(planSkillDirectory(alteredSkill))).toBe(true);
    expect(Schema.is(skillDirectoryPlanSchema)(tamperedPlan)).toBe(false);
  });
});
