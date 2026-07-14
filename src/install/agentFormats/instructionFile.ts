import { createHash } from "node:crypto";

import { Either, ParseResult, Schema } from "effect";

import { agentCatalog, agentIdSchema } from "../../catalog/agentCatalog.js";
import { featureCatalog, installedSkillDefinitionSchema } from "../../catalog/featureCatalog.js";
import { artifactKindSchema, artifactOwnerSchema, managedBlockOwnershipSchema, relativeArtifactPathSchema } from "../artifactReceipt.js";

export const instructionBlockStartMarker = "<!-- dufflebag:skills start -->";
export const instructionBlockEndMarker = "<!-- dufflebag:skills end -->";

const templateToken = "@@CTL@@";
const textEncoder = new TextEncoder();
const startMarkerBytes = textEncoder.encode(instructionBlockStartMarker);
const endMarkerBytes = textEncoder.encode(instructionBlockEndMarker);
const lineFeedBytes = textEncoder.encode("\n");
const carriageReturnBytes = textEncoder.encode("\r");
const blockSeparatorBytes = textEncoder.encode("\n\n");
const leadingFrontmatterOpeningPattern = /^---(?:\r\n|\n)/;
const leadingFrontmatterBlockPattern = /^---(?:\r\n|\n)(?:[\s\S]*?(?:\r\n|\n))?---(?:(?:\r\n|\n)|$)/;
const catalogSkillDefinitionSchema = installedSkillDefinitionSchema.members[1];
const installedSkillsEqual = Schema.equivalence(catalogSkillDefinitionSchema);
const catalogInstalledSkills = featureCatalog.flatMap((feature) =>
  feature.installedSkill._tag === "skill" ? [feature.installedSkill] : [],
);

export class InstructionFilePlanError extends Schema.TaggedError<InstructionFilePlanError>()("InstructionFilePlanError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable instruction-file request or materialization issue.",
  }),
}) {
  get message(): string {
    return `Cannot plan instruction file: ${this.issue}`;
  }
}

const formatParseError = (error: ParseResult.ParseError): string => ParseResult.TreeFormatter.formatErrorSync(error);

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

const concatenateBytes = (values: ReadonlyArray<Uint8Array>): Uint8Array => {
  const length = values.reduce((total, value) => total + value.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;

  // Copy each owned byte segment into one deterministic result.
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }

  return result;
};

const findByteIndexes = (input: { bytes: Uint8Array; pattern: Uint8Array }): ReadonlyArray<number> => {
  const indexes: Array<number> = [];
  const lastStart = input.bytes.byteLength - input.pattern.byteLength;

  // Find every exact marker without decoding or normalizing surrounding bytes.
  for (let offset = 0; offset <= lastStart; offset += 1) {
    const matches = input.pattern.every((value, index) => input.bytes[offset + index] === value);
    if (matches) {
      indexes.push(offset);
    }
  }

  return indexes;
};

const missingManagedBlockSchema = Schema.TaggedStruct("missing", {});
const managedBlockLocationSchema = Schema.TaggedStruct("block", {
  start: Schema.NonNegativeInt,
  bodyStart: Schema.NonNegativeInt,
  bodyEnd: Schema.NonNegativeInt,
  end: Schema.NonNegativeInt,
});
const currentManagedBlockSchema = Schema.Union(missingManagedBlockSchema, managedBlockLocationSchema);

type ManagedBlockLocation = Schema.Schema.Type<typeof managedBlockLocationSchema>;
type CurrentManagedBlock = Schema.Schema.Type<typeof currentManagedBlockSchema>;

