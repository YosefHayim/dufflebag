import { createHash } from "node:crypto";

import { Either, Option, Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import { agentCatalog } from "../../catalog/agentCatalog.js";
import { findFeature } from "../../catalog/featureCatalog.js";
import type { ReceiptEntry } from "../artifactReceipt.js";
import { type InstructionFilePlan, InstructionFilePlanError, instructionFilePlanSchema, planInstructionFile } from "./instructionFile.js";

const startMarker = "<!-- dufflebag:skills start -->";
const endMarker = "<!-- dufflebag:skills end -->";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const deslop = Option.getOrThrow(findFeature("deslop"));
const deslopV2 = Option.getOrThrow(findFeature("deslop-v2"));
const deslopSkill = Option.getOrThrow(Option.liftPredicate(deslop.installedSkill, (skill) => skill._tag === "skill"));
const deslopV2Skill = Option.getOrThrow(Option.liftPredicate(deslopV2.installedSkill, (skill) => skill._tag === "skill"));

const encode = (value: string): Uint8Array => textEncoder.encode(value);

const decode = (value: Uint8Array): string => textDecoder.decode(value);

const hash = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

const desiredSkill = (markdown = "Alpha uses @@CTL@@.") => ({ installedSkill: deslopSkill, markdown });

const request = (input?: {
  agentIds?: ReadonlyArray<string>;
  ctl?: string;
  currentBytes?: Uint8Array;
  desired?: "present" | "absent";
  path?: string;
  previousArtifact?: ReceiptEntry;
  skills?: ReadonlyArray<{ installedSkill: typeof deslopSkill; markdown: string }>;
}) => ({
  path: input?.path ?? "AGENTS.md",
  desired:
    input?.desired === "absent"
      ? { _tag: "absent" }
      : {
          _tag: "present",
          agentIds: input?.agentIds ?? ["aider"],
          skills: input?.skills ?? [desiredSkill()],
          ctl: input?.ctl ?? "dufflebag",
        },
  currentFile: input?.currentBytes === undefined ? { _tag: "missing" } : { _tag: "file", bytes: input.currentBytes },
  previousArtifact: input?.previousArtifact === undefined ? { _tag: "missing" } : { _tag: "owned", artifact: input.previousArtifact },
});

const unwrap = (result: ReturnType<typeof planInstructionFile>): InstructionFilePlan =>
  Either.getOrThrowWith(result, (error) => new Error(error.message));

const expectWrite = (plan: InstructionFilePlan) => {
  if (plan._tag !== "write") {
    throw new Error("Expected one instruction-file write.");
  }

  return plan;
};

const expectRestore = (plan: InstructionFilePlan) => {
  if (plan._tag !== "restore") {
    throw new Error("Expected one instruction-file restoration.");
  }

  return plan;
};

describe("planInstructionFile", () => {
  it("renders exact catalog skills in order and substitutes ctl literally", () => {
    const plan = expectWrite(
      unwrap(
        planInstructionFile(
          request({
            ctl: "$&/$`/$'",
            skills: [
              desiredSkill("---\nname: deslop\n---\nDeslop uses @@CTL@@.\n"),
              { installedSkill: deslopV2Skill, markdown: "---\r\nname: deslop-v2\r\n---\r\nV2 body.\r\n" },
            ],
          }),
        ),
      ),
    );
    const expectedBody = "\n## deslop\n\nDeslop uses $&/$`/$'.\n\n---\n\n## deslop-v2\n\nV2 body.\n";
    const exactInstructionKind: "instruction" = plan.artifact.kind._tag;

    expectTypeOf(exactInstructionKind).toEqualTypeOf<"instruction">();
    expectTypeOf(plan.artifact.owner._tag).toEqualTypeOf<"agent">();
    expectTypeOf(plan.artifact.ownership._tag).toEqualTypeOf<"managedBlock">();
    expect(decode(plan.bytes)).toBe(`${startMarker}${expectedBody}${endMarker}\n`);
    expect(plan.artifact).toEqual({
      owner: { _tag: "agent", agentIds: ["aider"] },
      path: "AGENTS.md",
      kind: { _tag: "instruction" },
      ownership: {
        _tag: "managedBlock",
        filePreviouslyPresent: false,
        startMarker,
        endMarker,
        installedBodyHash: hash(encode(expectedBody)),
      },
    });
  });

  it("preserves every existing byte while appending one reversible block", () => {
    const existing = encode("# User rules\n\nKeep trailing spaces.  ");
    const plan = expectWrite(unwrap(planInstructionFile(request({ currentBytes: existing }))));

    expect(decode(plan.bytes)).toBe(
      `# User rules\n\nKeep trailing spaces.  \n\n${startMarker}\n## deslop\n\nAlpha uses dufflebag.\n${endMarker}\n`,
    );
    expect(plan.bytes.slice(0, existing.byteLength)).toEqual(existing);
  });

  it("evolves shared AGENTS owners across Aider and Continue in catalog order", () => {
    const aider = expectWrite(unwrap(planInstructionFile(request())));
    const allOwners = expectWrite(
      unwrap(
        planInstructionFile(
          request({
            agentIds: ["aider", "continue"],
            currentBytes: aider.bytes,
            previousArtifact: aider.artifact,
          }),
        ),
      ),
    );
    const aiderAgain = expectWrite(
      unwrap(
        planInstructionFile(
          request({
            currentBytes: allOwners.bytes,
            previousArtifact: allOwners.artifact,
          }),
        ),
      ),
    );

    expect(aider.artifact.owner).toEqual({ _tag: "agent", agentIds: ["aider"] });
    expect(allOwners.artifact.owner).toEqual({ _tag: "agent", agentIds: ["aider", "continue"] });
    expect(aiderAgain.artifact.owner).toEqual({ _tag: "agent", agentIds: ["aider"] });
    expect(allOwners.bytes).toEqual(aider.bytes);
    expect(aiderAgain.bytes).toEqual(aider.bytes);
  });

  it("restores user AGENTS.md bytes from the legacy Codex instruction target", () => {
    const original = encode("User instructions.\n");
    const installed = expectWrite(unwrap(planInstructionFile(request({ currentBytes: original }))));
    const legacyCodexArtifact = {
      ...installed.artifact,
      owner: { _tag: "agent" as const, agentIds: ["codex"] as const },
    };

    const restored = expectRestore(
      unwrap(
        planInstructionFile(
          request({
            desired: "absent",
            currentBytes: installed.bytes,
            previousArtifact: legacyCodexArtifact,
          }),
        ),
      ),
    );

    expect(restored.bytes).toEqual(original);
  });

  it("restores exact surrounding bytes when the final shared owner leaves", () => {
    const original = encode("User bytes without a final newline");
    const installed = expectWrite(unwrap(planInstructionFile(request({ currentBytes: original }))));
    const removed = expectRestore(
      unwrap(
        planInstructionFile(
          request({
            desired: "absent",
            currentBytes: installed.bytes,
            previousArtifact: installed.artifact,
          }),
        ),
      ),
    );

    expect(removed.artifact).toEqual(installed.artifact);
    expect(removed.bytes).toEqual(original);
  });

  it("keeps user content appended after an installed block separated from the original prefix", () => {
    const installed = expectWrite(unwrap(planInstructionFile(request({ currentBytes: encode("User bytes") }))));
    const currentBytes = encode(`${decode(installed.bytes)}Later rules\n`);
    const restored = expectRestore(
      unwrap(
        planInstructionFile(
          request({
            desired: "absent",
            currentBytes,
            previousArtifact: installed.artifact,
          }),
        ),
      ),
    );

    expect(decode(restored.bytes)).toBe("User bytes\nLater rules\n");
  });

  it("keeps a CRLF-prefixed user suffix without inserting an extra line feed", () => {
    const installed = expectWrite(unwrap(planInstructionFile(request({ currentBytes: encode("User bytes") }))));
    const currentBytes = encode(`${decode(installed.bytes)}\r\nLater rules\r\n`);
    const restored = expectRestore(
      unwrap(
        planInstructionFile(
          request({
            desired: "absent",
            currentBytes,
            previousArtifact: installed.artifact,
          }),
        ),
      ),
    );

    expect(decode(restored.bytes)).toBe("User bytes\r\nLater rules\r\n");
  });

  it("removes a file created only for the managed block", () => {
    const installed = expectWrite(unwrap(planInstructionFile(request())));
    const removed = unwrap(
      planInstructionFile(
        request({
          desired: "absent",
          currentBytes: installed.bytes,
          previousArtifact: installed.artifact,
        }),
      ),
    );

    expect(removed).toEqual({ _tag: "remove", artifact: installed.artifact, unownedBytes: new Uint8Array() });
  });

  it("returns no operation when the path is absent and has no prior ownership", () => {
    expect(unwrap(planInstructionFile(request({ desired: "absent" })))).toEqual({ _tag: "none" });
  });

  it("ignores malformed reserved markers in an unreceipted file when absence is desired", () => {
    const result = planInstructionFile(
      request({
        desired: "absent",
        currentBytes: encode(`User bytes ${startMarker}`),
      }),
    );

    expect(unwrap(result)).toEqual({ _tag: "none" });
  });

  it.each(
    agentCatalog.flatMap((agent) => {
      if (agent.target._tag === "instructionFile") {
        return [{ agentId: agent.id, path: agent.target.path }];
      }

      return agent.target._tag === "configReference" ? [{ agentId: agent.id, path: agent.target.instructionPath }] : [];
    }),
  )("accepts catalog instruction consumer $agentId only at $path", ({ agentId, path }) => {
    const valid = planInstructionFile(request({ agentIds: [agentId], path }));
    const invalid = planInstructionFile(request({ agentIds: [agentId], path: `${path}.forged` }));

    expect(Either.isRight(valid)).toBe(true);
    expect(Either.isLeft(invalid)).toBe(true);
  });

  it.each([
    ["opening marker only", `Before${startMarker}body`],
    ["closing marker only", `body${endMarker}`],
    ["reversed markers", `${endMarker}body${startMarker}`],
    ["duplicate blocks", `${startMarker}one${endMarker}${startMarker}two${endMarker}`],
  ])("rejects %s", (_case, current) => {
    const result = planInstructionFile(request({ currentBytes: encode(current) }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(InstructionFilePlanError);
      expect(result.left.message).toContain("marker");
    }
  });

  it("rejects edits inside a receipted body and changed framing", () => {
    const installed = expectWrite(unwrap(planInstructionFile(request())));
    const editedBody = planInstructionFile(
      request({
        currentBytes: encode(`${startMarker}\nEdited\n${endMarker}\n`),
        previousArtifact: installed.artifact,
      }),
    );
    const changedFrame = planInstructionFile(
      request({
        currentBytes: installed.bytes.slice(0, -1),
        previousArtifact: installed.artifact,
      }),
    );

    expect(Either.isLeft(editedBody)).toBe(true);
    expect(Either.isLeft(changedFrame)).toBe(true);
  });

  it.each([
    ["whitespace ctl", { ...request(), desired: { ...request().desired, ctl: "   " } }],
    ["unresolved ctl token", { ...request(), desired: { ...request().desired, ctl: "@@CTL@@/ctl" } }],
    [
      "invented skill",
      {
        ...request(),
        desired: {
          ...request().desired,
          skills: [{ installedSkill: { _tag: "skill", id: "invented", shippedPaths: ["SKILL.md"] }, markdown: "Body" }],
        },
      },
    ],
    ["unknown request property", { ...request(), unexpected: true }],
  ])("rejects %s at the strict request boundary", (_case, input) => {
    expect(Either.isLeft(planInstructionFile(input))).toBe(true);
  });

  it("rejects prior owners that cannot legitimately consume the shared path", () => {
    const installed = expectWrite(unwrap(planInstructionFile(request())));
    const forged = {
      ...installed.artifact,
      owner: { _tag: "agent", agentIds: ["gemini"] },
    };

    expect(
      Either.isLeft(
        planInstructionFile({
          ...request({ currentBytes: installed.bytes }),
          previousArtifact: { _tag: "owned", artifact: forged },
        }),
      ),
    ).toBe(true);
  });

  it("rejects generic result kind and managed-body hash drift", () => {
    const plan = expectWrite(unwrap(planInstructionFile(request())));
    const wrongKind = {
      ...plan,
      artifact: {
        ...plan.artifact,
        kind: { _tag: "rule" },
        ownership: { _tag: "wholeFile", installedHash: "a".repeat(64), previous: { _tag: "missing" } },
      },
    };
    const wrongHash = {
      ...plan,
      artifact: {
        ...plan.artifact,
        ownership: { ...plan.artifact.ownership, installedBodyHash: "0".repeat(64) },
      },
    };

    expect(Schema.is(instructionFilePlanSchema)(wrongKind)).toBe(false);
    expect(Schema.is(instructionFilePlanSchema)(wrongHash)).toBe(false);
  });
});
