import { Either, Option, Schema } from "effect";

import { currentSnapshotMatches, desiredBytesMatch } from "../artifactMaterialization.js";
import { type OwnedArtifact, ownedArtifactSchema, scopeRelativePathSchema, sha256Bytes } from "../artifactReceipt.js";
import { renderRuleBody } from "./ruleFile.js";
import {
  type AgentFormatInput,
  type ArtifactCandidate,
  agentFormatInputSchema,
  agentFormatParseOptions,
  artifactCandidateSchema,
  observationForPath,
  priorArtifactForPath,
} from "./skillDirectory.js";

export const instructionStartMarker = "<!-- dufflebag:skills start -->";
export const instructionEndMarker = "<!-- dufflebag:skills end -->";

const instructionFileErrorCodeSchema = Schema.Literal(
  "invalid-input",
  "target-mismatch",
  "target-invalid",
  "skill-source-invalid",
  "frontmatter-unclosed",
  "unresolved-template",
  "observation-missing",
  "managed-block-conflict",
  "ownership-conflict",
);

export class InstructionFileFormatError extends Schema.TaggedError<InstructionFileFormatError>()("InstructionFileFormatError", {
  code: instructionFileErrorCodeSchema,
  message: Schema.String,
  cause: Schema.Defect,
}) {}

const concatBytes = (...values: ReadonlyArray<Uint8Array>): Uint8Array => {
  return new Uint8Array(Buffer.concat(values.map((value) => Buffer.from(value))));
};

const decodeUtf8 = (value: Uint8Array): Option.Option<string> => {
  try {
    return Option.some(new TextDecoder("utf-8", { fatal: true }).decode(value));
  } catch {
    return Option.none();
  }
};

const preferredNewline = (content: string): "\n" | "\r\n" => {
  const match = /\r\n|\n/.exec(content);

  return match?.[0] === "\r\n" ? "\r\n" : "\n";
};

type RenderInstructionBodyRequest = {
  readonly input: AgentFormatInput;
  readonly newline: "\n" | "\r\n";
};

const renderInstructionBody = ({ input, newline }: RenderInstructionBodyRequest): Either.Either<Uint8Array, InstructionFileFormatError> => {
  const sections: Array<Uint8Array> = [];

  // Preserve resolved skill order because section and separator order is part of the owned body hash.
  for (const payload of input.skills) {
    if (payload.installedSkill._tag !== "skill") {
      return Either.left(
        new InstructionFileFormatError({
          code: "invalid-input",
          message: "Every resolved payload must contain an installed skill.",
          cause: payload.installedSkill,
        }),
      );
    }

    const body = renderRuleBody(payload, input.templateValues);
    if (Either.isLeft(body)) {
      return Either.left(
        new InstructionFileFormatError({
          code: body.left.code,
          message: body.left.message,
          cause: body.left.cause,
        }),
      );
    }

    sections.push(concatBytes(new TextEncoder().encode(`## ${payload.installedSkill.id}${newline}${newline}`), body.right));
  }

  const separator = new TextEncoder().encode(`${newline}${newline}---${newline}${newline}`);
  const merged: Array<Uint8Array> = [];
  sections.forEach((section, index) => {
    if (index > 0) {
      merged.push(separator);
    }
    merged.push(section);
  });

  const body = concatBytes(new TextEncoder().encode(newline), ...merged, new TextEncoder().encode(newline));
  const text = Buffer.from(body).toString("utf8");
  if (text.includes(instructionStartMarker) || text.includes(instructionEndMarker)) {
    return Either.left(
      new InstructionFileFormatError({
        code: "managed-block-conflict",
        message: "An instruction body cannot contain Dufflebag's managed-block markers.",
        cause: text,
      }),
    );
  }

  return Either.right(body);
};

type ManagedSpan = {
  readonly ownedStart: number;
  readonly ownedEnd: number;
};

type ManagedMarkerRequest = {
  readonly content: Uint8Array;
  readonly startMarker: string;
  readonly endMarker: string;
};

