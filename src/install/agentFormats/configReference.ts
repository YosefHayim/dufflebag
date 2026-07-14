import { Either, Option, Schema } from "effect";
import { isAlias, isMap, isScalar, isSeq, parseDocument, type Range, visit } from "yaml";

import { currentSnapshotMatches, desiredBytesMatch } from "../artifactMaterialization.js";
import { type JsonValue, jsonValueSchema, ownedArtifactSchema, scopeRelativePathSchema, sha256JsonValue } from "../artifactReceipt.js";
import { type InstructionFileFormatError, planInstructionFile } from "./instructionFile.js";
import {
  type AgentFormatInput,
  type ArtifactCandidate,
  agentFormatInputSchema,
  agentFormatParseOptions,
  artifactCandidateSchema,
  observationForPath,
  priorArtifactForPath,
} from "./skillDirectory.js";

const configReferenceErrorCodeSchema = Schema.Literal(
  "invalid-input",
  "target-mismatch",
  "target-invalid",
  "observation-missing",
  "config-source-invalid",
  "ownership-conflict",
);

export class ConfigReferenceFormatError extends Schema.TaggedError<ConfigReferenceFormatError>()("ConfigReferenceFormatError", {
  code: configReferenceErrorCodeSchema,
  message: Schema.String,
  cause: Schema.Defect,
}) {}

const concatBytes = (...values: ReadonlyArray<Uint8Array>): Uint8Array => {
  return new Uint8Array(Buffer.concat(values.map((value) => Buffer.from(value))));
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => Buffer.from(left).equals(Buffer.from(right));

const decodeUtf8 = (value: Uint8Array): Option.Option<string> => {
  try {
    return Option.some(new TextDecoder("utf-8", { fatal: true }).decode(value));
  } catch {
    return Option.none();
  }
};

type YamlDocument = {
  readonly content: string;
  readonly prefix: Uint8Array;
};

const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf]);

const decodeYamlDocument = (value: Uint8Array): Option.Option<YamlDocument> => {
  const hasBom = value.length >= utf8Bom.length && bytesEqual(value.subarray(0, utf8Bom.length), utf8Bom);
  const prefix = hasBom ? value.subarray(0, utf8Bom.length) : new Uint8Array();
  const content = decodeUtf8(value.subarray(prefix.length));

  return Option.isSome(content) ? Option.some({ content: content.value, prefix }) : Option.none();
};

type YamlLine = {
  readonly body: string;
  readonly newline: string;
  readonly start: number;
  readonly end: number;
};

type SourceRange = {
  readonly start: number;
  readonly valueEnd: number;
};

type YamlEntry = {
  readonly value: string;
  readonly range: SourceRange;
  readonly line: YamlLine;
};

type YamlSequence = {
  readonly _tag: "sequence";
  readonly keyLine: YamlLine;
  readonly range: SourceRange;
  readonly entries: ReadonlyArray<YamlEntry>;
  readonly references: ReadonlyArray<string>;
  readonly flow: boolean;
  readonly newline: string;
};

type MissingYamlKey = {
  readonly _tag: "missingKey";
  readonly newline: string;
};

type YamlTarget = YamlSequence | MissingYamlKey;

const safeYamlToken = /^[A-Za-z0-9._/-]+$/;

const uniqueValues = (values: ReadonlyArray<string>): boolean => new Set(values).size === values.length;

const splitYamlLines = (content: string): ReadonlyArray<YamlLine> => {
  const lines: Array<YamlLine> = [];
  const pattern = /[^\r\n]*(?:\r\n|\n|$)/g;

  // Preserve source offsets so the one owned YAML range can be edited without reserializing unrelated bytes.
  for (const match of content.matchAll(pattern)) {
    if (match[0].length === 0) {
      continue;
    }

    const raw = match[0];
    const newline = raw.endsWith("\r\n") ? "\r\n" : raw.endsWith("\n") ? "\n" : "";
    const start = match.index;
    lines.push({
      body: raw.slice(0, raw.length - newline.length),
      newline,
      start,
      end: start + raw.length,
    });
  }

  return lines;
};

