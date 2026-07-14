import { createHash } from "node:crypto";

import { Either, ParseResult, Schema } from "effect";

import { agentCatalog, agentDefinitionSchema } from "../../catalog/agentCatalog.js";
import { featureCatalog, installedSkillDefinitionSchema } from "../../catalog/featureCatalog.js";
import { writeOperationSchema } from "../artifactPlan.js";
import {
  artifactKindSchema,
  artifactOwnerSchema,
  previousFileValueSchema,
  relativeArtifactPathSchema,
  wholeFileOwnershipSchema,
} from "../artifactReceipt.js";

const templateToken = "@@CTL@@";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const agentDefinitionsEqual = Schema.equivalence(agentDefinitionSchema);
const catalogSkillDefinitionSchema = installedSkillDefinitionSchema.members[1];
const installedSkillsEqual = Schema.equivalence(catalogSkillDefinitionSchema);
const catalogInstalledSkills = featureCatalog.flatMap((feature) =>
  feature.installedSkill._tag === "skill" ? [feature.installedSkill] : [],
);

export class SkillDirectoryPlanError extends Schema.TaggedError<SkillDirectoryPlanError>()("SkillDirectoryPlanError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable skill-directory request or generated-plan validation issue.",
  }),
}) {
  get message(): string {
    return `Cannot plan a skill directory: ${this.issue}`;
  }
}

const formatParseError = (error: ParseResult.ParseError): string => ParseResult.TreeFormatter.formatErrorSync(error);

const normalizedPath = (path: string): string => path.toLowerCase();

const duplicatePathIssues = (paths: ReadonlyArray<string>) =>
  paths.flatMap((path, index) => {
    const duplicateIndex = paths.findIndex((candidate) => normalizedPath(candidate) === normalizedPath(path));

    return duplicateIndex === index
      ? []
      : [
          {
            path: [index],
            message: `Path ${path} conflicts with an earlier case-insensitive path.`,
          },
        ];
  });

const parentFileIssues = (paths: ReadonlyArray<string>) =>
  paths.flatMap((path, index) =>
    paths.some((candidate) => normalizedPath(candidate).startsWith(`${normalizedPath(path)}/`))
      ? [
          {
            path: [index],
            message: `Path ${path} cannot be both a file and directory.`,
          },
        ]
      : [],
  );

const isShippedFilePath = (path: string): boolean => /(?:^|\/)[^/]+\.[^/]+$/.test(path);

const matchesShippedPath = (path: string, shippedPath: string): boolean =>
  path === shippedPath || (!isShippedFilePath(shippedPath) && path.startsWith(`${shippedPath}/`));

const sourceFileSchema = Schema.Struct({
  path: relativeArtifactPathSchema.annotations({
    description: "File path relative to one staged installed-skill directory.",
  }),
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Exact staged source bytes read before pure format planning.",
  }),
});

const stagedSkillFieldsSchema = Schema.Struct({
  installedSkill: catalogSkillDefinitionSchema.annotations({
    description: "Catalog-owned installed skill and its exact shipped-path allowlist.",
  }),
  sourceFiles: Schema.Array(sourceFileSchema).annotations({
    description: "Complete staged file snapshot for this installed skill.",
  }),
});

type StagedSkillFields = Schema.Schema.Type<typeof stagedSkillFieldsSchema>;

const shippedPathShapeIssues = (skill: StagedSkillFields) =>
  skill.installedSkill.shippedPaths.flatMap((shippedPath) => {
    const rootIndex = skill.sourceFiles.findIndex((file) => normalizedPath(file.path) === normalizedPath(shippedPath));
    const descendantIndex = skill.sourceFiles.findIndex((file) => normalizedPath(file.path).startsWith(`${normalizedPath(shippedPath)}/`));
    const shippedPathIsFile = isShippedFilePath(shippedPath);

    return [
      shippedPathIsFile && descendantIndex >= 0
        ? {
            path: ["sourceFiles", descendantIndex, "path"],
            message: `Shipped file path ${shippedPath} cannot be staged as a directory.`,
          }
        : undefined,
      !shippedPathIsFile && rootIndex >= 0
        ? {
            path: ["sourceFiles", rootIndex, "path"],
            message: `Shipped directory root ${shippedPath} must contain staged descendant files.`,
          }
        : undefined,
    ];
  });

const stagedSkillIssues = (skill: StagedSkillFields) => [
  catalogInstalledSkills.some((candidate) => installedSkillsEqual(candidate, skill.installedSkill))
    ? undefined
    : {
        path: ["installedSkill"],
        message: "Installed skill definitions must exactly match the decoded feature catalog.",
      },
  ...duplicatePathIssues(skill.sourceFiles.map((file) => file.path)).map((issue) => ({
    ...issue,
    path: ["sourceFiles", ...issue.path],
  })),
  ...parentFileIssues(skill.sourceFiles.map((file) => file.path)).map((issue) => ({
    ...issue,
    path: ["sourceFiles", ...issue.path],
  })),
  ...shippedPathShapeIssues(skill),
];

