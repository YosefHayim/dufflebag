import path from "node:path";
import { Option, Schema, type SchemaAST } from "effect";
import {
  type ArtifactObservation,
  artifactObservationSchema,
  artifactObservationsEqual,
  currentSnapshotMatches,
  desiredBytesMatch,
  restorationBytesMatch,
  restorationCanRemove,
} from "./artifactMaterialization.js";
import {
  type ArtifactReceipt,
  artifactReceiptJsonSchema,
  artifactReceiptSchema,
  type OwnedArtifact,
  ownedArtifactSchema,
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

const sortedUniqueValues = (values: ReadonlyArray<string>): boolean => {
  if (!uniqueValues(values)) {
    return false;
  }

  return values.every((value, index) => {
    const previous = index === 0 ? undefined : values.at(index - 1);

    return previous === undefined || previous < value;
  });
};

const hasParentChildConflict = (paths: ReadonlyArray<string>): boolean => {
  return paths.some((candidate) => {
    return paths.some((possibleParent) => {
      return candidate !== possibleParent && candidate.startsWith(`${possibleParent}/`);
    });
  });
};

const isNormalizedAbsoluteRoot = (root: string): boolean => {
  return (
    path.isAbsolute(root) &&
    path.normalize(root) === root &&
    !root.includes("\0") &&
    (root === path.parse(root).root || !root.endsWith(path.sep))
  );
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  return Buffer.from(left).equals(Buffer.from(right));
};

const artifactsEquivalent = Schema.equivalence(Schema.Array(ownedArtifactSchema));

const artifactEquivalent = Schema.equivalence(ownedArtifactSchema);

const receiptsEquivalent = Schema.equivalence(artifactReceiptSchema);

const canonicalReceiptSha256 = (receipt: ArtifactReceipt): string => {
  const encoded = Schema.encodeSync(artifactReceiptJsonSchema)(receipt);

  return sha256Bytes(new TextEncoder().encode(encoded));
};

const decodeUtf8 = (value: Uint8Array): Option.Option<string> => {
  try {
    return Option.some(new TextDecoder("utf-8", { fatal: true }).decode(value));
  } catch {
    return Option.none();
  }
};

const legacyManifestSchema = Schema.Struct({
  version: Schema.NonEmptyTrimmedString,
  scope: Schema.Literal("global", "project"),
  features: Schema.Array(
    Schema.String.pipe(
      Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
        message: () => "Legacy feature IDs must use kebab-case.",
      }),
    ),
  ).pipe(
    Schema.filter(uniqueValues, {
      message: () => "Legacy feature IDs must be unique.",
    }),
  ),
  skills: Schema.Array(Schema.NonEmptyTrimmedString).pipe(
    Schema.filter(uniqueValues, {
      message: () => "Legacy skill IDs must be unique.",
    }),
  ),
  installedAt: Schema.NonEmptyTrimmedString,
}).annotations({
  parseOptions: strictParseOptions,
});

type LegacyManifest = Schema.Schema.Type<typeof legacyManifestSchema>;

const legacyManifestsEquivalent = Schema.equivalence(legacyManifestSchema);

const legacyManifestBytesMatch = (value: Uint8Array, expected: LegacyManifest): boolean => {
  const text = decodeUtf8(value);
  if (Option.isNone(text)) {
    return false;
  }

  try {
    const decoded = Schema.validateSync(legacyManifestSchema, strictParseOptions)(JSON.parse(text.value));

    return legacyManifestsEquivalent(decoded, expected);
  } catch {
    return false;
  }
};

const freshPlanAuthoritySchema = Schema.TaggedStruct("fresh", {
  observations: Schema.Array(artifactObservationSchema),
}).annotations({
  parseOptions: strictParseOptions,
});

const receiptPlanAuthoritySchema = Schema.TaggedStruct("receipt", {
  receiptPath: scopeRelativePathSchema,
  receiptSha256: sha256Schema,
  receipt: artifactReceiptSchema,
  observations: Schema.Array(artifactObservationSchema),
}).annotations({
  parseOptions: strictParseOptions,
});

const legacyPlanAuthoritySchema = Schema.TaggedStruct("legacyManifest", {
  manifestPath: scopeRelativePathSchema,
  manifestBytes: persistedBytesSchema,
  manifestSha256: sha256Schema,
  manifest: legacyManifestSchema,
  observations: Schema.Array(artifactObservationSchema),
}).annotations({
  parseOptions: strictParseOptions,
});

const planAuthoritySchema = Schema.Union(freshPlanAuthoritySchema, receiptPlanAuthoritySchema, legacyPlanAuthoritySchema);

const desiredArtifactSourceSchema = Schema.TaggedStruct("desiredArtifact", {}).annotations({
  parseOptions: strictParseOptions,
});