const readSourceRange = (range: Range | undefined): Option.Option<SourceRange> => {
  if (range === undefined) {
    return Option.none();
  }

  const [start, valueEnd] = range;

  return Option.some({ start, valueEnd });
};

const lineContaining = (lines: ReadonlyArray<YamlLine>, offset: number): Option.Option<YamlLine> => {
  return Option.fromNullable(lines.find((line) => line.start <= offset && offset < line.end));
};

const preferredYamlNewline = (content: string): string => {
  const match = /\r\n|\n/.exec(content);

  return match?.[0] ?? "\n";
};

type BlockYamlEntryCheck = {
  readonly content: string;
  readonly line: YamlLine;
  readonly range: SourceRange;
};

const blockYamlEntryIsSafe = ({ content, line, range }: BlockYamlEntryCheck): boolean => {
  const bodyEnd = line.end - line.newline.length;
  const prefix = content.slice(line.start, range.start);
  const suffix = content.slice(range.valueEnd, bodyEnd);

  return /^ +-[ ]+$/.test(prefix) && /^ *(?:#.*)?$/.test(suffix);
};

const yamlUsesAnchorsOrAliases = (document: ReturnType<typeof parseDocument>): boolean => {
  let found = false;

  visit(document, {
    Node: (_key, node) => {
      if (isAlias(node) || node.anchor !== undefined) {
        found = true;
        return visit.BREAK;
      }

      return undefined;
    },
  });

  return found;
};

const yamlScalarsStayOnSingleLines = (document: ReturnType<typeof parseDocument>, lines: ReadonlyArray<YamlLine>): boolean => {
  let valid = true;

  visit(document, {
    Node: (_key, node) => {
      if (!isScalar(node)) {
        return undefined;
      }

      const range = readSourceRange(node.range ?? undefined);
      const line = Option.isSome(range) ? lineContaining(lines, range.value.start) : Option.none<YamlLine>();
      if (Option.isNone(range) || Option.isNone(line) || range.value.valueEnd > line.value.end - line.value.newline.length) {
        valid = false;
        return visit.BREAK;
      }

      return undefined;
    },
  });

  return valid;
};

const parseOwnedYamlTarget = (content: string, key: string): Option.Option<YamlTarget> => {
  if (!safeYamlToken.test(key) || content.includes("\t")) {
    return Option.none();
  }

  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(content, {
      keepSourceTokens: true,
      strict: true,
      uniqueKeys: true,
    });
  } catch {
    return Option.none();
  }

  const lines = splitYamlLines(content);
  if (
    document.errors.length > 0 ||
    document.warnings.length > 0 ||
    yamlUsesAnchorsOrAliases(document) ||
    !yamlScalarsStayOnSingleLines(document, lines) ||
    !isMap(document.contents)
  ) {
    return Option.none();
  }

  const matchingPairs = document.contents.items.filter((pair) => isScalar(pair.key) && pair.key.value === key);
  if (matchingPairs.length === 0) {
    return document.contents.flow === true ? Option.none() : Option.some({ _tag: "missingKey", newline: preferredYamlNewline(content) });
  }

  const pair = matchingPairs.at(0);
  if (matchingPairs.length !== 1 || pair === undefined || !isScalar(pair.key) || !isSeq(pair.value)) {
    return Option.none();
  }

  const keyRange = readSourceRange(pair.key.range ?? undefined);
  const sequenceRange = readSourceRange(pair.value.range ?? undefined);
  if (Option.isNone(keyRange) || Option.isNone(sequenceRange) || content.slice(keyRange.value.start, keyRange.value.valueEnd) !== key) {
    return Option.none();
  }

  const keyLine = lineContaining(lines, keyRange.value.start);
  if (Option.isNone(keyLine) || (pair.value.flow !== true && keyLine.value.body !== `${key}:`)) {
    return Option.none();
  }

  const entries: Array<YamlEntry> = [];
  const references: Array<string> = [];

  // Validate every sequence item before trusting its range for the owned edit.
  for (const item of pair.value.items) {
    if (!isScalar(item) || typeof item.value !== "string") {
      return Option.none();
    }

    const range = readSourceRange(item.range ?? undefined);
    if (Option.isNone(range)) {
      return Option.none();
    }

    const line = lineContaining(lines, range.value.start);
    if (Option.isNone(line) || (pair.value.flow !== true && !blockYamlEntryIsSafe({ content, line: line.value, range: range.value }))) {
      return Option.none();
    }

    entries.push({ value: item.value, range: range.value, line: line.value });
    references.push(item.value);
  }

  if (!uniqueValues(references)) {
    return Option.none();
  }

  return Option.some({
    _tag: "sequence",
    keyLine: keyLine.value,
    range: sequenceRange.value,
    entries,
    references,
    flow: pair.value.flow === true,
    newline: preferredYamlNewline(content),
  });
};

