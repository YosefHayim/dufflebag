import { Either, Schema } from "effect";

import { featureIdSchema } from "../catalog/featureCatalog.js";
import {
  type ArtifactOwnership,
  type ArtifactReceipt,
  artifactOwnerSchema,
  artifactReceiptSchema,
  installedJsonValueSchema,
  type JsonValuesOwnership,
  legacyManifestSchema,
  type ReceiptEntry,
  receiptEntrySchema,
  relativeArtifactPathSchema,
  scopeSchema,
  sha256Schema,
} from "./artifactReceipt.js";

const receiptFilename = "receipt.json";
const recoveryFilename = "recovery.json";

// e.g. "/Users/me/.claude" or "C:/Users/me/.claude" — not "rel", "a/../b", or "C:\\x"
const ABSOLUTE_ROOT_PATTERN =
  /^(?:\/|[A-Za-z]:\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?:[^\\/\0]+(?:\/[^\\/\0]+)*)?$/;
// e.g. "deslop" — legacy kebab skill id in uninstall manifests
const LEGACY_SKILL_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const absoluteRootSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(ABSOLUTE_ROOT_PATTERN, {
    message: () => "Artifact plan roots must be canonical POSIX or drive-absolute forward-slash paths with no parent traversal.",
  }),
  Schema.annotations({
    description: "Absolute filesystem root used to resolve every scope-relative artifact path.",
  }),
);

const receiptPathSchema = relativeArtifactPathSchema.pipe(
  Schema.filter((path) => path === receiptFilename || path.endsWith(`/${receiptFilename}`), {
    message: () => `Ownership receipts must use the canonical ${receiptFilename} basename.`,
  }),
);

export const receiptTargetSchema = Schema.Struct({
  path: receiptPathSchema.annotations({
    description: "Scope-relative path where the ownership receipt is published or removed.",
  }),
  kind: Schema.TaggedStruct("receipt", {}).annotations({
    description: "Receipt target kind fixed independently from receipt artifact entries.",
  }),
  owner: Schema.TaggedStruct("application", {}).annotations({
    description: "Receipt targets are always application-owned.",
  }),
});

export type ReceiptTarget = Schema.Schema.Type<typeof receiptTargetSchema>;

const plannedArtifactSchema = receiptEntrySchema.pipe(
  Schema.filter((artifact) =>
    artifact.kind._tag === "receipt"
      ? {
          path: ["kind"],
          message: "Receipt artifacts belong only in the separate receipt operation.",
        }
      : undefined,
  ),
);

export const artifactExpectedCurrentSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}).annotations({
    description: "Planning observed that the artifact target did not exist.",
  }),
  Schema.TaggedStruct("file", {
    sha256: sha256Schema.annotations({
      description: "Exact SHA-256 of the artifact bytes observed during planning.",
    }),
  }),
);

export type ArtifactExpectedCurrent = Schema.Schema.Type<typeof artifactExpectedCurrentSchema>;

export const artifactPreconditionSchema = Schema.Struct({
  path: relativeArtifactPathSchema.annotations({
    description: "Owned artifact path validated even when its desired bytes are unchanged.",
  }),
  expectedCurrent: artifactExpectedCurrentSchema.annotations({
    description: "Exact target state captured while planning the unchanged artifact.",
  }),
});

export type ArtifactPrecondition = Schema.Schema.Type<typeof artifactPreconditionSchema>;

export const writeOperationSchema = Schema.TaggedStruct("write", {
  artifact: plannedArtifactSchema.annotations({
    description: "Complete next-owned artifact and its exact ownership metadata.",
  }),
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Exact desired artifact bytes staged by the transactional writer.",
  }),
});

export type WriteOperation = Schema.Schema.Type<typeof writeOperationSchema>;

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

export const restoreOperationSchema = Schema.TaggedStruct("restore", {
  artifact: plannedArtifactSchema.annotations({
    description: "Previously receipted artifact whose final unowned bytes are restored.",
  }),
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Exact final bytes materialized by the artifact format handler.",
  }),
}).pipe(
  Schema.filter((operation) => {
    if (operation.artifact.ownership._tag !== "wholeFile") {
      return undefined;
    }

    const previous = operation.artifact.ownership.previous;

    return previous._tag === "priorFile" && bytesEqual(operation.bytes, previous.bytes)
      ? undefined
      : {
          path: ["bytes"],
          message: "Whole-file restoration bytes must exactly match the recorded prior bytes.",
        };
  }),
);

