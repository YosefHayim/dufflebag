import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { artifactPlanSchema, createUninstallPlan, createUpdatePlan, migrateLegacyManifest, validateArtifactPlan } from "./artifactPlan.js";

const oldHash = "1111111111111111111111111111111111111111111111111111111111111111";
const newHash = "2222222222222222222222222222222222222222222222222222222222222222";
const desiredBytes = new TextEncoder().encode("desired");
const noUnownedBytes = new Uint8Array();
const newSkillBytes = new TextEncoder().encode("new-skill");
const newConfigBytes = new TextEncoder().encode("new-config");
const previousSkillBytes = new TextEncoder().encode("previous-skill");
const previousInstructionBytes = new TextEncoder().encode("previous-instruction");

const applicationOwner = { _tag: "application" };
const agentOwner = (agentIds: ReadonlyArray<string>) => ({ _tag: "agent", agentIds });
const missingPrevious = { _tag: "missing" };
const expectedMissing = { _tag: "missing" };

const runtimeArtifact = {
  path: ".claude/dufflebag/hooks/contextGuard.js",
  kind: { _tag: "runtime" },
  owner: applicationOwner,
  ownership: { _tag: "wholeFile", installedHash: oldHash, previous: missingPrevious },
};

const skillArtifact = {
  path: ".claude/skills/autorun/SKILL.md",
  kind: { _tag: "skill" },
  owner: agentOwner(["claude-code"]),
  ownership: {
    _tag: "wholeFile",
    installedHash: oldHash,
    previous: { _tag: "priorFile", bytes: previousSkillBytes },
  },
};

const ruleArtifact = {
  path: ".cursor/rules/autorun.mdc",
  kind: { _tag: "rule" },
  owner: agentOwner(["cursor"]),
  ownership: { _tag: "wholeFile", installedHash: oldHash, previous: missingPrevious },
};

const instructionArtifact = {
  path: "AGENTS.md",
  kind: { _tag: "instruction" },
  owner: agentOwner(["cline", "codex"]),
  ownership: {
    _tag: "managedBlock",
    filePreviouslyPresent: true,
    startMarker: "<!-- dufflebag:skills start -->",
    endMarker: "<!-- dufflebag:skills end -->",
    installedBodyHash: oldHash,
  },
};

const jsonReferenceArtifact = {
  path: ".continue/config.json",
  kind: { _tag: "configReference" },
  owner: agentOwner(["continue"]),
  ownership: {
    _tag: "jsonValues",
    filePreviouslyPresent: true,
    createdContainers: [],
    values: [
      {
        pointer: "/rules/0",
        installed: { _tag: "value", hash: oldHash },
        previous: { _tag: "value", value: "user-rule.md" },
      },
    ],
  },
};

const yamlReferenceArtifact = {
  path: ".aider.conf.yml",
  kind: { _tag: "configReference" },
  owner: agentOwner(["aider"]),
  ownership: {
    _tag: "yamlSequenceValue",
    filePreviouslyPresent: true,
    key: "read",
    keyPreviouslyPresent: true,
    insertedPrefix: "",
    reference: "AGENTS.md",
    previouslyPresent: false,
  },
};

const settingsArtifact = {
  path: ".claude/settings.json",
  kind: { _tag: "settings" },
  owner: applicationOwner,
  ownership: {
    _tag: "jsonValues",
    filePreviouslyPresent: true,
    createdContainers: ["/hooks"],
    values: [
      {
        pointer: "/hooks/Stop",
        installed: { _tag: "value", hash: oldHash },
        previous: missingPrevious,
      },
    ],
  },
};

const managedConfigArtifact = {
  path: ".claude/dufflebag/config.json",
  kind: { _tag: "managedConfig" },
  owner: applicationOwner,
  ownership: { _tag: "wholeFile", installedHash: oldHash, previous: missingPrevious },
};

const desiredArtifacts = [
  runtimeArtifact,
  skillArtifact,
  ruleArtifact,
  instructionArtifact,
  jsonReferenceArtifact,
  yamlReferenceArtifact,
  settingsArtifact,
  managedConfigArtifact,
];

const receiptTarget = {
  path: ".claude/dufflebag/receipt.json",
  kind: { _tag: "receipt" },
  owner: applicationOwner,
};

const desiredReceipt = {
  version: "0.12.0",
  scope: "project",
  features: ["context-guard", "autonomous-loop"],
  artifacts: desiredArtifacts,
};

const write = (artifact: object, bytes = desiredBytes) => ({
  _tag: "write",
  artifact,
  bytes,
  expectedCurrent: expectedMissing,
});

const restore = (artifact: object, bytes: Uint8Array) => ({
  _tag: "restore",
  artifact,
  bytes,
  expectedCurrent: expectedMissing,
});

const remove = (artifact: object) => ({
  _tag: "remove",
  artifact,
  unownedBytes: noUnownedBytes,
  expectedCurrent: expectedMissing,
});

const completePlan = {
  scope: "project",
  root: "/workspace",
  operations: desiredArtifacts.map((artifact) => write(artifact)),
  preconditions: [],
  receipt: {
    _tag: "receiptPublish",
    target: receiptTarget,
    receipt: desiredReceipt,
    expectedCurrent: expectedMissing,
  },
};

const decodePlan = (input: unknown) =>
  Schema.validateEither(artifactPlanSchema, {
    onExcessProperty: "error",
  })(input);