type YamlRangeEdit = {
  readonly content: string;
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
};

const editYamlRange = ({ content, start, end, replacement }: YamlRangeEdit): Uint8Array => {
  return concatBytes(
    new TextEncoder().encode(content.slice(0, start)),
    new TextEncoder().encode(replacement),
    new TextEncoder().encode(content.slice(end)),
  );
};

type YamlReferenceRequest = {
  readonly content: string;
  readonly key: string;
  readonly reference: string;
};

type InitialYamlReferenceRequest = {
  readonly key: string;
  readonly reference: string;
};

const createYamlReference = ({ key, reference }: InitialYamlReferenceRequest): Option.Option<Uint8Array> => {
  if (!safeYamlToken.test(key) || !safeYamlToken.test(reference)) {
    return Option.none();
  }

  const candidate = `${key}:\n  - ${reference}\n`;
  const parsed = parseOwnedYamlTarget(candidate, key);

  return Option.isSome(parsed) &&
    parsed.value._tag === "sequence" &&
    parsed.value.references.length === 1 &&
    parsed.value.references.at(0) === reference
    ? Option.some(new TextEncoder().encode(candidate))
    : Option.none();
};

const addYamlReference = ({ content, key, reference }: YamlReferenceRequest): Option.Option<Uint8Array> => {
  if (!safeYamlToken.test(reference)) {
    return Option.none();
  }

  const parsed = parseOwnedYamlTarget(content, key);
  if (Option.isNone(parsed)) {
    return Option.none();
  }

  if (parsed.value._tag === "missingKey") {
    const separator = content.length > 0 ? parsed.value.newline : "";
    const candidate = `${content}${separator}${key}:${parsed.value.newline}  - ${reference}${parsed.value.newline}`;
    const validated = parseOwnedYamlTarget(candidate, key);

    return Option.isSome(validated) && validated.value._tag === "sequence" && validated.value.references.includes(reference)
      ? Option.some(new TextEncoder().encode(candidate))
      : Option.none();
  }

  if (parsed.value.references.includes(reference)) {
    return Option.some(new TextEncoder().encode(content));
  }

  if (parsed.value.flow && parsed.value.entries.length === 0 && parsed.value.keyLine.body === `${key}: []`) {
    const terminalNewline = parsed.value.keyLine.newline;
    const sequenceNewline = terminalNewline || parsed.value.newline;

    return Option.some(
      editYamlRange({
        content,
        start: parsed.value.keyLine.start,
        end: parsed.value.keyLine.end,
        replacement: `${key}:${sequenceNewline}  - ${reference}${terminalNewline}`,
      }),
    );
  }

  if (parsed.value.flow) {
    const lastEntry = parsed.value.entries.at(-1);
    const insertionPoint = lastEntry?.range.valueEnd ?? parsed.value.range.start + 1;
    const insertion = lastEntry === undefined ? reference : `, ${reference}`;

    return Option.some(editYamlRange({ content, start: insertionPoint, end: insertionPoint, replacement: insertion }));
  }

  const lastEntry = parsed.value.entries.at(-1);
  if (lastEntry === undefined) {
    return Option.none();
  }

  const prefix = content.slice(lastEntry.line.start, lastEntry.range.start);
  const insertionPoint = lastEntry.line.end - lastEntry.line.newline.length;
  const insertion = `${parsed.value.newline}${prefix}${reference}`;

  return Option.some(editYamlRange({ content, start: insertionPoint, end: insertionPoint, replacement: insertion }));
};

const isJsonArray = (value: JsonValue): value is ReadonlyArray<JsonValue> => Array.isArray(value);

