import path from "node:path";
import { Either, Option, Schema, type SchemaAST } from "effect";

import { type AgentId, agentDefinitionSchema } from "../../catalog/agentCatalog.js";
import { type InstalledSkill, installedSkillDefinitionSchema } from "../../catalog/featureCatalog.js";
import {
  type ArtifactObservation,
  artifactObservationSchema,
  currentSnapshotMatches,
  desiredBytesMatch,
} from "../artifactMaterialization.js";
import { type OwnedArtifact, ownedArtifactSchema, scopeRelativePathSchema, sha256Bytes } from "../artifactReceipt.js";

export const agentFormatParseOptions = {
  onExcessProperty: "error",
} satisfies SchemaAST.ParseOptions;

const uniqueValues = (values: ReadonlyArray<string>): boolean => new Set(values).size === values.length;

const installedSkillSchema = installedSkillDefinitionSchema.pipe(
  Schema.filter((installedSkill): installedSkill is InstalledSkill => installedSkill._tag === "skill", {
    message: () => "Resolved agent-format payloads require an installed skill.",
  }),
);

export const sourceSkillFileSchema = Schema.Struct({
  path: scopeRelativePathSchema,
  bytes: Schema.Uint8ArrayFromSelf,
}).annotations({
  parseOptions: agentFormatParseOptions,
});

export type SourceSkillFile = Schema.Schema.Type<typeof sourceSkillFileSchema>;

export const resolvedSkillPayloadSchema = Schema.Struct({
  installedSkill: installedSkillSchema,
  sourceFiles: Schema.Array(sourceSkillFileSchema).pipe(
    Schema.filter((sourceFiles) => uniqueValues(sourceFiles.map((sourceFile) => sourceFile.path)), {
      message: () => "Resolved source files must have unique relative paths.",
    }),
  ),
}).annotations({
  parseOptions: agentFormatParseOptions,
});

export type ResolvedSkillPayload = Schema.Schema.Type<typeof resolvedSkillPayloadSchema>;

const templateValuesSchema = Schema.Struct({
  ctl: Schema.NonEmptyString.annotations({
    description: "Target-local control script path substituted for every @@CTL@@ source token.",
  }),
}).annotations({
  parseOptions: agentFormatParseOptions,
});

export type AgentFormatTemplateValues = Schema.Schema.Type<typeof templateValuesSchema>;

export const agentFormatInputSchema = Schema.Struct({
  agent: agentDefinitionSchema,
  skills: Schema.Array(resolvedSkillPayloadSchema).pipe(
    Schema.filter(
      (skills) => uniqueValues(skills.flatMap(({ installedSkill }) => (installedSkill._tag === "skill" ? [installedSkill.id] : []))),
      {
        message: () => "Resolved installed skills must be unique and ordered.",
      },
    ),
  ),
  observations: Schema.Array(Schema.typeSchema(artifactObservationSchema)).pipe(
    Schema.filter((observations) => uniqueValues(observations.map((observation) => observation.path)), {
      message: () => "Observed target paths must be unique.",
    }),
  ),
  priorArtifacts: Schema.Array(Schema.typeSchema(ownedArtifactSchema)).pipe(
    Schema.filter((artifacts) => uniqueValues(artifacts.map((artifact) => artifact.path)), {
      message: () => "Prior receipt artifact paths must be unique.",
    }),
  ),
  templateValues: templateValuesSchema,
}).annotations({
  parseOptions: agentFormatParseOptions,
});

export type AgentFormatInput = Schema.Schema.Type<typeof agentFormatInputSchema>;

export const artifactCandidateSchema = Schema.Struct({
  artifact: Schema.typeSchema(ownedArtifactSchema),
  bytes: Schema.Uint8ArrayFromSelf,
}).annotations({
  parseOptions: agentFormatParseOptions,
});

export type ArtifactCandidate = Schema.Schema.Type<typeof artifactCandidateSchema>;

