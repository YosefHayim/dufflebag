import { Option, Schema, type SchemaAST } from "effect";
import { isAlias, isMap, isScalar, isSeq, parseDocument, type Range, visit } from "yaml";

import {
  type JsonValue,
  jsonValueSchema,
  type OwnedArtifact,
  persistedBytesSchema,
  scopeRelativePathSchema,
  sha256Bytes,
  sha256JsonValue,
  sha256Schema,
} from "./artifactReceipt.js";

const strictParseOptions = {
  onExcessProperty: "error",
} satisfies SchemaAST.ParseOptions;

const compareStrings = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
};

const uniqueValues = (values: ReadonlyArray<string>): boolean => {
  return new Set(values).size === values.length;
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  return Buffer.from(left).equals(Buffer.from(right));
};

const concatBytes = (...values: ReadonlyArray<Uint8Array>): Uint8Array => {
  return new Uint8Array(Buffer.concat(values.map((value) => Buffer.from(value))));
};

const canonicalUnknown = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    const encoded = JSON.stringify(value);

    return encoded ?? "";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalUnknown).join(",")}]`;
  }

  if (typeof value !== "object") {
    return "";
  }

  const entries = Object.entries(value)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalUnknown(entryValue)}`);

  return `{${entries.join(",")}}`;
};

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

const decodeJsonDocument = (value: Uint8Array): Option.Option<JsonValue> => {
  const text = decodeUtf8(value);

  if (Option.isNone(text)) {
    return Option.none();
  }

  try {
    return Option.some(Schema.validateSync(jsonValueSchema, strictParseOptions)(JSON.parse(text.value)));
  } catch {
    return Option.none();
  }
};

const isJsonArray = (value: JsonValue): value is ReadonlyArray<JsonValue> => {
  return Array.isArray(value);
};

const isJsonObject = (value: JsonValue): value is Readonly<Record<string, JsonValue>> => {
  return value !== null && typeof value === "object" && !isJsonArray(value);
};

const decodePointerSegment = (segment: string): string => {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
};

const pointerSegments = (pointer: string): ReadonlyArray<string> => {
  return pointer.slice(1).split("/").map(decodePointerSegment);
};

const readJsonObjectSegment = (document: JsonValue, segment: string): Option.Option<JsonValue> => {
  if (!isJsonObject(document) || !Object.hasOwn(document, segment)) {
    return Option.none();
  }

  // The plain-object and own-property guards prove this decoded key exists, including null values.
  return Option.some(document[segment]);
};

const readJsonPointerSegment = (document: JsonValue, segment: string): Option.Option<JsonValue> => {
  return readJsonObjectSegment(document, segment);
};

const readJsonPointer = (document: JsonValue, pointer: string): Option.Option<JsonValue> => {
  let current = document;

  // Traverse decoded RFC 6901 segments without conflating a present null with absence.
  for (const segment of pointerSegments(pointer)) {
    const candidate = readJsonPointerSegment(current, segment);

    if (Option.isNone(candidate)) {
      return Option.none();
    }

    current = candidate.value;
  }

  return Option.some(current);
};

type JsonTargetState =
  | {
      readonly _tag: "missing";
    }
  | {
      readonly _tag: "value";
      readonly value: JsonValue;
    };

type JsonPointerUpdate = {
  readonly document: JsonValue;
  readonly segments: ReadonlyArray<string>;
  readonly state: JsonTargetState;
};

type JsonStateRequest = {
  readonly document: JsonValue;
  readonly pointer: string;
  readonly state: JsonTargetState;
};

const updateJsonPointer = ({ document, segments, state }: JsonPointerUpdate): Option.Option<JsonValue> => {
  const [segment, ...remaining] = segments;

  if (segment === undefined) {
    return Option.none();
  }

  if (isJsonArray(document)) {
    return Option.none();
  }

  if (!isJsonObject(document)) {
    return Option.none();
  }

  const copy: Record<string, JsonValue> = { ...document };
  if (remaining.length === 0) {
    if (state._tag === "missing") {
      // Deleting a decoded string key is safe whether or not the final property exists.
      delete copy[segment];
    } else {
      // The decoded pointer segment is the exact string key owned by this receipt entry.
      copy[segment] = state.value;
    }

    return Option.some(copy);
  }

  if (!Object.hasOwn(copy, segment)) {
    return Option.none();
  }

  // The own-property guard proves this intermediate decoded key exists.
  const updated = updateJsonPointer({ document: copy[segment], segments: remaining, state });
  if (Option.isNone(updated)) {
    return Option.none();
  }

  // The same own-property proof permits replacing the recursively updated child.
  copy[segment] = updated.value;
  return Option.some(copy);
};