const managedMarkersAreGloballyOrdered = ({ content, startMarker, endMarker }: ManagedMarkerRequest): boolean => {
  const bytes = Buffer.from(content);
  const start = Buffer.from(startMarker, "utf8");
  const end = Buffer.from(endMarker, "utf8");
  const startIndex = bytes.indexOf(start);
  const endIndex = bytes.indexOf(end);

  if (startIndex < 0 || endIndex <= startIndex) {
    return false;
  }

  return bytes.lastIndexOf(start) === startIndex && bytes.lastIndexOf(end) === endIndex;
};

const locatePreviousSpan = (content: Uint8Array, previous: OwnedArtifact): Option.Option<ManagedSpan> => {
  if (previous.ownership._tag !== "managedBlock") {
    return Option.none();
  }

  const bytes = Buffer.from(content);
  const startMarker = Buffer.from(previous.ownership.startMarker, "utf8");
  const endMarker = Buffer.from(previous.ownership.endMarker, "utf8");
  const start = bytes.indexOf(startMarker);
  const end = bytes.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    return Option.none();
  }

  const ownedStart = start - previous.ownership.leadingDelimiter.length;
  const ownedEnd = end + endMarker.length + previous.ownership.trailingDelimiter.length;

  return ownedStart >= 0 && ownedEnd <= bytes.length ? Option.some({ ownedStart, ownedEnd }) : Option.none();
};

type InstructionFileFailure = {
  readonly code: Schema.Schema.Type<typeof instructionFileErrorCodeSchema>;
  readonly message: string;
  readonly cause: unknown;
};

const fail = ({ code, message, cause }: InstructionFileFailure): Either.Either<never, InstructionFileFormatError> =>
  Either.left(
    new InstructionFileFormatError({
      code,
      message,
      cause,
    }),
  );