const skillDirectoryErrorCodeSchema = Schema.Literal(
  "invalid-input",
  "target-mismatch",
  "target-invalid",
  "allowlist-unmatched",
  "duplicate-destination",
  "unresolved-template",
  "observation-missing",
  "ownership-conflict",
);

export class SkillDirectoryFormatError extends Schema.TaggedError<SkillDirectoryFormatError>()("SkillDirectoryFormatError", {
  code: skillDirectoryErrorCodeSchema,
  message: Schema.String,
  cause: Schema.Defect,
}) {}

const unresolvedTemplatePattern = /@@[A-Z][A-Z0-9_]*@@/;
const ctlToken = Buffer.from("@@CTL@@", "utf8");

export const substituteSkillTemplates = (sourceBytes: Uint8Array, templateValues: AgentFormatTemplateValues): Option.Option<Uint8Array> => {
  const source = Buffer.from(sourceBytes);
  const replacement = Buffer.from(templateValues.ctl, "utf8");
  const pieces: Array<Uint8Array> = [];
  let cursor = 0;
  let match = source.indexOf(ctlToken, cursor);

  // Advance monotonically so every raw token is replaced without decoding binary source files.
  while (match >= 0) {
    pieces.push(source.subarray(cursor, match), replacement);
    cursor = match + ctlToken.length;
    match = source.indexOf(ctlToken, cursor);
  }

  pieces.push(source.subarray(cursor));
  const result = new Uint8Array(Buffer.concat(pieces.map((piece) => Buffer.from(piece))));

  return unresolvedTemplatePattern.test(Buffer.from(result).toString("latin1")) ? Option.none() : Option.some(result);
};

export const observationForPath = (
  observations: ReadonlyArray<ArtifactObservation>,
  targetPath: string,
): Option.Option<ArtifactObservation> => Option.fromNullable(observations.find((observation) => observation.path === targetPath));

export const priorArtifactForPath = (artifacts: ReadonlyArray<OwnedArtifact>, targetPath: string): Option.Option<OwnedArtifact> =>
  Option.fromNullable(artifacts.find((artifact) => artifact.path === targetPath));

const wholeFilePlanningIssueSchema = Schema.Struct({
  code: Schema.Literal("target-invalid", "observation-missing", "ownership-conflict"),
  message: Schema.String,
  cause: Schema.Defect,
}).annotations({
  parseOptions: agentFormatParseOptions,
});

export type WholeFilePlanningIssue = Schema.Schema.Type<typeof wholeFilePlanningIssueSchema>;

type WholeFileCandidateRequest = {
  readonly path: string;
  readonly agentId: AgentId;
  readonly kind: "skill" | "rule";
  readonly bytes: Uint8Array;
  readonly observations: ReadonlyArray<ArtifactObservation>;
  readonly priorArtifacts: ReadonlyArray<OwnedArtifact>;
};

