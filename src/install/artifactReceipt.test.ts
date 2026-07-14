import { Effect, Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type ArtifactReceipt,
  artifactKindSchema,
  artifactOwnerSchema,
  artifactReceiptJsonSchema,
  artifactReceiptSchema,
  decodeArtifactReceiptJson,
  jsonPointerSchema,
  jsonValuesOwnershipSchema,
  legacyManifestSchema,
  managedBlockOwnershipSchema,
  previousFileValueSchema,
  previousJsonValueSchema,
  type ReceiptEntry,
  receiptEntrySchema,
  relativeArtifactPathSchema,
  sha256Schema,
  yamlSequenceValueOwnershipSchema,
} from "./artifactReceipt.js";

const installedHash = "a".repeat(64);
const installedValueHash = "b".repeat(64);

const missingPreviousFile = { _tag: "missing" };
const missingPreviousJson = { _tag: "missing" };
const applicationOwner = { _tag: "application" };
const agentOwner = { _tag: "agent", agentIds: ["codex"] };
const sharedAgentOwner = { _tag: "agent", agentIds: ["codex", "aider"] };

const wholeFileOwnership = {
  _tag: "wholeFile",
  installedHash,
  previous: missingPreviousFile,
};

const managedBlockOwnership = {
  _tag: "managedBlock",
  filePreviouslyPresent: true,
  startMarker: "<!-- dufflebag:start -->",
  endMarker: "<!-- dufflebag:end -->",
  installedBodyHash: installedHash,
};

const jsonValuesOwnership = {
  _tag: "jsonValues",
  filePreviouslyPresent: true,
  values: [
    {
      pointer: "/hooks/PreToolUse",
      installedValueHash,
      previous: missingPreviousJson,
    },
    {
      pointer: "/enabled",
      installedValueHash: installedHash,
      previous: { _tag: "value", value: false },
    },
  ],
};

const yamlSequenceOwnership = {
  _tag: "yamlSequenceValue",
  filePreviouslyPresent: true,
  key: "read",
  reference: "AGENTS.md",
  previouslyPresent: false,
};

const completeReceiptInput = {
  version: "1.0.0",
  scope: "project",
  features: ["context-guard", "autonomous-loop"],
  artifacts: [
    {
      owner: applicationOwner,
      path: ".dufflebag/runtime/contextGuard.js",
      kind: { _tag: "runtime" },
      ownership: {
        _tag: "wholeFile",
        installedHash,
        previous: { _tag: "priorFile", bytes: "AQID" },
      },
    },
    {
      owner: agentOwner,
      path: ".claude/skills/autorun/SKILL.md",
      kind: { _tag: "skill" },
      ownership: wholeFileOwnership,
    },
    {
      owner: agentOwner,
      path: ".cursor/rules/autorun.mdc",
      kind: { _tag: "rule" },
      ownership: wholeFileOwnership,
    },
    {
      owner: sharedAgentOwner,
      path: "AGENTS.md",
      kind: { _tag: "instruction" },
      ownership: managedBlockOwnership,
    },
    {
      owner: agentOwner,
      path: ".continue/config.json",
      kind: { _tag: "configReference" },
      ownership: jsonValuesOwnership,
    },
    {
      owner: agentOwner,
      path: ".aider.conf.yml",
      kind: { _tag: "configReference" },
      ownership: yamlSequenceOwnership,
    },
    {
      owner: applicationOwner,
      path: ".claude/settings.json",
      kind: { _tag: "settings" },
      ownership: jsonValuesOwnership,
    },
    {
      owner: applicationOwner,
      path: ".dufflebag/config.json",
      kind: { _tag: "managedConfig" },
      ownership: wholeFileOwnership,
    },
  ],
};

