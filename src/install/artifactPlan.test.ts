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
    values: [
      {
        pointer: "/rules/0",
        installedValueHash: oldHash,
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
    values: [
      {
        pointer: "/hooks/Stop",
        installedValueHash: oldHash,
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
});

const restore = (artifact: object, bytes: Uint8Array) => ({
  _tag: "restore",
  artifact,
  bytes,
});

const remove = (artifact: object) => ({ _tag: "remove", artifact, unownedBytes: noUnownedBytes });

const completePlan = {
  scope: "project",
  root: "/workspace",
  operations: desiredArtifacts.map((artifact) => write(artifact)),
  receipt: {
    _tag: "receiptPublish",
    target: receiptTarget,
    receipt: desiredReceipt,
  },
};

const decodePlan = (input: unknown) =>
  Schema.validateEither(artifactPlanSchema, {
    onExcessProperty: "error",
  })(input);

const unwrap = <Right, Left>(result: Either.Either<Right, Left>): Right =>
  Either.getOrThrowWith(result, (error) => new Error(String(error)));

describe("artifactPlanSchema", () => {
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
      receipt: { _tag: "remove", target: receiptTarget },
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
      receipt: { _tag: "remove", target: receiptTarget },
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
      receipt: { _tag: "remove", target: receiptTarget },
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
      receipt: {
        _tag: "receiptPublish",
        target: receiptTarget,
        receipt: { ...desiredReceipt, artifacts: [] },
      },
    });

    expect(Either.isRight(result)).toBe(true);
  });

  it("requires exact recorded prior bytes for a whole-file restoration", () => {
    const wrongBytes = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [restore(skillArtifact, desiredBytes)],
      receipt: { _tag: "remove", target: receiptTarget },
    });
    const originallyMissing = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [restore(runtimeArtifact, desiredBytes)],
      receipt: { _tag: "remove", target: receiptTarget },
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
      receipt: { _tag: "remove", target: receiptTarget },
    });
    const priorWholeFile = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(skillArtifact)],
      receipt: { _tag: "remove", target: receiptTarget },
    });
    const priorPartialFile = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(instructionArtifact)],
      receipt: { _tag: "remove", target: receiptTarget },
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
      receipt: { _tag: "remove", target: receiptTarget },
    });
    const yamlRemoval = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(accumulatedYaml)],
      receipt: { _tag: "remove", target: receiptTarget },
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
      receipt: { _tag: "remove", target: receiptTarget },
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain("no unowned bytes remain");
  });

  it("restores an originally present partial file even when its final bytes are empty", () => {
    const result = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [restore(instructionArtifact, new Uint8Array())],
      receipt: { _tag: "remove", target: receiptTarget },
    });

    expect(Either.isRight(result)).toBe(true);
  });

  it("requires restore and remove actions to be absent from a published receipt", () => {
    const restoredAndPublished = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [restore(skillArtifact, previousSkillBytes)],
      receipt: {
        _tag: "receiptPublish",
        target: receiptTarget,
        receipt: { ...desiredReceipt, artifacts: [skillArtifact] },
      },
    });
    const removedAndPublished = validateArtifactPlan({
      scope: "project",
      root: "/workspace",
      operations: [remove(runtimeArtifact)],
      receipt: {
        _tag: "receiptPublish",
        target: receiptTarget,
        receipt: { ...desiredReceipt, artifacts: [runtimeArtifact] },
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
      receipt: {
        _tag: "receiptPublish",
        target: receiptTarget,
        receipt: { ...desiredReceipt, artifacts: [runtimeArtifact] },
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
      receipt: { _tag: "remove", target: receiptTarget },
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
    });
    const shuffled = createUpdatePlan({
      root: "/workspace",
      previous: { _tag: "receipt", receipt: previousReceipt },
      restorations: [...expectedRestorations].reverse(),
      desired,
      receiptTarget,
    });
    const extra = createUpdatePlan({
      root: "/workspace",
      previous: { _tag: "receipt", receipt: previousReceipt },
      restorations: [...expectedRestorations, remove(ruleArtifact)],
      desired,
      receiptTarget,
    });
    const duplicate = createUpdatePlan({
      root: "/workspace",
      previous: { _tag: "receipt", receipt: previousReceipt },
      restorations: [restore(skillArtifact, previousSkillBytes), restore(skillArtifact, previousSkillBytes)],
      desired,
      receiptTarget,
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
    });
    const plan = unwrap(result);

    expect(plan.operations).toEqual([write(preservedYaml)]);
    expect(plan.receipt).toEqual({
      _tag: "receiptPublish",
      target: receiptTarget,
      receipt: { ...desiredReceipt, artifacts: [preservedYaml] },
    });
  });

  it("preserves original file absence while retaining previous values acquired by later JSON ownership", () => {
    const previousArtifact = {
      ...jsonReferenceArtifact,
      ownership: {
        ...jsonReferenceArtifact.ownership,
        filePreviouslyPresent: false,
        values: [
          {
            pointer: "/rules/0",
            installedValueHash: oldHash,
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
        values: [
          {
            pointer: "/rules/0",
            installedValueHash: newHash,
            previous: { _tag: "value", value: "installed-rule.md" },
          },
          {
            pointer: "/rules/1",
            installedValueHash: newHash,
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
      }),
    );

    expect(plan.operations).toEqual([write(expectedArtifact)]);
    expect(plan.receipt).toEqual({
      _tag: "receiptPublish",
      target: receiptTarget,
      receipt: { ...desiredReceipt, artifacts: [expectedArtifact] },
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
      }),
    );

    expect(plan.operations).toEqual([write(expectedInstruction)]);
    expect(plan.receipt).toEqual({
      _tag: "receiptPublish",
      target: receiptTarget,
      receipt: { ...desiredReceipt, artifacts: [expectedInstruction, expectedYaml] },
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
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain('["desired"]["receipt"]["artifacts"][0]["ownership"]["_tag"]');
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
    const plan = unwrap(createUninstallPlan({ root: "/workspace", receipt, restorations, receiptTarget }));

    expect(plan.operations).toEqual(restorations);
    expect(plan.receipt).toEqual({ _tag: "remove", target: receiptTarget });
  });

  it("orders a valid restoration set and rejects missing, duplicate, or non-receipted actions", () => {
    const receipt = { ...desiredReceipt, artifacts: [runtimeArtifact, skillArtifact] };
    const expectedRestorations = [restore(skillArtifact, previousSkillBytes), remove(runtimeArtifact)];
    const missing = createUninstallPlan({
      root: "/workspace",
      receipt,
      restorations: [remove(runtimeArtifact)],
      receiptTarget,
    });
    const shuffled = createUninstallPlan({
      root: "/workspace",
      receipt,
      restorations: [...expectedRestorations].reverse(),
      receiptTarget,
    });
    const extra = createUninstallPlan({
      root: "/workspace",
      receipt,
      restorations: [...expectedRestorations, remove(ruleArtifact)],
      receiptTarget,
    });
    const duplicate = createUninstallPlan({
      root: "/workspace",
      receipt,
      restorations: [restore(skillArtifact, previousSkillBytes), restore(skillArtifact, previousSkillBytes)],
      receiptTarget,
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
      detection: { homePaths: [".cursor"], absolutePaths: [], commands: ["cursor"] },
    });
    const plan = unwrap(createUninstallPlan({ root: "/workspace", receipt, restorations: [remove(runtimeArtifact)], receiptTarget }));

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
      }),
    );

    expect(plan.operations.map((operation) => operation.artifact.path)).toEqual([runtimeArtifact.path, skillArtifact.path]);
    expect(plan.operations.every((operation) => operation._tag === "write")).toBe(true);
    expect(plan.receipt._tag).toBe("receiptPublish");
    if (plan.receipt._tag === "receiptPublish") {
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
    const result = migrateLegacyManifest({ root: "/workspace", manifest, knownArtifacts, receiptTarget });

    expect(Either.isLeft(result)).toBe(true);
  });
});
