import path from "node:path";
import { Either, Option, Schema } from "effect";

import { scopeRelativePathSchema } from "../artifactReceipt.js";
import {
  type AgentFormatInput,
  type AgentFormatTemplateValues,
  type ArtifactCandidate,
  agentFormatInputSchema,
  agentFormatParseOptions,
  planWholeFileCandidate,
  type ResolvedSkillPayload,
  substituteSkillTemplates,
} from "./skillDirectory.js";

const ruleFileErrorCodeSchema = Schema.Literal(
  "invalid-input",
  "target-mismatch",
  "target-invalid",
  "skill-source-invalid",
  "frontmatter-unclosed",
  "unresolved-template",
  "observation-missing",
  "ownership-conflict",
);

export class RuleFileFormatError extends Schema.TaggedError<RuleFileFormatError>()("RuleFileFormatError", {
  code: ruleFileErrorCodeSchema,
  message: Schema.String,
  cause: Schema.Defect,
}) {}

const ruleBodyIssueSchema = Schema.Struct({
  code: Schema.Literal("skill-source-invalid", "frontmatter-unclosed", "unresolved-template"),
  message: Schema.String,
  cause: Schema.Defect,
}).annotations({
  parseOptions: agentFormatParseOptions,
});

export type RuleBodyIssue = Schema.Schema.Type<typeof ruleBodyIssueSchema>;

const decodeUtf8 = (value: Uint8Array): Option.Option<string> => {
  try {
    return Option.some(new TextDecoder("utf-8", { fatal: true }).decode(value));
  } catch {
    return Option.none();
  }
};

type TextLine = {
  readonly body: string;
  readonly end: number;
  readonly newline: string;
};

const textLineAt = (content: string, start: number): TextLine => {
  const lineFeed = content.indexOf("\n", start);
  if (lineFeed < 0) {
    return {
      body: content.slice(start),
      end: content.length,
      newline: "",
    };
  }

  const hasCarriageReturn = lineFeed > start && content.charCodeAt(lineFeed - 1) === 13;
  const bodyEnd = hasCarriageReturn ? lineFeed - 1 : lineFeed;

  return {
    body: content.slice(start, bodyEnd),
    end: lineFeed + 1,
    newline: hasCarriageReturn ? "\r\n" : "\n",
  };
};

const frontmatterBodyStart = (content: string, closingLine: TextLine): number => {
  if (closingLine.end >= content.length) {
    return closingLine.end;
  }

  const separator = textLineAt(content, closingLine.end);

  return separator.body.length === 0 && separator.newline.length > 0 ? separator.end : closingLine.end;
};

const stripLeadingFrontmatter = (value: Uint8Array): Either.Either<Uint8Array, RuleBodyIssue> => {
  const decoded = decodeUtf8(value);
  if (Option.isNone(decoded)) {
    return Either.left({
      code: "skill-source-invalid",
      message: "SKILL.md must contain valid UTF-8 bytes.",
      cause: value,
    });
  }

  const firstLine = textLineAt(decoded.value, 0);
  if (firstLine.body !== "---") {
    return Either.right(value);
  }
  if (firstLine.newline.length === 0) {
    return Either.left({
      code: "frontmatter-unclosed",
      message: "A leading YAML frontmatter block must contain a full-line closing delimiter.",
      cause: decoded.value,
    });
  }

  let cursor = firstLine.end;

  // Scan only complete subsequent lines so a later Markdown horizontal rule remains ordinary body content.
  while (cursor <= decoded.value.length) {
    const line = textLineAt(decoded.value, cursor);
    if (line.body === "---") {
      return Either.right(new TextEncoder().encode(decoded.value.slice(frontmatterBodyStart(decoded.value, line))));
    }

    if (line.newline.length === 0) {
      break;
    }
    cursor = line.end;
  }

  return Either.left({
    code: "frontmatter-unclosed",
    message: "A leading YAML frontmatter block must contain a full-line closing delimiter.",
    cause: decoded.value,
  });
};