export const planWholeFileCandidate = ({
  path: targetPath,
  agentId,
  kind,
  bytes,
  observations,
  priorArtifacts,
}: WholeFileCandidateRequest): Either.Either<ArtifactCandidate, WholeFilePlanningIssue> => {
  const observation = observationForPath(observations, targetPath);
  if (Option.isNone(observation)) {
    return Either.left({
      code: "observation-missing",
      message: `No exact target observation was supplied for ${targetPath}.`,
      cause: targetPath,
    });
  }

  const previous = priorArtifactForPath(priorArtifacts, targetPath);
  if (Option.isSome(previous)) {
    if (
      previous.value.kind !== kind ||
      previous.value.ownership._tag !== "wholeFile" ||
      !currentSnapshotMatches({ artifact: previous.value, observation: observation.value, target: "installed" })
    ) {
      return Either.left({
        code: "ownership-conflict",
        message: `The prior receipt does not authorize replacing ${targetPath}.`,
        cause: previous.value,
      });
    }
  }

  const prior =
    Option.isSome(previous) && previous.value.ownership._tag === "wholeFile"
      ? previous.value.ownership.prior
      : observation.value.snapshot._tag === "missing"
        ? { _tag: "missing" }
        : {
            _tag: "file",
            bytes: observation.value.snapshot.bytes,
            sha256: observation.value.snapshot.sha256,
          };
  const artifactResult = Schema.decodeUnknownEither(
    Schema.typeSchema(ownedArtifactSchema),
    agentFormatParseOptions,
  )({
    path: targetPath,
    owner: { _tag: "agent", agentIds: [agentId] },
    kind,
    ownership: {
      _tag: "wholeFile",
      installedSha256: sha256Bytes(bytes),
      prior,
    },
  });
  if (Either.isLeft(artifactResult)) {
    return Either.left({
      code: "target-invalid",
      message: `The planned whole-file target is invalid: ${targetPath}.`,
      cause: artifactResult.left,
    });
  }

  if (!desiredBytesMatch({ artifact: artifactResult.right, candidateBytes: bytes, observation: observation.value, previous })) {
    return Either.left({
      code: "ownership-conflict",
      message: `The desired bytes cannot be derived from the authorized state at ${targetPath}.`,
      cause: targetPath,
    });
  }

  const candidateResult = Schema.decodeUnknownEither(
    artifactCandidateSchema,
    agentFormatParseOptions,
  )({
    artifact: artifactResult.right,
    bytes,
  });

  return Either.isLeft(candidateResult)
    ? Either.left({
        code: "target-invalid",
        message: `The planned whole-file candidate is invalid: ${targetPath}.`,
        cause: candidateResult.left,
      })
    : Either.right(candidateResult.right);
};

type SkillDirectoryFailure = {
  readonly code: Schema.Schema.Type<typeof skillDirectoryErrorCodeSchema>;
  readonly message: string;
  readonly cause: unknown;
};

const fail = ({ code, message, cause }: SkillDirectoryFailure): Either.Either<never, SkillDirectoryFormatError> =>
  Either.left(
    new SkillDirectoryFormatError({
      code,
      message,
      cause,
    }),
  );

const compareSourcePaths = (left: SourceSkillFile, right: SourceSkillFile): number => {
  if (left.path < right.path) {
    return -1;
  }

  return left.path > right.path ? 1 : 0;
};

type AllowlistCandidateRequest = {
  readonly input: AgentFormatInput;
  readonly payload: ResolvedSkillPayload;
  readonly directory: string;
  readonly allowlistPath: string;
  readonly destinations: ReadonlySet<string>;
};

type CandidateBatch = {
  readonly candidates: ReadonlyArray<ArtifactCandidate>;
  readonly destinations: ReadonlySet<string>;
};

const planAllowlistCandidates = ({
  input,
  payload,
  directory,
  allowlistPath,
  destinations,
}: AllowlistCandidateRequest): Either.Either<CandidateBatch, SkillDirectoryFormatError> => {
  if (payload.installedSkill._tag !== "skill") {
    return fail({
      code: "invalid-input",
      message: "Every resolved payload must contain an installed skill.",
      cause: payload.installedSkill,
    });
  }

  const allowlistResult = Schema.decodeUnknownEither(scopeRelativePathSchema)(allowlistPath);
  if (Either.isLeft(allowlistResult)) {
    return fail({
      code: "target-invalid",
      message: `Skill ${payload.installedSkill.id} declares an invalid shipped path.`,
      cause: allowlistResult.left,
    });
  }

  const matches = payload.sourceFiles
    .filter((sourceFile) => sourceFile.path === allowlistPath || sourceFile.path.startsWith(`${allowlistPath}/`))
    .sort(compareSourcePaths);
  if (matches.length === 0) {
    return fail({
      code: "allowlist-unmatched",
      message: `Skill ${payload.installedSkill.id} shipped path ${allowlistPath} matches no exact source file.`,
      cause: allowlistPath,
    });
  }

  const candidates: Array<ArtifactCandidate> = [];
  const nextDestinations = new Set(destinations);

  // Preserve lexical source order while rejecting overlap with every previously expanded allowlist entry.
  for (const sourceFile of matches) {
    const targetPath = path.posix.join(directory, payload.installedSkill.id, sourceFile.path);
    if (nextDestinations.has(targetPath)) {
      return fail({
        code: "duplicate-destination",
        message: `Multiple allowlist entries resolve to ${targetPath}.`,
        cause: targetPath,
      });
    }
    nextDestinations.add(targetPath);

    const substituted = substituteSkillTemplates(sourceFile.bytes, input.templateValues);
    if (Option.isNone(substituted)) {
      return fail({
        code: "unresolved-template",
        message: `Skill source ${sourceFile.path} contains an undeclared template token.`,
        cause: sourceFile.path,
      });
    }

    const candidate = planWholeFileCandidate({
      path: targetPath,
      agentId: input.agent.id,
      kind: "skill",
      bytes: substituted.value,
      observations: input.observations,
      priorArtifacts: input.priorArtifacts,
    });
    if (Either.isLeft(candidate)) {
      return fail({ code: candidate.left.code, message: candidate.left.message, cause: candidate.left.cause });
    }

    candidates.push(candidate.right);
  }

  return Either.right({ candidates, destinations: nextDestinations });
};