const receiptRestorationSourceSchema = Schema.TaggedStruct("receiptRestoration", {}).annotations({
  parseOptions: strictParseOptions,
});

const writeOperationSchema = Schema.TaggedStruct("write", {
  path: scopeRelativePathSchema,
  bytes: persistedBytesSchema,
  source: Schema.Union(desiredArtifactSourceSchema, receiptRestorationSourceSchema),
}).annotations({
  parseOptions: strictParseOptions,
});

const receiptOwnedAuthoritySchema = Schema.TaggedStruct("receiptOwned", {}).annotations({
  parseOptions: strictParseOptions,
});

const legacyManifestAuthoritySchema = Schema.TaggedStruct("legacyManifest", {}).annotations({
  parseOptions: strictParseOptions,
});

const removeOperationSchema = Schema.TaggedStruct("remove", {
  path: scopeRelativePathSchema,
  authority: Schema.Union(receiptOwnedAuthoritySchema, legacyManifestAuthoritySchema),
}).annotations({
  parseOptions: strictParseOptions,
});

export const artifactOperationSchema = Schema.Union(writeOperationSchema, removeOperationSchema);

export type ArtifactOperation = Schema.Schema.Type<typeof artifactOperationSchema>;

const publishReceiptSchema = Schema.TaggedStruct("publishReceipt", {
  path: scopeRelativePathSchema,
  value: artifactReceiptSchema,
}).annotations({
  parseOptions: strictParseOptions,
});

const removeReceiptSchema = Schema.TaggedStruct("removeReceipt", {
  path: scopeRelativePathSchema,
  expectedSha256: sha256Schema,
}).annotations({
  parseOptions: strictParseOptions,
});

export const receiptDispositionSchema = Schema.Union(publishReceiptSchema, removeReceiptSchema);

export type ReceiptDisposition = Schema.Schema.Type<typeof receiptDispositionSchema>;

const artifactPlanFieldsSchema = Schema.Struct({
  scope: Schema.Literal("global", "project"),
  root: Schema.String.pipe(
    Schema.filter(isNormalizedAbsoluteRoot, {
      message: () => "Artifact plan roots must be absolute and byte-equal to native normalization.",
    }),
  ),
  authority: planAuthoritySchema,
  artifacts: Schema.Array(ownedArtifactSchema),
  operations: Schema.Array(artifactOperationSchema),
  receipt: receiptDispositionSchema,
});

type ArtifactPlanFields = Schema.Schema.Type<typeof artifactPlanFieldsSchema>;

const planValidationIssueSchema = Schema.Struct({
  path: Schema.Array(Schema.String),
  message: Schema.String,
});

type PlanValidationIssue = Schema.Schema.Type<typeof planValidationIssueSchema>;

const issue = (targetPath: ReadonlyArray<string>, message: string): ReadonlyArray<PlanValidationIssue> => {
  return [{ path: targetPath, message }];
};

const findArtifact = (artifacts: ReadonlyArray<OwnedArtifact>, targetPath: string): Option.Option<OwnedArtifact> => {
  const artifact = artifacts.find((candidate) => candidate.path === targetPath);

  return artifact === undefined ? Option.none() : Option.some(artifact);
};

const findObservation = (observations: ReadonlyArray<ArtifactObservation>, targetPath: string): Option.Option<ArtifactObservation> => {
  const observation = observations.find((candidate) => candidate.path === targetPath);

  return observation === undefined ? Option.none() : Option.some(observation);
};

const observationsCover = (observations: ReadonlyArray<ArtifactObservation>, expectedPaths: ReadonlyArray<string>): boolean => {
  const observedPaths = observations.map((observation) => observation.path).sort(compareStrings);
  const sortedExpected = [...expectedPaths].sort(compareStrings);

  return (
    uniqueValues(observedPaths) &&
    sortedUniqueValues(sortedExpected) &&
    observedPaths.length === sortedExpected.length &&
    observedPaths.every((observedPath, index) => observedPath === sortedExpected.at(index))
  );
};