const unwrap = <Right, Left>(result: Either.Either<Right, Left>): Right =>
  Either.getOrThrowWith(result, (error) => new Error(String(error)));

describe("artifactPlanSchema", () => {
  it("requires inspected receipt state for publish and remove operations", () => {
    const guardedPublish = completePlan;
    const unguardedPublish = {
      ...completePlan,
      receipt: { _tag: "receiptPublish", target: receiptTarget, receipt: desiredReceipt },
    };
    const guardedRemove = {
      scope: "project",
      root: "/workspace",
      operations: [],
      preconditions: [],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: { _tag: "file", sha256: oldHash } },
    };

    expect(Either.isRight(validateArtifactPlan(guardedPublish))).toBe(true);
    expect(Either.isRight(validateArtifactPlan(guardedRemove))).toBe(true);
    expect(Either.isLeft(validateArtifactPlan(unguardedPublish))).toBe(true);
    expect(
      Either.isLeft(
        validateArtifactPlan({
          ...guardedPublish,
          receipt: { ...guardedPublish.receipt, expectedCurrent: { _tag: "file", sha256: "invalid" } },
        }),
      ),
    ).toBe(true);
  });

  it("requires a schema-valid expected current state for every artifact operation", () => {
    const guardedPlan = {
      ...completePlan,
      operations: completePlan.operations.map((operation) => ({
        ...operation,
        expectedCurrent: { _tag: "file", sha256: oldHash },
      })),
    };
    const unguardedPlan = {
      ...completePlan,
      operations: desiredArtifacts.map((artifact) => ({
        _tag: "write",
        artifact,
        bytes: desiredBytes,
      })),
    };

    expect(Either.isRight(validateArtifactPlan(guardedPlan))).toBe(true);
    expect(Either.isLeft(validateArtifactPlan(unguardedPlan))).toBe(true);
    expect(
      Either.isLeft(
        validateArtifactPlan({
          ...completePlan,
          operations: [{ ...completePlan.operations[0], expectedCurrent: { _tag: "file", sha256: "invalid" } }],
        }),
      ),
    ).toBe(true);
  });

  it("strictly decodes a published plan with every artifact kind, owner, and ownership tag", () => {
    const plan = unwrap(validateArtifactPlan(completePlan));

    expect(plan.scope).toBe("project");
    expect(plan.root).toBe("/workspace");
    expect(plan.operations.map((operation) => operation._tag)).toEqual(Array(8).fill("write"));
    expect(plan.receipt._tag).toBe("receiptPublish");
    expect(new Set(plan.receipt.receipt.artifacts.map((artifact) => artifact.kind._tag))).toEqual(
      new Set(["runtime", "skill", "rule", "instruction", "configReference", "settings", "managedConfig"]),
    );
    expect(new Set(plan.receipt.receipt.artifacts.map((artifact) => artifact.ownership._tag))).toEqual(
      new Set(["wholeFile", "managedBlock", "jsonValues", "yamlSequenceValue"]),
    );
    expect(new Set(plan.receipt.receipt.artifacts.map((artifact) => artifact.owner._tag))).toEqual(new Set(["application", "agent"]));
    expect(plan.receipt.target.kind).toEqual({ _tag: "receipt" });
  });

  it.each([
    { name: "plan", input: { ...completePlan, unexpected: true } },
    {
      name: "write operation",
      input: { ...completePlan, operations: [{ ...completePlan.operations[0], unexpected: true }] },
    },
    {
      name: "receipt operation",
      input: { ...completePlan, receipt: { ...completePlan.receipt, unexpected: true } },
    },
    {
      name: "artifact target",
      input: {
        ...completePlan,
        operations: [
          {
            ...completePlan.operations[0],
            artifact: { ...runtimeArtifact, unexpected: true },
          },
        ],
      },
    },
  ])("rejects unknown keys on the $name", ({ input }) => {
    const result = decodePlan(input);

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("is unexpected");
  });

  it.each([
    "../outside",
    "/absolute/path",
    ".claude/../outside",
    "nested\\windows",
  ])("rejects escaping or non-canonical relative path %s", (path) => {
    const result = validateArtifactPlan({
      ...completePlan,
      operations: [write({ ...runtimeArtifact, path })],
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("path");
  });

  it.each(["/workspace", "/", "C:/workspace", "z:/workspace/project"])("accepts canonical cross-platform absolute root %s", (root) => {
    expect(Either.isRight(validateArtifactPlan({ ...completePlan, root }))).toBe(true);
  });

  it.each([
    "C:workspace",
    "C:\\workspace",
    "C://workspace",
    "/workspace//nested",
    "C:/workspace/../outside",
  ])("rejects non-canonical absolute root %s", (root) => {
    const result = validateArtifactPlan({ ...completePlan, root });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("root");
  });

  it("rejects duplicate targets with a property-addressed issue", () => {
    const result = validateArtifactPlan({
      ...completePlan,
      operations: [write(runtimeArtifact), write({ ...runtimeArtifact, kind: { _tag: "managedConfig" } })],
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain('["operations"][1]["artifact"]["path"]');
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("unique");
  });

  it("rejects parent and child targets with property-addressed issues", () => {
    const parent = { ...managedConfigArtifact, path: ".claude/dufflebag" };
    const child = { ...runtimeArtifact, path: ".claude/dufflebag/hooks/contextGuard.js" };
    const result = validateArtifactPlan({ ...completePlan, operations: [write(parent), write(child)] });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain('["operations"][1]["artifact"]["path"]');
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("conflicts with");
  });

  it("rejects case-folded target collisions on common macOS and Windows filesystems", () => {
    const first = { ...runtimeArtifact, path: ".Dufflebag/Hooks/contextGuard.js" };
    const second = { ...managedConfigArtifact, path: ".dufflebag/hooks/CONTEXTGUARD.JS" };
    const result = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(first), remove(second)],
      preconditions: [],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain('["operations"][1]["artifact"]["path"]');
  });

  it.each([
    { name: "runtime owned by an agent", artifact: { ...runtimeArtifact, owner: agentOwner(["codex"]) } },
    { name: "skill owned by the application", artifact: { ...skillArtifact, owner: applicationOwner } },
    { name: "instruction with whole-file ownership", artifact: { ...instructionArtifact, ownership: skillArtifact.ownership } },
    { name: "settings with managed-block ownership", artifact: { ...settingsArtifact, ownership: instructionArtifact.ownership } },
  ])("rejects invalid ownership-kind combination: $name", ({ artifact }) => {
    const result = validateArtifactPlan({ ...completePlan, operations: [write(artifact)] });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("incompatible");
  });

  it.each([
    { name: "empty agent ownership", owner: agentOwner([]) },
    { name: "duplicate agent ownership", owner: agentOwner(["codex", "codex"]) },
  ])("rejects $name", ({ owner }) => {
    const result = validateArtifactPlan({
      ...completePlan,
      operations: [write({ ...instructionArtifact, owner })],
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("agentIds");
  });

  it("rejects receipt owner, kind, and scope inconsistencies", () => {
    const wrongOwner = validateArtifactPlan({
      ...completePlan,
      receipt: { ...completePlan.receipt, target: { ...receiptTarget, owner: agentOwner(["codex"]) } },
    });
    const wrongKind = validateArtifactPlan({
      ...completePlan,
      receipt: { ...completePlan.receipt, target: { ...receiptTarget, kind: { _tag: "runtime" } } },
    });
    const wrongScope = validateArtifactPlan({
      ...completePlan,
      receipt: { ...completePlan.receipt, receipt: { ...desiredReceipt, scope: "global" } },
    });

    expect(Either.isLeft(wrongOwner)).toBe(true);
    expect(Either.isLeft(wrongKind)).toBe(true);
    expect(Either.isLeft(wrongScope)).toBe(true);
  });

  it("requires the canonical receipt.json basename", () => {
    const result = validateArtifactPlan({
      ...completePlan,
      receipt: {
        ...completePlan.receipt,
        target: { ...receiptTarget, path: ".claude/dufflebag/manifest.json" },
      },
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("receipt.json");
  });

  it.each([
    { reservedPath: ".claude/dufflebag/receipt.json", label: "receipt" },
    { reservedPath: ".claude/dufflebag/recovery.json", label: "recovery" },
  ])("rejects an operation conflicting with the reserved $label path", ({ reservedPath }) => {
    const artifact = { ...runtimeArtifact, path: reservedPath };
    const result = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(artifact)],
      preconditions: [],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain('["operations"][0]["artifact"]["path"]');
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain(reservedPath);
  });

  it("rejects a published artifact conflicting with the reserved recovery path", () => {
    const artifact = { ...runtimeArtifact, path: ".claude/dufflebag/recovery.json/snapshot" };
    const result = validateArtifactPlan({
      ...completePlan,
      operations: [write(artifact)],
      receipt: {
        ...completePlan.receipt,
        receipt: { ...desiredReceipt, artifacts: [artifact] },
      },
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain('["receipt"]["receipt"]["artifacts"][0]["path"]');
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("recovery.json");
  });

  it("reserves receipt and recovery paths case-insensitively", () => {
    const artifact = { ...runtimeArtifact, path: ".CLAUDE/DUFFLEBAG/RECOVERY.JSON" };
    const result = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(artifact)],
      preconditions: [],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("recovery.json");
  });

  it("represents receipt publication separately and last", () => {
    const result = decodePlan({
      ...completePlan,
      operations: [...completePlan.operations, completePlan.receipt],
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(completePlan.receipt._tag).toBe("receiptPublish");
  });

  it("accepts byte-backed restoration as a final action absent from the next receipt", () => {
    const result = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [restore(skillArtifact, previousSkillBytes)],
      preconditions: [],
      receipt: {
        _tag: "receiptPublish",
        target: receiptTarget,
        receipt: { ...desiredReceipt, artifacts: [] },
        expectedCurrent: expectedMissing,
      },
    });

    expect(Either.isRight(result)).toBe(true);
  });

  it("requires exact recorded prior bytes for a whole-file restoration", () => {
    const wrongBytes = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [restore(skillArtifact, desiredBytes)],
      preconditions: [],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });
    const originallyMissing = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [restore(runtimeArtifact, desiredBytes)],
      preconditions: [],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });

    expect(Either.isLeft(wrongBytes)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(wrongBytes)))).toContain("recorded prior bytes");
    expect(Either.isLeft(originallyMissing)).toBe(true);
  });

  it("allows deletion only when the receipt proves the whole file or partial host file was originally absent", () => {
    const absentPartialArtifact = {
      ...instructionArtifact,
      ownership: { ...instructionArtifact.ownership, filePreviouslyPresent: false },
    };
    const missingWholeFile = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(runtimeArtifact), remove(absentPartialArtifact)],
      preconditions: [],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });
    const priorWholeFile = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(skillArtifact)],
      preconditions: [],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });
    const priorPartialFile = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(instructionArtifact)],
      preconditions: [],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });

    expect(Either.isRight(missingWholeFile)).toBe(true);
    expect(Either.isLeft(priorWholeFile)).toBe(true);
    expect(Either.isLeft(priorPartialFile)).toBe(true);
  });

  it("rejects partial-host deletion when receipt history proves unowned content must remain", () => {
    const accumulatedJson = {
      ...jsonReferenceArtifact,
      ownership: {
        ...jsonReferenceArtifact.ownership,
        filePreviouslyPresent: false,
      },
    };
    const accumulatedYaml = {
      ...yamlReferenceArtifact,
      ownership: {
        ...yamlReferenceArtifact.ownership,
        filePreviouslyPresent: false,
        previouslyPresent: true,
      },
    };
    const jsonRemoval = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(accumulatedJson)],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });
    const yamlRemoval = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(accumulatedYaml)],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });

    expect(Either.isLeft(jsonRemoval)).toBe(true);
    expect(Either.isLeft(yamlRemoval)).toBe(true);
  });

  it("requires empty materialized unowned bytes before deleting an absent partial host", () => {
    const absentPartialArtifact = {
      ...instructionArtifact,
      ownership: { ...instructionArtifact.ownership, filePreviouslyPresent: false },
    };
    const result = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [{ ...remove(absentPartialArtifact), unownedBytes: desiredBytes }],
      preconditions: [],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("no unowned bytes remain");
  });

  it("restores an originally present partial file even when its final bytes are empty", () => {
    const result = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [restore(instructionArtifact, new Uint8Array())],
      preconditions: [],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });

    expect(Either.isRight(result)).toBe(true);
  });

  it("requires restore and remove actions to be absent from a published receipt", () => {
    const restoredAndPublished = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [restore(skillArtifact, previousSkillBytes)],
      preconditions: [],
      receipt: {
        _tag: "receiptPublish",
        target: receiptTarget,
        receipt: { ...desiredReceipt, artifacts: [skillArtifact] },
        expectedCurrent: expectedMissing,
      },
    });
    const removedAndPublished = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(runtimeArtifact)],
      preconditions: [],
      receipt: {
        _tag: "receiptPublish",
        target: receiptTarget,
        receipt: { ...desiredReceipt, artifacts: [runtimeArtifact] },
        expectedCurrent: expectedMissing,
      },
    });

    expect(Either.isLeft(restoredAndPublished)).toBe(true);
    expect(Either.isLeft(removedAndPublished)).toBe(true);
  });

  it("requires written artifact metadata to exactly match the published receipt", () => {
    const mismatchedArtifact = {
      ...runtimeArtifact,
      ownership: { ...runtimeArtifact.ownership, installedHash: newHash },
    };
    const result = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [write(mismatchedArtifact)],
      preconditions: [],
      receipt: {
        _tag: "receiptPublish",
        target: receiptTarget,
        receipt: { ...desiredReceipt, artifacts: [runtimeArtifact] },
        expectedCurrent: expectedMissing,
      },
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("exactly match");
  });

  it("forbids normal desired writes in a receipt-removal plan", () => {
    const result = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [write(runtimeArtifact)],
      preconditions: [],
      receipt: { _tag: "remove", target: receiptTarget, expectedCurrent: expectedMissing },
    });

    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("createUpdatePlan", () => {
  it("rejects desired receipt artifacts that have no one-to-one desired write", () => {
    const result = createUpdatePlan({
      root: "/workspace",
      previous: { _tag: "missing" },
      restorations: [],
      desired: {
        receipt: { ...desiredReceipt, artifacts: [runtimeArtifact, skillArtifact] },
        writes: [write(runtimeArtifact)],
      },
      receiptTarget,
      receiptExpectedCurrent: expectedMissing,
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain(
      "Every desired receipt artifact must have exactly one desired write",
    );
  });

  it("rejects duplicate, extra, and metadata-mismatched desired writes", () => {
    const mismatchedArtifact = {
      ...runtimeArtifact,
      ownership: { ...runtimeArtifact.ownership, installedHash: newHash },
    };
    const request = {
      root: "/workspace",
      previous: { _tag: "missing" },
      restorations: [],
      desired: {
        receipt: { ...desiredReceipt, artifacts: [runtimeArtifact] },
        writes: [write(runtimeArtifact)],
      },
      receiptTarget,
      receiptExpectedCurrent: expectedMissing,
    };
    const duplicate = createUpdatePlan({
      ...request,
      desired: { ...request.desired, writes: [write(runtimeArtifact), write(runtimeArtifact)] },
    });
    const extra = createUpdatePlan({
      ...request,
      desired: { ...request.desired, writes: [write(runtimeArtifact), write(skillArtifact)] },
    });
    const metadataMismatch = createUpdatePlan({
      ...request,
      desired: { ...request.desired, writes: [write(mismatchedArtifact)] },
    });

    expect(Either.isLeft(duplicate)).toBe(true);
    expect(Either.isLeft(extra)).toBe(true);
    expect(Either.isLeft(metadataMismatch)).toBe(true);
  });

  it("adds, changes, removes only receipt-owned stale entries, omits unchanged state, and preserves restoration metadata", () => {
    const unchanged = runtimeArtifact;
    const stale = { ...ruleArtifact, path: ".cursor/rules/removed.mdc" };
    const previousChanged = skillArtifact;
    const desiredChanged = {
      ...skillArtifact,
      ownership: { _tag: "wholeFile", installedHash: newHash, previous: missingPrevious },
    };
    const added = managedConfigArtifact;
    const previousReceipt = {
      version: "0.11.0",
      scope: "project",
      features: ["context-guard"],
      artifacts: [unchanged, previousChanged, stale],
    };
    const nextReceipt = {
      version: "0.12.0",
      scope: "project",
      features: ["context-guard", "autonomous-loop"],
      artifacts: [unchanged, desiredChanged, added],
    };

    const plan = unwrap(
      createUpdatePlan({
        root: "/workspace",
        previous: { _tag: "receipt", receipt: previousReceipt },
        restorations: [remove(stale)],
        desired: {
          receipt: nextReceipt,
          writes: [write(unchanged), write(desiredChanged, newSkillBytes), write(added, newConfigBytes)],
        },
        receiptTarget,
        receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
      }),
    );

    expect(plan.operations).toEqual([
      remove(stale),
      write(
        {
          ...desiredChanged,
          ownership: { ...desiredChanged.ownership, previous: previousChanged.ownership.previous },
        },
        newSkillBytes,
      ),
      write(added, newConfigBytes),
    ]);
    expect(plan.receipt).toEqual({
      _tag: "receiptPublish",
      target: receiptTarget,
      expectedCurrent: { _tag: "file", sha256: oldHash },
      receipt: {
        ...nextReceipt,
        artifacts: [
          unchanged,
          {
            ...desiredChanged,
            ownership: { ...desiredChanged.ownership, previous: previousChanged.ownership.previous },
          },
          added,
        ],
      },
    });
    expect(plan.preconditions).toEqual([{ path: unchanged.path, expectedCurrent: expectedMissing }]);
    expect(plan.operations.some((operation) => operation.artifact.path === unchanged.path)).toBe(false);
  });

  it("requires one exact restoration per stale prior entry and emits them in reverse receipt order", () => {
    const previousReceipt = { ...desiredReceipt, artifacts: [runtimeArtifact, skillArtifact] };
    const desired = {
      receipt: { ...desiredReceipt, artifacts: [] },
      writes: [],
    };
    const expectedRestorations = [restore(skillArtifact, previousSkillBytes), remove(runtimeArtifact)];
    const missing = createUpdatePlan({
      root: "/workspace",
      previous: { _tag: "receipt", receipt: previousReceipt },
      restorations: [remove(runtimeArtifact)],
      desired,
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });
    const shuffled = createUpdatePlan({
      root: "/workspace",
      previous: { _tag: "receipt", receipt: previousReceipt },
      restorations: [...expectedRestorations].reverse(),
      desired,
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });
    const extra = createUpdatePlan({
      root: "/workspace",
      previous: { _tag: "receipt", receipt: previousReceipt },
      restorations: [...expectedRestorations, remove(ruleArtifact)],
      desired,
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });
    const duplicate = createUpdatePlan({
      root: "/workspace",
      previous: { _tag: "receipt", receipt: previousReceipt },
      restorations: [restore(skillArtifact, previousSkillBytes), restore(skillArtifact, previousSkillBytes)],
      desired,
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });
    const mismatchedArtifact = {
      ...skillArtifact,
      ownership: { ...skillArtifact.ownership, installedHash: newHash },
    };
    const metadataMismatch = createUpdatePlan({
      root: "/workspace",
      previous: { _tag: "receipt", receipt: previousReceipt },
      restorations: [restore(mismatchedArtifact, previousSkillBytes), remove(runtimeArtifact)],
      desired,
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });

    expect(Either.isLeft(missing)).toBe(true);
    expect(Either.isLeft(extra)).toBe(true);
    expect(Either.isLeft(duplicate)).toBe(true);
    expect(Either.isLeft(metadataMismatch)).toBe(true);
    expect(unwrap(shuffled).operations).toEqual(expectedRestorations);
  });

  it("publishes deterministically from missing prior state without inventing removes", () => {
    const request = {
      root: "/workspace",
      previous: { _tag: "missing" },
      restorations: [],
      desired: { receipt: desiredReceipt, writes: desiredArtifacts.map((artifact) => write(artifact)) },
      receiptTarget,
      receiptExpectedCurrent: expectedMissing,
    };

    const first = unwrap(createUpdatePlan(request));
    const second = unwrap(createUpdatePlan(request));

    expect(second).toEqual(first);
    expect(first.operations.every((operation) => operation._tag === "write")).toBe(true);
  });

  it("does not reuse YAML restoration state when the owned key-reference pair changes", () => {
    const previousYaml = {
      ...yamlReferenceArtifact,
      ownership: { ...yamlReferenceArtifact.ownership, previouslyPresent: true },
    };
    const desiredYaml = {
      ...yamlReferenceArtifact,
      ownership: {
        ...yamlReferenceArtifact.ownership,
        filePreviouslyPresent: false,
        reference: "DUFFLEBAG.md",
        previouslyPresent: false,
      },
    };
    const preservedYaml = {
      ...desiredYaml,
      ownership: { ...desiredYaml.ownership, filePreviouslyPresent: true },
    };
    const result = createUpdatePlan({
      root: "/workspace",
      previous: {
        _tag: "receipt",
        receipt: { ...desiredReceipt, artifacts: [previousYaml] },
      },
      restorations: [],
      desired: {
        receipt: { ...desiredReceipt, artifacts: [desiredYaml] },
        writes: [write(desiredYaml)],
      },
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });
    const plan = unwrap(result);

    expect(plan.operations).toEqual([write(preservedYaml)]);
    expect(plan.receipt).toEqual({
      _tag: "receiptPublish",
      target: receiptTarget,
      receipt: { ...desiredReceipt, artifacts: [preservedYaml] },
      expectedCurrent: { _tag: "file", sha256: oldHash },
    });
  });

  it("preserves original file absence while retaining previous values acquired by later JSON ownership", () => {
    const previousArtifact = {
      ...jsonReferenceArtifact,
      ownership: {
        ...jsonReferenceArtifact.ownership,
        filePreviouslyPresent: false,
        createdContainers: [],
        values: [
          {
            pointer: "/rules/0",
            installed: { _tag: "value", hash: oldHash },
            previous: missingPrevious,
          },
        ],
      },
    };
    const desiredArtifact = {
      ...jsonReferenceArtifact,
      ownership: {
        ...jsonReferenceArtifact.ownership,
        filePreviouslyPresent: true,
        createdContainers: [],
        values: [
          {
            pointer: "/rules/0",
            installed: { _tag: "value", hash: newHash },
            previous: { _tag: "value", value: "installed-rule.md" },
          },
          {
            pointer: "/rules/1",
            installed: { _tag: "value", hash: newHash },
            previous: { _tag: "value", value: "user-rule.md" },
          },
        ],
      },
    };
    const expectedArtifact = {
      ...desiredArtifact,
      ownership: {
        ...desiredArtifact.ownership,
        filePreviouslyPresent: false,
        values: [{ ...desiredArtifact.ownership.values[0], previous: missingPrevious }, desiredArtifact.ownership.values[1]],
      },
    };
    const plan = unwrap(
      createUpdatePlan({
        root: "/workspace",
        previous: {
          _tag: "receipt",
          receipt: { ...desiredReceipt, artifacts: [previousArtifact] },
        },
        restorations: [],
        desired: {
          receipt: { ...desiredReceipt, artifacts: [desiredArtifact] },
          writes: [write(desiredArtifact)],
        },
        receiptTarget,
        receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
      }),
    );

    expect(plan.operations).toEqual([write(expectedArtifact)]);
    expect(plan.receipt).toEqual({
      _tag: "receiptPublish",
      target: receiptTarget,
      receipt: { ...desiredReceipt, artifacts: [expectedArtifact] },
      expectedCurrent: { _tag: "file", sha256: oldHash },
    });
  });

  it("preserves prior created JSON containers while adding newly created ancestors", () => {
    const previousArtifact = {
      ...settingsArtifact,
      ownership: {
        _tag: "jsonValues",
        filePreviouslyPresent: false,
        createdContainers: ["/hooks"],
        values: [
          {
            pointer: "/hooks/Stop",
            installed: { _tag: "value", hash: oldHash },
            previous: missingPrevious,
          },
        ],
      },
    };
    const desiredArtifact = {
      ...settingsArtifact,
      ownership: {
        _tag: "jsonValues",
        filePreviouslyPresent: true,
        createdContainers: ["/permissions"],
        values: [
          {
            pointer: "/hooks/Stop",
            installed: { _tag: "value", hash: oldHash },
            previous: { _tag: "value", value: [], lexical: { _tag: "value", source: "[]" } },
          },
          {
            pointer: "/permissions/allow",
            installed: { _tag: "value", hash: newHash },
            previous: missingPrevious,
          },
        ],
      },
    };
    const plan = unwrap(
      createUpdatePlan({
        root: "/workspace",
        previous: {
          _tag: "receipt",
          receipt: { ...desiredReceipt, artifacts: [previousArtifact] },
        },
        restorations: [],
        desired: {
          receipt: { ...desiredReceipt, artifacts: [desiredArtifact] },
          writes: [write(desiredArtifact)],
        },
        receiptTarget,
        receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
      }),
    );

    expect(plan.receipt).toMatchObject({
      _tag: "receiptPublish",
      receipt: {
        artifacts: [
          {
            ownership: {
              createdContainers: ["/hooks", "/permissions"],
              values: [
                { installed: { _tag: "value", hash: oldHash }, previous: missingPrevious },
                { installed: { _tag: "value", hash: newHash }, previous: missingPrevious },
              ],
            },
          },
        ],
      },
    });
  });

  it("rejects acquiring JSON container deletion authority without a new owned pointer", () => {
    const previousArtifact = {
      ...settingsArtifact,
      ownership: {
        ...settingsArtifact.ownership,
        createdContainers: [],
      },
    };
    const desiredArtifact = {
      ...settingsArtifact,
      ownership: {
        ...settingsArtifact.ownership,
        createdContainers: ["/hooks"],
      },
    };
    const result = createUpdatePlan({
      root: "/workspace",
      previous: {
        _tag: "receipt",
        receipt: { ...desiredReceipt, artifacts: [previousArtifact] },
      },
      restorations: [],
      desired: {
        receipt: { ...desiredReceipt, artifacts: [desiredArtifact] },
        writes: [write(desiredArtifact)],
      },
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("preserves an unchanged installed-missing JSON value without another write", () => {
    const previousArtifact = {
      ...settingsArtifact,
      ownership: {
        _tag: "jsonValues",
        filePreviouslyPresent: true,
        createdContainers: [],
        values: [
          {
            pointer: "/env/DUFFLEBAG_CONFIG",
            installed: { _tag: "missing" },
            previous: {
              _tag: "value",
              value: "/legacy/config.json",
              lexical: {
                _tag: "onlyProperty",
                prefix: "",
                property: '"DUFFLEBAG_CONFIG":"/legacy/config.json"',
                suffix: "",
              },
            },
          },
        ],
      },
    };
    const desiredArtifact = {
      ...previousArtifact,
      ownership: {
        ...previousArtifact.ownership,
        values: previousArtifact.ownership.values.map((value) => ({
          ...value,
          previous: {
            _tag: "value",
            value: "/wrong/new-history.json",
            lexical: {
              _tag: "onlyProperty",
              prefix: "",
              property: '"DUFFLEBAG_CONFIG":"/wrong/new-history.json"',
              suffix: "",
            },
          },
        })),
      },
    };
    const plan = unwrap(
      createUpdatePlan({
        root: "/workspace",
        previous: {
          _tag: "receipt",
          receipt: { ...desiredReceipt, artifacts: [previousArtifact] },
        },
        restorations: [],
        desired: {
          receipt: { ...desiredReceipt, artifacts: [desiredArtifact] },
          writes: [write(desiredArtifact)],
        },
        receiptTarget,
        receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
      }),
    );

    expect(plan.operations).toEqual([]);
    expect(plan.receipt).toMatchObject({
      _tag: "receiptPublish",
      receipt: {
        artifacts: [previousArtifact],
      },
    });
  });

  it("preserves retained managed-block and YAML restoration history", () => {
    const previousInstruction = {
      ...instructionArtifact,
      ownership: { ...instructionArtifact.ownership, filePreviouslyPresent: true },
    };
    const desiredInstruction = {
      ...instructionArtifact,
      ownership: {
        ...instructionArtifact.ownership,
        filePreviouslyPresent: false,
        installedBodyHash: newHash,
      },
    };
    const expectedInstruction = {
      ...desiredInstruction,
      ownership: { ...desiredInstruction.ownership, filePreviouslyPresent: true },
    };
    const previousYaml = {
      ...yamlReferenceArtifact,
      ownership: {
        ...yamlReferenceArtifact.ownership,
        keyPreviouslyPresent: false,
        insertedPrefix: "\n",
      },
    };
    const desiredYaml = {
      ...yamlReferenceArtifact,
      ownership: {
        ...yamlReferenceArtifact.ownership,
        filePreviouslyPresent: false,
      },
    };
    const expectedYaml = {
      ...desiredYaml,
      ownership: {
        ...desiredYaml.ownership,
        filePreviouslyPresent: true,
        keyPreviouslyPresent: false,
        insertedPrefix: "\n",
      },
    };
    const plan = unwrap(
      createUpdatePlan({
        root: "/workspace",
        previous: {
          _tag: "receipt",
          receipt: { ...desiredReceipt, artifacts: [previousInstruction, previousYaml] },
        },
        restorations: [],
        desired: {
          receipt: { ...desiredReceipt, artifacts: [desiredInstruction, desiredYaml] },
          writes: [write(desiredInstruction), write(desiredYaml)],
        },
        receiptTarget,
        receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
      }),
    );

    expect(plan.operations).toEqual([write(expectedInstruction)]);
    expect(plan.receipt).toEqual({
      _tag: "receiptPublish",
      target: receiptTarget,
      receipt: { ...desiredReceipt, artifacts: [expectedInstruction, expectedYaml] },
      expectedCurrent: { _tag: "file", sha256: oldHash },
    });
  });

  it("rejects changing the ownership tag for an already receipted path", () => {
    const desiredArtifact = {
      ...jsonReferenceArtifact,
      ownership: {
        ...yamlReferenceArtifact.ownership,
        reference: "DUFFLEBAG.md",
      },
    };
    const result = createUpdatePlan({
      root: "/workspace",
      previous: {
        _tag: "receipt",
        receipt: { ...desiredReceipt, artifacts: [jsonReferenceArtifact] },
      },
      restorations: [],
      desired: {
        receipt: { ...desiredReceipt, artifacts: [desiredArtifact] },
        writes: [write(desiredArtifact)],
      },
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain('["desired"]["receipt"]["artifacts"][0]["ownership"]["_tag"]');
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("remove the prior ownership first");
  });

  it("rejects changing the artifact kind or owner at a retained path", () => {
    const desiredArtifact = {
      ...settingsArtifact,
      path: jsonReferenceArtifact.path,
    };
    const result = createUpdatePlan({
      root: "/workspace",
      previous: {
        _tag: "receipt",
        receipt: { ...desiredReceipt, artifacts: [jsonReferenceArtifact] },
      },
      restorations: [],
      desired: {
        receipt: { ...desiredReceipt, artifacts: [desiredArtifact] },
        writes: [write(desiredArtifact)],
      },
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain('artifacts"][0]["kind"]');
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("remove the prior ownership first");
  });
});

describe("createUninstallPlan", () => {
  it("uses exact reverse-order final restorations from receipt entries and removes the receipt last", () => {
    const receipt = { ...desiredReceipt, artifacts: [runtimeArtifact, skillArtifact, instructionArtifact] };
    const restorations = [
      restore(instructionArtifact, previousInstructionBytes),
      restore(skillArtifact, previousSkillBytes),
      remove(runtimeArtifact),
    ];
    const plan = unwrap(
      createUninstallPlan({
        root: "/workspace",
        receipt,
        restorations,
        receiptTarget,
        receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
      }),
    );

    expect(plan.operations).toEqual(restorations);
    expect(plan.receipt).toEqual({
      _tag: "remove",
      target: receiptTarget,
      expectedCurrent: { _tag: "file", sha256: oldHash },
    });
  });

  it("orders a valid restoration set and rejects missing, duplicate, or non-receipted actions", () => {
    const receipt = { ...desiredReceipt, artifacts: [runtimeArtifact, skillArtifact] };
    const expectedRestorations = [restore(skillArtifact, previousSkillBytes), remove(runtimeArtifact)];
    const missing = createUninstallPlan({
      root: "/workspace",
      receipt,
      restorations: [remove(runtimeArtifact)],
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });
    const shuffled = createUninstallPlan({
      root: "/workspace",
      receipt,
      restorations: [...expectedRestorations].reverse(),
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });
    const extra = createUninstallPlan({
      root: "/workspace",
      receipt,
      restorations: [...expectedRestorations, remove(ruleArtifact)],
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });
    const duplicate = createUninstallPlan({
      root: "/workspace",
      receipt,
      restorations: [restore(skillArtifact, previousSkillBytes), restore(skillArtifact, previousSkillBytes)],
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });
    const mismatchedArtifact = {
      ...skillArtifact,
      ownership: { ...skillArtifact.ownership, installedHash: newHash },
    };
    const metadataMismatch = createUninstallPlan({
      root: "/workspace",
      receipt,
      restorations: [restore(mismatchedArtifact, previousSkillBytes), remove(runtimeArtifact)],
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
    });

    expect(Either.isLeft(missing)).toBe(true);
    expect(Either.isLeft(extra)).toBe(true);
    expect(Either.isLeft(duplicate)).toBe(true);
    expect(Either.isLeft(metadataMismatch)).toBe(true);
    expect(unwrap(shuffled).operations).toEqual(expectedRestorations);
  });

  it("rejects detection evidence and proves it cannot authorize a remove", () => {
    const receipt = { ...desiredReceipt, artifacts: [runtimeArtifact] };
    const result = createUninstallPlan({
      root: "/workspace",
      receipt,
      restorations: [remove(runtimeArtifact)],
      receiptTarget,
      receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
      detection: { homePaths: [".cursor"], absolutePaths: [], commands: ["cursor"] },
    });
    const plan = unwrap(
      createUninstallPlan({
        root: "/workspace",
        receipt,
        restorations: [remove(runtimeArtifact)],
        receiptTarget,
        receiptExpectedCurrent: { _tag: "file", sha256: oldHash },
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    expect(plan.operations).toEqual([remove(runtimeArtifact)]);
  });
});

describe("migrateLegacyManifest", () => {
  const legacyManifest = {
    version: "0.11.0",
    scope: "project",
    features: ["context-guard"],
    skills: ["autorun"],
    installedAt: "2026-07-14T00:00:00.000Z",
  };

  const knownArtifacts = [
    { recordedBy: { _tag: "feature", id: "context-guard" }, write: write(runtimeArtifact) },
    { recordedBy: { _tag: "feature", id: "dedup-guard" }, write: write(settingsArtifact) },
    { recordedBy: { _tag: "skill", id: "autorun" }, write: write(skillArtifact) },
    { recordedBy: { _tag: "skill", id: "planpage" }, write: write(ruleArtifact) },
  ];

  it("authorizes only known artifacts named by the strict legacy manifest and drops installedAt", () => {
    const plan = unwrap(
      migrateLegacyManifest({
        root: "/workspace",
        manifest: legacyManifest,
        knownArtifacts,
        receiptTarget,
        receiptExpectedCurrent: expectedMissing,
      }),
    );

    expect(plan.operations.map((operation) => operation.artifact.path)).toEqual([runtimeArtifact.path, skillArtifact.path]);
    expect(plan.operations.every((operation) => operation._tag === "write")).toBe(true);
    expect(plan.receipt._tag).toBe("receiptPublish");
    if (plan.receipt._tag === "receiptPublish") {
      expect(plan.receipt.expectedCurrent).toEqual(expectedMissing);
      expect(plan.receipt.receipt).toEqual({
        version: "0.11.0",
        scope: "project",
        features: ["context-guard"],
        artifacts: [runtimeArtifact, skillArtifact],
      });
      expect("installedAt" in plan.receipt.receipt).toBe(false);
    }
  });

  it.each([
    { name: "missing installedAt", manifest: { ...legacyManifest, installedAt: undefined } },
    { name: "unknown legacy key", manifest: { ...legacyManifest, detectedAgents: ["cursor"] } },
    { name: "duplicate feature IDs", manifest: { ...legacyManifest, features: ["context-guard", "context-guard"] } },
  ])("rejects an invalid legacy manifest with $name", ({ manifest }) => {
    const result = migrateLegacyManifest({
      root: "/workspace",
      manifest,
      knownArtifacts,
      receiptTarget,
      receiptExpectedCurrent: expectedMissing,
    });

    expect(Either.isLeft(result)).toBe(true);
  });
});
