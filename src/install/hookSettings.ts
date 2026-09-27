/** Agent hook settings (settings.json and native equivalents): plan the dufflebag hook entries, and restore them on removal. */

import type { Path } from "@effect/platform";
import { Either, Schema, ParseResult as SchemaParseIssue } from "effect";
import { findNodeAtLocation, parseTree } from "jsonc-parser";

import type { AgentDefinition } from "../catalog/agentCatalog.js";
import { featureCatalog } from "../catalog/featureCatalog.js";
import { decodeStrictText } from "./fileBytes.js";
import { findDuplicateJsonKey } from "./findDuplicateJsonKey.js";
import { applicationOwner, checkFileChange, expectedCurrent, type FileSnapshot } from "./hostFiles.js";
import { settingsPath } from "./installPaths.js";
import { InstallError } from "./installRequest.js";
import {
  captureJsonValueLexical,
  editJsonValue,
  hashJsonValue,
  jsonPointerPath,
  objectProperties,
  restoreJsonLexical,
} from "./jsonEdit.js";
import type { JsonValuesOwnership, OwnedFile, OwnedJsonValue, PreviousJsonValue } from "./ownership.js";
import { installedHookFile, registrationEntrypoint } from "./packageFiles.js";
import { type FileChange, fileChangeSchema } from "./plan.js";

const textEncoder = new TextEncoder();

const settingsDocumentSchema = Schema.Struct(
  {
    hooks: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Array(Schema.Unknown) })),
    env: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  },
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);

type SettingsDocument = Schema.Schema.Type<typeof settingsDocumentSchema>;

// The source text is kept beside the document so every edit preserves the user's bytes.
const decodedSettingsSchema = Schema.Struct({ source: Schema.String, document: settingsDocumentSchema });

export type DecodedSettings = Schema.Schema.Type<typeof decodedSettingsSchema>;

const parseSettings = (source: string, label: string): Either.Either<SettingsDocument, InstallError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(Schema.parseJson(settingsDocumentSchema), { onExcessProperty: "preserve" })(source),
    (error) =>
      new InstallError({ issue: `${label} is invalid: ${SchemaParseIssue.TreeFormatter.formatErrorSync(error)}` }),
  );

export const decodeSettings = (snapshot: FileSnapshot): Either.Either<DecodedSettings, InstallError> => {
  if (snapshot._tag === "missing") {
    return Either.right({ source: "{}\n", document: {} });
  }

  return Either.flatMap(
    Either.mapLeft(decodeStrictText(snapshot.bytes, "settings.json"), (issue) => new InstallError({ issue })),
    (source) => {
      const duplicateProperty = findDuplicateJsonKey(source);
      if (duplicateProperty !== undefined) {
        return Either.left(
          new InstallError({
            issue: `settings.json contains duplicate JSON property ${JSON.stringify(duplicateProperty)}.`,
          }),
        );
      }

      return Either.map(parseSettings(source, "settings.json"), (document) => ({ source, document }));
    },
  );
};

const hookEventFromPointer = (pointer: string): string | undefined => {
  const event = pointer.slice("/hooks/".length);

  return pointer.startsWith("/hooks/") && !event.includes("/") ? event : undefined;
};

const decodeHookGroups = (value: unknown, event: string): Either.Either<ReadonlyArray<unknown>, InstallError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(Schema.Array(Schema.Unknown))(value),
    () => new InstallError({ issue: `settings.json hook event ${event} must contain an array.` }),
  );

// The user's own groups for an event: from the receipt when dufflebag already edited it, else from the file.
const baseHookGroups = (input: {
  ownership: JsonValuesOwnership | undefined;
  document: SettingsDocument;
  event: string;
  source: string;
}): Either.Either<{ groups: ReadonlyArray<unknown>; previous: PreviousJsonValue }, InstallError> => {
  const history = input.ownership?.values.find((value) => value.pointer === `/hooks/${input.event}`)?.previous;
  if (history?._tag === "value") {
    if (history.lexical === undefined) {
      return Either.left(
        new InstallError({ issue: `Receipted hook event ${input.event} lacks lexical restoration evidence.` }),
      );
    }

    return Either.map(decodeHookGroups(history.value, input.event), (groups) => ({ groups, previous: history }));
  }

  if (history?._tag === "missing") {
    return Either.right({ groups: [], previous: history });
  }

  const current = input.document.hooks?.[input.event];
  if (current === undefined) {
    return Either.right({ groups: [], previous: { _tag: "missing" } });
  }

  return Either.flatMap(decodeHookGroups(current, input.event), (groups) =>
    Either.map(captureJsonValueLexical({ source: input.source, path: ["hooks", input.event] }), (lexical) => ({
      groups,
      previous: { _tag: "value", value: groups, lexical },
    })),
  );
};