const inspectManagedBlock = (bytes: Uint8Array): Either.Either<CurrentManagedBlock, InstructionFilePlanError> => {
  const starts = findByteIndexes({ bytes, pattern: startMarkerBytes });
  const ends = findByteIndexes({ bytes, pattern: endMarkerBytes });
  if (starts.length === 0 && ends.length === 0) {
    return Either.right({ _tag: "missing" });
  }

  if (starts.length !== 1 || ends.length !== 1) {
    return Either.left(new InstructionFilePlanError({ issue: "managed block markers must occur exactly once as a pair." }));
  }

  const start = starts[0];
  const end = ends[0];
  if (start === undefined || end === undefined || end < start + startMarkerBytes.byteLength) {
    return Either.left(new InstructionFilePlanError({ issue: "managed block markers are reversed or overlap." }));
  }

  return Either.right({
    _tag: "block",
    start,
    bodyStart: start + startMarkerBytes.byteLength,
    bodyEnd: end,
    end: end + endMarkerBytes.byteLength,
  });
};

const hasCompleteLeadingFrontmatter = (markdown: string): boolean =>
  !leadingFrontmatterOpeningPattern.test(markdown) || leadingFrontmatterBlockPattern.test(markdown);

const stripLeadingFrontmatter = (markdown: string): string => markdown.replace(leadingFrontmatterBlockPattern, "").replaceAll("\r\n", "\n");

const instructionSkillSchema = Schema.Struct({
  installedSkill: catalogSkillDefinitionSchema.pipe(
    Schema.filter((installedSkill) => catalogInstalledSkills.some((candidate) => installedSkillsEqual(candidate, installedSkill)), {
      message: () => "Instruction-file installed skills must exactly match the decoded feature catalog.",
    }),
    Schema.annotations({
      description: "Catalog-owned installed skill rendered into the managed instruction block.",
    }),
  ),
  markdown: Schema.NonEmptyString.pipe(
    Schema.filter(hasCompleteLeadingFrontmatter, {
      message: () => "Leading YAML frontmatter must have exact opening and closing delimiter lines.",
    }),
    Schema.annotations({
      description: "Complete installed SKILL.md text before frontmatter removal and control-path substitution.",
    }),
  ),
});

export type InstructionSkill = Schema.Schema.Type<typeof instructionSkillSchema>;

const renderSkillSection = (skill: InstructionSkill, ctl: string) => {
  const body = stripLeadingFrontmatter(skill.markdown).split(templateToken).join(ctl).trim();
  if (body.length === 0) {
    return Either.left(new InstructionFilePlanError({ issue: `skill ${skill.installedSkill.id} has no markdown body after frontmatter.` }));
  }

  if (body.includes(instructionBlockStartMarker) || body.includes(instructionBlockEndMarker)) {
    return Either.left(
      new InstructionFilePlanError({ issue: `skill ${skill.installedSkill.id} contains a reserved managed block marker.` }),
    );
  }

  return Either.right(`## ${skill.installedSkill.id}\n\n${body}`);
};

const renderManagedBody = (skills: ReadonlyArray<InstructionSkill>, ctl: string) => {
  const sections = Either.all(skills.map((skill) => renderSkillSection(skill, ctl)));

  return Either.map(sections, (values) => textEncoder.encode(`\n${values.join("\n\n---\n\n")}\n`));
};

const replaceManagedBlock = (input: { currentBytes: Uint8Array; block: ManagedBlockLocation; desiredBlock: Uint8Array }): Uint8Array =>
  concatenateBytes([input.currentBytes.slice(0, input.block.start), input.desiredBlock, input.currentBytes.slice(input.block.end)]);

const appendedInstructionBytes = (currentBytes: Uint8Array, block: Uint8Array): Uint8Array =>
  concatenateBytes([currentBytes, blockSeparatorBytes, block, lineFeedBytes]);

const receiptedBlockRemovalRange = (input: {
  currentBytes: Uint8Array;
  block: ManagedBlockLocation;
  filePreviouslyPresent: boolean;
}): Either.Either<readonly [number, number], InstructionFilePlanError> => {
  const hasTrailingFrame = input.currentBytes[input.block.end] === lineFeedBytes[0];
  if (!hasTrailingFrame) {
    return Either.left(new InstructionFilePlanError({ issue: "managed block framing changed after the closing marker." }));
  }

  const end = input.block.end + lineFeedBytes.byteLength;
  if (!input.filePreviouslyPresent) {
    return Either.right([input.block.start, end]);
  }

  const frameStart = input.block.start - blockSeparatorBytes.byteLength;
  const frame = input.currentBytes.slice(frameStart, input.block.start);
  if (frameStart < 0 || !bytesEqual(frame, blockSeparatorBytes)) {
    return Either.left(new InstructionFilePlanError({ issue: "managed block framing changed before the opening marker." }));
  }

  return Either.right([frameStart, end]);
};