const decodeReceipt = Schema.decodeUnknownSync(artifactReceiptSchema, {
  onExcessProperty: "error",
});
const decodeReceiptJson = (input: unknown) => Effect.runSync(decodeArtifactReceiptJson(input));
const decodeEntry = Schema.decodeUnknownSync(receiptEntrySchema, {
  onExcessProperty: "error",
});
const decodeOwner = Schema.decodeUnknownSync(artifactOwnerSchema, {
  onExcessProperty: "error",
});
const decodeKind = Schema.decodeUnknownSync(artifactKindSchema, {
  onExcessProperty: "error",
});
const decodePreviousFile = Schema.decodeUnknownSync(previousFileValueSchema, {
  onExcessProperty: "error",
});
const decodePreviousJson = Schema.decodeUnknownSync(previousJsonValueSchema, {
  onExcessProperty: "error",
});
const decodeJsonValues = Schema.decodeUnknownSync(jsonValuesOwnershipSchema, {
  onExcessProperty: "error",
});
const decodeManagedBlock = Schema.decodeUnknownSync(managedBlockOwnershipSchema, {
  onExcessProperty: "error",
});
const decodeYamlSequenceValue = Schema.decodeUnknownSync(yamlSequenceValueOwnershipSchema, {
  onExcessProperty: "error",
});
const decodeLegacyManifest = Schema.decodeUnknownSync(legacyManifestSchema, {
  onExcessProperty: "error",
});

const receiptWithArtifacts = (artifacts: ReadonlyArray<unknown>) => ({
  version: "1.0.0",
  scope: "project",
  features: ["context-guard"],
  artifacts,
});