const isStringArray = (value: JsonValue): value is ReadonlyArray<string> => {
  return isJsonArray(value) && value.every((entry) => typeof entry === "string");
};

const isJsonObject = (value: JsonValue): value is Readonly<Record<string, JsonValue>> => {
  return value !== null && typeof value === "object" && !isJsonArray(value);
};

const decodeJsonDocument = (value: Uint8Array): Option.Option<JsonValue> => {
  const text = decodeUtf8(value);
  if (Option.isNone(text)) {
    return Option.none();
  }

  try {
    return Option.some(Schema.validateSync(jsonValueSchema, agentFormatParseOptions)(JSON.parse(text.value)));
  } catch {
    return Option.none();
  }
};

const decodePointerSegment = (segment: string): string => segment.replaceAll("~1", "/").replaceAll("~0", "~");

const pointerSegments = (pointer: string): Option.Option<ReadonlyArray<string>> => {
  if (!/^\/(?:[^~/]|~[01])*(?:\/(?:[^~/]|~[01])*)*$/.test(pointer)) {
    return Option.none();
  }

  return Option.some(pointer.slice(1).split("/").map(decodePointerSegment));
};

type JsonReferenceState = { readonly _tag: "missing" } | { readonly _tag: "value"; readonly value: JsonValue };

type JsonReferenceTransitionRequest = {
  readonly installed: JsonReferenceState | undefined;
  readonly prior: JsonReferenceState | undefined;
  readonly reference: string;
};

const stringArraysEqual = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean => {
  return left.length === right.length && left.every((value, index) => value === right.at(index));
};

const jsonReferenceTransitionMatches = ({ installed, prior, reference }: JsonReferenceTransitionRequest): boolean => {
  if (installed?._tag !== "value" || !isStringArray(installed.value)) {
    return false;
  }

  if (prior?._tag === "missing") {
    return stringArraysEqual(installed.value, [reference]);
  }

  if (prior?._tag !== "value" || !isStringArray(prior.value)) {
    return false;
  }

  const priorReferenceCount = prior.value.filter((entry) => entry === reference).length;
  if (priorReferenceCount > 1) {
    return false;
  }

  const expected = priorReferenceCount === 1 ? prior.value : [...prior.value, reference];

  return stringArraysEqual(installed.value, expected);
};

type JsonReferenceUpdate = {
  readonly document: JsonValue;
  readonly prior: { readonly _tag: "missing" } | { readonly _tag: "value"; readonly value: JsonValue };
  readonly installed: ReadonlyArray<JsonValue>;
  readonly changed: boolean;
};

type JsonReferenceTraversal = {
  readonly document: JsonValue;
  readonly segments: ReadonlyArray<string>;
  readonly reference: string;
};

const updateJsonReference = ({ document, segments, reference }: JsonReferenceTraversal): Option.Option<JsonReferenceUpdate> => {
  const segment = segments.at(0);
  if (segment === undefined || !isJsonObject(document)) {
    return Option.none();
  }

  if (segments.length === 1) {
    // The plain-object guard above proves this dynamic key can be read, while hasOwn distinguishes absence.
    const existing = Object.hasOwn(document, segment) ? Option.some(document[segment]) : Option.none<JsonValue>();
    if (Option.isSome(existing) && (!isJsonArray(existing.value) || !existing.value.every((entry) => typeof entry === "string"))) {
      return Option.none();
    }

    const prior = Option.isSome(existing) && isJsonArray(existing.value) ? existing.value : [];
    if (prior.filter((entry) => entry === reference).length > 1) {
      return Option.none();
    }

    const changed = !prior.includes(reference);
    const installed = changed ? [...prior, reference] : prior;

    return Option.some({
      document: changed ? { ...document, [segment]: installed } : document,
      prior: Option.isSome(existing) ? { _tag: "value", value: prior } : { _tag: "missing" },
      installed,
      changed,
    });
  }

  if (!Object.hasOwn(document, segment)) {
    return Option.none();
  }

  // The own-property guard proves this intermediate pointer segment exists on the decoded plain object.
  const child = document[segment];
  const updated = updateJsonReference({ document: child, segments: segments.slice(1), reference });
  if (Option.isNone(updated)) {
    return Option.none();
  }

  return Option.some({
    ...updated.value,
    document: updated.value.changed ? { ...document, [segment]: updated.value.document } : document,
  });
};