const stripReceiptedBlock = (input: { currentBytes: Uint8Array; block: ManagedBlockLocation; filePreviouslyPresent: boolean }) =>
  Either.map(receiptedBlockRemovalRange(input), ([start, end]) => {
    const prefix = input.currentBytes.slice(0, start);
    const suffix = input.currentBytes.slice(end);
    const suffixStartsLineEnding =
      suffix[0] === lineFeedBytes[0] || (suffix[0] === carriageReturnBytes[0] && suffix[1] === lineFeedBytes[0]);
    const needsSeparator =
      prefix.byteLength > 0 && suffix.byteLength > 0 && prefix[prefix.byteLength - 1] !== lineFeedBytes[0] && !suffixStartsLineEnding;

    return concatenateBytes([prefix, ...(needsSeparator ? [lineFeedBytes] : []), suffix]);
  });

const instructionAgentIdsSchema = Schema.NonEmptyArray(agentIdSchema).pipe(
  Schema.filter(
    (agentIds) =>
      Schema.is(artifactOwnerSchema)({
        _tag: "agent",
        agentIds,
      }),
    {
      message: () => "Instruction agents must be unique and use exact catalog order.",
    },
  ),
);

const instructionArtifactSchema = Schema.Struct({
  owner: artifactOwnerSchema.members[1].annotations({
    description: "Catalog agents that share this exact instruction artifact.",
  }),
  path: relativeArtifactPathSchema.annotations({
    description: "Catalog instruction path owned by the complete agent set.",
  }),
  kind: artifactKindSchema.members[3].annotations({
    description: "Artifact kind fixed to one shared instruction file.",
  }),
  ownership: managedBlockOwnershipSchema.annotations({
    description: "Exact managed block history and installed-body evidence.",
  }),
});

type InstructionArtifact = Schema.Schema.Type<typeof instructionArtifactSchema>;

const instructionWriteOperationFieldsSchema = Schema.TaggedStruct("write", {
  artifact: instructionArtifactSchema,
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Complete desired instruction-file bytes.",
  }),
});

const instructionRestoreOperationSchema = Schema.TaggedStruct("restore", {
  artifact: instructionArtifactSchema,
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Exact surrounding bytes left after the managed block is removed.",
  }),
});

const emptyInstructionBytesSchema = Schema.Uint8ArrayFromSelf.pipe(
  Schema.filter((bytes) => bytes.byteLength === 0, {
    message: () => "Instruction-file removal requires no remaining unowned bytes.",
  }),
);

const instructionRemoveOperationSchema = Schema.TaggedStruct("remove", {
  artifact: instructionArtifactSchema,
  unownedBytes: emptyInstructionBytesSchema,
}).pipe(
  Schema.filter((operation) =>
    operation.artifact.ownership.filePreviouslyPresent
      ? {
          path: ["artifact", "ownership", "filePreviouslyPresent"],
          message: "A pre-existing instruction file must be restored instead of removed.",
        }
      : undefined,
  ),
);

const instructionOperationFieldsSchema = Schema.Union(
  instructionWriteOperationFieldsSchema,
  instructionRestoreOperationSchema,
  instructionRemoveOperationSchema,
);

type InstructionOperationFields = Schema.Schema.Type<typeof instructionOperationFieldsSchema>;

const presentInstructionSchema = Schema.TaggedStruct("present", {
  agentIds: instructionAgentIdsSchema.annotations({
    description: "Catalog-ordered agents that share the desired instruction path.",
  }),
  skills: Schema.NonEmptyArray(instructionSkillSchema).pipe(
    Schema.filter((skills) => skills.length === new Set(skills.map((skill) => skill.installedSkill.id)).size, {
      message: () => "Instruction-file installed skills must be unique.",
    }),
    Schema.annotations({
      description: "Ordered catalog skills rendered into the desired managed block.",
    }),
  ),
  ctl: Schema.NonEmptyTrimmedString.pipe(
    Schema.filter((command) => !command.includes(templateToken), {
      message: () => "The control command cannot contain the unresolved template token.",
    }),
    Schema.annotations({
      description: "Concrete control command substituted for every @@CTL@@ placeholder.",
    }),
  ),
});