describe("artifactReceiptSchema", () => {
  it("decodes every receiptable artifact kind and all ownership tags", () => {
    const receipt = decodeReceipt(completeReceiptInput);

    expect(receipt.artifacts.map((artifact) => artifact.kind._tag)).toEqual([
      "runtime",
      "skill",
      "rule",
      "instruction",
      "configReference",
      "configReference",
      "settings",
      "managedConfig",
    ]);
    expect(receipt.artifacts.map((artifact) => artifact.ownership._tag)).toEqual([
      "wholeFile",
      "wholeFile",
      "wholeFile",
      "managedBlock",
      "jsonValues",
      "yamlSequenceValue",
      "jsonValues",
      "wholeFile",
    ]);
    expect(receipt.artifacts[0]?.ownership).toMatchObject({
      _tag: "wholeFile",
      previous: { _tag: "priorFile", bytes: new Uint8Array([1, 2, 3]) },
    });
    expectTypeOf(receipt).toMatchTypeOf<ArtifactReceipt>();
    expectTypeOf(receipt.artifacts).items.toMatchTypeOf<ReceiptEntry>();
  });

  it("decodes all eight tagged artifact kinds while preventing receipt self-ownership", () => {
    const kindTags = ["runtime", "skill", "rule", "instruction", "configReference", "settings", "managedConfig", "receipt"];
    const receiptEntry = {
      owner: applicationOwner,
      path: ".dufflebag/receipt.json",
      kind: { _tag: "receipt" },
      ownership: wholeFileOwnership,
    };

    expect(kindTags.map((_tag) => decodeKind({ _tag })).map((kind) => kind._tag)).toEqual(kindTags);
    expect(decodeEntry(receiptEntry).kind._tag).toBe("receipt");
    expect(() => decodeReceipt(receiptWithArtifacts([receiptEntry]))).toThrow(/itself|receipt/i);
  });

  it("round-trips every receipt field through the JSON codec", () => {
    const receipt = decodeReceipt(completeReceiptInput);
    const json = Schema.encodeSync(artifactReceiptJsonSchema)(receipt);
    const encoded = JSON.parse(json);

    expect(Object.keys(encoded)).toEqual(["version", "scope", "features", "artifacts"]);
    expect(encoded.artifacts[0].ownership.previous.bytes).toBe("AQID");
    expect(decodeReceiptJson(json)).toEqual(receipt);
  });

  it("preserves host-file existence for member-level ownership through receipt JSON", () => {
    const receipt = decodeReceipt(
      receiptWithArtifacts([
        {
          owner: sharedAgentOwner,
          path: "AGENTS.md",
          kind: { _tag: "instruction" },
          ownership: { ...managedBlockOwnership, filePreviouslyPresent: true },
        },
        {
          owner: agentOwner,
          path: ".continue/config.json",
          kind: { _tag: "configReference" },
          ownership: {
            ...jsonValuesOwnership,
            filePreviouslyPresent: false,
            values: jsonValuesOwnership.values.map((value) => ({ ...value, previous: missingPreviousJson })),
          },
        },
        {
          owner: agentOwner,
          path: ".aider.conf.yml",
          kind: { _tag: "configReference" },
          ownership: { ...yamlSequenceOwnership, filePreviouslyPresent: true },
        },
      ]),
    );
    const roundTrip = decodeReceiptJson(Schema.encodeSync(artifactReceiptJsonSchema)(receipt));

    expect(roundTrip.artifacts[0]?.ownership).toMatchObject({
      _tag: "managedBlock",
      filePreviouslyPresent: true,
    });
    expect(roundTrip.artifacts[1]?.ownership).toMatchObject({
      _tag: "jsonValues",
      filePreviouslyPresent: false,
    });
    expect(roundTrip.artifacts[2]?.ownership).toMatchObject({
      _tag: "yamlSequenceValue",
      filePreviouslyPresent: true,
    });
  });

  it.each([
    { ...completeReceiptInput, unexpected: true },
    { ...completeReceiptInput, detectedAgents: ["codex"] },
  ])("rejects receipt-level excess or detection evidence", (input) => {
    expect(() => decodeReceipt(input)).toThrow();
    expect(() => decodeReceiptJson(JSON.stringify(input))).toThrow();
  });

  it("rejects excess properties at every nested receipt boundary", () => {
    expect(() => decodeOwner({ _tag: "application", extra: true })).toThrow();
    expect(() => decodeKind({ _tag: "runtime", extra: true })).toThrow();
    expect(() => decodePreviousFile({ _tag: "missing", extra: true })).toThrow();
    expect(() => decodePreviousJson({ _tag: "value", value: null, extra: true })).toThrow();
    expect(() =>
      decodeEntry({
        ...completeReceiptInput.artifacts[0],
        extra: true,
      }),
    ).toThrow();
    expect(() =>
      decodeJsonValues({
        _tag: "jsonValues",
        filePreviouslyPresent: true,
        values: [
          {
            pointer: "/value",
            installedValueHash,
            previous: missingPreviousJson,
            extra: true,
          },
        ],
      }),
    ).toThrow();
  });

  it.each([
    "/absolute",
    "../escape",
    "nested/../../escape",
    "nested//file",
    "C:/file",
    "C:foo",
    "nested\\file",
    ".",
    "nested/./file",
  ])("rejects unsafe artifact path %j", (path) => {
    const decodePath = Schema.decodeUnknownSync(relativeArtifactPathSchema);

    expect(() => decodePath(path)).toThrow();
  });

  it("accepts normalized hidden and root-level relative paths", () => {
    const decodePath = Schema.decodeUnknownSync(relativeArtifactPathSchema);

    expect(decodePath(".claude/settings.json")).toBe(".claude/settings.json");
    expect(decodePath("AGENTS.md")).toBe("AGENTS.md");
  });

  it.each(["a".repeat(63), "A".repeat(64), `${"a".repeat(63)}g`, ""])("rejects invalid SHA-256 %j", (hash) => {
    expect(() => Schema.decodeUnknownSync(sha256Schema)(hash)).toThrow();
  });

  it("requires canonical base64 for prior file bytes", () => {
    expect(decodePreviousFile({ _tag: "priorFile", bytes: "Zg==" })).toEqual({
      _tag: "priorFile",
      bytes: new Uint8Array([102]),
    });
    expect(() => decodePreviousFile({ _tag: "priorFile", bytes: "Zg=" })).toThrow();
    expect(() => decodePreviousFile({ _tag: "priorFile", bytes: "Zh==" })).toThrow();
    expect(() => decodePreviousFile({ _tag: "priorFile", bytes: "AB==" })).toThrow();
    expect(() => decodePreviousFile({ _tag: "priorFile", bytes: "***" })).toThrow();
  });

  it.each(["", "rules", "#/rules", "/bad~2escape", "/bad~escape"])("rejects invalid JSON pointer %j", (pointer) => {
    expect(() => Schema.decodeUnknownSync(jsonPointerSchema)(pointer)).toThrow();
  });

  it("accepts escaped absolute JSON pointers", () => {
    const decodePointer = Schema.decodeUnknownSync(jsonPointerSchema);

    expect(decodePointer("/rules/0")).toBe("/rules/0");
    expect(decodePointer("/a~1b/~0key")).toBe("/a~1b/~0key");
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    new Date("2026-01-01T00:00:00.000Z"),
  ])("rejects a non-JSON previous value", (value) => {
    expect(() => decodePreviousJson({ _tag: "value", value })).toThrow();
  });

  it("rejects duplicate and parent-child JSON pointers", () => {
    const value = {
      installedValueHash,
      previous: missingPreviousJson,
    };

    expect(() =>
      decodeJsonValues({
        _tag: "jsonValues",
        filePreviouslyPresent: true,
        values: [
          { ...value, pointer: "/rules" },
          { ...value, pointer: "/rules" },
        ],
      }),
    ).toThrow(/pointer/i);
    expect(() =>
      decodeJsonValues({
        _tag: "jsonValues",
        filePreviouslyPresent: true,
        values: [
          { ...value, pointer: "/rules" },
          { ...value, pointer: "/rules/0" },
        ],
      }),
    ).toThrow(/pointer/i);
  });

  it("round-trips members acquired after a receipt first created their host files", () => {
    const receipt = decodeReceipt(
      receiptWithArtifacts([
        {
          owner: agentOwner,
          path: ".continue/config.json",
          kind: { _tag: "configReference" },
          ownership: {
            ...jsonValuesOwnership,
            filePreviouslyPresent: false,
          },
        },
        {
          owner: agentOwner,
          path: ".aider.conf.yml",
          kind: { _tag: "configReference" },
          ownership: {
            ...yamlSequenceOwnership,
            filePreviouslyPresent: false,
            previouslyPresent: true,
          },
        },
      ]),
    );
    const roundTrip = decodeReceiptJson(Schema.encodeSync(artifactReceiptJsonSchema)(receipt));

    expect(roundTrip.artifacts[0]?.ownership).toMatchObject({
      _tag: "jsonValues",
      filePreviouslyPresent: false,
      values: [{ previous: { _tag: "missing" } }, { previous: { _tag: "value", value: false } }],
    });
    expect(roundTrip.artifacts[1]?.ownership).toMatchObject({
      _tag: "yamlSequenceValue",
      filePreviouslyPresent: false,
      previouslyPresent: true,
    });
  });

  it("allows missing owned members when the host file previously existed", () => {
    expect(
      decodeJsonValues({
        _tag: "jsonValues",
        filePreviouslyPresent: true,
        values: [
          {
            pointer: "/rules",
            installedValueHash,
            previous: missingPreviousJson,
          },
        ],
      }).filePreviouslyPresent,
    ).toBe(true);
    expect(
      decodeYamlSequenceValue({
        ...yamlSequenceOwnership,
        filePreviouslyPresent: true,
        previouslyPresent: false,
      }).filePreviouslyPresent,
    ).toBe(true);
  });

  it("requires non-empty unique agent ownership IDs", () => {
    expect(() => decodeOwner({ _tag: "agent", agentIds: [] })).toThrow();
    expect(() => decodeOwner({ _tag: "agent", agentIds: ["codex", "codex"] })).toThrow(/unique/i);
  });

  it("requires known agent ownership IDs in exact catalog order", () => {
    expect(() => decodeOwner({ _tag: "agent", agentIds: ["unknown-agent"] })).toThrow(/agent|catalog|unknown/i);
    expect(() => decodeOwner({ _tag: "agent", agentIds: ["aider", "codex"] })).toThrow(/agent|catalog|order/i);
  });

  it("rejects equal managed-block markers", () => {
    expect(() =>
      decodeManagedBlock({
        _tag: "managedBlock",
        filePreviouslyPresent: true,
        startMarker: "marker",
        endMarker: "marker",
        installedBodyHash: installedHash,
      }),
    ).toThrow(/endMarker/);
  });

  it.each([
    {
      owner: agentOwner,
      path: "runtime.js",
      kind: { _tag: "runtime" },
      ownership: wholeFileOwnership,
    },
    {
      owner: applicationOwner,
      path: "skill/SKILL.md",
      kind: { _tag: "skill" },
      ownership: wholeFileOwnership,
    },
    {
      owner: agentOwner,
      path: "AGENTS.md",
      kind: { _tag: "instruction" },
      ownership: wholeFileOwnership,
    },
    {
      owner: agentOwner,
      path: "settings.json",
      kind: { _tag: "settings" },
      ownership: jsonValuesOwnership,
    },
    {
      owner: applicationOwner,
      path: "settings.yml",
      kind: { _tag: "settings" },
      ownership: yamlSequenceOwnership,
    },
    {
      owner: agentOwner,
      path: "config.json",
      kind: { _tag: "configReference" },
      ownership: managedBlockOwnership,
    },
    {
      owner: agentOwner,
      path: "managed-config.json",
      kind: { _tag: "managedConfig" },
      ownership: wholeFileOwnership,
    },
  ])("rejects incompatible owner or ownership combinations", (entry) => {
    expect(() => decodeEntry(entry)).toThrow(/owner|ownership/i);
  });

  it("rejects duplicate and parent-child artifact paths", () => {
    const first = {
      owner: applicationOwner,
      path: "runtime/guard.js",
      kind: { _tag: "runtime" },
      ownership: wholeFileOwnership,
    };

    expect(() => decodeReceipt(receiptWithArtifacts([first, first]))).toThrow(/path/i);
    expect(() =>
      decodeReceipt(
        receiptWithArtifacts([
          first,
          {
            ...first,
            path: "runtime/guard.js/map",
          },
        ]),
      ),
    ).toThrow(/path/i);
  });

  it("rejects artifact path collisions after deterministic case folding", () => {
    const instruction = {
      owner: sharedAgentOwner,
      path: "AGENTS.md",
      kind: { _tag: "instruction" },
      ownership: managedBlockOwnership,
    };

    expect(() =>
      decodeReceipt(
        receiptWithArtifacts([
          instruction,
          {
            ...instruction,
            path: "agents.md",
          },
        ]),
      ),
    ).toThrow(/path/i);
  });

  it("rejects duplicate receipt features", () => {
    expect(() =>
      decodeReceipt({
        ...receiptWithArtifacts([]),
        features: ["context-guard", "context-guard"],
      }),
    ).toThrow(/feature/i);
  });

  it.each([
    ["unknown feature", ["unknown-feature"]],
    ["missing dependency", ["autonomous-loop"]],
    ["non-catalog order", ["autonomous-loop", "context-guard"]],
  ])("rejects %s in receipt features", (_case, features) => {
    expect(() =>
      decodeReceipt({
        ...receiptWithArtifacts([]),
        features,
      }),
    ).toThrow(/feature|dependency|catalog order/i);
  });
});