const restorationStateCarriedForward = (previous: OwnedArtifact, desired: OwnedArtifact): boolean => {
  if (previous.kind !== desired.kind || previous.ownership._tag !== desired.ownership._tag) {
    return false;
  }

  switch (previous.ownership._tag) {
    case "wholeFile": {
      if (desired.ownership._tag !== "wholeFile" || previous.ownership.prior._tag !== desired.ownership.prior._tag) {
        return false;
      }

      if (previous.ownership.prior._tag === "missing" || desired.ownership.prior._tag === "missing") {
        return true;
      }

      return (
        previous.ownership.prior.sha256 === desired.ownership.prior.sha256 &&
        bytesEqual(previous.ownership.prior.bytes, desired.ownership.prior.bytes)
      );
    }
    case "managedBlock":
      return (
        desired.ownership._tag === "managedBlock" &&
        previous.ownership.priorDocument._tag === desired.ownership.priorDocument._tag &&
        bytesEqual(previous.ownership.leadingDelimiter, desired.ownership.leadingDelimiter) &&
        bytesEqual(previous.ownership.trailingDelimiter, desired.ownership.trailingDelimiter)
      );
    case "jsonValues": {
      if (desired.ownership._tag !== "jsonValues" || previous.ownership.priorDocument._tag !== desired.ownership.priorDocument._tag) {
        return false;
      }

      const previousEntries = previous.ownership.entries;

      return desired.ownership.entries.every((desiredEntry) => {
        const previousEntry = previousEntries.find((entry) => entry.pointer === desiredEntry.pointer);
        if (previousEntry === undefined) {
          return true;
        }

        if (previousEntry.prior._tag !== desiredEntry.prior._tag) {
          return false;
        }

        if (previousEntry.prior._tag === "missing" || desiredEntry.prior._tag === "missing") {
          return true;
        }

        return sha256JsonValue(previousEntry.prior.value) === sha256JsonValue(desiredEntry.prior.value);
      });
    }
    case "yamlSequenceValue":
      return (
        desired.ownership._tag === "yamlSequenceValue" &&
        previous.ownership.priorPresence._tag === desired.ownership.priorPresence._tag &&
        previous.ownership.priorKeyPresence._tag === desired.ownership.priorKeyPresence._tag &&
        previous.ownership.priorDocument._tag === desired.ownership.priorDocument._tag
      );
  }
};

const validateAuthority = (plan: ArtifactPlanFields): ReadonlyArray<PlanValidationIssue> | undefined => {
  const authority = plan.authority;
  const desiredPaths = plan.artifacts.map((artifact) => artifact.path);
  const receiptPaths = authority._tag === "receipt" ? authority.receipt.artifacts.map((artifact) => artifact.path) : [];
  const expectedObservationPaths = [...new Set([...desiredPaths, ...receiptPaths])].sort(compareStrings);

  if (!observationsCover(authority.observations, expectedObservationPaths)) {
    return issue(["authority", "observations"], "Raw snapshots must cover every and only authority-bound artifact target.");
  }

  if (authority._tag === "fresh" && plan.receipt._tag !== "publishReceipt") {
    return issue(["authority"], "Fresh authority can only publish a receipt.");
  }

  if (authority._tag === "legacyManifest") {
    if (
      authority.manifestPath !== ".claude/dufflebag/manifest.json" ||
      authority.manifestSha256 !== sha256Bytes(authority.manifestBytes) ||
      !legacyManifestBytesMatch(authority.manifestBytes, authority.manifest) ||
      authority.manifest.scope !== plan.scope ||
      plan.receipt._tag !== "publishReceipt"
    ) {
      return issue(["authority"], "Legacy authority must bind the fixed manifest path, scope, and a published receipt.");
    }
  }

  if (authority._tag !== "receipt") {
    return undefined;
  }

  if (authority.receiptSha256 !== canonicalReceiptSha256(authority.receipt)) {
    return issue(["authority", "receiptSha256"], "Receipt authority hash must bind its exact canonical decoded receipt.");
  }

  if (authority.receipt.scope !== plan.scope || authority.receiptPath !== plan.receipt.path) {
    return issue(["authority"], "Receipt authority scope and path must match the plan disposition.");
  }

  if (plan.receipt._tag === "removeReceipt" && plan.receipt.expectedSha256 !== authority.receiptSha256) {
    return issue(["receipt"], "Receipt removal must use the exact authority-bound receipt hash.");
  }

  // Verify every receipt member against its same-path raw snapshot before authorizing mutations.
  for (const artifact of authority.receipt.artifacts) {
    const observation = findObservation(authority.observations, artifact.path);
    if (Option.isNone(observation) || !currentSnapshotMatches({ artifact, observation: observation.value, target: "installed" })) {
      return issue(["authority", "observations", artifact.path], `Owned artifact changed: ${artifact.path}`);
    }
  }

  // Preserve the receipt-authorized restoration state across every same-path update.
  for (const artifact of plan.artifacts) {
    const previous = findArtifact(authority.receipt.artifacts, artifact.path);
    if (Option.isSome(previous) && !restorationStateCarriedForward(previous.value, artifact)) {
      return issue(
        ["artifacts", artifact.path, "ownership"],
        "Same-path updates must carry the exact receipt-authorized restoration state forward.",
      );
    }
  }

  return undefined;
};