const applyJsonState = ({ document, pointer, state }: JsonStateRequest): Option.Option<JsonValue> => {
  return updateJsonPointer({ document, segments: pointerSegments(pointer), state });
};

const jsonStateMatches = ({ document, pointer, state }: JsonStateRequest): boolean => {
  const actual = readJsonPointer(document, pointer);

  if (state._tag === "missing") {
    return Option.isNone(actual);
  }

  return Option.isSome(actual) && sha256JsonValue(actual.value) === sha256JsonValue(state.value);
};

const isEmptyJsonDocument = (document: JsonValue): boolean => {
  if (isJsonArray(document)) {
    return document.length === 0;
  }

  return isJsonObject(document) && Object.keys(document).length === 0;
};

type ManagedSpan = {
  readonly ownedStart: number;
  readonly ownedEnd: number;
};

const isLineStart = (content: Uint8Array, index: number): boolean => {
  return index === 0 || content.at(index - 1) === 10;
};

const isLineEnd = (content: Uint8Array, index: number): boolean => {
  return index === content.length || content.at(index) === 10 || (content.at(index) === 13 && content.at(index + 1) === 10);
};

const locateManagedSpan = (artifact: OwnedArtifact, candidateBytes: Uint8Array): Option.Option<ManagedSpan> => {
  if (artifact.ownership._tag !== "managedBlock" || Option.isNone(decodeUtf8(candidateBytes))) {
    return Option.none();
  }

  const content = Buffer.from(candidateBytes);
  const startMarker = Buffer.from(artifact.ownership.startMarker, "utf8");
  const endMarker = Buffer.from(artifact.ownership.endMarker, "utf8");
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  const afterStart = start + startMarker.length;
  const afterEnd = end + endMarker.length;

  if (
    start < 0 ||
    end < 0 ||
    content.lastIndexOf(startMarker) !== start ||
    content.lastIndexOf(endMarker) !== end ||
    !isLineStart(content, start) ||
    !isLineEnd(content, afterStart) ||
    !isLineStart(content, end) ||
    !isLineEnd(content, afterEnd)
  ) {
    return Option.none();
  }

  const body = content.subarray(afterStart, end);
  const leading = Buffer.from(artifact.ownership.leadingDelimiter);
  const trailing = Buffer.from(artifact.ownership.trailingDelimiter);
  const ownedStart = start - leading.length;
  const ownedEnd = afterEnd + trailing.length;

  if (
    ownedStart < 0 ||
    ownedEnd > content.length ||
    !content.subarray(ownedStart, start).equals(leading) ||
    !content.subarray(afterEnd, ownedEnd).equals(trailing) ||
    sha256Bytes(body) !== artifact.ownership.installedBodySha256
  ) {
    return Option.none();
  }

  return Option.some({ ownedStart, ownedEnd });
};