const stagedSkillSchema = stagedSkillFieldsSchema.pipe(Schema.filter(stagedSkillIssues));

const previousSkillFileSchema = Schema.Struct({
  path: relativeArtifactPathSchema.annotations({
    description: "Exact desired destination whose restoration state is known.",
  }),
  previous: Schema.typeSchema(previousFileValueSchema).annotations({
    description: "Exact file state from before this destination first became owned.",
  }),
});

const skillDirectoryAgentFieldsSchema = Schema.Struct({
  ...agentDefinitionSchema.fields,
  target: agentDefinitionSchema.fields.target.members[0],
});

const skillDirectoryAgentSchema = skillDirectoryAgentFieldsSchema.pipe(
  Schema.filter((agent) => [
    agentCatalog.some((candidate) => agentDefinitionsEqual(candidate, agent))
      ? undefined
      : {
          path: [],
          message: "Agent definitions must exactly match the decoded agent catalog.",
        },
  ]),
);

const skillDirectoryRequestFieldsSchema = Schema.Struct({
  agent: skillDirectoryAgentSchema.annotations({
    description: "Catalog agent whose skill-directory target receives the desired files.",
  }),
  ctl: Schema.NonEmptyTrimmedString.pipe(
    Schema.filter((command) => !command.includes(templateToken), {
      message: () => "The control command cannot contain the template token.",
    }),
    Schema.annotations({
      description: "Concrete control command substituted into UTF-8 staged files.",
    }),
  ),
  skills: Schema.Array(stagedSkillSchema).annotations({
    description: "Ordered installed skills with complete staged source snapshots.",
  }),
  previousFiles: Schema.Array(previousSkillFileSchema).annotations({
    description: "One exact restoration state for every desired destination.",
  }),
});

type SkillDirectoryRequestFields = Schema.Schema.Type<typeof skillDirectoryRequestFieldsSchema>;

const isShippedSourceFile = (path: string, shippedPaths: ReadonlyArray<string>): boolean =>
  shippedPaths.some((shippedPath) => matchesShippedPath(path, shippedPath));

const selectedSourceFiles = (request: SkillDirectoryRequestFields) => {
  const targetPath = request.agent.target.path;

  return request.skills.flatMap((skill) => {
    const installedSkill = skill.installedSkill;

    return skill.sourceFiles
      .filter((file) => isShippedSourceFile(file.path, installedSkill.shippedPaths))
      .sort((left, right) => {
        if (left.path < right.path) {
          return -1;
        }

        if (left.path > right.path) {
          return 1;
        }

        return 0;
      })
      .map((file) => ({
        destination: `${targetPath}/${installedSkill.id}/${file.path}`,
        source: file,
      }));
  });
};

const missingShippedPathIssues = (skills: ReadonlyArray<StagedSkillFields>) =>
  skills.flatMap((skill, skillIndex) => {
    return skill.installedSkill.shippedPaths.flatMap((shippedPath, shippedPathIndex) =>
      skill.sourceFiles.some((file) => matchesShippedPath(file.path, shippedPath))
        ? []
        : [
            {
              path: ["skills", skillIndex, "installedSkill", "shippedPaths", shippedPathIndex],
              message: `Shipped path ${shippedPath} has no staged file or directory descendants.`,
            },
          ],
    );
  });

const duplicateInstalledSkillIssues = (skills: ReadonlyArray<StagedSkillFields>) =>
  skills.flatMap((skill, index) => {
    const installedSkillId = skill.installedSkill.id;
    const firstIndex = skills.findIndex((candidate) => candidate.installedSkill.id === installedSkillId);

    return firstIndex === index
      ? []
      : [
          {
            path: ["skills", index, "installedSkill", "id"],
            message: `Installed skill ${installedSkillId} appears more than once.`,
          },
        ];
  });

const previousFileIssues = (request: SkillDirectoryRequestFields) => {
  const desiredPaths = selectedSourceFiles(request).map((file) => file.destination);

  return [
    ...desiredPaths.flatMap((path) =>
      request.previousFiles.some((file) => file.path === path)
        ? []
        : [
            {
              path: ["previousFiles"],
              message: `Desired skill file ${path} requires one exact previous-file state.`,
            },
          ],
    ),
    ...request.previousFiles.flatMap((file, index) =>
      desiredPaths.includes(file.path)
        ? []
        : [
            {
              path: ["previousFiles", index, "path"],
              message: `Previous-file state ${file.path} does not belong to a desired skill file.`,
            },
          ],
    ),
  ];
};