type ConfigReferenceFailure = {
  readonly code: Schema.Schema.Type<typeof configReferenceErrorCodeSchema>;
  readonly message: string;
  readonly cause: unknown;
};

const fail = ({ code, message, cause }: ConfigReferenceFailure): Either.Either<never, ConfigReferenceFormatError> =>
  Either.left(
    new ConfigReferenceFormatError({
      code,
      message,
      cause,
    }),
  );

type ConfigCandidateRequest = {
  readonly input: AgentFormatInput;
  readonly target: AgentFormatInput["agent"]["target"] & { readonly _tag: "configReference" };
};

const configReferenceFormatIsSafe = (target: ConfigCandidateRequest["target"]): boolean => {
  if (target.referenceFormat._tag === "yamlSequenceKey") {
    return Option.isSome(
      createYamlReference({
        key: target.referenceFormat.key,
        reference: target.instructionPath,
      }),
    );
  }

  return Option.isSome(pointerSegments(target.referenceFormat.pointer));
};

const planYamlCandidate = ({ input, target }: ConfigCandidateRequest): Either.Either<ArtifactCandidate, ConfigReferenceFormatError> => {
  if (target.referenceFormat._tag !== "yamlSequenceKey") {
    return fail({
      code: "target-mismatch",
      message: "The YAML planner requires a yamlSequenceKey reference tag.",
      cause: target.referenceFormat,
    });
  }

  const observation = observationForPath(input.observations, target.configPath);
  if (Option.isNone(observation)) {
    return fail({
      code: "observation-missing",
      message: `No exact target observation was supplied for ${target.configPath}.`,
      cause: target.configPath,
    });
  }

  const previous = priorArtifactForPath(input.priorArtifacts, target.configPath);
  if (Option.isSome(previous)) {
    if (
      previous.value.kind !== "configReference" ||
      previous.value.ownership._tag !== "yamlSequenceValue" ||
      previous.value.ownership.key !== target.referenceFormat.key ||
      previous.value.ownership.reference !== target.instructionPath ||
      !currentSnapshotMatches({ artifact: previous.value, observation: observation.value, target: "installed" })
    ) {
      return fail({
        code: "ownership-conflict",
        message: `The prior receipt does not authorize YAML changes at ${target.configPath}.`,
        cause: previous.value,
      });
    }
  }

  let candidateBytes: Uint8Array;
  let priorPresence: { readonly _tag: "absent" } | { readonly _tag: "present" };
  let priorKeyPresence: { readonly _tag: "absent" } | { readonly _tag: "present" };
  let priorDocument: { readonly _tag: "missing" } | { readonly _tag: "existing" };

  if (observation.value.snapshot._tag === "missing") {
    const added = createYamlReference({
      key: target.referenceFormat.key,
      reference: target.instructionPath,
    });
    if (Option.isNone(added)) {
      return fail({
        code: "config-source-invalid",
        message: `YAML config ${target.configPath} cannot be safely created.`,
        cause: target.referenceFormat,
      });
    }

    candidateBytes = added.value;
    priorPresence = { _tag: "absent" };
    priorKeyPresence = { _tag: "absent" };
    priorDocument = { _tag: "missing" };
  } else {
    const document = decodeYamlDocument(observation.value.snapshot.bytes);
    const parsed = Option.isSome(document)
      ? parseOwnedYamlTarget(document.value.content, target.referenceFormat.key)
      : Option.none<YamlTarget>();
    const added = Option.isSome(document)
      ? addYamlReference({ content: document.value.content, key: target.referenceFormat.key, reference: target.instructionPath })
      : Option.none<Uint8Array>();
    if (Option.isNone(document) || Option.isNone(parsed) || Option.isNone(added)) {
      return fail({
        code: "config-source-invalid",
        message: `YAML config ${target.configPath} cannot be safely edited.`,
        cause: observation.value.snapshot.bytes,
      });
    }

    candidateBytes = concatBytes(document.value.prefix, added.value);
    priorKeyPresence = parsed.value._tag === "missingKey" ? { _tag: "absent" } : { _tag: "present" };
    priorPresence =
      parsed.value._tag === "sequence" && parsed.value.references.includes(target.instructionPath)
        ? { _tag: "present" }
        : { _tag: "absent" };
    priorDocument = { _tag: "existing" };
  }

  if (Option.isSome(previous) && previous.value.ownership._tag === "yamlSequenceValue") {
    priorPresence = previous.value.ownership.priorPresence;
    priorKeyPresence = previous.value.ownership.priorKeyPresence;
    priorDocument = previous.value.ownership.priorDocument;
  }

  const artifactResult = Schema.decodeUnknownEither(
    Schema.typeSchema(ownedArtifactSchema),
    agentFormatParseOptions,
  )({
    path: target.configPath,
    owner: { _tag: "agent", agentIds: [input.agent.id] },
    kind: "configReference",
    ownership: {
      _tag: "yamlSequenceValue",
      key: target.referenceFormat.key,
      reference: target.instructionPath,
      priorPresence,
      priorKeyPresence,
      priorDocument,
    },
  });
  if (Either.isLeft(artifactResult)) {
    return fail({
      code: "target-invalid",
      message: `YAML ownership metadata is invalid for ${target.configPath}.`,
      cause: artifactResult.left,
    });
  }

  if (!desiredBytesMatch({ artifact: artifactResult.right, candidateBytes, observation: observation.value, previous })) {
    return fail({
      code: "config-source-invalid",
      message: `YAML config ${target.configPath} cannot produce the exact desired reference.`,
      cause: target.configPath,
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
        message: `The YAML candidate is invalid for ${target.configPath}.`,
        cause: candidateResult.left,
      })
    : Either.right(candidateResult.right);
};

const planJsonCandidate = ({ input, target }: ConfigCandidateRequest): Either.Either<ArtifactCandidate, ConfigReferenceFormatError> => {
  if (target.referenceFormat._tag !== "jsonArrayPointer") {
    return fail({
      code: "target-mismatch",
      message: "The JSON planner requires a jsonArrayPointer reference tag.",
      cause: target.referenceFormat,
    });
  }

  const observation = observationForPath(input.observations, target.configPath);
  if (Option.isNone(observation)) {
    return fail({
      code: "observation-missing",
      message: `No exact target observation was supplied for ${target.configPath}.`,
      cause: target.configPath,
    });
  }

  const previous = priorArtifactForPath(input.priorArtifacts, target.configPath);
  if (Option.isSome(previous)) {
    const previousEntry = previous.value.ownership._tag === "jsonValues" ? previous.value.ownership.entries.at(0) : undefined;
    const previousTransitionMatches = jsonReferenceTransitionMatches({
      installed: previousEntry?.installed,
      prior: previousEntry?.prior,
      reference: target.instructionPath,
    });
    if (
      previous.value.kind !== "configReference" ||
      previous.value.ownership._tag !== "jsonValues" ||
      previous.value.ownership.entries.length !== 1 ||
      previousEntry?.pointer !== target.referenceFormat.pointer ||
      !previousTransitionMatches ||
      !currentSnapshotMatches({ artifact: previous.value, observation: observation.value, target: "installed" })
    ) {
      return fail({
        code: "ownership-conflict",
        message: `The prior receipt does not authorize JSON changes at ${target.configPath}.`,
        cause: previous.value,
      });
    }
  }

  const document =
    observation.value.snapshot._tag === "missing" ? Option.some<JsonValue>({}) : decodeJsonDocument(observation.value.snapshot.bytes);
  const segments = pointerSegments(target.referenceFormat.pointer);
  const updated =
    Option.isSome(document) && Option.isSome(segments)
      ? updateJsonReference({ document: document.value, segments: segments.value, reference: target.instructionPath })
      : Option.none<JsonReferenceUpdate>();
  if (Option.isNone(document) || Option.isNone(segments) || Option.isNone(updated)) {
    return fail({
      code: "config-source-invalid",
      message: `JSON config ${target.configPath} cannot be safely edited.`,
      cause: target.configPath,
    });
  }

  const candidateBytes =
    observation.value.snapshot._tag === "file" && !updated.value.changed
      ? observation.value.snapshot.bytes
      : new TextEncoder().encode(`${JSON.stringify(updated.value.document, null, 2)}\n`);
  let prior = updated.value.prior;
  let priorDocument: { readonly _tag: "missing" } | { readonly _tag: "existing" } =
    observation.value.snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "existing" };

  if (Option.isSome(previous) && previous.value.ownership._tag === "jsonValues") {
    const previousEntry = previous.value.ownership.entries.at(0);
    if (previousEntry === undefined) {
      return fail({
        code: "ownership-conflict",
        message: `The JSON receipt entry is missing at ${target.configPath}.`,
        cause: previous.value,
      });
    }
    prior = previousEntry.prior;
    priorDocument = previous.value.ownership.priorDocument;
  }

  const artifactResult = Schema.decodeUnknownEither(
    Schema.typeSchema(ownedArtifactSchema),
    agentFormatParseOptions,
  )({
    path: target.configPath,
    owner: { _tag: "agent", agentIds: [input.agent.id] },
    kind: "configReference",
    ownership: {
      _tag: "jsonValues",
      entries: [
        {
          pointer: target.referenceFormat.pointer,
          installed: {
            _tag: "value",
            value: updated.value.installed,
            sha256: sha256JsonValue(updated.value.installed),
          },
          prior,
        },
      ],
      priorDocument,
    },
  });
  if (Either.isLeft(artifactResult)) {
    return fail({
      code: "target-invalid",
      message: `JSON ownership metadata is invalid for ${target.configPath}.`,
      cause: artifactResult.left,
    });
  }

  if (!desiredBytesMatch({ artifact: artifactResult.right, candidateBytes, observation: observation.value, previous })) {
    return fail({
      code: "config-source-invalid",
      message: `JSON config ${target.configPath} cannot produce the exact desired reference.`,
      cause: target.configPath,
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
        message: `The JSON candidate is invalid for ${target.configPath}.`,
        cause: candidateResult.left,
      })
    : Either.right(candidateResult.right);
};

export const planConfigReference = (
  input: unknown,
): Either.Either<ReadonlyArray<ArtifactCandidate>, ConfigReferenceFormatError | InstructionFileFormatError> => {
  let decoded: AgentFormatInput;
  try {
    decoded = Schema.decodeUnknownSync(agentFormatInputSchema, agentFormatParseOptions)(input);
  } catch (cause) {
    return fail({ code: "invalid-input", message: "Config-reference input does not match the strict format contract.", cause });
  }

  if (decoded.agent.target._tag !== "configReference") {
    return fail({
      code: "target-mismatch",
      message: "The config-reference planner requires a configReference target tag.",
      cause: decoded.agent.target,
    });
  }

  const instructionPath = Schema.decodeUnknownEither(scopeRelativePathSchema)(decoded.agent.target.instructionPath);
  const configPath = Schema.decodeUnknownEither(scopeRelativePathSchema)(decoded.agent.target.configPath);
  if (Either.isLeft(instructionPath) || Either.isLeft(configPath)) {
    return fail({
      code: "target-invalid",
      message: "Config-reference paths must be safe scope-relative paths.",
      cause: decoded.agent.target,
    });
  }

  const target = {
    ...decoded.agent.target,
    instructionPath: instructionPath.right,
    configPath: configPath.right,
  };
  if (!configReferenceFormatIsSafe(target)) {
    return fail({
      code: "target-invalid",
      message: "The config-reference format cannot safely represent its target instruction path.",
      cause: target.referenceFormat,
    });
  }
  if (decoded.skills.length === 0) {
    return Either.right([]);
  }

  const instruction = planInstructionFile({
    ...decoded,
    agent: {
      ...decoded.agent,
      target: {
        _tag: "instructionFile",
        path: instructionPath.right,
      },
    },
  });
  if (Either.isLeft(instruction)) {
    return Either.left(instruction.left);
  }

  const config =
    target.referenceFormat._tag === "yamlSequenceKey"
      ? planYamlCandidate({ input: decoded, target })
      : planJsonCandidate({ input: decoded, target });
  if (Either.isLeft(config)) {
    return Either.left(config.left);
  }

  return Either.right([...instruction.right, config.right]);
};