export const planInstructionFile = (input: unknown): Either.Either<ReadonlyArray<ArtifactCandidate>, InstructionFileFormatError> => {
  let decoded: AgentFormatInput;
  try {
    decoded = Schema.decodeUnknownSync(agentFormatInputSchema, agentFormatParseOptions)(input);
  } catch (cause) {
    return fail({ code: "invalid-input", message: "Instruction-file input does not match the strict format contract.", cause });
  }

  if (decoded.agent.target._tag !== "instructionFile") {
    return fail({
      code: "target-mismatch",
      message: "The instruction planner requires an instructionFile target tag.",
      cause: decoded.agent.target,
    });
  }

  const targetPathResult = Schema.decodeUnknownEither(scopeRelativePathSchema)(decoded.agent.target.path);
  if (Either.isLeft(targetPathResult)) {
    return fail({
      code: "target-invalid",
      message: "The instruction target must be a safe scope-relative path.",
      cause: targetPathResult.left,
    });
  }

  const targetPath = targetPathResult.right;
  if (decoded.skills.length === 0) {
    return Either.right([]);
  }

  const observation = observationForPath(decoded.observations, targetPath);
  if (Option.isNone(observation)) {
    return fail({
      code: "observation-missing",
      message: `No exact target observation was supplied for ${targetPath}.`,
      cause: targetPath,
    });
  }

  const existingBytes = observation.value.snapshot._tag === "missing" ? new Uint8Array() : observation.value.snapshot.bytes;
  const existingText = decodeUtf8(existingBytes);
  if (Option.isNone(existingText)) {
    return fail({
      code: "managed-block-conflict",
      message: `Instruction target ${targetPath} is not valid UTF-8.`,
      cause: existingBytes,
    });
  }

  const previous = priorArtifactForPath(decoded.priorArtifacts, targetPath);
  const newline = preferredNewline(existingText.value);
  const body = renderInstructionBody({ input: decoded, newline });
  if (Either.isLeft(body)) {
    return Either.left(body.left);
  }

  let leadingDelimiter: Uint8Array;
  let trailingDelimiter: Uint8Array;
  let priorDocument: { readonly _tag: "missing" } | { readonly _tag: "existing" };
  let candidateBytes: Uint8Array;

  if (Option.isSome(previous)) {
    if (
      previous.value.kind !== "instruction" ||
      previous.value.ownership._tag !== "managedBlock" ||
      previous.value.ownership.startMarker !== instructionStartMarker ||
      previous.value.ownership.endMarker !== instructionEndMarker ||
      !managedMarkersAreGloballyOrdered({
        content: existingBytes,
        startMarker: instructionStartMarker,
        endMarker: instructionEndMarker,
      }) ||
      !currentSnapshotMatches({ artifact: previous.value, observation: observation.value, target: "installed" })
    ) {
      return fail({
        code: "ownership-conflict",
        message: `The prior receipt does not authorize replacing ${targetPath}.`,
        cause: previous.value,
      });
    }

    const span = locatePreviousSpan(existingBytes, previous.value);
    if (Option.isNone(span)) {
      return fail({
        code: "ownership-conflict",
        message: `The receipted managed block cannot be located at ${targetPath}.`,
        cause: previous.value,
      });
    }

    leadingDelimiter = previous.value.ownership.leadingDelimiter;
    trailingDelimiter = previous.value.ownership.trailingDelimiter;
    priorDocument = previous.value.ownership.priorDocument;
    const block = concatBytes(
      leadingDelimiter,
      new TextEncoder().encode(instructionStartMarker),
      body.right,
      new TextEncoder().encode(instructionEndMarker),
      trailingDelimiter,
    );
    candidateBytes = concatBytes(existingBytes.subarray(0, span.value.ownedStart), block, existingBytes.subarray(span.value.ownedEnd));
  } else {
    if (existingText.value.includes(instructionStartMarker) || existingText.value.includes(instructionEndMarker)) {
      return fail({
        code: "managed-block-conflict",
        message: `Unreceipted managed-marker text exists at ${targetPath}.`,
        cause: targetPath,
      });
    }

    const encodedNewline = new TextEncoder().encode(newline);
    leadingDelimiter =
      existingBytes.length === 0
        ? new Uint8Array()
        : existingText.value.endsWith(newline)
          ? encodedNewline
          : concatBytes(encodedNewline, encodedNewline);
    trailingDelimiter = encodedNewline;
    priorDocument = observation.value.snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "existing" };
    candidateBytes = concatBytes(
      existingBytes,
      leadingDelimiter,
      new TextEncoder().encode(instructionStartMarker),
      body.right,
      new TextEncoder().encode(instructionEndMarker),
      trailingDelimiter,
    );
  }

  const artifactResult = Schema.decodeUnknownEither(
    Schema.typeSchema(ownedArtifactSchema),
    agentFormatParseOptions,
  )({
    path: targetPath,
    owner: { _tag: "agent", agentIds: [decoded.agent.id] },
    kind: "instruction",
    ownership: {
      _tag: "managedBlock",
      startMarker: instructionStartMarker,
      endMarker: instructionEndMarker,
      installedBodySha256: sha256Bytes(body.right),
      leadingDelimiter,
      trailingDelimiter,
      priorDocument,
    },
  });
  if (Either.isLeft(artifactResult)) {
    return fail({
      code: "target-invalid",
      message: `The instruction ownership metadata is invalid for ${targetPath}.`,
      cause: artifactResult.left,
    });
  }

  if (
    !desiredBytesMatch({
      artifact: artifactResult.right,
      candidateBytes,
      observation: observation.value,
      previous,
    })
  ) {
    return fail({
      code: "ownership-conflict",
      message: `The instruction candidate cannot be derived from authorized bytes at ${targetPath}.`,
      cause: targetPath,
    });
  }

  const candidateResult = Schema.decodeUnknownEither(
    artifactCandidateSchema,
    agentFormatParseOptions,
  )({
    artifact: artifactResult.right,
    bytes: candidateBytes,
  });

  return Either.isLeft(candidateResult)
    ? fail({
        code: "target-invalid",
        message: `The instruction candidate is invalid for ${targetPath}.`,
        cause: candidateResult.left,
      })
    : Either.right([candidateResult.right]);
};