const skillDirectoryRequestIssues = (request: SkillDirectoryRequestFields) => [
  ...duplicateInstalledSkillIssues(request.skills),
  ...missingShippedPathIssues(request.skills),
  ...duplicatePathIssues(request.previousFiles.map((file) => file.path)).map((issue) => ({
    ...issue,
    path: ["previousFiles", ...issue.path],
  })),
  ...duplicatePathIssues(selectedSourceFiles(request).map((file) => file.destination)).map((issue) => ({
    ...issue,
    path: ["skills", ...issue.path],
  })),
  ...previousFileIssues(request),
];

export const skillDirectoryRequestSchema = skillDirectoryRequestFieldsSchema.pipe(Schema.filter(skillDirectoryRequestIssues));

export type SkillDirectoryRequest = Schema.Schema.Type<typeof skillDirectoryRequestSchema>;

const skillArtifactSchema = Schema.Struct({
  owner: artifactOwnerSchema.members[1],
  path: relativeArtifactPathSchema,
  kind: artifactKindSchema.members[1],
  ownership: wholeFileOwnershipSchema,
});

const skillDirectoryWriteFieldsSchema = Schema.TaggedStruct("write", {
  artifact: skillArtifactSchema,
  bytes: writeOperationSchema.fields.bytes,
});

const skillDirectoryWriteSchema = skillDirectoryWriteFieldsSchema.pipe(
  Schema.filter((operation) => [
    operation.artifact.ownership.installedHash !== createHash("sha256").update(operation.bytes).digest("hex")
      ? {
          path: ["artifact", "ownership", "installedHash"],
          message: "Skill ownership hash must match the exact desired bytes.",
        }
      : undefined,
  ]),
);

const skillDirectoryPlanFieldsSchema = Schema.Struct({
  writes: Schema.Array(skillDirectoryWriteSchema).annotations({
    description: "Exact desired skill-file writes with matching whole-file ownership.",
  }),
});

type SkillDirectoryPlanFields = Schema.Schema.Type<typeof skillDirectoryPlanFieldsSchema>;

const skillDirectoryPlanIssues = (plan: SkillDirectoryPlanFields) =>
  duplicatePathIssues(plan.writes.map((write) => write.artifact.path)).map((issue) => ({
    ...issue,
    path: ["writes", ...issue.path],
  }));

export const skillDirectoryPlanSchema = skillDirectoryPlanFieldsSchema.pipe(Schema.filter(skillDirectoryPlanIssues));

export type SkillDirectoryPlan = Schema.Schema.Type<typeof skillDirectoryPlanSchema>;

const decodeSkillDirectoryRequest = (input: unknown): Either.Either<SkillDirectoryRequest, SkillDirectoryPlanError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(skillDirectoryRequestSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new SkillDirectoryPlanError({ issue: formatParseError(error) }),
  );

const validateSkillDirectoryPlan = (input: unknown): Either.Either<SkillDirectoryPlan, SkillDirectoryPlanError> =>
  Either.mapLeft(
    Schema.validateEither(skillDirectoryPlanSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new SkillDirectoryPlanError({ issue: formatParseError(error) }),
  );

const renderSkillBytes = (bytes: Uint8Array, ctl: string): Uint8Array => {
  const text = Either.try({
    try: () => textDecoder.decode(bytes),
    catch: () => undefined,
  });

  if (Either.isLeft(text) || text.right === undefined || !text.right.includes(templateToken)) {
    return bytes;
  }

  return textEncoder.encode(text.right.split(templateToken).join(ctl));
};

const materializeSkillDirectoryPlan = (request: SkillDirectoryRequest): Either.Either<SkillDirectoryPlan, SkillDirectoryPlanError> => {
  const writes = selectedSourceFiles(request).map((file) => {
    const previous = request.previousFiles.find((candidate) => candidate.path === file.destination);
    if (previous === undefined) {
      return Either.left(new SkillDirectoryPlanError({ issue: `Missing previous-file state for desired skill file ${file.destination}.` }));
    }

    const bytes = renderSkillBytes(file.source.bytes, request.ctl);

    return Either.right({
      _tag: "write",
      artifact: {
        owner: { _tag: "agent", agentIds: [request.agent.id] },
        path: file.destination,
        kind: { _tag: "skill" },
        ownership: {
          _tag: "wholeFile",
          installedHash: createHash("sha256").update(bytes).digest("hex"),
          previous: previous.previous,
        },
      },
      bytes,
    });
  });

  return Either.flatMap(Either.all(writes), (resolvedWrites) => validateSkillDirectoryPlan({ writes: resolvedWrites }));
};

// Plan one skill-directory target without I/O: decode all evidence, then materialize and validate every desired write.
export const planSkillDirectory = (input: unknown): Either.Either<SkillDirectoryPlan, SkillDirectoryPlanError> => {
  // 1. Decode the catalog agent, complete staged trees, allowlists, and prior file states.
  const request = decodeSkillDirectoryRequest(input);
  if (Either.isLeft(request)) {
    return Either.left(request.left);
  }

  // 2. Select declared files, render exact bytes, and validate their paths, hashes, owners, and restoration states.
  return materializeSkillDirectoryPlan(request.right);
};