const validateOperation = (plan: ArtifactPlanFields, operation: ArtifactOperation): ReadonlyArray<PlanValidationIssue> | undefined => {
  if (operation._tag === "write" && operation.source._tag === "desiredArtifact") {
    const artifact = findArtifact(plan.artifacts, operation.path);
    const observation = findObservation(plan.authority.observations, operation.path);
    const previous =
      plan.authority._tag === "receipt" ? findArtifact(plan.authority.receipt.artifacts, operation.path) : Option.none<OwnedArtifact>();

    return Option.isSome(artifact) &&
      Option.isSome(observation) &&
      desiredBytesMatch({
        artifact: artifact.value,
        candidateBytes: operation.bytes,
        observation: observation.value,
        previous,
      })
      ? undefined
      : issue(["operations", operation.path], "Desired write bytes must be an exact authority-bound owned transform.");
  }
  if (plan.authority._tag !== "receipt") {
    return issue(["operations", operation.path], "Only decoded receipt authority can restore or remove an owned artifact.");
  }

  const artifact = findArtifact(plan.authority.receipt.artifacts, operation.path);
  const observation = findObservation(plan.authority.observations, operation.path);
  if (Option.isNone(artifact) || Option.isNone(observation) || plan.artifacts.some((item) => item.path === operation.path)) {
    return issue(["operations", operation.path], "Receipt restoration must name a stale receipt-owned artifact.");
  }

  if (operation._tag === "write" && operation.source._tag === "receiptRestoration") {
    return restorationBytesMatch({ artifact: artifact.value, observation: observation.value, candidateBytes: operation.bytes })
      ? undefined
      : issue(["operations", operation.path], "Restoration bytes must equal the exact current-minus-owned transform.");
  }

  if (operation._tag === "remove" && operation.authority._tag === "receiptOwned") {
    return restorationCanRemove(artifact.value, observation.value)
      ? undefined
      : issue(["operations", operation.path], "Removal is allowed only when exact restoration yields the original missing target.");
  }

  return issue(["operations", operation.path], "Operation authority does not match its plan authority.");
};

const validateLegacyRemoval = (plan: ArtifactPlanFields, operation: ArtifactOperation): ReadonlyArray<PlanValidationIssue> | undefined => {
  if (operation._tag !== "remove" || operation.authority._tag !== "legacyManifest") {
    return undefined;
  }

  return plan.authority._tag === "legacyManifest" && operation.path === plan.authority.manifestPath
    ? undefined
    : issue(["operations", operation.path], "Legacy removal must match the decoded fixed-manifest authority.");
};

const validateArtifactWrites = (plan: ArtifactPlanFields): ReadonlyArray<PlanValidationIssue> | undefined => {
  // Require one desired write unless receipt authority proves the artifact is carried byte-for-byte unchanged.
  for (const artifact of plan.artifacts) {
    const desiredWrite = plan.operations.find((operation) => {
      return operation.path === artifact.path && operation._tag === "write" && operation.source._tag === "desiredArtifact";
    });

    if (desiredWrite !== undefined) {
      continue;
    }

    const priorArtifact =
      plan.authority._tag === "receipt" ? Option.getOrUndefined(findArtifact(plan.authority.receipt.artifacts, artifact.path)) : undefined;
    if (priorArtifact === undefined || !artifactEquivalent(priorArtifact, artifact)) {
      return issue(["artifacts", artifact.path], "Every fresh or changed artifact requires a matching desired write.");
    }
  }

  return undefined;
};

const validateAuthorityOperationSet = (plan: ArtifactPlanFields): ReadonlyArray<PlanValidationIssue> | undefined => {
  if (plan.authority._tag === "legacyManifest") {
    const manifestRemovals = plan.operations.filter((operation) => {
      return operation._tag === "remove" && operation.authority._tag === "legacyManifest";
    });

    return manifestRemovals.length === 1
      ? undefined
      : issue(["operations"], "Legacy plans require exactly one authority-bound fixed-manifest removal.");
  }

  if (plan.authority._tag !== "receipt") {
    return undefined;
  }

  const desiredPaths = new Set(plan.artifacts.map((artifact) => artifact.path));
  const stalePaths = plan.authority.receipt.artifacts
    .filter((artifact) => !desiredPaths.has(artifact.path))
    .map((artifact) => artifact.path)
    .sort(compareStrings);
  const restorationPaths = plan.operations
    .filter((operation) => {
      return (
        (operation._tag === "write" && operation.source._tag === "receiptRestoration") ||
        (operation._tag === "remove" && operation.authority._tag === "receiptOwned")
      );
    })
    .map((operation) => operation.path)
    .sort(compareStrings);

  return stalePaths.length === restorationPaths.length && stalePaths.every((stalePath, index) => stalePath === restorationPaths.at(index))
    ? undefined
    : issue(["operations"], "Every and only stale receipt-owned artifact requires one exact restoration operation.");
};