type SkillPayloadCandidateRequest = {
  readonly input: AgentFormatInput;
  readonly payload: ResolvedSkillPayload;
  readonly directory: string;
  readonly destinations: ReadonlySet<string>;
};

const planSkillPayloadCandidates = ({
  input,
  payload,
  directory,
  destinations,
}: SkillPayloadCandidateRequest): Either.Either<CandidateBatch, SkillDirectoryFormatError> => {
  if (payload.installedSkill._tag !== "skill") {
    return fail({
      code: "invalid-input",
      message: "Every resolved payload must contain an installed skill.",
      cause: payload.installedSkill,
    });
  }

  const candidates: Array<ArtifactCandidate> = [];
  let nextDestinations = destinations;

  // Preserve the declared allowlist order because it is part of deterministic artifact planning.
  for (const allowlistPath of payload.installedSkill.shippedPaths) {
    const planned = planAllowlistCandidates({ input, payload, directory, allowlistPath, destinations: nextDestinations });
    if (Either.isLeft(planned)) {
      return planned;
    }
    candidates.push(...planned.right.candidates);
    nextDestinations = planned.right.destinations;
  }

  return Either.right({ candidates, destinations: nextDestinations });
};

export const planSkillDirectory = (input: unknown): Either.Either<ReadonlyArray<ArtifactCandidate>, SkillDirectoryFormatError> => {
  let decoded: AgentFormatInput;
  try {
    decoded = Schema.decodeUnknownSync(agentFormatInputSchema, agentFormatParseOptions)(input);
  } catch (cause) {
    return fail({ code: "invalid-input", message: "Skill-directory input does not match the strict format contract.", cause });
  }

  if (decoded.agent.target._tag !== "skillDirectory") {
    return fail({
      code: "target-mismatch",
      message: "The skill-directory planner requires a skillDirectory target tag.",
      cause: decoded.agent.target,
    });
  }

  const directoryResult = Schema.decodeUnknownEither(scopeRelativePathSchema)(decoded.agent.target.directory);
  if (Either.isLeft(directoryResult)) {
    return fail({
      code: "target-invalid",
      message: "The skill-directory target must be a safe scope-relative path.",
      cause: directoryResult.left,
    });
  }

  const candidates: Array<ArtifactCandidate> = [];
  let destinations: ReadonlySet<string> = new Set<string>();

  // Preserve resolved skill and allowlist order while sorting only the files expanded by each declared entry.
  for (const payload of decoded.skills) {
    const planned = planSkillPayloadCandidates({
      input: decoded,
      payload,
      directory: directoryResult.right,
      destinations,
    });
    if (Either.isLeft(planned)) {
      return Either.left(planned.left);
    }
    candidates.push(...planned.right.candidates);
    destinations = planned.right.destinations;
  }

  return Either.right(candidates);
};