export type RestoreOperation = Schema.Schema.Type<typeof restoreOperationSchema>;

const emptyBytesSchema = Schema.Uint8ArrayFromSelf.pipe(
  Schema.filter((bytes) => bytes.byteLength === 0, {
    message: () => "Artifact removal requires materialized proof that no unowned bytes remain.",
  }),
);

const ownershipAllowsRemoval = (ownership: ArtifactOwnership): boolean => {
  switch (ownership._tag) {
    case "wholeFile":
      return ownership.previous._tag === "missing";
    case "managedBlock":
      return !ownership.filePreviouslyPresent;
    case "jsonValues":
      return !ownership.filePreviouslyPresent && ownership.values.every((value) => value.previous._tag === "missing");
    case "yamlSequenceValue":
      return !ownership.filePreviouslyPresent && !ownership.previouslyPresent;
  }
};

export const artifactRemoveOperationSchema = Schema.TaggedStruct("remove", {
  artifact: plannedArtifactSchema.annotations({
    description: "Previously receipted artifact whose final action is safe host-file deletion.",
  }),
  unownedBytes: emptyBytesSchema.annotations({
    description: "Materialized final unowned bytes, which must be empty before host-file deletion.",
  }),
}).pipe(
  Schema.filter((operation) =>
    ownershipAllowsRemoval(operation.artifact.ownership)
      ? undefined
      : {
          path: ["artifact", "ownership"],
          message: "Artifact removal requires proof that the complete host file was originally absent.",
        },
  ),
);

export type ArtifactRemoveOperation = Schema.Schema.Type<typeof artifactRemoveOperationSchema>;

const expectedCurrentFieldsSchema = Schema.Struct({
  expectedCurrent: artifactExpectedCurrentSchema.annotations({
    description: "Target state that must still match before this operation may be staged or committed.",
  }),
});

const receiptRemoveOperationSchema = Schema.extend(
  Schema.TaggedStruct("remove", {
    target: receiptTargetSchema,
  }),
  expectedCurrentFieldsSchema,
);

export const removeOperationSchema = Schema.Union(artifactRemoveOperationSchema, receiptRemoveOperationSchema);

export type RemoveOperation = Schema.Schema.Type<typeof removeOperationSchema>;

export const receiptPublishOperationSchema = Schema.extend(
  Schema.TaggedStruct("receiptPublish", {
    target: receiptTargetSchema,
    receipt: artifactReceiptSchema.annotations({
      description: "Complete next ownership receipt published after every artifact operation succeeds.",
    }),
  }),
  expectedCurrentFieldsSchema,
);

export type ReceiptPublishOperation = Schema.Schema.Type<typeof receiptPublishOperationSchema>;

export const artifactRestorationOperationSchema = Schema.Union(restoreOperationSchema, artifactRemoveOperationSchema);

export type ArtifactRestorationOperation = Schema.Schema.Type<typeof artifactRestorationOperationSchema>;

const plannedWriteOperationSchema = Schema.extend(writeOperationSchema, expectedCurrentFieldsSchema);
const plannedRestoreOperationSchema = Schema.extend(restoreOperationSchema, expectedCurrentFieldsSchema);
const plannedRemoveOperationSchema = Schema.extend(artifactRemoveOperationSchema, expectedCurrentFieldsSchema);
const plannedArtifactRestorationOperationSchema = Schema.Union(plannedRestoreOperationSchema, plannedRemoveOperationSchema);

type PlannedArtifactRestorationOperation = Schema.Schema.Type<typeof plannedArtifactRestorationOperationSchema>;

export const artifactOperationSchema = Schema.Union(
  plannedWriteOperationSchema,
  plannedRestoreOperationSchema,
  plannedRemoveOperationSchema,
);

export type ArtifactOperation = Schema.Schema.Type<typeof artifactOperationSchema>;

