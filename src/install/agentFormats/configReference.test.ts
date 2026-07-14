import { createHash } from "node:crypto";

import { Either, Option, Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import { findAgent } from "../../catalog/agentCatalog.js";
import type { ArtifactOperation } from "../artifactPlan.js";
import { type ConfigReferencePlan, configReferencePlanSchema, planConfigReference } from "./configReference.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const aider = Option.getOrThrow(findAgent("aider"));
const continueAgent = Option.getOrThrow(findAgent("continue"));
const missingFile = { _tag: "missing" };
const noPreviousArtifact = { _tag: "missing" };

const hashJson = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const unwrap = (result: ReturnType<typeof planConfigReference>): ConfigReferencePlan =>
  Either.getOrThrowWith(result, (error) => new Error(error.message));

const operationValue = (plan: ConfigReferencePlan) => {
  if (plan._tag === "none") {
    throw new Error("Expected one materialized config-reference operation.");
  }

  return plan;
};

const writeValue = (plan: ConfigReferencePlan) => {
  const operation = operationValue(plan);
  if (operation._tag !== "write") {
    throw new Error("Expected one config-reference write.");
  }

  return operation;
};

const restoreValue = (plan: ConfigReferencePlan) => {
  const operation = operationValue(plan);
  if (operation._tag !== "restore") {
    throw new Error("Expected one config-reference restoration.");
  }

  return operation;
};

const request = (input?: {
  agent?: typeof aider | typeof continueAgent;
  currentBytes?: Uint8Array;
  desired?: "present" | "absent";
  previousArtifact?: ArtifactOperation["artifact"];
}) => ({
  agent: input?.agent ?? aider,
  desired: { _tag: input?.desired ?? "present" },
  currentFile: input?.currentBytes === undefined ? missingFile : { _tag: "file", bytes: input.currentBytes },
  previousArtifact: input?.previousArtifact === undefined ? noPreviousArtifact : { _tag: "owned", artifact: input.previousArtifact },
});

describe("planConfigReference", () => {
  it("returns no operation when the native reference is absent and unreceipted", () => {
    expect(unwrap(planConfigReference(request({ desired: "absent" })))).toEqual({ _tag: "none" });
  });

  it("plans only Aider native configuration with its exact catalog owner", () => {
    const write = writeValue(unwrap(planConfigReference(request())));
    const exactConfigKind: "configReference" = write.artifact.kind._tag;

    expectTypeOf(exactConfigKind).toEqualTypeOf<"configReference">();
    expectTypeOf(write.artifact.owner._tag).toEqualTypeOf<"agent">();
    expectTypeOf(write.artifact.ownership._tag).toEqualTypeOf<"jsonValues" | "yamlSequenceValue">();
    expect(write.artifact.path).toBe(".aider.conf.yml");
    expect(write.artifact.owner).toEqual({ _tag: "agent", agentIds: ["aider"] });
    expect(textDecoder.decode(write.bytes)).toBe("read:\n  - AGENTS.md\n");
    expect(write.artifact.ownership).toEqual({
      _tag: "yamlSequenceValue",
      filePreviouslyPresent: false,
      key: "read",
      keyPreviouslyPresent: false,
      insertedPrefix: "",
      reference: "AGENTS.md",
      previouslyPresent: false,
    });
  });

  it("removes an Aider file created only for the native reference", () => {
    const installed = writeValue(unwrap(planConfigReference(request())));
    const removed = unwrap(
      planConfigReference(
        request({
          desired: "absent",
          currentBytes: installed.bytes,
          previousArtifact: installed.artifact,
        }),
      ),
    );

    expect(removed).toEqual({ _tag: "remove", artifact: installed.artifact, unownedBytes: new Uint8Array() });
  });

  it.each(["model: sonnet\n", "model: sonnet"])("round-trips a created Aider read key from %j", (original) => {
    const installed = writeValue(
      unwrap(
        planConfigReference(
          request({
            currentBytes: textEncoder.encode(original),
          }),
        ),
      ),
    );
    const removed = restoreValue(
      unwrap(
        planConfigReference(
          request({
            desired: "absent",
            currentBytes: installed.bytes,
            previousArtifact: installed.artifact,
          }),
        ),
      ),
    );

    expect(textDecoder.decode(removed.bytes)).toBe(original);
  });

  it("keeps a later Aider root key separated from a non-terminated original prefix", () => {
    const installed = writeValue(
      unwrap(
        planConfigReference(
          request({
            currentBytes: textEncoder.encode("model: sonnet"),
          }),
        ),
      ),
    );
    const restored = restoreValue(
      unwrap(
        planConfigReference(
          request({
            desired: "absent",
            currentBytes: textEncoder.encode(`${textDecoder.decode(installed.bytes)}theme: dark\n`),
            previousArtifact: installed.artifact,
          }),
        ),
      ),
    );

    expect(textDecoder.decode(restored.bytes)).toBe("model: sonnet\ntheme: dark\n");
  });

  it("adds one Aider reference under an existing block sequence and preserves other bytes", () => {
    const current = "model: sonnet\nread:\n  - USER.md\ntheme: dark\n";
    const write = writeValue(
      unwrap(
        planConfigReference(
          request({
            currentBytes: textEncoder.encode(current),
          }),
        ),
      ),
    );

    expect(textDecoder.decode(write.bytes)).toBe("model: sonnet\nread:\n  - USER.md\n  - AGENTS.md\ntheme: dark\n");
    expect(write.artifact.ownership).toMatchObject({ keyPreviouslyPresent: true, insertedPrefix: "", previouslyPresent: false });
  });

  it.each([
    "read:\n  - USER.md",
    "read:\r\n  - USER.md",
  ])("round-trips an existing Aider sequence with no final line ending in %j", (original) => {
    const installed = writeValue(
      unwrap(
        planConfigReference(
          request({
            currentBytes: textEncoder.encode(original),
          }),
        ),
      ),
    );
    const restored = restoreValue(
      unwrap(
        planConfigReference(
          request({
            desired: "absent",
            currentBytes: installed.bytes,
            previousArtifact: installed.artifact,
          }),
        ),
      ),
    );

    expect(textDecoder.decode(restored.bytes)).toBe(original);
  });

  it("rejects edits to the exact installed Aider reference line", () => {
    const installed = writeValue(unwrap(planConfigReference(request())));
    const result = planConfigReference(
      request({
        desired: "absent",
        currentBytes: textEncoder.encode("read:\n  - AGENTS.md # user edit\n"),
        previousArtifact: installed.artifact,
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects edits to a handler-created Aider key before removing the pair", () => {
    const installed = writeValue(unwrap(planConfigReference(request())));
    const result = planConfigReference(
      request({
        desired: "absent",
        currentBytes: textEncoder.encode("read: # user note\n  - AGENTS.md\n"),
        previousArtifact: installed.artifact,
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
  });

  it.each([
    '"read":\n  - "AGENTS.md"\n',
    "read:\n  - AGENTS.md # user-owned\n",
  ])("recognizes one semantically equivalent pre-existing Aider reference in %j", (current) => {
    const write = writeValue(
      unwrap(
        planConfigReference(
          request({
            currentBytes: textEncoder.encode(current),
          }),
        ),
      ),
    );

    expect(textDecoder.decode(write.bytes)).toBe(current);
    expect(write.artifact.ownership).toMatchObject({ keyPreviouslyPresent: true, insertedPrefix: "", previouslyPresent: true });
  });

  it("restores the exact prior Continue rules value while preserving unrelated JSON bytes", () => {
    const original = '{ "theme" : "dark", "rules" : ["USER.md"] }\n';
    const installed = writeValue(
      unwrap(
        planConfigReference(
          request({
            agent: continueAgent,
            currentBytes: textEncoder.encode(original),
          }),
        ),
      ),
    );
    const restored = restoreValue(
      unwrap(
        planConfigReference(
          request({
            agent: continueAgent,
            desired: "absent",
            currentBytes: installed.bytes,
            previousArtifact: installed.artifact,
          }),
        ),
      ),
    );
    const restoredSource = textDecoder.decode(restored.bytes);

    expect(restoredSource.startsWith('{ "theme" : "dark", "rules" : ')).toBe(true);
    expect(JSON.parse(restoredSource)).toEqual(JSON.parse(original));
  });

  it("preserves unrelated Continue JSON bytes when the rules member was initially missing", () => {
    const original = '{ "theme" : "dark" }\n';
    const installed = writeValue(
      unwrap(
        planConfigReference(
          request({
            agent: continueAgent,
            currentBytes: textEncoder.encode(original),
          }),
        ),
      ),
    );
    const restored = restoreValue(
      unwrap(
        planConfigReference(
          request({
            agent: continueAgent,
            desired: "absent",
            currentBytes: installed.bytes,
            previousArtifact: installed.artifact,
          }),
        ),
      ),
    );

    expect(textDecoder.decode(restored.bytes)).toBe(original);
  });

  it("adds one Continue reference without duplicating an existing one", () => {
    const added = writeValue(
      unwrap(
        planConfigReference(
          request({
            agent: continueAgent,
            currentBytes: textEncoder.encode('{ "theme" : "dark", "rules" : ["USER.md"] }\n'),
          }),
        ),
      ),
    );
    const existing = '{"rules":["AGENTS.md"]}\n';
    const unchanged = writeValue(
      unwrap(
        planConfigReference(
          request({
            agent: continueAgent,
            currentBytes: textEncoder.encode(existing),
          }),
        ),
      ),
    );

    expect(JSON.parse(textDecoder.decode(added.bytes))).toEqual({ theme: "dark", rules: ["USER.md", "AGENTS.md"] });
    expect(textDecoder.decode(unchanged.bytes)).toBe(existing);
  });

  it.each([
    ["malformed JSON", "{not-json"],
    ["duplicate JSON member", '{"rules":[],"rules":[]}'],
    ["escaped duplicate JSON member", '{"rules":[],"\\u0072ules":[]}'],
    ["non-array rules", '{"rules":"AGENTS.md"}'],
    ["non-string rule", '{"rules":[1]}'],
  ])("rejects %s instead of overwriting Continue configuration", (_case, json) => {
    const result = planConfigReference(
      request({
        agent: continueAgent,
        currentBytes: textEncoder.encode(json),
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
  });

  it.each([
    "model: [\n",
    "read: AGENTS.md\n",
    "read:\n  nested: value\n",
    "read:\n\t- AGENTS.md\n",
    "{ read: [AGENTS.md] }\n",
    "read:",
    "read: # user note",
    'read:\n  - AGENTS.md\n  - "AGENTS.md"\n',
  ])("rejects malformed or unsupported Aider YAML %j without an operation", (yaml) => {
    expect(
      Either.isLeft(
        planConfigReference(
          request({
            currentBytes: textEncoder.encode(yaml),
          }),
        ),
      ),
    ).toBe(true);
  });

  it.each([aider, continueAgent])("rejects malformed UTF-8 and a leading BOM for $id configuration", (agent) => {
    const malformedUtf8 = planConfigReference(
      request({
        agent,
        currentBytes: new Uint8Array([255]),
      }),
    );
    const bomSource = agent.id === "aider" ? "read:\n  - USER.md\n" : '{"rules":["USER.md"]}\n';
    const leadingBom = planConfigReference(
      request({
        agent,
        currentBytes: textEncoder.encode(`\uFEFF${bomSource}`),
      }),
    );

    expect(Either.isLeft(malformedUtf8)).toBe(true);
    expect(Either.isLeft(leadingBom)).toBe(true);
  });

  it("rejects forged or cross-routed catalog agents", () => {
    const forgedAider = {
      ...aider,
      target: {
        _tag: "configReference",
        instructionPath: "AGENTS.md",
        configPath: ".continue/config.json",
        referenceFormat: "jsonRulesArray",
      },
    };
    const cursor = Option.getOrThrow(findAgent("cursor"));

    expect(Either.isLeft(planConfigReference({ ...request(), agent: forgedAider }))).toBe(true);
    expect(Either.isLeft(planConfigReference({ ...request(), agent: cursor }))).toBe(true);
  });

  it("rejects prior ownership that does not match the exact native target", () => {
    const installed = writeValue(unwrap(planConfigReference(request())));
    const wrongOwner = {
      ...installed.artifact,
      owner: { _tag: "agent", agentIds: ["continue"] },
    };
    const wrongReference = {
      ...installed.artifact,
      ownership:
        installed.artifact.ownership._tag === "yamlSequenceValue"
          ? { ...installed.artifact.ownership, reference: "OTHER.md" }
          : installed.artifact.ownership,
    };

    expect(
      Either.isLeft(
        planConfigReference({
          ...request({ currentBytes: installed.bytes }),
          previousArtifact: { _tag: "owned", artifact: wrongOwner },
        }),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        planConfigReference({
          ...request({ currentBytes: installed.bytes }),
          previousArtifact: { _tag: "owned", artifact: wrongReference },
        }),
      ),
    ).toBe(true);
  });

  it("rejects non-string-array Continue restoration history during update planning", () => {
    const installed = writeValue(unwrap(planConfigReference(request({ agent: continueAgent }))));
    if (installed.artifact.ownership._tag !== "jsonValues") {
      throw new Error("Expected Continue JSON ownership.");
    }

    const invalidHistory = {
      ...installed.artifact,
      ownership: {
        ...installed.artifact.ownership,
        values: installed.artifact.ownership.values.map((value) => ({
          ...value,
          previous: { _tag: "value", value: { unexpected: true } },
        })),
      },
    };
    const result = planConfigReference({
      ...request({ agent: continueAgent, currentBytes: installed.bytes }),
      previousArtifact: { _tag: "owned", artifact: invalidHistory },
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects edits inside receipted Continue and Aider references", () => {
    const continueWrite = writeValue(unwrap(planConfigReference(request({ agent: continueAgent }))));
    const aiderWrite = writeValue(unwrap(planConfigReference(request())));

    const continueConflict = planConfigReference(
      request({
        agent: continueAgent,
        currentBytes: textEncoder.encode('{"rules":["AGENTS.md","UNRECEIPTED.md"]}\n'),
        previousArtifact: continueWrite.artifact,
      }),
    );
    const aiderConflict = planConfigReference(
      request({
        currentBytes: textEncoder.encode("read:\n  - USER.md\n"),
        previousArtifact: aiderWrite.artifact,
      }),
    );

    expect(Either.isLeft(continueConflict)).toBe(true);
    expect(Either.isLeft(aiderConflict)).toBe(true);
  });

  it("rejects generic result hash and native-reference semantic drift", () => {
    const continueWrite = writeValue(unwrap(planConfigReference(request({ agent: continueAgent }))));
    const aiderWrite = writeValue(unwrap(planConfigReference(request())));
    if (continueWrite.artifact.ownership._tag !== "jsonValues") {
      throw new Error("Expected Continue JSON ownership.");
    }

    const wrongHash = {
      ...continueWrite,
      artifact: {
        ...continueWrite.artifact,
        ownership: {
          ...continueWrite.artifact.ownership,
          values: continueWrite.artifact.ownership.values.map((value) => ({ ...value, installedValueHash: "0".repeat(64) })),
        },
      },
    };
    const wrongYaml = { ...aiderWrite, bytes: textEncoder.encode("read:\n  - OTHER.md\n") };
    const selfConsistentWrongYaml = {
      ...aiderWrite,
      artifact: {
        ...aiderWrite.artifact,
        ownership:
          aiderWrite.artifact.ownership._tag === "yamlSequenceValue"
            ? { ...aiderWrite.artifact.ownership, reference: "OTHER.md" }
            : aiderWrite.artifact.ownership,
      },
      bytes: textEncoder.encode("read:\n  - OTHER.md\n"),
    };
    const selfConsistentWrongJson = {
      ...continueWrite,
      artifact: {
        ...continueWrite.artifact,
        ownership: {
          ...continueWrite.artifact.ownership,
          values: continueWrite.artifact.ownership.values.map((value) => ({
            ...value,
            installedValueHash: hashJson(["OTHER.md"]),
          })),
        },
      },
      bytes: textEncoder.encode('{"rules":["OTHER.md"]}\n'),
    };

    expect(Schema.is(configReferencePlanSchema)(wrongHash)).toBe(false);
    expect(Schema.is(configReferencePlanSchema)(wrongYaml)).toBe(false);
    expect(Schema.is(configReferencePlanSchema)(selfConsistentWrongYaml)).toBe(false);
    expect(Schema.is(configReferencePlanSchema)(selfConsistentWrongJson)).toBe(false);
  });

  it("strictly rejects unknown request properties", () => {
    expect(Either.isLeft(planConfigReference({ ...request(), unexpected: true }))).toBe(true);
  });
});