const removeManagedSpan = (artifact: OwnedArtifact, candidateBytes: Uint8Array): Option.Option<Uint8Array> => {
  const span = locateManagedSpan(artifact, candidateBytes);

  if (Option.isNone(span)) {
    return Option.none();
  }

  return Option.some(concatBytes(candidateBytes.subarray(0, span.value.ownedStart), candidateBytes.subarray(span.value.ownedEnd)));
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

type YamlReferenceRequest = {
  readonly content: string;
  readonly key: string;
  readonly reference: string;
};

type YamlRemovalRequest = YamlReferenceRequest & {
  readonly removeKey: boolean;
};

const splitYamlLines = (content: string): ReadonlyArray<YamlLine> => {
  const lines: Array<YamlLine> = [];
  const pattern = /[^\r\n]*(?:\r\n|\n|$)/g;

  // Preserve exact byte offsets so structural rewrites cannot touch unrelated ranges.
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

  const matchingPairs = document.contents.items.filter((pair) => {
    return isScalar(pair.key) && pair.key.value === key;
  });
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

  // Validate every AST sequence item before trusting its source range for a surgical byte edit.
  for (const item of pair.value.items) {
    if (!isScalar(item) || typeof item.value !== "string") {
      return Option.none();
    }

    const range = readSourceRange(item.range ?? undefined);
    if (Option.isNone(range)) {
      return Option.none();
    }

    const line = lineContaining(lines, range.value.start);
    if (Option.isNone(line)) {
      return Option.none();
    }

    if (pair.value.flow !== true && !blockYamlEntryIsSafe({ content, line: line.value, range: range.value })) {
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

const removeYamlReference = ({ content, key, reference, removeKey }: YamlRemovalRequest): Option.Option<Uint8Array> => {
  const parsed = parseOwnedYamlTarget(content, key);
  if (Option.isNone(parsed) || parsed.value._tag === "missingKey") {
    return Option.none();
  }

  const matches = parsed.value.entries.flatMap((entry, index) => (entry.value === reference ? [index] : []));
  const targetIndex = matches.at(0);
  const target = targetIndex === undefined ? undefined : parsed.value.entries.at(targetIndex);
  if (matches.length !== 1 || targetIndex === undefined || target === undefined) {
    return Option.none();
  }

  if (parsed.value.entries.length === 1 && removeKey) {
    const separatorStart = parsed.value.keyLine.start - parsed.value.newline.length;
    const ownedStart =
      parsed.value.keyLine.start === 0
        ? Option.some(0)
        : content.slice(separatorStart, parsed.value.keyLine.start) === parsed.value.newline
          ? Option.some(separatorStart)
          : Option.none<number>();
    if (Option.isNone(ownedStart)) {
      return Option.none();
    }

    const end = parsed.value.flow ? parsed.value.keyLine.end : target.line.end;

    return Option.some(editYamlRange({ content, start: ownedStart.value, end, replacement: "" }));
  }

  if (parsed.value.flow) {
    if (parsed.value.entries.length === 1) {
      return Option.some(editYamlRange({ content, start: target.range.start, end: target.range.valueEnd, replacement: "" }));
    }

    if (targetIndex === 0) {
      const next = parsed.value.entries.at(1);

      return next === undefined
        ? Option.none()
        : Option.some(editYamlRange({ content, start: target.range.start, end: next.range.start, replacement: "" }));
    }

    const previous = parsed.value.entries.at(targetIndex - 1);

    return previous === undefined
      ? Option.none()
      : Option.some(editYamlRange({ content, start: previous.range.valueEnd, end: target.range.valueEnd, replacement: "" }));
  }

  if (parsed.value.entries.length === 1) {
    return Option.some(
      editYamlRange({
        content,
        start: parsed.value.keyLine.start,
        end: target.line.end,
        replacement: `${key}: []${target.line.newline}`,
      }),
    );
  }

  const targetBodyEnd = target.line.end - target.line.newline.length;
  if (targetIndex === 0) {
    return Option.some(editYamlRange({ content, start: target.line.start, end: targetBodyEnd, replacement: "" }));
  }

  const previous = parsed.value.entries.at(targetIndex - 1);
  if (previous === undefined) {
    return Option.none();
  }

  const previousBodyEnd = previous.line.end - previous.line.newline.length;

  return Option.some(editYamlRange({ content, start: previousBodyEnd, end: targetBodyEnd, replacement: "" }));
};

const missingTargetSnapshotSchema = Schema.TaggedStruct("missing", {}).annotations({
  parseOptions: strictParseOptions,
});

const fileTargetSnapshotSchema = Schema.TaggedStruct("file", {
  bytes: persistedBytesSchema,
  sha256: sha256Schema,
})
  .pipe(
    Schema.filter((snapshot) => snapshot.sha256 === sha256Bytes(snapshot.bytes), {
      message: () => "Target snapshot bytes must match their SHA-256.",
    }),
  )
  .annotations({
    parseOptions: strictParseOptions,
  });

const targetSnapshotSchema = Schema.Union(missingTargetSnapshotSchema, fileTargetSnapshotSchema);

export const artifactObservationSchema = Schema.Struct({
  path: scopeRelativePathSchema,
  snapshot: targetSnapshotSchema,
}).annotations({
  parseOptions: strictParseOptions,
});

export type ArtifactObservation = Schema.Schema.Type<typeof artifactObservationSchema>;

export const artifactObservationsEqual = (left: ArtifactObservation, right: ArtifactObservation): boolean => {
  if (left.path !== right.path || left.snapshot._tag !== right.snapshot._tag) {
    return false;
  }

  if (left.snapshot._tag === "missing" || right.snapshot._tag === "missing") {
    return true;
  }

  return left.snapshot.sha256 === right.snapshot.sha256 && bytesEqual(left.snapshot.bytes, right.snapshot.bytes);
};

const jsonEntryState = (
  entry: Extract<OwnedArtifact["ownership"], { readonly _tag: "jsonValues" }>["entries"][number],
  target: "installed" | "prior",
): JsonTargetState => {
  const state = target === "installed" ? entry.installed : entry.prior;

  return state._tag === "missing" ? { _tag: "missing" } : { _tag: "value", value: state.value };
};

type SnapshotMatchRequest = {
  readonly artifact: OwnedArtifact;
  readonly observation: ArtifactObservation;
  readonly target: "installed" | "prior";
};

const jsonSnapshotMatches = ({ artifact, observation, target }: SnapshotMatchRequest): boolean => {
  if (artifact.ownership._tag !== "jsonValues") {
    return false;
  }

  if (observation.snapshot._tag === "missing") {
    const documentWasMissing = artifact.ownership.priorDocument._tag === "missing";
    const allStatesMissing = artifact.ownership.entries.every((entry) => jsonEntryState(entry, target)._tag === "missing");

    return documentWasMissing && allStatesMissing;
  }

  if (target === "prior" && artifact.ownership.priorDocument._tag === "missing") {
    return false;
  }

  const document = decodeJsonDocument(observation.snapshot.bytes);

  return (
    Option.isSome(document) &&
    artifact.ownership.entries.every((entry) => {
      return jsonStateMatches({ document: document.value, pointer: entry.pointer, state: jsonEntryState(entry, target) });
    })
  );
};

const yamlSnapshotMatches = ({ artifact, observation, target }: SnapshotMatchRequest): boolean => {
  if (artifact.ownership._tag !== "yamlSequenceValue") {
    return false;
  }

  if (observation.snapshot._tag === "missing") {
    return target === "prior" && artifact.ownership.priorDocument._tag === "missing";
  }

  if (target === "prior" && artifact.ownership.priorDocument._tag === "missing") {
    return false;
  }

  const document = decodeYamlDocument(observation.snapshot.bytes);
  if (Option.isNone(document)) {
    return false;
  }

  const parsed = parseOwnedYamlTarget(document.value.content, artifact.ownership.key);
  if (Option.isNone(parsed)) {
    return false;
  }

  const expectedPresent = target === "installed" || artifact.ownership.priorPresence._tag === "present";

  if (parsed.value._tag === "missingKey") {
    return target === "prior" && artifact.ownership.priorKeyPresence._tag === "absent" && !expectedPresent;
  }

  if (target === "prior" && artifact.ownership.priorKeyPresence._tag === "absent") {
    return false;
  }

  return parsed.value.references.includes(artifact.ownership.reference) === expectedPresent;
};

export const currentSnapshotMatches = ({ artifact, observation, target }: SnapshotMatchRequest): boolean => {
  if (artifact.path !== observation.path) {
    return false;
  }

  switch (artifact.ownership._tag) {
    case "wholeFile": {
      if (target === "installed") {
        return observation.snapshot._tag === "file" && observation.snapshot.sha256 === artifact.ownership.installedSha256;
      }

      if (artifact.ownership.prior._tag === "missing") {
        return observation.snapshot._tag === "missing";
      }

      return (
        observation.snapshot._tag === "file" &&
        observation.snapshot.sha256 === artifact.ownership.prior.sha256 &&
        bytesEqual(observation.snapshot.bytes, artifact.ownership.prior.bytes)
      );
    }
    case "managedBlock": {
      if (target === "installed") {
        return observation.snapshot._tag === "file" && Option.isSome(locateManagedSpan(artifact, observation.snapshot.bytes));
      }

      if (artifact.ownership.priorDocument._tag === "missing") {
        return observation.snapshot._tag === "missing";
      }

      if (observation.snapshot._tag !== "file") {
        return false;
      }

      const content = decodeUtf8(observation.snapshot.bytes);
      return (
        Option.isSome(content) &&
        !content.value.includes(artifact.ownership.startMarker) &&
        !content.value.includes(artifact.ownership.endMarker)
      );
    }
    case "jsonValues":
      return jsonSnapshotMatches({ artifact, observation, target });
    case "yamlSequenceValue":
      return yamlSnapshotMatches({ artifact, observation, target });
  }
};

const initialJsonDocument = (observation: ArtifactObservation): Option.Option<JsonValue> => {
  if (observation.snapshot._tag === "missing") {
    return Option.some({});
  }

  return decodeJsonDocument(observation.snapshot.bytes);
};

type ApplyJsonEntriesRequest = {
  readonly document: JsonValue;
  readonly artifact: OwnedArtifact;
  readonly target: "installed" | "prior";
  readonly selectedPointers?: ReadonlySet<string>;
};

const applyArtifactJsonEntries = ({ document, artifact, target, selectedPointers }: ApplyJsonEntriesRequest): Option.Option<JsonValue> => {
  if (artifact.ownership._tag !== "jsonValues") {
    return Option.none();
  }

  let current: Option.Option<JsonValue> = Option.some(document);

  // Apply sorted non-overlapping receipt pointers in their declared deterministic order.
  for (const entry of artifact.ownership.entries) {
    if (selectedPointers !== undefined && !selectedPointers.has(entry.pointer)) {
      continue;
    }

    if (Option.isNone(current)) {
      return Option.none();
    }

    current = applyJsonState({ document: current.value, pointer: entry.pointer, state: jsonEntryState(entry, target) });
  }

  return current;
};

type DesiredTransformRequest = {
  readonly artifact: OwnedArtifact;
  readonly observation: ArtifactObservation;
  readonly previous: Option.Option<OwnedArtifact>;
};

type DesiredBytesTransformRequest = DesiredTransformRequest & {
  readonly candidateBytes: Uint8Array;
};

const deriveJsonPriorDocument = ({ artifact, observation, previous }: DesiredTransformRequest): Option.Option<JsonValue> => {
  const initial = initialJsonDocument(observation);
  if (Option.isNone(initial) || artifact.ownership._tag !== "jsonValues") {
    return Option.none();
  }

  let current: Option.Option<JsonValue> = initial;
  if (Option.isSome(previous)) {
    if (previous.value.ownership._tag !== "jsonValues") {
      return Option.none();
    }

    const desiredPointers = new Set(artifact.ownership.entries.map((entry) => entry.pointer));
    const removedPointers = new Set(
      previous.value.ownership.entries.filter((entry) => !desiredPointers.has(entry.pointer)).map((entry) => entry.pointer),
    );
    if (Option.isNone(current)) {
      return Option.none();
    }

    current = applyArtifactJsonEntries({
      document: current.value,
      artifact: previous.value,
      target: "prior",
      selectedPointers: removedPointers,
    });
  }

  return current;
};

const deriveDesiredJson = (request: DesiredTransformRequest): Option.Option<JsonValue> => {
  const current = deriveJsonPriorDocument(request);
  if (Option.isNone(current)) {
    return Option.none();
  }

  return applyArtifactJsonEntries({ document: current.value, artifact: request.artifact, target: "installed" });
};

const newJsonPriorsMatch = (request: DesiredTransformRequest): boolean => {
  if (Option.isNone(request.previous) || request.artifact.ownership._tag !== "jsonValues") {
    return true;
  }

  if (request.previous.value.ownership._tag !== "jsonValues") {
    return false;
  }

  const priorDocument = deriveJsonPriorDocument(request);
  if (Option.isNone(priorDocument)) {
    return false;
  }

  const previousPointers = new Set(request.previous.value.ownership.entries.map((entry) => entry.pointer));

  return request.artifact.ownership.entries.every((entry) => {
    return (
      previousPointers.has(entry.pointer) ||
      jsonStateMatches({ document: priorDocument.value, pointer: entry.pointer, state: jsonEntryState(entry, "prior") })
    );
  });
};

const desiredJsonBytesMatch = ({ artifact, candidateBytes, observation, previous }: DesiredBytesTransformRequest): boolean => {
  if (Option.isNone(previous) && !currentSnapshotMatches({ artifact, observation, target: "prior" })) {
    return false;
  }

  if (!newJsonPriorsMatch({ artifact, observation, previous })) {
    return false;
  }

  const expected = deriveDesiredJson({ artifact, observation, previous });
  const candidate = decodeJsonDocument(candidateBytes);

  return Option.isSome(expected) && Option.isSome(candidate) && sha256JsonValue(expected.value) === sha256JsonValue(candidate.value);
};

const desiredManagedBytesMatch = ({ artifact, candidateBytes, observation, previous }: DesiredBytesTransformRequest): boolean => {
  if (artifact.ownership._tag !== "managedBlock") {
    return false;
  }

  const candidatePrior = removeManagedSpan(artifact, candidateBytes);
  if (Option.isNone(candidatePrior)) {
    return false;
  }

  if (Option.isSome(previous)) {
    if (previous.value.ownership._tag !== "managedBlock" || observation.snapshot._tag !== "file") {
      return false;
    }

    const currentPrior = removeManagedSpan(previous.value, observation.snapshot.bytes);
    return Option.isSome(currentPrior) && bytesEqual(currentPrior.value, candidatePrior.value);
  }

  if (!currentSnapshotMatches({ artifact, observation, target: "prior" })) {
    return false;
  }

  const priorBytes = observation.snapshot._tag === "missing" ? new Uint8Array() : observation.snapshot.bytes;
  return bytesEqual(priorBytes, candidatePrior.value);
};

const desiredYamlBytesMatch = ({ artifact, candidateBytes, observation, previous }: DesiredBytesTransformRequest): boolean => {
  if (artifact.ownership._tag !== "yamlSequenceValue") {
    return false;
  }

  if (Option.isSome(previous)) {
    if (
      previous.value.ownership._tag !== "yamlSequenceValue" ||
      previous.value.ownership.key !== artifact.ownership.key ||
      previous.value.ownership.reference !== artifact.ownership.reference
    ) {
      return false;
    }
  } else if (!currentSnapshotMatches({ artifact, observation, target: "prior" })) {
    return false;
  }

  if (observation.snapshot._tag === "missing") {
    const expected = new TextEncoder().encode(`${artifact.ownership.key}:\n  - ${artifact.ownership.reference}\n`);

    return bytesEqual(expected, candidateBytes);
  }

  const document = decodeYamlDocument(observation.snapshot.bytes);
  if (Option.isNone(document)) {
    return false;
  }

  const expected = addYamlReference({
    content: document.value.content,
    key: artifact.ownership.key,
    reference: artifact.ownership.reference,
  });

  return Option.isSome(expected) && bytesEqual(concatBytes(document.value.prefix, expected.value), candidateBytes);
};

export const desiredBytesMatch = ({ artifact, candidateBytes, observation, previous }: DesiredBytesTransformRequest): boolean => {
  if (Option.isSome(previous) && (previous.value.kind !== artifact.kind || previous.value.ownership._tag !== artifact.ownership._tag)) {
    return false;
  }

  switch (artifact.ownership._tag) {
    case "wholeFile":
      return (
        sha256Bytes(candidateBytes) === artifact.ownership.installedSha256 &&
        (Option.isSome(previous)
          ? currentSnapshotMatches({ artifact: previous.value, observation, target: "installed" })
          : currentSnapshotMatches({ artifact, observation, target: "prior" }))
      );
    case "managedBlock":
      return desiredManagedBytesMatch({ artifact, candidateBytes, observation, previous });
    case "jsonValues":
      return desiredJsonBytesMatch({ artifact, candidateBytes, observation, previous });
    case "yamlSequenceValue":
      return desiredYamlBytesMatch({ artifact, candidateBytes, observation, previous });
  }
};

export const deriveRestorationBytes = (artifact: OwnedArtifact, observation: ArtifactObservation): Option.Option<Uint8Array> => {
  if (!currentSnapshotMatches({ artifact, observation, target: "installed" })) {
    return Option.none();
  }

  switch (artifact.ownership._tag) {
    case "wholeFile":
      return artifact.ownership.prior._tag === "file" ? Option.some(artifact.ownership.prior.bytes) : Option.none();
    case "managedBlock":
      return observation.snapshot._tag === "file" ? removeManagedSpan(artifact, observation.snapshot.bytes) : Option.none();
    case "jsonValues": {
      const initial = initialJsonDocument(observation);
      if (Option.isNone(initial)) {
        return Option.none();
      }

      const restored = applyArtifactJsonEntries({ document: initial.value, artifact, target: "prior" });

      return Option.isSome(restored) ? Option.some(new TextEncoder().encode(canonicalUnknown(restored.value))) : Option.none();
    }
    case "yamlSequenceValue": {
      if (observation.snapshot._tag !== "file") {
        return Option.none();
      }

      if (artifact.ownership.priorPresence._tag === "present") {
        return Option.some(observation.snapshot.bytes);
      }

      const document = decodeYamlDocument(observation.snapshot.bytes);
      if (Option.isNone(document)) {
        return Option.none();
      }

      const restored = removeYamlReference({
        content: document.value.content,
        key: artifact.ownership.key,
        reference: artifact.ownership.reference,
        removeKey: artifact.ownership.priorKeyPresence._tag === "absent",
      });

      return Option.isSome(restored) ? Option.some(concatBytes(document.value.prefix, restored.value)) : Option.none();
    }
  }
};

export const restorationCanRemove = (artifact: OwnedArtifact, observation: ArtifactObservation): boolean => {
  if (!currentSnapshotMatches({ artifact, observation, target: "installed" })) {
    return false;
  }

  switch (artifact.ownership._tag) {
    case "wholeFile":
      return artifact.ownership.prior._tag === "missing";
    case "managedBlock": {
      const restored = deriveRestorationBytes(artifact, observation);
      return artifact.ownership.priorDocument._tag === "missing" && Option.isSome(restored) && restored.value.length === 0;
    }
    case "jsonValues": {
      const initial = initialJsonDocument(observation);
      const restored = Option.isSome(initial)
        ? applyArtifactJsonEntries({ document: initial.value, artifact, target: "prior" })
        : Option.none<JsonValue>();
      return artifact.ownership.priorDocument._tag === "missing" && Option.isSome(restored) && isEmptyJsonDocument(restored.value);
    }
    case "yamlSequenceValue": {
      const restored = deriveRestorationBytes(artifact, observation);

      return artifact.ownership.priorDocument._tag === "missing" && Option.isSome(restored) && restored.value.length === 0;
    }
  }
};

type RestorationBytesRequest = {
  readonly artifact: OwnedArtifact;
  readonly observation: ArtifactObservation;
  readonly candidateBytes: Uint8Array;
};

export const restorationBytesMatch = ({ artifact, observation, candidateBytes }: RestorationBytesRequest): boolean => {
  const expected = deriveRestorationBytes(artifact, observation);
  if (Option.isNone(expected)) {
    return false;
  }

  if (artifact.ownership._tag === "jsonValues") {
    const expectedDocument = decodeJsonDocument(expected.value);
    const candidateDocument = decodeJsonDocument(candidateBytes);

    return (
      Option.isSome(expectedDocument) &&
      Option.isSome(candidateDocument) &&
      sha256JsonValue(expectedDocument.value) === sha256JsonValue(candidateDocument.value)
    );
  }

  return bytesEqual(expected.value, candidateBytes);
};