type PresentInstruction = Schema.Schema.Type<typeof presentInstructionSchema>;

const desiredInstructionSchema = Schema.Union(Schema.TaggedStruct("absent", {}), presentInstructionSchema);

const currentInstructionFileSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("file", {
    bytes: Schema.Uint8ArrayFromSelf.annotations({
      description: "Exact current instruction-file bytes inspected without normalization.",
    }),
  }),
);

const previousInstructionArtifactSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("owned", {
    artifact: Schema.typeSchema(instructionArtifactSchema).annotations({
      description: "Exact prior receipt entry authorizing replacement or restoration.",
    }),
  }),
);

const instructionFileRequestFieldsSchema = Schema.Struct({
  path: relativeArtifactPathSchema.annotations({
    description: "Shared instruction path planned exactly once for all desired consumers.",
  }),
  desired: desiredInstructionSchema.annotations({
    description: "Desired managed block and owners, or explicit absence for restoration.",
  }),
  currentFile: currentInstructionFileSchema,
  previousArtifact: previousInstructionArtifactSchema,
});

type InstructionFileRequestFields = Schema.Schema.Type<typeof instructionFileRequestFieldsSchema>;

const instructionPathForAgent = (agentId: string): string | undefined => {
  const agent = agentCatalog.find((candidate) => candidate.id === agentId);
  if (agent?.target._tag === "instructionFile") {
    return agent.target.path;
  }

  return agent?.target._tag === "configReference" ? agent.target.instructionPath : undefined;
};

const agentIdsMatchPath = (agentIds: ReadonlyArray<string>, path: string): boolean =>
  agentIds.every((agentId) => instructionPathForAgent(agentId) === path);

const requestIssues = (request: InstructionFileRequestFields) => {
  const previousArtifact = request.previousArtifact._tag === "owned" ? request.previousArtifact.artifact : undefined;

  return [
    request.desired._tag === "absent" || agentIdsMatchPath(request.desired.agentIds, request.path)
      ? undefined
      : {
          path: ["desired", "agentIds"],
          message: "Every desired agent must consume the exact shared instruction path from the catalog.",
        },
    previousArtifact === undefined || previousArtifact.path === request.path
      ? undefined
      : {
          path: ["previousArtifact", "artifact", "path"],
          message: "Prior instruction ownership must match the requested path.",
        },
    previousArtifact === undefined ||
    (previousArtifact.ownership.startMarker === instructionBlockStartMarker &&
      previousArtifact.ownership.endMarker === instructionBlockEndMarker)
      ? undefined
      : {
          path: ["previousArtifact", "artifact", "ownership"],
          message: "Prior instruction ownership must use the canonical managed-block markers.",
        },
    previousArtifact === undefined || agentIdsMatchPath(previousArtifact.owner.agentIds, request.path)
      ? undefined
      : {
          path: ["previousArtifact", "artifact", "owner"],
          message: "Every prior owner must legitimately consume this instruction path from the catalog.",
        },
    previousArtifact === undefined || request.currentFile._tag === "file"
      ? undefined
      : {
          path: ["currentFile"],
          message: "A receipted instruction artifact requires current file bytes.",
        },
  ];
};

export const instructionFileRequestSchema = instructionFileRequestFieldsSchema.pipe(Schema.filter(requestIssues));

export type InstructionFileRequest = Schema.Schema.Type<typeof instructionFileRequestSchema>;