const validatePlanStructure = (plan: ArtifactPlanFields): boolean | ReadonlyArray<PlanValidationIssue> => {
  if (plan.receipt._tag === "publishReceipt" && plan.scope !== plan.receipt.value.scope) {
    return issue(["scope"], "Plan and receipt scopes must match.");
  }

  if (plan.receipt._tag === "publishReceipt" && !artifactsEquivalent(plan.artifacts, plan.receipt.value.artifacts)) {
    return issue(["artifacts"], "Receipt artifacts must exactly match desired artifacts.");
  }

  if (plan.receipt._tag === "removeReceipt" && plan.artifacts.length > 0) {
    return issue(["artifacts"], "Uninstall plans cannot publish desired artifacts.");
  }

  const operationPaths = plan.operations.map((operation) => operation.path);
  if (!uniqueValues(operationPaths)) {
    return issue(["operations"], "Physical operation targets must be unique.");
  }

  const artifactPaths = plan.artifacts.map((artifact) => artifact.path);
  const allLogicalPaths = [...new Set([...operationPaths, ...artifactPaths, plan.receipt.path])];
  if (operationPaths.includes(plan.receipt.path) || artifactPaths.includes(plan.receipt.path) || hasParentChildConflict(allLogicalPaths)) {
    return issue(["receipt", "path"], "The receipt path is reserved and targets cannot overlap by ancestry.");
  }

  const authorityIssue = validateAuthority(plan);
  if (authorityIssue !== undefined) {
    return authorityIssue;
  }

  const writeIssue = validateArtifactWrites(plan);
  if (writeIssue !== undefined) {
    return writeIssue;
  }

  const authorityOperationIssue = validateAuthorityOperationSet(plan);
  if (authorityOperationIssue !== undefined) {
    return authorityOperationIssue;
  }

  // Preserve semantic operation order while independently proving each mutation.
  for (const operation of plan.operations) {
    const legacyIssue = validateLegacyRemoval(plan, operation);
    if (legacyIssue !== undefined) {
      return legacyIssue;
    }

    if (operation._tag === "remove" && operation.authority._tag === "legacyManifest") {
      continue;
    }

    const operationIssue = validateOperation(plan, operation);
    if (operationIssue !== undefined) {
      return operationIssue;
    }
  }

  return true;
};

export const artifactPlanSchema = artifactPlanFieldsSchema.pipe(Schema.filter(validatePlanStructure)).annotations({
  parseOptions: strictParseOptions,
});

export type ArtifactPlan = Schema.Schema.Type<typeof artifactPlanSchema>;

export class ArtifactPlanError extends Schema.TaggedError<ArtifactPlanError>()("ArtifactPlanError", {
  code: Schema.String,
  message: Schema.String,
}) {}

const restorationWriteSchema = Schema.TaggedStruct("write", {
  path: scopeRelativePathSchema,
  bytes: persistedBytesSchema,
});

const restorationRemoveSchema = Schema.TaggedStruct("remove", {
  path: scopeRelativePathSchema,
});

const restorationSchema = Schema.Union(restorationWriteSchema, restorationRemoveSchema);

type Restoration = Schema.Schema.Type<typeof restorationSchema>;

const patchUpdateModeSchema = Schema.TaggedStruct("patch", {}).annotations({
  parseOptions: strictParseOptions,
});

const replaceUpdateModeSchema = Schema.TaggedStruct("replace", {
  staleRestorations: Schema.Array(restorationSchema).pipe(
    Schema.filter((restorations) => uniqueValues(restorations.map((restoration) => restoration.path)), {
      message: () => "Stale restorations must target unique paths while preserving declared semantic order.",
    }),
  ),
}).annotations({
  parseOptions: strictParseOptions,
});

const updateRequestSchema = Schema.Struct({
  previousReceiptPath: scopeRelativePathSchema,
  previousReceiptSha256: sha256Schema,
  previousReceipt: artifactReceiptSchema,
  desiredPlan: artifactPlanFieldsSchema,
  observations: Schema.Array(artifactObservationSchema),
  mode: Schema.Union(patchUpdateModeSchema, replaceUpdateModeSchema),
}).annotations({
  parseOptions: strictParseOptions,
});

const uninstallRequestSchema = Schema.Struct({
  scope: Schema.Literal("global", "project"),
  root: artifactPlanFieldsSchema.fields.root,
  receiptPath: scopeRelativePathSchema,
  receiptSha256: sha256Schema,
  receipt: artifactReceiptSchema,
  observations: Schema.Array(artifactObservationSchema),
  restorations: Schema.Array(restorationSchema),
}).annotations({
  parseOptions: strictParseOptions,
});