// dufflebag owns only whole hook events, so every owned pointer is /hooks/<event>.
const settingsValueAtPointer = (document: SettingsDocument, pointer: string): unknown => {
  const [container, key, extra] = jsonPointerPath(pointer);

  return container === "hooks" && key !== undefined && extra === undefined ? document.hooks?.[key] : undefined;
};

const installedJsonValueMatches = (value: OwnedJsonValue, current: unknown): boolean =>
  current !== undefined && hashJsonValue(current) === value.installed.hash;

const validateCurrentSettingsOwnership = (
  document: SettingsDocument,
  ownership: JsonValuesOwnership | undefined,
): Either.Either<void, InstallError> => {
  const conflict = ownership?.values.find(
    (value) => !installedJsonValueMatches(value, settingsValueAtPointer(document, value.pointer)),
  );

  return conflict === undefined
    ? Either.right(undefined)
    : Either.left(
        new InstallError({ issue: `Receipted settings value ${conflict.pointer} changed after installation.` }),
      );
};

const settingsOperationSchema = (filePath: string) =>
  fileChangeSchema.pipe(
    Schema.filter((operation) => {
      const identityIssues = [
        ...(operation.file.path === filePath
          ? []
          : [{ path: ["file", "path"], message: `Settings operations must target ${filePath}.` }]),
        ...(operation.file.kind._tag === "settings"
          ? []
          : [{ path: ["file", "kind"], message: "Settings operations must use the settings file kind." }]),
        ...(operation.file.owner._tag === "application"
          ? []
          : [{ path: ["file", "owner"], message: "Settings operations must use the application owner." }]),
      ];
      if (identityIssues.length > 0 || operation._tag === "remove") {
        return identityIssues;
      }

      const decoded = decodeSettings({ _tag: "file", bytes: operation.bytes });
      if (Either.isLeft(decoded)) {
        return [{ path: ["bytes"], message: decoded.left.issue }];
      }

      if (operation._tag !== "write" || operation.file.ownership._tag !== "jsonValues") {
        return [];
      }

      return operation.file.ownership.values.flatMap((value, index) =>
        installedJsonValueMatches(value, settingsValueAtPointer(decoded.right.document, value.pointer))
          ? []
          : [
              {
                path: ["file", "ownership", "values", index],
                message: `Settings operation bytes do not match owned pointer ${value.pointer}.`,
              },
            ],
      );
    }),
  );

const validateSettingsOperation = (input: unknown, filePath: string): Either.Either<FileChange, InstallError> =>
  Either.mapLeft(
    Schema.validateEither(settingsOperationSchema(filePath), { onExcessProperty: "error" })(input),
    (error) =>
      new InstallError({
        issue: `Generated settings operation is invalid: ${SchemaParseIssue.TreeFormatter.formatErrorSync(error)}`,
      }),
  );

// A file dufflebag created and left empty is removed; anything else keeps its remaining user bytes.
const restoreOrRemove = (input: {
  file: OwnedFile;
  source: string;
  document: SettingsDocument;
  snapshot: FileSnapshot;
  filePreviouslyPresent: boolean;
}) =>
  !input.filePreviouslyPresent && Object.keys(input.document).length === 0
    ? {
        _tag: "remove",
        file: input.file,
        unownedBytes: new Uint8Array(),
        expectedCurrent: expectedCurrent(input.snapshot),
      }
    : {
        _tag: "restore",
        file: input.file,
        bytes: textEncoder.encode(input.source),
        expectedCurrent: expectedCurrent(input.snapshot),
      };

const managedHookGroupSchema = Schema.Struct({
  matcher: Schema.optional(
    Schema.NonEmptyString.annotations({
      description: "Optional tool matcher copied from the feature registration.",
    }),
  ),
  hooks: Schema.Tuple(
    Schema.Struct({
      type: Schema.Literal("command").annotations({
        description: "Claude hook leaf kind used for a spawned command.",
      }),
      command: Schema.NonEmptyString.annotations({
        description: "Fully resolved command invoking one installed runtime entrypoint.",
      }),
    }),
  ).annotations({
    description: "Single dufflebag-authored command leaf for this registration.",
  }),
});

type ManagedHookGroup = Schema.Schema.Type<typeof managedHookGroupSchema>;

