/** The recovery record a failed transaction leaves behind, and the path rules that keep recovery inside its root. */

import { Schema } from "effect";

const portablePath = (filePath: string): string => filePath.replaceAll("\\", "/");

const normalizedRecoveryPath = (filePath: string): string => {
  const normalized = portablePath(filePath);

  return normalized.endsWith("/") && normalized !== "/" && !/^[A-Za-z]:\/$/.test(normalized)
    ? normalized.slice(0, -1)
    : normalized;
};

const childPathPrefix = (root: string): string => (root.endsWith("/") ? root : `${root}/`);

const transactionDirectoryNamePattern =
  /^\.dufflebag-transaction-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isCanonicalAbsolutePath = (filePath: string): boolean => {
  const driveQualified = /^[A-Za-z]:[\\/]/.test(filePath);
  if (filePath.includes("\0") || (!driveQualified && (!filePath.startsWith("/") || filePath.includes("\\")))) {
    return false;
  }

  const remainder = driveQualified ? portablePath(filePath).slice(3) : filePath.slice(1);
  return remainder === "" || remainder.split("/").every((part) => part !== "" && part !== "." && part !== "..");
};

export const isInsideFolder = (root: string, candidate: string): boolean => {
  const normalizedRoot = normalizedRecoveryPath(root);
  const normalizedCandidate = normalizedRecoveryPath(candidate);

  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(childPathPrefix(normalizedRoot));
};

const recoveryPathKey = (filePath: string): string => normalizedRecoveryPath(filePath).toLowerCase();

const recoveryPathsConflict = (left: string, right: string): boolean => {
  const leftKey = recoveryPathKey(left);
  const rightKey = recoveryPathKey(right);

  return (
    leftKey === rightKey ||
    leftKey.startsWith(childPathPrefix(rightKey)) ||
    rightKey.startsWith(childPathPrefix(leftKey))
  );
};

const recoveryMarkerPath = (receiptPath: string): string => {
  const normalizedReceiptPath = normalizedRecoveryPath(receiptPath);

  return `${normalizedReceiptPath.slice(0, normalizedReceiptPath.lastIndexOf("/"))}/recovery.json`;
};

const isDirectSnapshotPath = (transactionRoot: string, snapshotPath: string): boolean => {
  const snapshotsPrefix = `${childPathPrefix(normalizedRecoveryPath(transactionRoot))}snapshots/`;
  const normalizedSnapshotPath = normalizedRecoveryPath(snapshotPath);
  const snapshotName = normalizedSnapshotPath.startsWith(snapshotsPrefix)
    ? normalizedSnapshotPath.slice(snapshotsPrefix.length)
    : "";

  return snapshotName !== "" && !snapshotName.includes("/");
};

const absolutePathSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.filter(isCanonicalAbsolutePath, {
    message: () => "Filesystem paths must be canonical absolute POSIX or drive-qualified paths.",
  }),
);

export class UnfinishedChangeError extends Schema.TaggedError<UnfinishedChangeError>()("UnfinishedChangeError", {
  recoveryPath: absolutePathSchema.annotations({
    description: "Durable recovery record that must be resolved before another transaction starts.",
  }),
}) {
  get message(): string {
    return `Recovery is pending at ${this.recoveryPath}`;
  }
}

const targetSnapshotSchema = Schema.Struct({
  targetPath: absolutePathSchema.annotations({
    description: "Absolute destination path captured before the transaction mutated it.",
  }),
  original: Schema.Union(
    Schema.TaggedStruct("missing", {}),
    Schema.TaggedStruct("file", {
      snapshotPath: absolutePathSchema.annotations({
        description: "Absolute path of the durable byte-for-byte target snapshot.",
      }),
    }),
  ).annotations({
    description: "Whether the destination was absent or captured as a durable file snapshot.",
  }),
});

export type TargetSnapshot = Schema.Schema.Type<typeof targetSnapshotSchema>;

export const recoveryRecordSchema = Schema.TaggedStruct("pending", {
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
}).pipe(
  Schema.filter((record) =>
    isInsideFolder(record.root, record.receiptPath) && portablePath(record.receiptPath).endsWith("/receipt.json")
      ? true
      : {
          path: ["receiptPath"],
          message: "Recovery receipt paths must stay under the decoded root and end in receipt.json.",
        },
  ),
  Schema.filter((record) => {
    const transactionName = normalizedRecoveryPath(record.transactionRoot).slice(
      childPathPrefix(normalizedRecoveryPath(record.root)).length,
    );

    return isInsideFolder(record.root, record.transactionRoot) && transactionDirectoryNamePattern.test(transactionName)
      ? true
      : {
          path: ["transactionRoot"],
          message: "Recovery transaction roots must be direct reserved children of the decoded root.",
        };
  }),
  Schema.filter((record) => {
    const markerPath = recoveryMarkerPath(record.receiptPath);
    const invalidIndex = record.snapshots.findIndex(
      (snapshot) =>
        !isInsideFolder(record.root, snapshot.targetPath) ||
        normalizedRecoveryPath(snapshot.targetPath) === normalizedRecoveryPath(record.root) ||
        recoveryPathsConflict(snapshot.targetPath, markerPath) ||
        recoveryPathsConflict(record.transactionRoot, snapshot.targetPath),
    );

    return invalidIndex < 0
      ? true
      : {
          path: ["snapshots", invalidIndex, "targetPath"],
          message: "Recovery targets must stay below the decoded root and outside transaction-owned paths.",
        };
  }),
  Schema.filter((record) => {
    const invalidIndex = record.snapshots.findIndex(
      (snapshot) =>
        snapshot.original._tag === "file" &&
        !isDirectSnapshotPath(record.transactionRoot, snapshot.original.snapshotPath),
    );

    return invalidIndex < 0
      ? true
      : {
          path: ["snapshots", invalidIndex, "original", "snapshotPath"],
          message: "Recovery snapshots must be direct children of the transaction snapshots directory.",
        };
  }),
  Schema.filter((record) => {
    const targetPaths = record.snapshots.map((snapshot) => snapshot.targetPath);
    const conflictingIndex = targetPaths.findIndex((candidate, index) =>
      targetPaths.slice(0, index).some((prior) => recoveryPathsConflict(prior, candidate)),
    );

    return conflictingIndex < 0
      ? true
      : {
          path: ["snapshots", conflictingIndex, "targetPath"],
          message: "Recovery target paths must be unique without case or ancestor conflicts.",
        };
  }),
  Schema.filter((record) => {
    const snapshotKeys = record.snapshots.flatMap((snapshot) =>
      snapshot.original._tag === "file" ? [recoveryPathKey(snapshot.original.snapshotPath)] : [],
    );

    return new Set(snapshotKeys).size === snapshotKeys.length
      ? true
      : { path: ["snapshots"], message: "Recovery file snapshots must use unique source paths." };
  }),
  Schema.filter((record) =>
    record.snapshots.some(
      (snapshot) => normalizedRecoveryPath(snapshot.targetPath) === normalizedRecoveryPath(record.receiptPath),
    )
      ? true
      : { path: ["snapshots"], message: "Recovery snapshots must include the ownership receipt target." },
  ),
);

export type RecoveryRecord = Schema.Schema.Type<typeof recoveryRecordSchema>;

export const recoveryRecordJsonSchema = Schema.parseJson(recoveryRecordSchema);

export const decodeRecoveryRecordJson = Schema.decodeUnknown(recoveryRecordJsonSchema, {
  onExcessProperty: "error",
});
