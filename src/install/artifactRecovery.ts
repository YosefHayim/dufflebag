import { Schema } from "effect";

const portablePath = (filePath: string): string => filePath.replaceAll("\\", "/");

const normalizedRecoveryPath = (filePath: string): string => {
  const normalized = portablePath(filePath);

  return normalized.endsWith("/") && normalized !== "/" && !/^[A-Za-z]:\/$/.test(normalized) ? normalized.slice(0, -1) : normalized;
};

const childPathPrefix = (root: string): string => (root.endsWith("/") ? root : `${root}/`);

const transactionDirectoryNamePattern = /^\.dufflebag-transaction-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isCanonicalAbsolutePath = (filePath: string): boolean => {
  if (filePath.includes("\0")) {
    return false;
  }

  const driveQualified = /^[A-Za-z]:[\\/]/.test(filePath);
  const normalized = driveQualified ? portablePath(filePath) : filePath;
  if (filePath.startsWith("/") && !filePath.includes("\\")) {
    const remainder = filePath.slice(1);

    return remainder === "" || remainder.split("/").every((part) => part !== "" && part !== "." && part !== "..");
  }
  if (!driveQualified) {
    return false;
  }

  const remainder = normalized.slice(3);
  return remainder === "" || remainder.split("/").every((part) => part !== "" && part !== "." && part !== "..");
};

export const isPathWithin = (root: string, candidate: string): boolean => {
  const normalizedRoot = normalizedRecoveryPath(root);
  const normalizedCandidate = normalizedRecoveryPath(candidate);

  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(childPathPrefix(normalizedRoot));
};

const recoveryPathKey = (filePath: string): string => normalizedRecoveryPath(filePath).toLowerCase();

const recoveryPathsConflict = (left: string, right: string): boolean => {
  const leftKey = recoveryPathKey(left);
  const rightKey = recoveryPathKey(right);

  return leftKey === rightKey || leftKey.startsWith(childPathPrefix(rightKey)) || rightKey.startsWith(childPathPrefix(leftKey));
};

const firstConflictingPathIndex = (paths: ReadonlyArray<string>): number =>
  paths.findIndex((candidate, index) => paths.slice(0, index).some((prior) => recoveryPathsConflict(prior, candidate)));

const recoveryMarkerPath = (receiptPath: string): string => {
  const normalizedReceiptPath = normalizedRecoveryPath(receiptPath);
  const separatorIndex = normalizedReceiptPath.lastIndexOf("/");

  return `${normalizedReceiptPath.slice(0, separatorIndex)}/recovery.json`;
};

const isDirectSnapshotPath = (transactionRoot: string, snapshotPath: string): boolean => {
  const snapshotsPrefix = `${childPathPrefix(normalizedRecoveryPath(transactionRoot))}snapshots/`;
  const normalizedSnapshotPath = normalizedRecoveryPath(snapshotPath);
  const snapshotName = normalizedSnapshotPath.startsWith(snapshotsPrefix) ? normalizedSnapshotPath.slice(snapshotsPrefix.length) : "";

  return snapshotName !== "" && !snapshotName.includes("/");
};

const absolutePathSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.filter(isCanonicalAbsolutePath, {
    message: () => "Filesystem paths must be canonical absolute POSIX or drive-qualified paths.",
  }),
);

export class ArtifactRecoveryPendingError extends Schema.TaggedError<ArtifactRecoveryPendingError>()("ArtifactRecoveryPendingError", {
  recoveryPath: absolutePathSchema.annotations({
    description: "Durable recovery record that must be resolved before another transaction starts.",
  }),
}) {
  get message(): string {
    return `Recovery is pending at ${this.recoveryPath}`;
  }
}

const capturedTargetStateSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("file", {
    snapshotPath: absolutePathSchema.annotations({
      description: "Absolute path of the durable byte-for-byte target snapshot.",
    }),
  }),
);

const targetSnapshotSchema = Schema.Struct({
  targetPath: absolutePathSchema.annotations({
    description: "Absolute destination path captured before the transaction mutated it.",
  }),
  original: capturedTargetStateSchema.annotations({
    description: "Whether the destination was absent or captured as a durable file snapshot.",
  }),
});

export type TargetSnapshot = Schema.Schema.Type<typeof targetSnapshotSchema>;