export const renderRuleBody = (
  payload: ResolvedSkillPayload,
  templateValues: AgentFormatTemplateValues,
): Either.Either<Uint8Array, RuleBodyIssue> => {
  if (payload.installedSkill._tag !== "skill" || !payload.installedSkill.shippedPaths.includes("SKILL.md")) {
    return Either.left({
      code: "skill-source-invalid",
      message: "Rule and instruction formats require an exactly allowlisted SKILL.md source.",
      cause: payload.installedSkill,
    });
  }

  const sourceFile = payload.sourceFiles.find((candidate) => candidate.path === "SKILL.md");
  if (sourceFile === undefined) {
    return Either.left({
      code: "skill-source-invalid",
      message: `Skill ${payload.installedSkill.id} is missing its exact SKILL.md source.`,
      cause: payload.sourceFiles,
    });
  }

  const substituted = substituteSkillTemplates(sourceFile.bytes, templateValues);
  if (Option.isNone(substituted)) {
    return Either.left({
      code: "unresolved-template",
      message: `Skill ${payload.installedSkill.id} contains an undeclared template token.`,
      cause: sourceFile.path,
    });
  }

  return stripLeadingFrontmatter(substituted.value);
};

type RuleFileFailure = {
  readonly code: Schema.Schema.Type<typeof ruleFileErrorCodeSchema>;
  readonly message: string;
  readonly cause: unknown;
};

const fail = ({ code, message, cause }: RuleFileFailure): Either.Either<never, RuleFileFormatError> =>
  Either.left(
    new RuleFileFormatError({
      code,
      message,
      cause,
    }),
  );

export const planRuleFiles = (input: unknown): Either.Either<ReadonlyArray<ArtifactCandidate>, RuleFileFormatError> => {
  let decoded: AgentFormatInput;
  try {
    decoded = Schema.decodeUnknownSync(agentFormatInputSchema, agentFormatParseOptions)(input);
  } catch (cause) {
    return fail({ code: "invalid-input", message: "Rule-file input does not match the strict format contract.", cause });
  }

  if (decoded.agent.target._tag !== "ruleFile") {
    return fail({
      code: "target-mismatch",
      message: "The rule-file planner requires a ruleFile target tag.",
      cause: decoded.agent.target,
    });
  }

  const directoryResult = Schema.decodeUnknownEither(scopeRelativePathSchema)(decoded.agent.target.directory);
  if (Either.isLeft(directoryResult) || !/^\.[a-zA-Z0-9]+$/.test(decoded.agent.target.extension)) {
    return fail({
      code: "target-invalid",
      message: "The rule-file target requires a safe directory and dotted alphanumeric extension.",
      cause: decoded.agent.target,
    });
  }

  const candidates: Array<ArtifactCandidate> = [];

  // Preserve resolved skill order so rule artifacts remain deterministic across agents and runs.
  for (const payload of decoded.skills) {
    if (payload.installedSkill._tag !== "skill") {
      return fail({
        code: "invalid-input",
        message: "Every resolved payload must contain an installed skill.",
        cause: payload.installedSkill,
      });
    }

    const body = renderRuleBody(payload, decoded.templateValues);
    if (Either.isLeft(body)) {
      return fail({ code: body.left.code, message: body.left.message, cause: body.left.cause });
    }

    const targetPath = path.posix.join(directoryResult.right, `${payload.installedSkill.id}${decoded.agent.target.extension}`);
    const candidate = planWholeFileCandidate({
      path: targetPath,
      agentId: decoded.agent.id,
      kind: "rule",
      bytes: body.right,
      observations: decoded.observations,
      priorArtifacts: decoded.priorArtifacts,
    });
    if (Either.isLeft(candidate)) {
      return fail({ code: candidate.left.code, message: candidate.left.message, cause: candidate.left.cause });
    }

    candidates.push(candidate.right);
  }

  return Either.right(candidates);
};