const instructionOperationIssues = (operation: InstructionOperationFields) => {
  const ownership = operation.artifact.ownership;
  const issues: Array<{ path: ReadonlyArray<string>; message: string } | undefined> = [
    agentIdsMatchPath(operation.artifact.owner.agentIds, operation.artifact.path)
      ? undefined
      : {
          path: ["artifact", "owner"],
          message: "Instruction plan owners must consume the artifact path from the catalog.",
        },
  ];

  if (ownership.startMarker !== instructionBlockStartMarker || ownership.endMarker !== instructionBlockEndMarker) {
    issues.push({
      path: ["artifact", "ownership"],
      message: "Instruction ownership must use the canonical managed-block markers.",
    });
  }

  if (operation._tag !== "write") {
    return issues;
  }

  const block = inspectManagedBlock(operation.bytes);
  if (Either.isLeft(block) || block.right._tag === "missing") {
    issues.push({ path: ["bytes"], message: "Instruction writes must contain exactly one valid managed block." });

    return issues;
  }

  const body = operation.bytes.slice(block.right.bodyStart, block.right.bodyEnd);
  if (hashBytes(body) !== ownership.installedBodyHash) {
    issues.push({
      path: ["artifact", "ownership", "installedBodyHash"],
      message: "Instruction ownership hash must match the exact managed body bytes.",
    });
  }

  return issues;
};

const instructionOperationSchema = instructionOperationFieldsSchema.pipe(Schema.filter(instructionOperationIssues));

export const instructionFilePlanSchema = Schema.Union(Schema.TaggedStruct("none", {}), instructionOperationSchema);

export type InstructionFilePlan = Schema.Schema.Type<typeof instructionFilePlanSchema>;

const decodeInstructionRequest = (input: unknown): Either.Either<InstructionFileRequest, InstructionFilePlanError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(instructionFileRequestSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new InstructionFilePlanError({ issue: `request is invalid: ${formatParseError(error)}` }),
  );

const validateInstructionPlan = (input: unknown): Either.Either<InstructionFilePlan, InstructionFilePlanError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(instructionFilePlanSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new InstructionFilePlanError({ issue: `generated operation is invalid: ${formatParseError(error)}` }),
  );

const validateReceiptedBlock = (request: InstructionFileRequest, block: ManagedBlockLocation) => {
  if (request.previousArtifact._tag === "missing" || request.currentFile._tag === "missing") {
    return Either.left(new InstructionFilePlanError({ issue: "current managed block has no complete prior receipt evidence." }));
  }

  const ownership = request.previousArtifact.artifact.ownership;

  const currentBody = request.currentFile.bytes.slice(block.bodyStart, block.bodyEnd);
  if (hashBytes(currentBody) !== ownership.installedBodyHash) {
    return Either.left(new InstructionFilePlanError({ issue: "managed block changed inside its receipted body." }));
  }

  return Either.map(
    receiptedBlockRemovalRange({
      currentBytes: request.currentFile.bytes,
      block,
      filePreviouslyPresent: ownership.filePreviouslyPresent,
    }),
    () => ownership,
  );
};

const createInstructionArtifact = (input: {
  request: InstructionFileRequest;
  desired: PresentInstruction;
  installedBodyHash: string;
  filePreviouslyPresent: boolean;
}): InstructionArtifact => ({
  owner: { _tag: "agent", agentIds: input.desired.agentIds },
  path: input.request.path,
  kind: { _tag: "instruction" },
  ownership: {
    _tag: "managedBlock",
    filePreviouslyPresent: input.filePreviouslyPresent,
    startMarker: instructionBlockStartMarker,
    endMarker: instructionBlockEndMarker,
    installedBodyHash: input.installedBodyHash,
  },
});