const legacyMigrationRequestSchema = Schema.Struct({
  legacyManifest: legacyManifestSchema,
  legacyManifestBytes: persistedBytesSchema,
  legacyManifestSha256: sha256Schema,
  desiredPlan: artifactPlanSchema,
}).annotations({
  parseOptions: strictParseOptions,
});

const decodeOwnedArtifact = Schema.validateSync(ownedArtifactSchema, strictParseOptions);

type ReconciledArtifactRequest = {
  readonly previous: OwnedArtifact;
  readonly desired: OwnedArtifact;
  readonly mode: "patch" | "replace";
};

const carryRestorationState = ({ previous, desired, mode }: ReconciledArtifactRequest): OwnedArtifact => {
  if (previous.kind !== desired.kind || previous.ownership._tag !== desired.ownership._tag) {
    throw new ArtifactPlanError({
      code: "ownership-kind-change",
      message: `Owned artifact kind cannot change in place: ${desired.path}`,
    });
  }

  switch (desired.ownership._tag) {
    case "wholeFile": {
      if (previous.ownership._tag !== "wholeFile") {
        throw new ArtifactPlanError({ code: "ownership-kind-change", message: `Ownership changed for ${desired.path}.` });
      }

      return decodeOwnedArtifact({ ...desired, ownership: { ...desired.ownership, prior: previous.ownership.prior } });
    }
    case "managedBlock": {
      if (previous.ownership._tag !== "managedBlock") {
        throw new ArtifactPlanError({ code: "ownership-kind-change", message: `Ownership changed for ${desired.path}.` });
      }

      return decodeOwnedArtifact({
        ...desired,
        ownership: {
          ...desired.ownership,
          leadingDelimiter: previous.ownership.leadingDelimiter,
          trailingDelimiter: previous.ownership.trailingDelimiter,
          priorDocument: previous.ownership.priorDocument,
        },
      });
    }
    case "jsonValues": {
      if (previous.ownership._tag !== "jsonValues") {
        throw new ArtifactPlanError({ code: "ownership-kind-change", message: `Ownership changed for ${desired.path}.` });
      }

      const previousOwnership = previous.ownership;
      const desiredPointers = new Set(desired.ownership.entries.map((entry) => entry.pointer));
      const selected =
        mode === "patch"
          ? [...previousOwnership.entries.filter((entry) => !desiredPointers.has(entry.pointer)), ...desired.ownership.entries]
          : [...desired.ownership.entries];
      const entries = selected
        .map((entry) => {
          const priorEntry = previousOwnership.entries.find((candidate) => candidate.pointer === entry.pointer);

          return priorEntry === undefined ? entry : { ...entry, prior: priorEntry.prior };
        })
        .sort((left, right) => compareStrings(left.pointer, right.pointer));

      return decodeOwnedArtifact({
        ...desired,
        ownership: {
          ...desired.ownership,
          entries,
          priorDocument: previousOwnership.priorDocument,
        },
      });
    }
    case "yamlSequenceValue": {
      if (previous.ownership._tag !== "yamlSequenceValue") {
        throw new ArtifactPlanError({ code: "ownership-kind-change", message: `Ownership changed for ${desired.path}.` });
      }

      if (previous.ownership.key !== desired.ownership.key || previous.ownership.reference !== desired.ownership.reference) {
        throw new ArtifactPlanError({
          code: "yaml-reference-change",
          message: `YAML ownership cannot change key or reference in place: ${desired.path}`,
        });
      }

      return decodeOwnedArtifact({
        ...desired,
        ownership: {
          ...desired.ownership,
          priorPresence: previous.ownership.priorPresence,
          priorKeyPresence: previous.ownership.priorKeyPresence,
          priorDocument: previous.ownership.priorDocument,
        },
      });
    }
  }
};

type MergeArtifactsRequest = {
  readonly previousArtifacts: ReadonlyArray<OwnedArtifact>;
  readonly desiredArtifacts: ReadonlyArray<OwnedArtifact>;
  readonly mode: "patch" | "replace";
};

const mergeUpdateArtifacts = ({ previousArtifacts, desiredArtifacts, mode }: MergeArtifactsRequest): ReadonlyArray<OwnedArtifact> => {
  const desiredPaths = new Set(desiredArtifacts.map((artifact) => artifact.path));
  const carried = mode === "patch" ? previousArtifacts.filter((artifact) => !desiredPaths.has(artifact.path)) : [];
  const updated = desiredArtifacts.map((desired) => {
    const previous = previousArtifacts.find((artifact) => artifact.path === desired.path);

    return previous === undefined ? desired : carryRestorationState({ previous, desired, mode });
  });

  return [...carried, ...updated].sort((left, right) => compareStrings(left.path, right.path));
};

