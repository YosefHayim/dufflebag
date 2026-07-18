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

const textEncoder = new TextEncoder();
const templateToken = "@@CTL@@";
// e.g. "---\n" or "---\r\n" at the start of a skill markdown body
const leadingFrontmatterOpeningPattern = /^---(?:\r\n|\n)/;
// e.g. "---\nname: x\n---\n# body" → whole leading YAML frontmatter block
const leadingFrontmatterBlockPattern = /^---(?:\r\n|\n)(?:[\s\S]*?(?:\r\n|\n))?---(?:(?:\r\n|\n)|$)/;
const agentDefinitionsEqual = Schema.equivalence(agentDefinitionSchema);
const catalogSkillDefinitionSchema = installedSkillDefinitionSchema.members[1];
const installedSkillsEqual = Schema.equivalence(catalogSkillDefinitionSchema);
const catalogInstalledSkills = featureCatalog.flatMap((feature) =>
  feature.installedSkill._tag === "skill" ? [feature.installedSkill] : [],
);

export class RuleFilePlanError extends Schema.TaggedError<RuleFilePlanError>()("RuleFilePlanError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable rule-file request or generated-plan validation issue.",
  }),
}) {
  get message(): string {
    return `Cannot plan rule files: ${this.issue}`;
  }
}

const formatParseError = (error: ParseResult.ParseError): string => ParseResult.TreeFormatter.formatErrorSync(error);

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const hasCompleteLeadingFrontmatter = (markdown: string): boolean =>
  !leadingFrontmatterOpeningPattern.test(markdown) || leadingFrontmatterBlockPattern.test(markdown);

const stripLeadingFrontmatter = (markdown: string): string => markdown.replace(leadingFrontmatterBlockPattern, "");

const hasRuleBody = (markdown: string): boolean => stripLeadingFrontmatter(markdown).trim().length > 0;

const substituteControlPath = (markdown: string, ctl: string): string => markdown.split(templateToken).join(ctl);

const ruleFileAgentFieldsSchema = Schema.Struct({
  ...agentDefinitionSchema.fields,
  target: agentDefinitionSchema.fields.target.members[1],
});

const ruleFileAgentSchema = ruleFileAgentFieldsSchema.pipe(
  Schema.filter((agent) => agentCatalog.some((candidate) => agentDefinitionsEqual(candidate, agent)), {
    message: () => "Rule-file agents must exactly match the decoded agent catalog.",
  }),
);

const ruleFileMarkdownSchema = Schema.String.pipe(
  Schema.filter(hasCompleteLeadingFrontmatter, {
    message: () => "Leading YAML frontmatter must have exact opening and closing delimiter lines.",
  }),
  Schema.filter(hasRuleBody, {
    message: () => "Rule-file markdown requires a non-empty body after frontmatter.",
  }),
  Schema.annotations({
    description: "Exact installed SKILL.md text used to produce one native rule body.",
  }),
);

const ruleFileSkillSchema = Schema.Struct({
  installedSkill: catalogSkillDefinitionSchema.pipe(
    Schema.filter((installedSkill) => catalogInstalledSkills.some((candidate) => installedSkillsEqual(candidate, installedSkill)), {
      message: () => "Rule-file installed skills must exactly match the decoded feature catalog.",
    }),
    Schema.annotations({
      description: "Catalog-owned installed skill identity used for the output filename.",
    }),
  ),
  markdown: ruleFileMarkdownSchema,
});

type RuleFileSkill = Schema.Schema.Type<typeof ruleFileSkillSchema>;

const installedSkillIds = (skills: ReadonlyArray<RuleFileSkill>): ReadonlyArray<string> =>
  skills.map(({ installedSkill }) => installedSkill.id);

const uniqueRuleFileSkillsSchema = Schema.Array(ruleFileSkillSchema).pipe(
  Schema.filter(
    (skills) => {
      const ids = installedSkillIds(skills);

      return ids.length === new Set(ids).size;
    },
    {
      message: () => "Installed rule-file skill IDs must be unique.",
    },
  ),
);

const previousRuleFileSchema = Schema.Struct({
  path: relativeArtifactPathSchema.annotations({
    description: "Exact rule path whose original state is retained for restoration.",
  }),
  previous: Schema.typeSchema(previousFileValueSchema).annotations({
    description: "Decoded original whole-file state retained across updates.",
  }),
});

const uniquePreviousRuleFilesSchema = Schema.Array(previousRuleFileSchema).pipe(
  Schema.filter((files) => files.length === new Set(files.map((file) => file.path)).size, {
    message: () => "Previous rule-file paths must be unique.",
  }),
);

const ruleFileRequestFieldsSchema = Schema.Struct({
  agent: ruleFileAgentSchema.annotations({
    description: "Decoded agent whose target selects the native rule-file format.",
  }),
  ctl: Schema.NonEmptyTrimmedString.pipe(
    Schema.filter((command) => !command.includes(templateToken), {
      message: () => "The control command cannot contain the template token.",
    }),
    Schema.annotations({
      description: "Exact installed control-program path substituted for every @@CTL@@ placeholder.",
    }),
  ),
  skills: uniqueRuleFileSkillsSchema.annotations({
    description: "Ordered installed skill markdown values rendered into separate rule files.",
  }),
  previousFiles: uniquePreviousRuleFilesSchema.annotations({
    description: "Exact original file state for every desired rule path, in skill order.",
  }),
});

type RuleFileRequestFields = Schema.Schema.Type<typeof ruleFileRequestFieldsSchema>;