export const receiptOperationSchema = Schema.Union(receiptPublishOperationSchema, receiptRemoveOperationSchema);

export type ReceiptOperation = Schema.Schema.Type<typeof receiptOperationSchema>;

const normalizedPath = (path: string): string => path.toLowerCase();

const pathsConflict = (left: string, right: string): boolean => {
  const normalizedLeft = normalizedPath(left);
  const normalizedRight = normalizedPath(right);

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`)
  );
};

const recoveryPathForReceipt = (receiptPath: string): string => `${receiptPath.slice(0, -receiptFilename.length)}${recoveryFilename}`;

const reservedReceiptPaths = (receiptTarget: ReceiptTarget): ReadonlyArray<string> => [
  receiptTarget.path,
  recoveryPathForReceipt(receiptTarget.path),
];

const receiptEntriesEqual = Schema.equivalence(receiptEntrySchema);

const artifactOwnersEqual = Schema.equivalence(artifactOwnerSchema);

const reverseValues = <Value>(values: ReadonlyArray<Value>): ReadonlyArray<Value> =>
  values.map((_, index) => values[values.length - index - 1]);

const restorationConsistencyIssues = (
  expectedArtifacts: ReadonlyArray<ReceiptEntry>,
  restorations: ReadonlyArray<ArtifactRestorationOperation>,
) => [
  ...expectedArtifacts.flatMap((expectedArtifact) => {
    const matchingIndexes = restorations.flatMap((restoration, index) =>
      receiptEntriesEqual(restoration.artifact, expectedArtifact) ? [index] : [],
    );

    if (matchingIndexes.length === 0) {
      return [
        {
          path: ["restorations"],
          message: `Prior receipt artifact ${expectedArtifact.path} requires one exact restoration action.`,
        },
      ];
    }

    return matchingIndexes.slice(1).map((index) => ({
      path: ["restorations", index, "artifact"],
      message: `Prior receipt artifact ${expectedArtifact.path} cannot have duplicate restoration actions.`,
    }));
  }),
  ...restorations.flatMap((restoration, index) =>
    expectedArtifacts.some((artifact) => receiptEntriesEqual(restoration.artifact, artifact))
      ? []
      : [
          {
            path: ["restorations", index, "artifact"],
            message: "Restoration actions cannot include artifacts absent from the prior receipt.",
          },
        ],
  ),
];

const orderRestorations = (
  expectedArtifacts: ReadonlyArray<ReceiptEntry>,
  restorations: ReadonlyArray<PlannedArtifactRestorationOperation>,
): ReadonlyArray<PlannedArtifactRestorationOperation> =>
  [...restorations].sort(
    (left, right) =>
      expectedArtifacts.findIndex((artifact) => receiptEntriesEqual(artifact, left.artifact)) -
      expectedArtifacts.findIndex((artifact) => receiptEntriesEqual(artifact, right.artifact)),
  );

const operationPathIssues = (operations: ReadonlyArray<ArtifactOperation>, receiptTarget: ReceiptTarget) =>
  operations.flatMap((operation, index) => {
    const reservedPath = reservedReceiptPaths(receiptTarget).find((path) => pathsConflict(operation.artifact.path, path));

    return [
      ...operations.slice(index + 1).flatMap((candidate, offset) => {
        if (!pathsConflict(operation.artifact.path, candidate.artifact.path)) {
          return [];
        }

        return [
          {
            path: ["operations", index + offset + 1, "artifact", "path"],
            message:
              normalizedPath(operation.artifact.path) === normalizedPath(candidate.artifact.path)
                ? "Artifact operation paths must be unique."
                : `Artifact operation path ${candidate.artifact.path} conflicts with ${operation.artifact.path}.`,
          },
        ];
      }),
      ...(reservedPath !== undefined
        ? [
            {
              path: ["operations", index, "artifact", "path"],
              message: `Artifact operation path ${operation.artifact.path} conflicts with reserved path ${reservedPath}.`,
            },
          ]
        : []),
    ];
  });

const publishConsistencyIssues = (operations: ReadonlyArray<ArtifactOperation>, publish: ReceiptPublishOperation) =>
  operations.flatMap((operation, index) => {
    const receiptArtifact = publish.receipt.artifacts.find((artifact) => artifact.path === operation.artifact.path);

    if (operation._tag !== "write") {
      return receiptArtifact === undefined
        ? []
        : [
            {
              path: ["operations", index, "artifact", "path"],
              message: "Restored and removed artifacts must be absent from the published receipt.",
            },
          ];
    }

    return receiptArtifact !== undefined && receiptEntriesEqual(operation.artifact, receiptArtifact)
      ? []
      : [
          {
            path: ["operations", index, "artifact"],
            message: "Written artifacts must exactly match their published receipt entries.",
          },
        ];
  });

const receiptArtifactIssues = (receipt: ArtifactReceipt, receiptTarget: ReceiptTarget) =>
  receipt.artifacts.flatMap((artifact, index) => {
    const reservedPath = reservedReceiptPaths(receiptTarget).find((path) => pathsConflict(artifact.path, path));

    return [
      ...(artifact.kind._tag === "receipt"
        ? [
            {
              path: ["receipt", "receipt", "artifacts", index, "kind"],
              message: "Published receipt artifacts cannot contain the receipt itself.",
            },
          ]
        : []),
      ...(reservedPath !== undefined
        ? [
            {
              path: ["receipt", "receipt", "artifacts", index, "path"],
              message: `Receipt artifact path ${artifact.path} conflicts with reserved path ${reservedPath}.`,
            },
          ]
        : []),
    ];
  });

const artifactPlanFieldsSchema = Schema.Struct({
  scope: scopeSchema.annotations({
    description: "Installation scope shared by the plan and published receipt.",
  }),
  root: absoluteRootSchema,
  operations: Schema.Array(artifactOperationSchema).annotations({
    description: "Ordered desired writes, host-file restorations, and host-file deletions committed before the receipt.",
  }),
  preconditions: Schema.Array(artifactPreconditionSchema).annotations({
    description: "Validation-only guards retained for desired artifacts whose bytes need no write.",
  }),
  receipt: receiptOperationSchema.annotations({
    description: "Receipt publication or removal represented separately and committed last.",
  }),
});

type ArtifactPlanFields = Schema.Schema.Type<typeof artifactPlanFieldsSchema>;

const artifactPlanIssues = (plan: ArtifactPlanFields) => {
  const issues = operationPathIssues(plan.operations, plan.receipt.target);

  const preconditionIssues = [
    ...plan.preconditions.flatMap((precondition, index) =>
      plan.preconditions.slice(0, index).some((candidate) => normalizedPath(candidate.path) === normalizedPath(precondition.path))
        ? [
            {
              path: ["preconditions", index, "path"],
              message: `Artifact precondition path ${precondition.path} must be unique.`,
            },
          ]
        : [],
    ),
    ...plan.preconditions.flatMap((precondition, index) =>
      plan.operations.some((operation) => normalizedPath(operation.artifact.path) === normalizedPath(precondition.path))
        ? [
            {
              path: ["preconditions", index, "path"],
              message: "Validation-only preconditions cannot duplicate mutation targets.",
            },
          ]
        : [],
    ),
  ];

  if (plan.receipt._tag === "receiptPublish") {
    const publish = plan.receipt;

    return [
      ...issues,
      ...preconditionIssues,
      ...(publish.receipt.scope === plan.scope
        ? []
        : [
            {
              path: ["receipt", "receipt", "scope"],
              message: "Published receipt scope must match the artifact plan scope.",
            },
          ]),
      ...receiptArtifactIssues(publish.receipt, publish.target),
      ...publishConsistencyIssues(plan.operations, publish),
      ...publish.receipt.artifacts.flatMap((artifact, index) => {
        const mutated = plan.operations.some((operation) => operation.artifact.path === artifact.path);
        const guarded = plan.preconditions.filter((precondition) => precondition.path === artifact.path).length === 1;

        return mutated || guarded
          ? []
          : [
              {
                path: ["receipt", "receipt", "artifacts", index, "path"],
                message: "Every published artifact requires a mutation or validation-only precondition.",
              },
            ];
      }),
      ...plan.preconditions.flatMap((precondition, index) =>
        publish.receipt.artifacts.some((artifact) => artifact.path === precondition.path)
          ? []
          : [
              {
                path: ["preconditions", index, "path"],
                message: "Validation-only preconditions must correspond to a published receipt artifact.",
              },
            ],
      ),
    ];
  }

  return [
    ...issues,
    ...preconditionIssues,
    ...plan.preconditions.map((_, index) => ({
      path: ["preconditions", index],
      message: "Receipt-removal plans cannot retain validation-only desired artifacts.",
    })),
    ...plan.operations.flatMap((operation, index) =>
      operation._tag !== "write"
        ? []
        : [
            {
              path: ["operations", index, "_tag"],
              message: "A receipt-removal plan can contain only artifact restorations or removals.",
            },
          ],
    ),
  ];
};

export const artifactPlanSchema = artifactPlanFieldsSchema.pipe(Schema.filter(artifactPlanIssues));

export type ArtifactPlan = Schema.Schema.Type<typeof artifactPlanSchema>;

const previousReceiptSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("receipt", {
    receipt: artifactReceiptSchema,
  }),
);

const desiredStateSchema = Schema.Struct({
  receipt: artifactReceiptSchema,
  writes: Schema.Array(plannedWriteOperationSchema),
}).pipe(
  Schema.filter((desired) => [
    ...desired.writes.flatMap((operation, index) => {
      const receiptArtifact = desired.receipt.artifacts.find((artifact) => artifact.path === operation.artifact.path);

      return receiptArtifact !== undefined && receiptEntriesEqual(operation.artifact, receiptArtifact)
        ? []
        : [
            {
              path: ["writes", index, "artifact"],
              message: "Every desired write must exactly match its desired receipt entry.",
            },
          ];
    }),
    ...desired.receipt.artifacts.flatMap((artifact, index) =>
      desired.writes.filter((operation) => operation.artifact.path === artifact.path).length === 1
        ? []
        : [
            {
              path: ["receipt", "artifacts", index, "path"],
              message: "Every desired receipt artifact must have exactly one desired write.",
            },
          ],
    ),
  ]),
);

const jsonContainerAcquisitionIssues = (previous: JsonValuesOwnership, desired: JsonValuesOwnership, artifactIndex: number) =>
  desired.createdContainers.flatMap((container, containerIndex) => {
    if (previous.createdContainers.includes(container)) {
      return [];
    }

    const ownsNewDescendant = desired.values.some(
      (value) =>
        value.pointer.startsWith(`${container}/`) && !previous.values.some((previousValue) => previousValue.pointer === value.pointer),
    );

    return ownsNewDescendant
      ? []
      : [
          {
            path: ["desired", "receipt", "artifacts", artifactIndex, "ownership", "createdContainers", containerIndex],
            message: `Created JSON container ${container} requires a newly owned descendant pointer.`,
          },
        ];
  });

export const updatePlanInputSchema = Schema.Struct({
  root: absoluteRootSchema,
  previous: previousReceiptSchema,
  restorations: Schema.Array(plannedArtifactRestorationOperationSchema).annotations({
    description: "Exact final-action set for stale prior receipt entries; the planner owns operation order.",
  }),
  desired: desiredStateSchema,
  receiptTarget: receiptTargetSchema,
  receiptExpectedCurrent: artifactExpectedCurrentSchema.annotations({
    description: "Receipt target state captured during capability inspection.",
  }),
}).pipe(
  Schema.filter((input) => {
    const previousArtifacts = input.previous._tag === "receipt" ? input.previous.receipt.artifacts : [];
    const staleArtifacts = reverseValues(
      previousArtifacts.filter(
        (previousArtifact) => !input.desired.receipt.artifacts.some((artifact) => artifact.path === previousArtifact.path),
      ),
    );

    return [
      ...(input.previous._tag === "receipt" && input.previous.receipt.scope !== input.desired.receipt.scope
        ? [
            {
              path: ["previous", "receipt", "scope"],
              message: "Previous and desired receipt scopes must match.",
            },
          ]
        : []),
      ...restorationConsistencyIssues(staleArtifacts, input.restorations),
      ...input.desired.receipt.artifacts.flatMap((artifact, index) => {
        const previousArtifact = previousArtifacts.find((candidate) => candidate.path === artifact.path);

        return previousArtifact !== undefined && previousArtifact.ownership._tag !== artifact.ownership._tag
          ? [
              {
                path: ["desired", "receipt", "artifacts", index, "ownership", "_tag"],
                message: `Cannot change ownership from ${previousArtifact.ownership._tag} to ${artifact.ownership._tag} at ${artifact.path}; remove the prior ownership first.`,
              },
            ]
          : [];
      }),
      ...input.desired.receipt.artifacts.flatMap((artifact, index) => {
        const previousArtifact = previousArtifacts.find((candidate) => candidate.path === artifact.path);
        if (previousArtifact === undefined) {
          return [];
        }

        return [
          ...(previousArtifact.kind._tag === artifact.kind._tag
            ? []
            : [
                {
                  path: ["desired", "receipt", "artifacts", index, "kind"],
                  message: `Cannot change artifact kind from ${previousArtifact.kind._tag} to ${artifact.kind._tag} at ${artifact.path}; remove the prior ownership first.`,
                },
              ]),
          ...(previousArtifact.owner._tag === artifact.owner._tag
            ? []
            : [
                {
                  path: ["desired", "receipt", "artifacts", index, "owner"],
                  message: `Cannot change artifact owner from ${previousArtifact.owner._tag} to ${artifact.owner._tag} at ${artifact.path}; remove the prior ownership first.`,
                },
              ]),
        ];
      }),
      ...input.desired.receipt.artifacts.flatMap((artifact, index) => {
        const previousArtifact = previousArtifacts.find((candidate) => candidate.path === artifact.path);

        return previousArtifact?.ownership._tag === "jsonValues" && artifact.ownership._tag === "jsonValues"
          ? jsonContainerAcquisitionIssues(previousArtifact.ownership, artifact.ownership, index)
          : [];
      }),
      ...input.desired.receipt.artifacts.flatMap((artifact, index) => {
        const reservedPath = reservedReceiptPaths(input.receiptTarget).find((path) => pathsConflict(artifact.path, path));

        return reservedPath !== undefined
          ? [
              {
                path: ["desired", "receipt", "artifacts", index, "path"],
                message: `Desired artifact path ${artifact.path} conflicts with reserved path ${reservedPath}.`,
              },
            ]
          : [];
      }),
    ];
  }),
);

export type UpdatePlanInput = Schema.Schema.Type<typeof updatePlanInputSchema>;

export const uninstallPlanInputSchema = Schema.Struct({
  root: absoluteRootSchema,
  receipt: artifactReceiptSchema,
  restorations: Schema.Array(plannedArtifactRestorationOperationSchema).annotations({
    description: "Exact final-action set for every receipt entry; the planner owns operation order.",
  }),
  receiptTarget: receiptTargetSchema,
  receiptExpectedCurrent: artifactExpectedCurrentSchema.annotations({
    description: "Receipt target state captured during capability inspection.",
  }),
}).pipe(Schema.filter((input) => restorationConsistencyIssues(reverseValues(input.receipt.artifacts), input.restorations)));

export type UninstallPlanInput = Schema.Schema.Type<typeof uninstallPlanInputSchema>;

const legacyRecordedBySchema = Schema.Union(
  Schema.TaggedStruct("feature", {
    id: featureIdSchema.annotations({
      description: "Legacy manifest feature ID that authorizes this known artifact.",
    }),
  }),
  Schema.TaggedStruct("skill", {
    id: Schema.NonEmptyTrimmedString.pipe(
      Schema.pattern(LEGACY_SKILL_ID_PATTERN, {
        message: () => "Legacy artifact skill IDs must use lowercase kebab-case.",
      }),
      Schema.annotations({
        description: "Legacy manifest skill ID that authorizes this known artifact.",
      }),
    ),
  }),
);

const knownLegacyArtifactSchema = Schema.Struct({
  recordedBy: legacyRecordedBySchema,
  write: plannedWriteOperationSchema,
});

export const legacyMigrationInputSchema = Schema.Struct({
  root: absoluteRootSchema,
  manifest: legacyManifestSchema,
  knownArtifacts: Schema.Array(knownLegacyArtifactSchema).annotations({
    description: "Explicit known artifacts filtered only by exact legacy manifest records.",
  }),
  receiptTarget: receiptTargetSchema,
  receiptExpectedCurrent: artifactExpectedCurrentSchema.annotations({
    description: "Receipt target state captured during legacy capability inspection.",
  }),
});

export type LegacyMigrationInput = Schema.Schema.Type<typeof legacyMigrationInputSchema>;

const preserveJsonRestoration = (previous: JsonValuesOwnership, desired: JsonValuesOwnership): ArtifactOwnership => ({
  ...desired,
  filePreviouslyPresent: previous.filePreviouslyPresent,
  createdContainers: [
    ...previous.createdContainers.filter((container) => desired.values.some((value) => value.pointer.startsWith(`${container}/`))),
    ...desired.createdContainers.filter((container) => !previous.createdContainers.includes(container)),
  ],
  values: desired.values.map((value) => {
    const priorValue = previous.values.find((candidate) => candidate.pointer === value.pointer);

    return priorValue === undefined ? value : { ...value, previous: priorValue.previous };
  }),
});

const installedJsonValuesEqual = Schema.equivalence(installedJsonValueSchema);

const preserveRestoration = (previous: ArtifactOwnership, desired: ArtifactOwnership): ArtifactOwnership => {
  if (previous._tag === "wholeFile" && desired._tag === "wholeFile") {
    return { ...desired, previous: previous.previous };
  }

  if (previous._tag === "jsonValues" && desired._tag === "jsonValues") {
    return preserveJsonRestoration(previous, desired);
  }

  if (previous._tag === "managedBlock" && desired._tag === "managedBlock") {
    return { ...desired, filePreviouslyPresent: previous.filePreviouslyPresent };
  }

  if (previous._tag === "yamlSequenceValue" && desired._tag === "yamlSequenceValue") {
    return previous.key === desired.key && previous.reference === desired.reference
      ? {
          ...desired,
          filePreviouslyPresent: previous.filePreviouslyPresent,
          insertedPrefix: previous.insertedPrefix,
          keyPreviouslyPresent: previous.keyPreviouslyPresent,
          previouslyPresent: previous.previouslyPresent,
        }
      : { ...desired, filePreviouslyPresent: previous.filePreviouslyPresent };
  }

  return desired;
};

const preserveArtifactRestoration = (previous: ReceiptEntry, desired: ReceiptEntry): ReceiptEntry => ({
  ...desired,
  ownership: preserveRestoration(previous.ownership, desired.ownership),
});

const installedOwnershipEqual = (left: ArtifactOwnership, right: ArtifactOwnership): boolean => {
  if (left._tag === "wholeFile" && right._tag === "wholeFile") {
    return left.installedHash === right.installedHash;
  }

  if (left._tag === "managedBlock" && right._tag === "managedBlock") {
    return (
      left.startMarker === right.startMarker && left.endMarker === right.endMarker && left.installedBodyHash === right.installedBodyHash
    );
  }

  if (left._tag === "jsonValues" && right._tag === "jsonValues") {
    return (
      left.values.length === right.values.length &&
      left.values.every((value, index) => {
        const candidate = right.values[index];

        return (
          candidate !== undefined && value.pointer === candidate.pointer && installedJsonValuesEqual(value.installed, candidate.installed)
        );
      })
    );
  }

  if (left._tag === "yamlSequenceValue" && right._tag === "yamlSequenceValue") {
    return left.key === right.key && left.reference === right.reference;
  }

  return false;
};

const installedArtifactsEqual = (left: ReceiptEntry, right: ReceiptEntry): boolean =>
  left.path === right.path &&
  left.kind._tag === right.kind._tag &&
  artifactOwnersEqual(left.owner, right.owner) &&
  installedOwnershipEqual(left.ownership, right.ownership);

const validateUpdateInput = (input: unknown) =>
  Schema.validateEither(updatePlanInputSchema, {
    onExcessProperty: "error",
  })(input);

const validateUninstallInput = (input: unknown) =>
  Schema.validateEither(uninstallPlanInputSchema, {
    onExcessProperty: "error",
  })(input);

const validateLegacyMigrationInput = (input: unknown) =>
  Schema.validateEither(legacyMigrationInputSchema, {
    onExcessProperty: "error",
  })(input);

export const validateArtifactPlan = (input: unknown) =>
  Schema.validateEither(artifactPlanSchema, {
    onExcessProperty: "error",
  })(input);

// Reconcile one validated desired state: preserve restoration history, restore stale artifacts first, and publish ownership last.
export const createUpdatePlan = (input: unknown) =>
  Either.flatMap(validateUpdateInput(input), (request) => {
    // 1. Preserve the original restoration history for every retained path.
    const previousArtifacts = request.previous._tag === "receipt" ? request.previous.receipt.artifacts : [];
    const nextArtifacts = request.desired.receipt.artifacts.map((desiredArtifact) => {
      const previousArtifact = previousArtifacts.find((artifact) => artifact.path === desiredArtifact.path);

      return previousArtifact === undefined ? desiredArtifact : preserveArtifactRestoration(previousArtifact, desiredArtifact);
    });

    // 2. Identify stale ownership in reverse prior-receipt order.
    const staleArtifacts = reverseValues(
      previousArtifacts.filter((previousArtifact) => !nextArtifacts.some((artifact) => artifact.path === previousArtifact.path)),
    );

    // 3. Order the caller's exact restoration set by that prior receipt.
    const restorations = orderRestorations(staleArtifacts, request.restorations);

    // 4. Emit only writes whose installed state changes.
    const changedWrites = request.desired.writes.flatMap((operation) =>
      nextArtifacts
        .filter((artifact) => artifact.path === operation.artifact.path)
        .flatMap((artifact) => {
          const previousArtifact = previousArtifacts.find((candidate) => candidate.path === artifact.path);

          return previousArtifact !== undefined && installedArtifactsEqual(previousArtifact, artifact) ? [] : [{ ...operation, artifact }];
        }),
    );
    const changedPaths = new Set(changedWrites.map((operation) => operation.artifact.path));
    const preconditions = request.desired.writes.flatMap((operation) =>
      changedPaths.has(operation.artifact.path) ? [] : [{ path: operation.artifact.path, expectedCurrent: operation.expectedCurrent }],
    );

    // 5. Publish the complete next receipt after every filesystem action.
    const receipt = {
      ...request.desired.receipt,
      artifacts: nextArtifacts,
    };

    return validateArtifactPlan({
      scope: receipt.scope,
      root: request.root,
      operations: [...restorations, ...changedWrites],
      preconditions,
      receipt: {
        _tag: "receiptPublish",
        target: request.receiptTarget,
        receipt,
        expectedCurrent: request.receiptExpectedCurrent,
      },
    });
  });

export const createUninstallPlan = (input: unknown) =>
  Either.flatMap(validateUninstallInput(input), (request) => {
    const restorations = orderRestorations(reverseValues(request.receipt.artifacts), request.restorations);

    return validateArtifactPlan({
      scope: request.receipt.scope,
      root: request.root,
      operations: restorations,
      preconditions: [],
      receipt: {
        _tag: "remove",
        target: request.receiptTarget,
        expectedCurrent: request.receiptExpectedCurrent,
      },
    });
  });

export const migrateLegacyManifest = (input: unknown) =>
  Either.flatMap(validateLegacyMigrationInput(input), (request) => {
    const writes = request.knownArtifacts
      .filter(({ recordedBy }) =>
        recordedBy._tag === "feature" ? request.manifest.features.includes(recordedBy.id) : request.manifest.skills.includes(recordedBy.id),
      )
      .map(({ write }) => write);

    return createUpdatePlan({
      root: request.root,
      previous: { _tag: "missing" },
      restorations: [],
      desired: {
        receipt: {
          version: request.manifest.version,
          scope: request.manifest.scope,
          features: request.manifest.features,
          artifacts: writes.map(({ artifact }) => artifact),
        },
        writes,
      },
      receiptTarget: request.receiptTarget,
      receiptExpectedCurrent: request.receiptExpectedCurrent,
    });
  });