const unionStable = (first: ReadonlyArray<string>, second: ReadonlyArray<string>): ReadonlyArray<string> => {
  return [...first, ...second.filter((value) => !first.includes(value))];
};

const requireCurrentOwnedState = (receipt: ArtifactReceipt, observations: ReadonlyArray<ArtifactObservation>): void => {
  const paths = receipt.artifacts.map((artifact) => artifact.path);
  if (!observationsCover(observations, paths)) {
    throw new ArtifactPlanError({
      code: "observation-set-mismatch",
      message: "Observations must cover exactly the receipt-owned artifact paths.",
    });
  }

  receipt.artifacts.forEach((artifact) => {
    const observation = findObservation(observations, artifact.path);
    if (Option.isNone(observation) || !currentSnapshotMatches({ artifact, observation: observation.value, target: "installed" })) {
      throw new ArtifactPlanError({
        code: "owned-state-conflict",
        message: `Owned artifact changed: ${artifact.path}`,
      });
    }
  });
};

const createRestorationOperation = (restoration: Restoration): ArtifactOperation => {
  if (restoration._tag === "write") {
    return Schema.validateSync(
      artifactOperationSchema,
      strictParseOptions,
    )({
      ...restoration,
      source: { _tag: "receiptRestoration" },
    });
  }

  return Schema.validateSync(
    artifactOperationSchema,
    strictParseOptions,
  )({
    ...restoration,
    authority: { _tag: "receiptOwned" },
  });
};

const mergeAuthorityObservations = (
  previous: ReadonlyArray<ArtifactObservation>,
  desired: ReadonlyArray<ArtifactObservation>,
): ReadonlyArray<ArtifactObservation> => {
  const previousPaths = new Set(previous.map((observation) => observation.path));

  return [...previous, ...desired.filter((observation) => !previousPaths.has(observation.path))].sort((left, right) => {
    return compareStrings(left.path, right.path);
  });
};

export const validateArtifactPlan = (input: unknown): ArtifactPlan => {
  return Schema.validateSync(artifactPlanSchema, strictParseOptions)(input);
};

export const createUpdatePlan = (input: unknown): ArtifactPlan => {
  const request = Schema.validateSync(updateRequestSchema, strictParseOptions)(input);
  if (request.desiredPlan.receipt._tag !== "publishReceipt" || request.desiredPlan.authority._tag !== "receipt") {
    throw new ArtifactPlanError({
      code: "update-requires-receipt-publish",
      message: "An update requires a receipt-authorized desired plan that publishes its successor receipt.",
    });
  }

  if (request.previousReceipt.scope !== request.desiredPlan.scope) {
    throw new ArtifactPlanError({ code: "scope-mismatch", message: "Previous receipt and desired update scopes must match." });
  }

  if (
    request.desiredPlan.authority.receiptPath !== request.previousReceiptPath ||
    request.desiredPlan.authority.receiptSha256 !== request.previousReceiptSha256 ||
    !receiptsEquivalent(request.desiredPlan.authority.receipt, request.previousReceipt)
  ) {
    throw new ArtifactPlanError({
      code: "receipt-authority-mismatch",
      message: "Desired update authority must bind the exact previous receipt path, hash, and artifacts.",
    });
  }

  if (request.desiredPlan.operations.some((operation) => operation._tag !== "write" || operation.source._tag !== "desiredArtifact")) {
    throw new ArtifactPlanError({
      code: "invalid-update-operation",
      message: "Desired update plans may contain only desired writes.",
    });
  }

  requireCurrentOwnedState(request.previousReceipt, request.observations);

  const overlapMismatch = request.desiredPlan.authority.observations.some((desiredObservation) => {
    const previousObservation = findObservation(request.observations, desiredObservation.path);

    return Option.isSome(previousObservation) && !artifactObservationsEqual(previousObservation.value, desiredObservation);
  });
  if (overlapMismatch) {
    throw new ArtifactPlanError({
      code: "snapshot-mismatch",
      message: "Desired and receipt observations must bind the same current bytes for overlapping targets.",
    });
  }

  const previousPaths = request.previousReceipt.artifacts.map((artifact) => artifact.path);
  const desiredPaths = request.desiredPlan.artifacts.map((artifact) => artifact.path);
  const expectedStalePaths = previousPaths.filter((previousPath) => !desiredPaths.includes(previousPath));
  if (
    request.mode._tag === "replace" &&
    (request.mode.staleRestorations.length !== expectedStalePaths.length ||
      request.mode.staleRestorations.some((restoration) => !expectedStalePaths.includes(restoration.path)))
  ) {
    throw new ArtifactPlanError({
      code: "stale-set-mismatch",
      message: "Replace updates must declare the exact previous-minus-desired stale set in semantic order.",
    });
  }

  const mode = request.mode._tag;
  const artifacts = mergeUpdateArtifacts({
    previousArtifacts: request.previousReceipt.artifacts,
    desiredArtifacts: request.desiredPlan.artifacts,
    mode,
  });
  const features =
    mode === "patch"
      ? unionStable(request.previousReceipt.features, request.desiredPlan.receipt.value.features)
      : request.desiredPlan.receipt.value.features;
  const staleOperations = request.mode._tag === "replace" ? request.mode.staleRestorations.map(createRestorationOperation) : [];
  const receipt = Schema.validateSync(
    artifactReceiptSchema,
    strictParseOptions,
  )({
    ...request.desiredPlan.receipt.value,
    features,
    artifacts,
  });
  const authority = Schema.validateSync(
    planAuthoritySchema,
    strictParseOptions,
  )({
    _tag: "receipt",
    receiptPath: request.previousReceiptPath,
    receiptSha256: request.previousReceiptSha256,
    receipt: request.previousReceipt,
    observations: mergeAuthorityObservations(request.observations, request.desiredPlan.authority.observations),
  });

  return validateArtifactPlan({
    ...request.desiredPlan,
    authority,
    artifacts,
    operations: [...request.desiredPlan.operations, ...staleOperations],
    receipt: { ...request.desiredPlan.receipt, value: receipt },
  });
};

