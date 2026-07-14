import { Either } from "effect";
import { describe, expect, it } from "vitest";

import { sha256Bytes } from "../artifactReceipt.js";
import {
  instructionEndMarker as instructionEnd,
  instructionStartMarker as instructionStart,
  planInstructionFile,
} from "./instructionFile.js";

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
  id: "codex",
  displayName: "Codex",
  detection: {
    homePaths: [".codex"],
    absolutePaths: [],
    commands: ["codex"],
  },
  target: {
    _tag: "instructionFile",
    path: "AGENTS.md",
  },
};

const skill = (body: string) => ({
  installedSkill: { _tag: "skill", id: "example", shippedPaths: ["SKILL.md"] },
  sourceFiles: [{ path: "SKILL.md", bytes: bytes(body) }],
});

const right = <Value, Error>(result: Either.Either<Value, Error>): Value => {
  if (Either.isLeft(result)) {
    throw result.left;
  }

  return result.right;
};

const only = <Value>(values: ReadonlyArray<Value>): Value => {
  const value = values.at(0);
  if (values.length !== 1 || value === undefined) {
    throw new Error("Expected one planned artifact.");
  }

  return value;
};

describe("planInstructionFile", () => {
  it("inserts one managed block while preserving every surrounding byte and the source body newline style", () => {
    const existing = bytes("# User rules\r\n");
    const result = planInstructionFile({
      agent,
      skills: [skill("---\r\nname: example\r\n---\r\n\r\nBody one\r\nBody two")],
      observations: [fileObservation("AGENTS.md", existing)],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });

    const candidate = only(right(result));
    const expected =
      "# User rules\r\n\r\n<!-- dufflebag:skills start -->\r\n## example\r\n\r\nBody one\r\nBody two\r\n<!-- dufflebag:skills end -->\r\n";
    expect(new TextDecoder().decode(candidate.bytes)).toBe(expected);
    expect(candidate.artifact).toMatchObject({
      path: "AGENTS.md",
      kind: "instruction",
      owner: { _tag: "agent", agentIds: ["codex"] },
      ownership: {
        _tag: "managedBlock",
        startMarker: "<!-- dufflebag:skills start -->",
        endMarker: "<!-- dufflebag:skills end -->",
        installedBodySha256: sha256Bytes(bytes("\r\n## example\r\n\r\nBody one\r\nBody two\r\n")),
        leadingDelimiter: bytes("\r\n"),
        trailingDelimiter: bytes("\r\n"),
        priorDocument: { _tag: "existing" },
      },
    });
  });

  it("replaces only a receipted matching block and retains its original restoration metadata", () => {
    const original = bytes("User bytes without a final newline");
    const first = only(
      right(
        planInstructionFile({
          agent,
          skills: [skill("old body")],
          observations: [fileObservation("AGENTS.md", original)],
          priorArtifacts: [],
          templateValues: { ctl: "ctl.js" },
        }),
      ),
    );
    const updated = planInstructionFile({
      agent,
      skills: [skill("new body")],
      observations: [fileObservation("AGENTS.md", first.bytes)],
      priorArtifacts: [first.artifact],
      templateValues: { ctl: "ctl.js" },
    });

    const candidate = only(right(updated));
    const rendered = new TextDecoder().decode(candidate.bytes);
    expect(rendered.startsWith("User bytes without a final newline\n\n<!-- dufflebag:skills start -->")).toBe(true);
    expect(rendered).toContain("new body");
    expect(rendered).not.toContain("old body");
    expect(rendered.match(/<!-- dufflebag:skills start -->/g)).toHaveLength(1);
    expect(candidate.artifact.ownership).toMatchObject({
      leadingDelimiter: bytes("\n\n"),
      trailingDelimiter: bytes("\n"),
      priorDocument: { _tag: "existing" },
    });
  });

  it("distinguishes a missing file from a pre-existing empty file", () => {
    const missing = only(
      right(
        planInstructionFile({
          agent,
          skills: [skill("body")],
          observations: [missingObservation("AGENTS.md")],
          priorArtifacts: [],
          templateValues: { ctl: "ctl.js" },
        }),
      ),
    );
    const existing = only(
      right(
        planInstructionFile({
          agent,
          skills: [skill("body")],
          observations: [fileObservation("AGENTS.md", new Uint8Array())],
          priorArtifacts: [],
          templateValues: { ctl: "ctl.js" },
        }),
      ),
    );

    expect(missing.artifact.ownership).toMatchObject({ priorDocument: { _tag: "missing" } });
    expect(existing.artifact.ownership).toMatchObject({ priorDocument: { _tag: "existing" } });
  });

  it("emits nothing for an empty desired skill set", () => {
    const result = planInstructionFile({
      agent,
      skills: [],
      observations: [],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });

    expect(right(result)).toEqual([]);
  });

  it("validates the target path before accepting an empty desired skill set", () => {
    const result = planInstructionFile({
      agent: {
        ...agent,
        target: {
          _tag: "instructionFile",
          path: "../escape",
        },
      },
      skills: [],
      observations: [],
      priorArtifacts: [],
      templateValues: { ctl: "ctl.js" },
    });

    expect(Either.isLeft(result) && result.left.code).toBe("target-invalid");
  });

  it("rejects orphaned, reversed, or duplicate global markers even with a matching receipt", () => {
    const first = only(
      right(
        planInstructionFile({
          agent,
          skills: [skill("old body")],
          observations: [missingObservation("AGENTS.md")],
          priorArtifacts: [],
          templateValues: { ctl: "ctl.js" },
        }),
      ),
    );
    const installed = new TextDecoder().decode(first.bytes);
    const malformedDocuments = [
      `${instructionEnd}\n${installed}`,
      `${instructionStart}\n${installed}`,
      `${installed}${instructionEnd}\n`,
      `${instructionEnd}\n${instructionStart}\n${installed}`,
    ];

    malformedDocuments.forEach((content) => {
      const result = planInstructionFile({
        agent,
        skills: [skill("new body")],
        observations: [fileObservation("AGENTS.md", bytes(content))],
        priorArtifacts: [first.artifact],
        templateValues: { ctl: "ctl.js" },
      });

      expect(Either.isLeft(result) && result.left.code).toBe("ownership-conflict");
    });
  });

  it("fails closed on unreceipted, edited, orphaned, duplicate, reversed, nested, or embedded markers", () => {
    const start = instructionStart;
    const end = instructionEnd;
    const collisions = [
      `${start}\nbody\n${end}\n`,
      `prefix ${start} body`,
      `${end}\n${start}\n`,
      `${start}\n${start}\n${end}\n${end}\n`,
      `${start}\nbody\n`,
      `body\n${end}\n`,
    ];

    collisions.forEach((content) => {
      const result = planInstructionFile({
        agent,
        skills: [skill("new body")],
        observations: [fileObservation("AGENTS.md", bytes(content))],
        priorArtifacts: [],
        templateValues: { ctl: "ctl.js" },
      });

      expect(Either.isLeft(result) && result.left.code).toBe("managed-block-conflict");
    });

    const installed = bytes(`${start}\nold body\n${end}\n`);
    const edited = planInstructionFile({
      agent,
      skills: [skill("new body")],
      observations: [fileObservation("AGENTS.md", bytes(`${start}\nedited\n${end}\n`))],
      priorArtifacts: [
        {
          path: "AGENTS.md",
          owner: { _tag: "agent", agentIds: ["codex"] },
          kind: "instruction",
          ownership: {
            _tag: "managedBlock",
            startMarker: start,
            endMarker: end,
            installedBodySha256: sha256Bytes(bytes("\nold body\n")),
            leadingDelimiter: new Uint8Array(),
            trailingDelimiter: bytes("\n"),
            priorDocument: { _tag: "missing" },
          },
        },
      ],
      templateValues: { ctl: "ctl.js" },
    });

    expect(sha256Bytes(installed)).not.toBe(sha256Bytes(bytes(`${start}\nedited\n${end}\n`)));
    expect(Either.isLeft(edited) && edited.left.code).toBe("ownership-conflict");
  });
});