const artifactRecoveryRecordFieldsSchema = Schema.TaggedStruct("pending", {
  version: Schema.Literal(1).annotations({
    description: "Recovery record format version.",
  }),
  root: absolutePathSchema.annotations({
    description: "Absolute installation root of the failed transaction.",
  }),
  receiptPath: absolutePathSchema.annotations({
    description: "Absolute ownership receipt path protected by the pending transaction.",
  }),
  transactionRoot: absolutePathSchema.annotations({
    description: "Retained transaction directory containing the durable snapshots.",
  }),
  snapshots: Schema.Array(targetSnapshotSchema)
    .pipe(
      Schema.minItems(1, {
        message: () => "Pending recovery records require at least one captured target.",
      }),
    )
    .annotations({
      description: "Original state of every target captured before the transaction lock was published.",
    }),
});

export const artifactRecoveryRecordSchema = artifactRecoveryRecordFieldsSchema.pipe(
  Schema.filter((record) => {
    if (isPathWithin(record.root, record.receiptPath) && portablePath(record.receiptPath).endsWith("/receipt.json")) {
      return true;
    }

    return {
      path: ["receiptPath"],
      message: "Recovery receipt paths must stay under the decoded root and end in receipt.json.",
    };
  }),
  Schema.filter((record) => {
    const normalizedRoot = normalizedRecoveryPath(record.root);
    const normalizedTransactionRoot = normalizedRecoveryPath(record.transactionRoot);
    const transactionName = normalizedTransactionRoot.slice(childPathPrefix(normalizedRoot).length);
    if (isPathWithin(record.root, record.transactionRoot) && transactionDirectoryNamePattern.test(transactionName)) {
      return true;
    }

    return {
      path: ["transactionRoot"],
      message: "Recovery transaction roots must be direct reserved children of the decoded root.",
    };
  }),
  Schema.filter((record) => {
    const normalizedRoot = normalizedRecoveryPath(record.root);
    const markerPath = recoveryMarkerPath(record.receiptPath);
    const invalidTargetIndex = record.snapshots.findIndex(
      (snapshot) =>
        !isPathWithin(record.root, snapshot.targetPath) ||
        normalizedRecoveryPath(snapshot.targetPath) === normalizedRoot ||
        recoveryPathsConflict(snapshot.targetPath, markerPath) ||
        recoveryPathsConflict(record.transactionRoot, snapshot.targetPath),
    );
    if (invalidTargetIndex < 0) {
      return true;
    }

    return {
      path: ["snapshots", invalidTargetIndex, "targetPath"],
      message: "Recovery targets must stay below the decoded root and outside transaction-owned paths.",
    };
  }),
  Schema.filter((record) => {
    const invalidSnapshotIndex = record.snapshots.findIndex(
      (snapshot) => snapshot.original._tag === "file" && !isDirectSnapshotPath(record.transactionRoot, snapshot.original.snapshotPath),
    );
    if (invalidSnapshotIndex < 0) {
      return true;
    }

    return {
      path: ["snapshots", invalidSnapshotIndex, "original", "snapshotPath"],
      message: "Recovery snapshots must be direct children of the transaction snapshots directory.",
    };
  }),
  Schema.filter((record) => {
    const targetPaths = record.snapshots.map((snapshot) => snapshot.targetPath);
    const conflictingTargetIndex = firstConflictingPathIndex(targetPaths);
    if (conflictingTargetIndex < 0) {
      return true;
    }

    return {
      path: ["snapshots", conflictingTargetIndex, "targetPath"],
      message: "Recovery target paths must be unique without case or ancestor conflicts.",
    };
  }),
  Schema.filter((record) => {
    const snapshotPaths = record.snapshots.flatMap((snapshot) =>
      snapshot.original._tag === "file" ? [snapshot.original.snapshotPath] : [],
    );
    const snapshotKeys = snapshotPaths.map(recoveryPathKey);
    if (new Set(snapshotKeys).size === snapshotKeys.length) {
      return true;
    }

    return {
      path: ["snapshots"],
      message: "Recovery file snapshots must use unique source paths.",
    };
  }),
  Schema.filter((record) => {
    const includesReceipt = record.snapshots.some(
      (snapshot) => normalizedRecoveryPath(snapshot.targetPath) === normalizedRecoveryPath(record.receiptPath),
    );
    if (includesReceipt) {
      return true;
    }

    return {
      path: ["snapshots"],
      message: "Recovery snapshots must include the ownership receipt target.",
    };
  }),
);

export type ArtifactRecoveryRecord = Schema.Schema.Type<typeof artifactRecoveryRecordSchema>;

export const artifactRecoveryRecordJsonSchema = Schema.parseJson(artifactRecoveryRecordSchema);

export const decodeArtifactRecoveryRecordJson = Schema.decodeUnknown(artifactRecoveryRecordJsonSchema, {
  onExcessProperty: "error",
});
