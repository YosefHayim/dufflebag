/** Byte-preserving edits to one JSON object property, so a user's settings keep their own formatting. */

import { Either, Schema } from "effect";
import { findNodeAtLocation, type Node, parseTree } from "jsonc-parser";

import { hashBytes } from "./fileBytes.js";
import { InstallError } from "./installRequest.js";
import type { PreviousJsonLexical } from "./ownership.js";

const textEncoder = new TextEncoder();
const encodeJson = Schema.encodeSync(Schema.parseJson());

// Receipts record owned JSON values by the hash of their compact encoding.
export const hashJsonValue = (value: unknown): string => hashBytes(textEncoder.encode(encodeJson(value)));

const decodeJsonPointerSegment = (segment: string): string => segment.replaceAll("~1", "/").replaceAll("~0", "~");

export const jsonPointerPath = (pointer: string): ReadonlyArray<string> =>
  pointer.slice(1).split("/").map(decodeJsonPointerSegment);

export const jsonPropertyName = (property: Node): string | undefined => {
  const key = property.children?.[0];

  return typeof key?.value === "string" ? key.value : undefined;
};

export const objectProperties = (node: Node): ReadonlyArray<Node> => node.children || [];

const commaBetween = (input: { source: string; start: number; end: number }): number | undefined => {
  const offset = input.source.indexOf(",", input.start);

  return offset >= input.start && offset < input.end ? offset : undefined;
};

const spliceSource = (input: { source: string; start: number; end: number; text?: string }): string =>
  input.source.slice(0, input.start) + (input.text || "") + input.source.slice(input.end);

const separatorError = new InstallError({ issue: "settings.json property separators could not be preserved safely." });

const removeJsonProperty = (input: {
  source: string;
  parent: Node;
  property: Node;
}): Either.Either<string, InstallError> => {
  const properties = objectProperties(input.parent);
  const index = properties.indexOf(input.property);
  const previous = properties[index - 1];
  const next = properties[index + 1];
  const propertyEnd = input.property.offset + input.property.length;

  if (next !== undefined) {
    const comma = commaBetween({ source: input.source, start: propertyEnd, end: next.offset });

    return comma === undefined
      ? Either.left(separatorError)
      : Either.right(spliceSource({ source: input.source, start: input.property.offset, end: comma + 1 }));
  }

  if (previous !== undefined) {
    const comma = commaBetween({
      source: input.source,
      start: previous.offset + previous.length,
      end: input.property.offset,
    });

    return comma === undefined
      ? Either.left(separatorError)
      : Either.right(spliceSource({ source: input.source, start: comma, end: propertyEnd }));
  }

  return Either.right(spliceSource({ source: input.source, start: input.property.offset, end: propertyEnd }));
};

const locateProperty = (input: { source: string; path: ReadonlyArray<string> }) => {
  const root = parseTree(input.source);
  const key = input.path.at(-1);
  const parent = root === undefined ? undefined : findNodeAtLocation(root, input.path.slice(0, -1));
  if (key === undefined || parent?.type !== "object") {
    return undefined;
  }

  return { key, parent, property: objectProperties(parent).find((candidate) => jsonPropertyName(candidate) === key) };
};

export const editJsonValue = (input: {
  source: string;
  path: ReadonlyArray<string>;
  value: unknown;
}): Either.Either<string, InstallError> => {
  const located = locateProperty(input);
  if (located === undefined) {
    return Either.left(
      new InstallError({ issue: `settings.json path /${input.path.join("/")} is not an editable object property.` }),
    );
  }

  const { key, parent, property } = located;
  if (property !== undefined) {
    if (input.value === undefined) {
      return removeJsonProperty({ source: input.source, parent, property });
    }

    const currentValue = property.children?.[1];
    if (currentValue === undefined) {
      return Either.left(new InstallError({ issue: `settings.json property ${key} has no value.` }));
    }

    return Either.right(
      spliceSource({
        source: input.source,
        start: currentValue.offset,
        end: currentValue.offset + currentValue.length,
        text: encodeJson(input.value),
      }),
    );
  }

  if (input.value === undefined) {
    return Either.right(input.source);
  }

  // A new property copies the key/value spacing and indentation of the last existing one.
  const previous = objectProperties(parent).at(-1);
  const previousKey = previous?.children?.[0];
  const previousValue = previous?.children?.[1];
  const keyValueSeparator =
    previousKey === undefined || previousValue === undefined
      ? ":"
      : input.source.slice(previousKey.offset + previousKey.length, previousValue.offset);
  const encodedProperty = `${JSON.stringify(key)}${keyValueSeparator}${encodeJson(input.value)}`;
  if (previous === undefined) {
    return Either.right(
      spliceSource({ source: input.source, start: parent.offset + 1, end: parent.offset + 1, text: encodedProperty }),
    );
  }

  const offset = previous.offset + previous.length;
  const closingWhitespace = input.source.slice(offset, parent.offset + parent.length - 1);

  return Either.right(
    spliceSource({ source: input.source, start: offset, end: offset, text: `,${closingWhitespace}${encodedProperty}` }),
  );
};

const locateValue = (input: { source: string; path: ReadonlyArray<string> }): Either.Either<Node, InstallError> => {
  const property = locateProperty(input)?.property;
  if (property === undefined) {
    return Either.left(
      new InstallError({ issue: `settings.json property /${input.path.join("/")} could not be located.` }),
    );
  }

  const value = property.children?.[1];

  return value === undefined
    ? Either.left(new InstallError({ issue: `settings.json property /${input.path.join("/")} has no value.` }))
    : Either.right(value);
};

export const captureJsonValueLexical = (input: {
  source: string;
  path: ReadonlyArray<string>;
}): Either.Either<PreviousJsonLexical, InstallError> =>
  Either.map(locateValue(input), (value) => ({
    _tag: "value",
    source: input.source.slice(value.offset, value.offset + value.length),
  }));

export const restoreJsonLexical = (input: {
  source: string;
  path: ReadonlyArray<string>;
  lexical: PreviousJsonLexical;
}): Either.Either<string, InstallError> =>
  Either.map(locateValue(input), (value) =>
    spliceSource({
      source: input.source,
      start: value.offset,
      end: value.offset + value.length,
      text: input.lexical.source,
    }),
  );