export const desiredHookGroups = (input: {
  root: string;
  featureIds: ReadonlyArray<string>;
  selectedAgents: ReadonlyArray<AgentDefinition>;
  agent: AgentDefinition;
  path: Path.Path;
}) => {
  const groups = new Map<string, ReadonlyArray<ManagedHookGroup>>();
  if (
    !input.selectedAgents.some((agent) => agent.id === input.agent.id) ||
    input.agent.nativeHooks._tag === "unsupported"
  ) {
    return groups;
  }

  for (const feature of featureCatalog) {
    if (!input.featureIds.includes(feature.id) || feature.runtime._tag === "none") {
      continue;
    }

    for (const registration of feature.runtime.registrations) {
      const entrypoint = installedHookFile(
        feature.sourceDirectory,
        registrationEntrypoint(feature.runtime, registration),
      );
      const runtime = `node "${input.path.join(input.root, entrypoint)}"`;
      const command = registration.readsAgentId ? `DUFFLEBAG_AGENT_ID=${input.agent.id} ${runtime}` : runtime;
      const group = managedHookGroupSchema.make({
        ...(registration.matcher._tag === "pattern" ? { matcher: registration.matcher.value } : {}),
        hooks: [{ type: "command", command }],
      });

      groups.set(registration.event, [...(groups.get(registration.event) || []), group]);
    }
  }

  return groups;
};

export const planSettings = (input: {
  filePath?: string;
  snapshot: FileSnapshot;
  decoded: DecodedSettings;
  previousFile: OwnedFile | undefined;
  desiredGroups: ReadonlyMap<string, ReadonlyArray<ManagedHookGroup>>;
}): Either.Either<FileChange | undefined, InstallError> => {
  const filePath = input.filePath === undefined ? settingsPath : input.filePath;
  const previousOwnership =
    input.previousFile?.ownership._tag === "jsonValues" ? input.previousFile.ownership : undefined;
  if (
    input.previousFile !== undefined &&
    (input.previousFile.path !== filePath ||
      input.previousFile.kind._tag !== "settings" ||
      input.previousFile.owner._tag !== "application" ||
      previousOwnership === undefined)
  ) {
    return Either.left(
      new InstallError({ issue: "Receipted settings entry must keep its exact path, kind, and application owner." }),
    );
  }

  if (previousOwnership !== undefined && input.snapshot._tag === "missing") {
    return Either.left(new InstallError({ issue: "Receipted settings.json was removed after installation." }));
  }

  const currentOwnership = validateCurrentSettingsOwnership(input.decoded.document, previousOwnership);
  if (Either.isLeft(currentOwnership)) {
    return Either.left(currentOwnership.left);
  }

  // Events dufflebag no longer wants are restored first, newest first, then every desired event is written.
  const previousEvents = (previousOwnership?.values || []).flatMap((value) => {
    const event = hookEventFromPointer(value.pointer);

    return event === undefined ? [] : [event];
  });
  const removedEvents = previousEvents.filter((event) => !input.desiredGroups.has(event)).reverse();
  const events = [...new Set([...removedEvents, ...input.desiredGroups.keys()])];
  const createsHooksContainer = input.decoded.document.hooks === undefined && input.desiredGroups.size > 0;
  const ownsHooksContainer = previousOwnership?.createdContainers.includes("/hooks") === true || createsHooksContainer;
  const ownershipValues: Array<OwnedJsonValue> = [];
  let source = input.decoded.source;

  if (createsHooksContainer) {
    const edited = editJsonValue({ source, path: ["hooks"], value: {} });
    if (Either.isLeft(edited)) {
      return Either.left(edited.left);
    }

    source = edited.right;
  }

  for (const event of events) {
    const base = baseHookGroups({ ownership: previousOwnership, document: input.decoded.document, event, source });
    if (Either.isLeft(base)) {
      return Either.left(base.left);
    }

    const desired = input.desiredGroups.get(event);
    const previous = base.right.previous;
    const value = desired === undefined ? undefined : [...base.right.groups, ...desired];
    const edited =
      desired === undefined && previous._tag === "value" && previous.lexical !== undefined
        ? restoreJsonLexical({ source, path: ["hooks", event], lexical: previous.lexical })
        : editJsonValue({ source, path: ["hooks", event], value });
    if (Either.isLeft(edited)) {
      return Either.left(edited.left);
    }

    source = edited.right;
    if (desired !== undefined) {
      ownershipValues.push({
        pointer: `/hooks/${event}`,
        installed: { _tag: "value", hash: hashJsonValue(value) },
        previous,
      });
    }
  }

  let mergedDocument = parseSettings(source, "Generated settings.json");
  if (Either.isLeft(mergedDocument)) {
    return Either.left(mergedDocument.left);
  }

  const hooks = mergedDocument.right.hooks;
  if (ownsHooksContainer && hooks !== undefined && Object.keys(hooks).length === 0) {
    const edited = editJsonValue({ source, path: ["hooks"], value: undefined });
    if (Either.isLeft(edited)) {
      return Either.left(edited.left);
    }

    source = edited.right;
    mergedDocument = parseSettings(source, "Generated settings.json");
    if (Either.isLeft(mergedDocument)) {
      return Either.left(mergedDocument.left);
    }
  }

  if (ownershipValues.length === 0) {
    if (input.previousFile === undefined || previousOwnership === undefined) {
      return Either.right(undefined);
    }

    const operation = restoreOrRemove({
      file: input.previousFile,
      source,
      document: mergedDocument.right,
      snapshot: input.snapshot,
      filePreviouslyPresent: previousOwnership.filePreviouslyPresent,
    });

    return validateSettingsOperation(operation, filePath);
  }

  const createdContainers = [
    ...new Set([...(previousOwnership?.createdContainers || []), ...(ownsHooksContainer ? ["/hooks"] : [])]),
  ].filter((container) => ownershipValues.some((value) => value.pointer.startsWith(`${container}/`)));
  const ownership: JsonValuesOwnership = {
    _tag: "jsonValues",
    filePreviouslyPresent:
      previousOwnership === undefined ? input.snapshot._tag === "file" : previousOwnership.filePreviouslyPresent,
    createdContainers,
    values: ownershipValues,
  };

  return validateSettingsOperation(
    {
      _tag: "write",
      file: { owner: applicationOwner, path: filePath, kind: { _tag: "settings" }, ownership },
      bytes: textEncoder.encode(source),
      expectedCurrent: expectedCurrent(input.snapshot),
    },
    filePath,
  );
};