describe("legacyManifestSchema", () => {
  const legacyManifest = {
    version: "0.11.0",
    scope: "global",
    features: ["context-guard", "autonomous-loop"],
    skills: ["autorun"],
    installedAt: "2026-07-14T10:00:00.000Z",
  };

  it("decodes only the five legacy manifest fields", () => {
    expect(decodeLegacyManifest(legacyManifest)).toEqual(legacyManifest);
    expect(() => decodeLegacyManifest({ ...legacyManifest, artifacts: [] })).toThrow();
    expect(() => decodeLegacyManifest({ ...legacyManifest, detectedPaths: ["AGENTS.md"] })).toThrow();
  });

  it("rejects invalid or duplicate legacy identities", () => {
    expect(() =>
      decodeLegacyManifest({
        ...legacyManifest,
        features: ["context-guard", "context-guard"],
      }),
    ).toThrow(/feature/i);
    expect(() =>
      decodeLegacyManifest({
        ...legacyManifest,
        skills: ["autorun", "autorun"],
      }),
    ).toThrow(/unique/i);
    expect(() => decodeLegacyManifest({ ...legacyManifest, skills: ["Autorun"] })).toThrow();
    expect(() => decodeLegacyManifest({ ...legacyManifest, features: ["unknown-feature"] })).toThrow(/unknown/i);
  });

  it("rejects non-semantic versions and non-canonical timestamps", () => {
    expect(() => decodeLegacyManifest({ ...legacyManifest, version: "latest" })).toThrow();
    expect(() => decodeLegacyManifest({ ...legacyManifest, installedAt: "2026-07-14" })).toThrow();
    expect(() => decodeLegacyManifest({ ...legacyManifest, installedAt: "2026-99-99T10:00:00.000Z" })).toThrow();
  });
});