const expectedRuleFilePaths = (request: RuleFileRequestFields): ReadonlyArray<string> => {
  const target = request.agent.target;

  return installedSkillIds(request.skills).map((skillId) => `${target.directory}/${skillId}${target.extension}`);
};

const exactPreviousFileIssues = (request: RuleFileRequestFields) => {
  const expectedPaths = expectedRuleFilePaths(request);
  const previousPaths = request.previousFiles.map((file) => file.path);
  const mismatchIndex = expectedPaths.findIndex((path, index) => path !== previousPaths[index]);

  if (mismatchIndex < 0 && expectedPaths.length === previousPaths.length) {
    return [];
  }

  let issueIndex = mismatchIndex;
  if (issueIndex < 0) {
    issueIndex = Math.min(expectedPaths.length, previousPaths.length);
  }

  return [
    {
      path: ["previousFiles", issueIndex],
      message: "Previous rule-file paths must exactly match desired rule paths in skill order.",
    },
  ];
};

export const ruleFileRequestSchema = ruleFileRequestFieldsSchema.pipe(Schema.filter(exactPreviousFileIssues));

export type RuleFileRequest = Schema.Schema.Type<typeof ruleFileRequestSchema>;

const ruleArtifactSchema = Schema.Struct({
  owner: artifactOwnerSchema.members[1],
  path: relativeArtifactPathSchema,
  kind: artifactKindSchema.members[2],
  ownership: wholeFileOwnershipSchema,
});

const ruleFileWriteFieldsSchema = Schema.TaggedStruct("write", {
  artifact: ruleArtifactSchema,
  bytes: writeOperationSchema.fields.bytes,
});

type RuleFileWrite = Schema.Schema.Type<typeof ruleFileWriteFieldsSchema>;

const ruleFileWriteIssues = (write: RuleFileWrite) => [
  write.artifact.owner.agentIds.length === 1
    ? undefined
    : {
        path: ["artifact", "owner"],
        message: "Each rule artifact requires exactly one agent owner.",
      },
  write.artifact.ownership.installedHash !== hashBytes(write.bytes)
    ? {
        path: ["artifact", "ownership", "installedHash"],
        message: "Rule ownership hashes must match the exact desired bytes.",
      }
    : undefined,
];

const ruleFileWriteSchema = ruleFileWriteFieldsSchema.pipe(Schema.filter(ruleFileWriteIssues));

const uniqueRuleWritesSchema = Schema.Array(ruleFileWriteSchema).pipe(
  Schema.filter((writes) => writes.length === new Set(writes.map((write) => write.artifact.path)).size, {
    message: () => "Rule-file plans cannot contain duplicate artifact paths.",
  }),
);

export const ruleFilePlanSchema = Schema.Struct({
  writes: uniqueRuleWritesSchema.annotations({
    description: "Ordered desired rule writes with matching whole-file ownership.",
  }),
});

export type RuleFilePlan = Schema.Schema.Type<typeof ruleFilePlanSchema>;

const decodeRuleFileRequest = (input: unknown): Either.Either<RuleFileRequest, RuleFilePlanError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(ruleFileRequestSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new RuleFilePlanError({ issue: formatParseError(error) }),
  );

const validateRuleFilePlan = (input: unknown): Either.Either<RuleFilePlan, RuleFilePlanError> =>
  Either.mapLeft(
    Schema.validateEither(ruleFilePlanSchema, {
      onExcessProperty: "error",
    })(input),
    (error) => new RuleFilePlanError({ issue: formatParseError(error) }),
  );

const createRuleWrites = (request: RuleFileRequest): Either.Either<ReadonlyArray<RuleFileWrite>, RuleFilePlanError> => {
  const target = request.agent.target;
  const writes = request.skills.map(({ installedSkill, markdown }) => {
    const path = `${target.directory}/${installedSkill.id}${target.extension}`;
    const previousFile = request.previousFiles.find((file) => file.path === path);
    if (previousFile === undefined) {
      return Either.left(new RuleFilePlanError({ issue: `Missing previous-file state for desired rule file ${path}.` }));
    }

    const bytes = textEncoder.encode(substituteControlPath(stripLeadingFrontmatter(markdown), request.ctl));
    const write: RuleFileWrite = {
      _tag: "write",
      artifact: {
        path,
        kind: { _tag: "rule" },
        owner: { _tag: "agent", agentIds: [request.agent.id] },
        ownership: {
          _tag: "wholeFile",
          installedHash: hashBytes(bytes),
          previous: previousFile.previous,
        },
      },
      bytes,
    };

    return Either.right(write);
  });

  return Either.all(writes);
};

const materializeRuleFilePlan = (request: RuleFileRequest): Either.Either<RuleFilePlan, RuleFilePlanError> => {
  const writes = createRuleWrites(request);
  if (Either.isLeft(writes)) {
    return Either.left(writes.left);
  }

  return validateRuleFilePlan({ writes: writes.right });
};

// Plan native rule files without I/O: decode source state, then materialize and validate ordered writes.
export const planRuleFiles = (input: unknown): Either.Either<RuleFilePlan, RuleFilePlanError> => {
  // 1. Decode the complete target, markdown, substitution, and restoration state.
  const request = decodeRuleFileRequest(input);
  if (Either.isLeft(request)) {
    return Either.left(request.left);
  }

  // 2. Strip valid leading frontmatter, materialize one write per skill, and validate the direct plan.
  return materializeRuleFilePlan(request.right);
};