const restorePointer = (source: string, value: OwnedJsonValue): Either.Either<string, InstallError> => {
  const path = jsonPointerPath(value.pointer);
  if (value.previous._tag === "missing") {
    return editJsonValue({ source, path, value: undefined });
  }

  return value.previous.lexical === undefined
    ? Either.left(new InstallError({ issue: `Settings value ${value.pointer} lacks lexical restoration evidence.` }))
    : restoreJsonLexical({ source, path, lexical: value.previous.lexical });
};

export const restoreSettings = (input: {
  file: OwnedFile;
  snapshot: FileSnapshot;
}): Either.Either<FileChange, InstallError> => {
  const ownership = input.file.ownership;
  if (
    input.file.kind._tag !== "settings" ||
    input.file.owner._tag !== "application" ||
    ownership._tag !== "jsonValues"
  ) {
    return Either.left(
      new InstallError({ issue: `Settings restoration for ${input.file.path} has invalid ownership.` }),
    );
  }

  if (input.snapshot._tag === "missing") {
    return Either.left(
      new InstallError({ issue: `Receipted settings file ${input.file.path} was removed after installation.` }),
    );
  }

  const decoded = decodeSettings(input.snapshot);
  if (Either.isLeft(decoded)) {
    return Either.left(decoded.left);
  }

  const currentOwnership = validateCurrentSettingsOwnership(decoded.right.document, ownership);
  if (Either.isLeft(currentOwnership)) {
    return Either.left(currentOwnership.left);
  }

  // Undo edits in reverse order, then drop only the containers dufflebag created that are now empty.
  let source = decoded.right.source;
  for (const value of [...ownership.values].reverse()) {
    const restored = restorePointer(source, value);
    if (Either.isLeft(restored)) {
      return Either.left(restored.left);
    }

    source = restored.right;
  }

  for (const pointer of [...ownership.createdContainers].reverse()) {
    const pointerPath = jsonPointerPath(pointer);
    const root = parseTree(source);
    const container = root === undefined ? undefined : findNodeAtLocation(root, [...pointerPath]);
    if (container?.type !== "object" || objectProperties(container).length > 0) {
      continue;
    }

    const restored = editJsonValue({ source, path: pointerPath, value: undefined });
    if (Either.isLeft(restored)) {
      return Either.left(restored.left);
    }

    source = restored.right;
  }

  const document = parseSettings(source, "Generated settings.json");
  if (Either.isLeft(document)) {
    return Either.left(document.left);
  }

  return checkFileChange(
    restoreOrRemove({
      file: input.file,
      source,
      document: document.right,
      snapshot: input.snapshot,
      filePreviouslyPresent: ownership.filePreviouslyPresent,
    }),
  );
};