const planInstructionWrite = (input: {
  request: InstructionFileRequest;
  desired: PresentInstruction;
  currentBlock: CurrentManagedBlock;
}): Either.Either<InstructionFilePlan, InstructionFilePlanError> => {
  const body = renderManagedBody(input.desired.skills, input.desired.ctl);
  if (Either.isLeft(body)) {
    return Either.left(body.left);
  }

  const blockBytes = concatenateBytes([startMarkerBytes, body.right, endMarkerBytes]);
  if (input.request.currentFile._tag === "missing") {
    return validateInstructionPlan({
      _tag: "write",
      artifact: createInstructionArtifact({
        request: input.request,
        desired: input.desired,
        installedBodyHash: hashBytes(body.right),
        filePreviouslyPresent: false,
      }),
      bytes: concatenateBytes([blockBytes, lineFeedBytes]),
    });
  }

  if (input.currentBlock._tag === "missing") {
    if (input.request.previousArtifact._tag === "owned") {
      return Either.left(new InstructionFilePlanError({ issue: "receipted managed block is missing from the current instruction file." }));
    }

    return validateInstructionPlan({
      _tag: "write",
      artifact: createInstructionArtifact({
        request: input.request,
        desired: input.desired,
        installedBodyHash: hashBytes(body.right),
        filePreviouslyPresent: true,
      }),
      bytes: appendedInstructionBytes(input.request.currentFile.bytes, blockBytes),
    });
  }

  const ownership = validateReceiptedBlock(input.request, input.currentBlock);
  if (Either.isLeft(ownership)) {
    return Either.left(ownership.left);
  }

  return validateInstructionPlan({
    _tag: "write",
    artifact: createInstructionArtifact({
      request: input.request,
      desired: input.desired,
      installedBodyHash: hashBytes(body.right),
      filePreviouslyPresent: ownership.right.filePreviouslyPresent,
    }),
    bytes: replaceManagedBlock({
      currentBytes: input.request.currentFile.bytes,
      block: input.currentBlock,
      desiredBlock: blockBytes,
    }),
  });
};

const planInstructionRemoval = (
  request: InstructionFileRequest,
  currentBlock: CurrentManagedBlock,
): Either.Either<InstructionFilePlan, InstructionFilePlanError> => {
  if (request.previousArtifact._tag === "missing") {
    return validateInstructionPlan({ _tag: "none" });
  }

  if (request.currentFile._tag === "missing" || currentBlock._tag === "missing") {
    return Either.left(new InstructionFilePlanError({ issue: "receipted managed block is missing from the current instruction file." }));
  }

  const ownership = validateReceiptedBlock(request, currentBlock);
  if (Either.isLeft(ownership)) {
    return Either.left(ownership.left);
  }

  const unownedBytes = stripReceiptedBlock({
    currentBytes: request.currentFile.bytes,
    block: currentBlock,
    filePreviouslyPresent: ownership.right.filePreviouslyPresent,
  });
  if (Either.isLeft(unownedBytes)) {
    return Either.left(unownedBytes.left);
  }

  const artifact = request.previousArtifact.artifact;

  return validateInstructionPlan(
    !ownership.right.filePreviouslyPresent && unownedBytes.right.byteLength === 0
      ? { _tag: "remove", artifact, unownedBytes: unownedBytes.right }
      : { _tag: "restore", artifact, bytes: unownedBytes.right },
  );
};

const materializeInstructionPlan = (request: InstructionFileRequest): Either.Either<InstructionFilePlan, InstructionFilePlanError> => {
  if (request.desired._tag === "absent" && request.previousArtifact._tag === "missing") {
    return validateInstructionPlan({ _tag: "none" });
  }

  const currentBlock = inspectManagedBlock(request.currentFile._tag === "missing" ? new Uint8Array() : request.currentFile.bytes);
  if (Either.isLeft(currentBlock)) {
    return Either.left(currentBlock.left);
  }

  return request.desired._tag === "absent"
    ? planInstructionRemoval(request, currentBlock.right)
    : planInstructionWrite({ request, desired: request.desired, currentBlock: currentBlock.right });
};

// Plan one shared instruction path: decode the request, then inspect and validate one direct action.
export const planInstructionFile = (input: unknown): Either.Either<InstructionFilePlan, InstructionFilePlanError> => {
  // 1. Decode the complete desired owner set, catalog skills, current bytes, and prior receipt.
  const request = decodeInstructionRequest(input);
  if (Either.isLeft(request)) {
    return Either.left(request.left);
  }

  // 2. Inspect exact bytes and validate one write, restoration, removal, or no-op.
  return materializeInstructionPlan(request.right);
};