export const createUninstallPlan = (input: unknown): ArtifactPlan => {
  const request = Schema.validateSync(uninstallRequestSchema, strictParseOptions)(input);
  if (request.scope !== request.receipt.scope) {
    throw new ArtifactPlanError({ code: "scope-mismatch", message: "Uninstall scope must match the receipt scope." });
  }

  requireCurrentOwnedState(request.receipt, request.observations);

  const receiptPaths = request.receipt.artifacts.map((artifact) => artifact.path).sort(compareStrings);
  const restorationPaths = request.restorations.map((restoration) => restoration.path).sort(compareStrings);
  if (
    !uniqueValues(restorationPaths) ||
    receiptPaths.length !== restorationPaths.length ||
    receiptPaths.some((receiptPath, index) => receiptPath !== restorationPaths.at(index))
  ) {
    throw new ArtifactPlanError({
      code: "restoration-set-mismatch",
      message: "Uninstall restorations must target every and only receipt-owned artifact once.",
    });
  }

  return validateArtifactPlan({
    scope: request.scope,
    root: request.root,
    authority: {
      _tag: "receipt",
      receiptPath: request.receiptPath,
      receiptSha256: request.receiptSha256,
      receipt: request.receipt,
      observations: request.observations,
    },
    artifacts: [],
    operations: request.restorations.map(createRestorationOperation),
    receipt: {
      _tag: "removeReceipt",
      path: request.receiptPath,
      expectedSha256: request.receiptSha256,
    },
  });
};

export const migrateLegacyManifest = (input: unknown): ArtifactPlan => {
  const request = Schema.validateSync(legacyMigrationRequestSchema, strictParseOptions)(input);
  if (request.desiredPlan.receipt._tag !== "publishReceipt" || request.desiredPlan.authority._tag !== "fresh") {
    throw new ArtifactPlanError({
      code: "migration-requires-fresh-publish",
      message: "Legacy migration starts from a fresh desired plan that publishes a receipt.",
    });
  }

  const desiredFeatures = request.desiredPlan.receipt.value.features;
  if (
    request.legacyManifest.scope !== request.desiredPlan.scope ||
    request.legacyManifest.features.some((feature) => !desiredFeatures.includes(feature))
  ) {
    throw new ArtifactPlanError({
      code: "legacy-selection-mismatch",
      message: "Resolved desired features must include every validated legacy-selected feature.",
    });
  }

  const authority = Schema.validateSync(
    planAuthoritySchema,
    strictParseOptions,
  )({
    _tag: "legacyManifest",
    manifestPath: ".claude/dufflebag/manifest.json",
    manifestBytes: request.legacyManifestBytes,
    manifestSha256: request.legacyManifestSha256,
    manifest: request.legacyManifest,
    observations: request.desiredPlan.authority.observations,
  });

  return validateArtifactPlan({
    ...request.desiredPlan,
    authority,
    operations: [
      ...request.desiredPlan.operations,
      {
        _tag: "remove",
        path: ".claude/dufflebag/manifest.json",
        authority: { _tag: "legacyManifest" },
      },
    ],
  });
};
