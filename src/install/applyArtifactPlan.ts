import { createHash, randomUUID } from "node:crypto";
import { rmdir } from "node:fs/promises";

import { FileSystem, Path } from "@effect/platform";
import { BadArgument, type PlatformError, SystemError } from "@effect/platform/Error";
import { Cause, Effect, Exit, Option, Ref, Schema } from "effect";

import type { ArtifactOperation, ArtifactPlan, ArtifactPrecondition, ReceiptOperation } from "./artifactPlan.js";
import { artifactReceiptJsonSchema } from "./artifactReceipt.js";
import {
  ArtifactRecoveryPendingError,
  type ArtifactRecoveryRecord,
  artifactRecoveryRecordJsonSchema,
  artifactRecoveryRecordSchema,
  decodeArtifactRecoveryRecordJson,
  isPathWithin,
  type TargetSnapshot,
} from "./artifactRecovery.js";

const missingTargetSnapshot = (targetPath: string): TargetSnapshot => ({
  targetPath,
  original: { _tag: "missing" },
});

const fileTargetSnapshot = (targetPath: string, snapshotPath: string): TargetSnapshot => ({
  targetPath,
  original: { _tag: "file", snapshotPath },
});

type StagedArtifact = {
  readonly operation: ArtifactOperation;
  readonly targetPath: string;
  readonly stagedPath: string;
  readonly snapshotPath: string;
};

type StagedReceipt = {
  readonly operation: ReceiptOperation;
  readonly targetPath: string;
  readonly recoveryPath: string;
  readonly stagedPath: string;
  readonly snapshotPath: string;
};

type StagedPrecondition = {
  readonly precondition: ArtifactPrecondition;
  readonly targetPath: string;
  readonly snapshotPath: string;
};

type StagedPlan = {
  readonly root: string;
  readonly transactionRoot: string;
  readonly stagedDirectory: string;
  readonly snapshotsDirectory: string;
  readonly pendingRecordPath: string;
  readonly artifacts: ReadonlyArray<StagedArtifact>;
  readonly preconditions: ReadonlyArray<StagedPrecondition>;
  readonly receipt: StagedReceipt;
};

type ValidatedRoot = {
  readonly root: string;
};

type TargetValidation = {
  readonly validatedRoot: ValidatedRoot;
  readonly targetPath: string;
};

type ExistingEntryValidation = TargetValidation & {
  readonly existingPath: string;
  readonly realPath: string;
};

type TargetCapture = TargetValidation & {
  readonly snapshotPath: string;
};

type TargetStateValidation = {
  readonly validatedRoot: ValidatedRoot;
  readonly snapshot: TargetSnapshot;
};

type PlanPreconditionValidation = {
  readonly stagedPlan: StagedPlan;
  readonly snapshots: ReadonlyArray<TargetSnapshot>;
};

type StagedPlanRequest = {
  readonly plan: ArtifactPlan;
  readonly validatedRoot: ValidatedRoot;
};

type CaptureTargetsRequest = {
  readonly stagedPlan: StagedPlan;
  readonly validatedRoot: ValidatedRoot;
};

type CommittedTargetState =
  | TargetSnapshot["original"]
  | {
      readonly _tag: "bytes";
      readonly value: Uint8Array;
    };

type CommittedMutation = {
  readonly snapshot: TargetSnapshot;
  readonly current: CommittedTargetState;
};

type CommittedStateValidation = {
  readonly validatedRoot: ValidatedRoot;
  readonly mutation: CommittedMutation;
};

type MutationStateUpdate = {
  readonly mutations: Ref.Ref<ReadonlyArray<CommittedMutation>>;
  readonly snapshot: TargetSnapshot;
  readonly current: CommittedTargetState;
};

type ArtifactMutation = {
  readonly artifact: StagedArtifact;
  readonly mutations: Ref.Ref<ReadonlyArray<CommittedMutation>>;
  readonly snapshot: TargetSnapshot;
};

type ReceiptMutation = {
  readonly receipt: StagedReceipt;
  readonly mutations: Ref.Ref<ReadonlyArray<CommittedMutation>>;
  readonly snapshot: TargetSnapshot;
};

type TransactionRuntime = {
  readonly stagedPlan: StagedPlan;
  readonly validatedRoot: ValidatedRoot;
  readonly snapshots: ReadonlyArray<TargetSnapshot>;
  readonly mutations: Ref.Ref<ReadonlyArray<CommittedMutation>>;
  readonly createdDirectories: Ref.Ref<ReadonlyArray<string>>;
};

const isNotFound = (error: PlatformError): boolean => error._tag === "SystemError" && error.reason === "NotFound";

const isAlreadyExists = (error: PlatformError): boolean => error._tag === "SystemError" && error.reason === "AlreadyExists";

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const combineCauses = (causes: ReadonlyArray<Cause.Cause<unknown>>): Cause.Cause<unknown> =>
  causes.reduce((combined, cause) => Cause.sequential(combined, cause), Cause.empty);

const createStagedPlan = (request: StagedPlanRequest) =>
  Effect.map(Path.Path, (path): StagedPlan => {
    const transactionRoot = path.join(request.validatedRoot.root, `.dufflebag-transaction-${randomUUID()}`);
    const stagedDirectory = path.join(transactionRoot, "staged");
    const snapshotsDirectory = path.join(transactionRoot, "snapshots");
    const artifacts = request.plan.operations.map((operation, index) => ({
      operation,
      targetPath: path.resolve(request.validatedRoot.root, operation.artifact.path),
      stagedPath: path.join(stagedDirectory, String(index)),
      snapshotPath: path.join(snapshotsDirectory, String(index)),
    }));
    const preconditions = request.plan.preconditions.map((precondition, index) => ({
      precondition,
      targetPath: path.resolve(request.validatedRoot.root, precondition.path),
      snapshotPath: path.join(snapshotsDirectory, `precondition-${index}`),
    }));
    const receiptTargetPath = path.resolve(request.validatedRoot.root, request.plan.receipt.target.path);
    const receiptDirectory = path.dirname(receiptTargetPath);

    return {
      root: request.validatedRoot.root,
      transactionRoot,
      stagedDirectory,
      snapshotsDirectory,
      pendingRecordPath: path.join(transactionRoot, "pending.json"),
      artifacts,
      preconditions,
      receipt: {
        operation: request.plan.receipt,
        targetPath: receiptTargetPath,
        recoveryPath: path.join(receiptDirectory, "recovery.json"),
        stagedPath: path.join(stagedDirectory, "receipt"),
        snapshotPath: path.join(snapshotsDirectory, "receipt"),
      },
    };
  });

const ensureRecoveryAbsent = (receipt: StagedReceipt) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const recoveryExists = yield* fileSystem.stat(receipt.recoveryPath).pipe(
      Effect.as(true),
      Effect.catchIf(isNotFound, () => Effect.succeed(false)),
    );

    if (recoveryExists) {
      return yield* new ArtifactRecoveryPendingError({ recoveryPath: receipt.recoveryPath });
    }
  });

const validatePlanRoot = (root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const normalizedRoot = path.normalize(root);

    if (!path.isAbsolute(root) || path.resolve(root) !== normalizedRoot) {
      return yield* new BadArgument({
        module: "FileSystem",
        method: "realPath",
        description: `Artifact plan root ${root} is not a fully qualified canonical path on this host.`,
      });
    }

    const realRoot = yield* fileSystem.realPath(normalizedRoot);
    const entry = yield* fileSystem.stat(realRoot);
    if (entry.type !== "Directory") {
      return yield* new BadArgument({
        module: "FileSystem",
        method: "realPath",
        description: `Artifact plan root ${root} is not a directory.`,
      });
    }

    return { root: realRoot } satisfies ValidatedRoot;
  });

const validateExistingEntry = (validation: ExistingEntryValidation) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const expectedRealPath = path.resolve(
      validation.validatedRoot.root,
      path.relative(validation.validatedRoot.root, validation.existingPath),
    );
    const entry = yield* fileSystem.stat(validation.existingPath);
    const expectedType = validation.existingPath === validation.targetPath ? "File" : "Directory";

    if (validation.realPath !== expectedRealPath || entry.type !== expectedType) {
      return yield* new BadArgument({
        module: "FileSystem",
        method: "realPath",
        description: `Transaction target ${validation.targetPath} has a symlinked or non-file path component at ${validation.existingPath}.`,
      });
    }
  });

const validateTarget = (validation: TargetValidation) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const currentRealRoot = yield* fileSystem.realPath(validation.validatedRoot.root);
    let existingPath = validation.targetPath;

    if (currentRealRoot !== validation.validatedRoot.root || !isPathWithin(validation.validatedRoot.root, validation.targetPath)) {
      return yield* new BadArgument({
        module: "FileSystem",
        method: "realPath",
        description: `Transaction target ${validation.targetPath} is outside its captured installation root.`,
      });
    }

    // Resolve the nearest existing path so a symlinked ancestor cannot redirect a later write.
    while (true) {
      const resolved = yield* fileSystem.realPath(existingPath).pipe(
        Effect.map(Option.some),
        Effect.catchIf(isNotFound, () => Effect.succeed(Option.none())),
      );
      if (Option.isSome(resolved)) {
        return yield* validateExistingEntry({
          validatedRoot: validation.validatedRoot,
          targetPath: validation.targetPath,
          existingPath,
          realPath: resolved.value,
        });
      }

      const parent = path.dirname(existingPath);
      if (parent === existingPath) {
        return yield* new BadArgument({
          module: "FileSystem",
          method: "realPath",
          description: `Transaction target ${validation.targetPath} is outside installation root ${validation.validatedRoot.root}.`,
        });
      }

      existingPath = parent;
    }
  });

const preflightTargets = (request: CaptureTargetsRequest) =>
  Effect.forEach(
    [
      ...request.stagedPlan.artifacts.map((artifact) => artifact.targetPath),
      ...request.stagedPlan.preconditions.map((precondition) => precondition.targetPath),
      request.stagedPlan.receipt.targetPath,
      request.stagedPlan.receipt.recoveryPath,
    ],
    (targetPath) => validateTarget({ validatedRoot: request.validatedRoot, targetPath }),
    { discard: true },
  );

const captureTarget = (capture: TargetCapture) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    yield* validateTarget({ validatedRoot: capture.validatedRoot, targetPath: capture.targetPath });
    const bytes = yield* fileSystem.readFile(capture.targetPath).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () => Effect.succeed(Option.none())),
    );

    if (Option.isNone(bytes)) {
      return missingTargetSnapshot(capture.targetPath);
    }

    yield* fileSystem.writeFile(capture.snapshotPath, bytes.value, { mode: 0o600 });

    return fileTargetSnapshot(capture.targetPath, capture.snapshotPath);
  });

const removeTransaction = (stagedPlan: StagedPlan) =>
  Effect.flatMap(FileSystem.FileSystem, (fileSystem) => fileSystem.remove(stagedPlan.transactionRoot, { recursive: true, force: true }));

const captureTargets = (request: CaptureTargetsRequest) =>
  Effect.uninterruptibleMask(() =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;

      yield* fileSystem.makeDirectory(request.stagedPlan.transactionRoot, { mode: 0o700 });
      const captureExit = yield* Effect.exit(
        Effect.interruptible(
          Effect.gen(function* () {
            yield* fileSystem.makeDirectory(request.stagedPlan.stagedDirectory, { mode: 0o700 });
            yield* fileSystem.makeDirectory(request.stagedPlan.snapshotsDirectory, { mode: 0o700 });

            const artifactSnapshots = yield* Effect.forEach(request.stagedPlan.artifacts, (artifact) =>
              captureTarget({
                validatedRoot: request.validatedRoot,
                targetPath: artifact.targetPath,
                snapshotPath: artifact.snapshotPath,
              }),
            );
            const preconditionSnapshots = yield* Effect.forEach(request.stagedPlan.preconditions, (precondition) =>
              captureTarget({
                validatedRoot: request.validatedRoot,
                targetPath: precondition.targetPath,
                snapshotPath: precondition.snapshotPath,
              }),
            );
            const receiptSnapshot = yield* captureTarget({
              validatedRoot: request.validatedRoot,
              targetPath: request.stagedPlan.receipt.targetPath,
              snapshotPath: request.stagedPlan.receipt.snapshotPath,
            });

            return [...artifactSnapshots, ...preconditionSnapshots, receiptSnapshot];
          }),
        ),
      );

      if (Exit.isSuccess(captureExit)) {
        return captureExit.value;
      }

      const cleanupExit = yield* Effect.exit(removeTransaction(request.stagedPlan));
      return yield* Effect.failCause(
        Exit.isFailure(cleanupExit) ? Cause.sequential(captureExit.cause, cleanupExit.cause) : captureExit.cause,
      );
    }),
  );

const stageTargets = (stagedPlan: StagedPlan) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    yield* Effect.forEach(
      stagedPlan.artifacts,
      (artifact) =>
        artifact.operation._tag === "remove" ? Effect.void : fileSystem.writeFile(artifact.stagedPath, artifact.operation.bytes),
      { discard: true },
    );

    if (stagedPlan.receipt.operation._tag === "receiptPublish") {
      const receiptJson = yield* Schema.encode(artifactReceiptJsonSchema)(stagedPlan.receipt.operation.receipt);
      yield* fileSystem.writeFileString(stagedPlan.receipt.stagedPath, receiptJson);
    }
  });

const parentDirectories = (root: string, targetPath: string) =>
  Effect.map(Path.Path, (path) => {
    const directories: Array<string> = [];
    let directory = path.dirname(targetPath);

    // Walk from the target parent back to the validated installation root.
    while (directory !== root) {
      const relativeDirectory = path.relative(root, directory);
      if (relativeDirectory.startsWith("..") || path.isAbsolute(relativeDirectory)) {
        return [];
      }

      directories.push(directory);
      const parent = path.dirname(directory);
      if (parent === directory) {
        return [];
      }

      directory = parent;
    }

    return directories.reverse();
  });

const ensureDirectory = (createdDirectories: Ref.Ref<ReadonlyArray<string>>, directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directoryExists = yield* fileSystem.stat(directory).pipe(
      Effect.map((entry) => entry.type === "Directory"),
      Effect.catchIf(isNotFound, () => Effect.succeed(false)),
    );

    if (directoryExists) {
      return;
    }

    yield* fileSystem.makeDirectory(directory);
    yield* Ref.update(createdDirectories, (directories) => [...directories, directory]);
  });

const ensureTargetParent = (transaction: TransactionRuntime, targetPath: string) =>
  Effect.gen(function* () {
    const directories = yield* parentDirectories(transaction.stagedPlan.root, targetPath);
    yield* Effect.forEach(directories, (directory) => ensureDirectory(transaction.createdDirectories, directory), {
      discard: true,
    });
  });

const pendingRecoveryRecord = (transaction: TransactionRuntime): ArtifactRecoveryRecord => ({
  _tag: "pending",
  version: 1,
  root: transaction.stagedPlan.root,
  receiptPath: transaction.stagedPlan.receipt.targetPath,
  transactionRoot: transaction.stagedPlan.transactionRoot,
  snapshots: transaction.snapshots,
});

const publishRecoveryMarker = (transaction: TransactionRuntime) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const recoveryJson = yield* Schema.encode(artifactRecoveryRecordJsonSchema)(pendingRecoveryRecord(transaction));

    yield* fileSystem.writeFileString(transaction.stagedPlan.pendingRecordPath, recoveryJson, { flag: "wx", mode: 0o600 });
    yield* ensureTargetParent(transaction, transaction.stagedPlan.receipt.recoveryPath);
    yield* validateTarget({
      validatedRoot: transaction.validatedRoot,
      targetPath: transaction.stagedPlan.receipt.recoveryPath,
    });
    return yield* fileSystem.link(transaction.stagedPlan.pendingRecordPath, transaction.stagedPlan.receipt.recoveryPath).pipe(
      Effect.as(true),
      Effect.catchIf(isAlreadyExists, () => Effect.succeed(false)),
    );
  });

const recoveryRecordsEqual = Schema.equivalence(artifactRecoveryRecordSchema);

const verifyRecoveryMarker = (transaction: TransactionRuntime) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const recoveryJson = yield* fileSystem.readFileString(transaction.stagedPlan.receipt.recoveryPath);
    const recoveryRecord = yield* decodeArtifactRecoveryRecordJson(recoveryJson);

    if (!recoveryRecordsEqual(recoveryRecord, pendingRecoveryRecord(transaction))) {
      return yield* new BadArgument({
        module: "FileSystem",
        method: "readFile",
        description: `Recovery marker ${transaction.stagedPlan.receipt.recoveryPath} changed during the transaction.`,
      });
    }
  });

const removeRecoveryMarker = (transaction: TransactionRuntime) =>
  Effect.flatMap(FileSystem.FileSystem, (fileSystem) => fileSystem.remove(transaction.stagedPlan.receipt.recoveryPath));

const findSnapshot = (snapshots: ReadonlyArray<TargetSnapshot>, targetPath: string) => {
  const snapshot = snapshots.find((candidate) => candidate.targetPath === targetPath);

  return snapshot === undefined ? Effect.dieMessage(`Transaction snapshot missing for ${targetPath}`) : Effect.succeed(snapshot);
};

const validatePlanPreconditions = (validation: PlanPreconditionValidation) =>
  Effect.forEach(
    [
      ...validation.stagedPlan.artifacts.map((artifact) => ({
        targetPath: artifact.targetPath,
        expectedCurrent: artifact.operation.expectedCurrent,
      })),
      ...validation.stagedPlan.preconditions.map((precondition) => ({
        targetPath: precondition.targetPath,
        expectedCurrent: precondition.precondition.expectedCurrent,
      })),
      {
        targetPath: validation.stagedPlan.receipt.targetPath,
        expectedCurrent: validation.stagedPlan.receipt.operation.expectedCurrent,
      },
    ],
    (target) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const snapshot = yield* findSnapshot(validation.snapshots, target.targetPath);
        const expected = target.expectedCurrent;

        if (expected._tag === "missing" && snapshot.original._tag === "missing") {
          return;
        }

        if (expected._tag === "file" && snapshot.original._tag === "file") {
          const capturedBytes = yield* fileSystem.readFile(snapshot.original.snapshotPath);
          if (sha256(capturedBytes) === expected.sha256) {
            return;
          }
        }

        return yield* new BadArgument({
          module: "FileSystem",
          method: "stat",
          description: `Transaction target ${target.targetPath} no longer matches the state inspected during planning.`,
        });
      }),
    { discard: true },
  );

const validateTargetState = (validation: TargetStateValidation) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    yield* validateTarget({ validatedRoot: validation.validatedRoot, targetPath: validation.snapshot.targetPath });
    const currentBytes = yield* fileSystem.readFile(validation.snapshot.targetPath).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () => Effect.succeed(Option.none())),
    );

    if (validation.snapshot.original._tag === "missing" && Option.isNone(currentBytes)) {
      return;
    }

    if (validation.snapshot.original._tag === "file" && Option.isSome(currentBytes)) {
      const capturedBytes = yield* fileSystem.readFile(validation.snapshot.original.snapshotPath);
      if (bytesEqual(currentBytes.value, capturedBytes)) {
        return;
      }
    }

    return yield* new BadArgument({
      module: "FileSystem",
      method: "stat",
      description: `Transaction target ${validation.snapshot.targetPath} changed after it was captured.`,
    });
  });

const recordMutation = (mutations: Ref.Ref<ReadonlyArray<CommittedMutation>>, snapshot: TargetSnapshot) =>
  Ref.update(mutations, (recorded) => [...recorded, { snapshot, current: snapshot.original }]);

const updateMutationState = (update: MutationStateUpdate) =>
  Ref.update(update.mutations, (recorded) =>
    recorded.map((mutation) =>
      mutation.snapshot.targetPath === update.snapshot.targetPath ? { ...mutation, current: update.current } : mutation,
    ),
  );

const applyArtifactOperation = (mutation: ArtifactMutation) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    yield* recordMutation(mutation.mutations, mutation.snapshot);
    yield* fileSystem.remove(mutation.artifact.targetPath, { force: true });
    yield* updateMutationState({
      mutations: mutation.mutations,
      snapshot: mutation.snapshot,
      current: { _tag: "missing" },
    });

    switch (mutation.artifact.operation._tag) {
      case "write":
      case "restore":
        yield* fileSystem.rename(mutation.artifact.stagedPath, mutation.artifact.targetPath);
        yield* updateMutationState({
          mutations: mutation.mutations,
          snapshot: mutation.snapshot,
          current: { _tag: "bytes", value: mutation.artifact.operation.bytes },
        });
        return;
      case "remove":
        return;
    }
  });

const commitArtifacts = (transaction: TransactionRuntime) =>
  Effect.forEach(
    transaction.stagedPlan.artifacts,
    (artifact) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          if (artifact.operation._tag !== "remove") {
            yield* ensureTargetParent(transaction, artifact.targetPath);
          }

          const snapshot = yield* findSnapshot(transaction.snapshots, artifact.targetPath);
          yield* validateTargetState({ validatedRoot: transaction.validatedRoot, snapshot });
          yield* applyArtifactOperation({ artifact, mutations: transaction.mutations, snapshot });
        }),
      ),
    { discard: true },
  );

const applyReceiptOperation = (mutation: ReceiptMutation) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const receiptBytes =
      mutation.receipt.operation._tag === "receiptPublish" ? yield* fileSystem.readFile(mutation.receipt.stagedPath) : undefined;

    yield* recordMutation(mutation.mutations, mutation.snapshot);
    yield* fileSystem.remove(mutation.receipt.targetPath, { force: true });
    yield* updateMutationState({
      mutations: mutation.mutations,
      snapshot: mutation.snapshot,
      current: { _tag: "missing" },
    });
    if (mutation.receipt.operation._tag === "receiptPublish" && receiptBytes !== undefined) {
      yield* fileSystem.rename(mutation.receipt.stagedPath, mutation.receipt.targetPath);
      yield* updateMutationState({
        mutations: mutation.mutations,
        snapshot: mutation.snapshot,
        current: { _tag: "bytes", value: receiptBytes },
      });
    }
  });

const commitReceipt = (transaction: TransactionRuntime) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      if (transaction.stagedPlan.receipt.operation._tag === "receiptPublish") {
        yield* ensureTargetParent(transaction, transaction.stagedPlan.receipt.targetPath);
      }

      const snapshot = yield* findSnapshot(transaction.snapshots, transaction.stagedPlan.receipt.targetPath);
      yield* validateTargetState({ validatedRoot: transaction.validatedRoot, snapshot });
      yield* applyReceiptOperation({ receipt: transaction.stagedPlan.receipt, mutations: transaction.mutations, snapshot });
    }),
  );

const validateCommittedState = (validation: CommittedStateValidation) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const targetPath = validation.mutation.snapshot.targetPath;

    yield* validateTarget({ validatedRoot: validation.validatedRoot, targetPath });
    const currentBytes = yield* fileSystem.readFile(targetPath).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () => Effect.succeed(Option.none())),
    );

    const actualBytes = Option.getOrUndefined(currentBytes);
    switch (validation.mutation.current._tag) {
      case "missing":
        if (actualBytes === undefined) {
          return;
        }
        break;
      case "file": {
        const expectedBytes = yield* fileSystem.readFile(validation.mutation.current.snapshotPath);
        if (actualBytes !== undefined && bytesEqual(actualBytes, expectedBytes)) {
          return;
        }
        break;
      }
      case "bytes":
        if (actualBytes !== undefined && bytesEqual(actualBytes, validation.mutation.current.value)) {
          return;
        }
        break;
    }

    return yield* new BadArgument({
      module: "FileSystem",
      method: "stat",
      description: `Transaction target ${targetPath} changed after this transaction mutated it.`,
    });
  });

const restoreTarget = (validation: CommittedStateValidation) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const snapshot = validation.mutation.snapshot;

    yield* validateCommittedState(validation);
    yield* fileSystem.remove(snapshot.targetPath, { force: true });
    if (snapshot.original._tag === "file") {
      yield* fileSystem.copyFile(snapshot.original.snapshotPath, snapshot.targetPath);
    }
  });

const restoreTargets = (transaction: TransactionRuntime) =>
  Effect.gen(function* () {
    const recordedMutations = yield* Ref.get(transaction.mutations);
    const outcomes = yield* Effect.forEach([...recordedMutations].reverse(), (mutation) =>
      Effect.map(Effect.exit(restoreTarget({ validatedRoot: transaction.validatedRoot, mutation })), (exit) => ({ mutation, exit })),
    );
    const failedSnapshots = outcomes.flatMap((outcome) => (Exit.isFailure(outcome.exit) ? [outcome.mutation.snapshot] : []));
    const rollbackCauses = outcomes.flatMap((outcome) => (Exit.isFailure(outcome.exit) ? [outcome.exit.cause] : []));

    return { failedSnapshots, rollbackCause: combineCauses(rollbackCauses) };
  });

// @effect/platform lacks atomic nonrecursive directory removal.
const removeEmptyDirectory = (directory: string) =>
  Effect.tryPromise({
    try: () => rmdir(directory),
    catch: (cause) =>
      new SystemError({
        reason: "Unknown",
        module: "FileSystem",
        method: "rmdir",
        pathOrDescriptor: directory,
        description: "Could not remove an empty transaction-created directory.",
        cause,
      }),
  });

const removeCreatedDirectories = (createdDirectories: Ref.Ref<ReadonlyArray<string>>) =>
  Effect.gen(function* () {
    const directories = yield* Ref.get(createdDirectories);
    const deepestFirst = [...new Set(directories)].sort((left, right) => right.length - left.length);

    yield* Effect.forEach(deepestFirst, removeEmptyDirectory, { discard: true });
  });

const failAfterCleanup = (stagedPlan: StagedPlan, cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    const cleanupExit = yield* Effect.exit(removeTransaction(stagedPlan));
    return yield* Effect.failCause(Exit.isFailure(cleanupExit) ? Cause.sequential(cause, cleanupExit.cause) : cause);
  });

const cleanupUnpublishedMarker = (transaction: TransactionRuntime) =>
  Effect.gen(function* () {
    yield* removeTransaction(transaction.stagedPlan);
    yield* removeCreatedDirectories(transaction.createdDirectories);
  });

const failForOccupiedMarker = (transaction: TransactionRuntime) =>
  Effect.gen(function* () {
    const pendingCause = Cause.fail(new ArtifactRecoveryPendingError({ recoveryPath: transaction.stagedPlan.receipt.recoveryPath }));
    const cleanupExit = yield* Effect.exit(cleanupUnpublishedMarker(transaction));

    return yield* Effect.failCause(Exit.isFailure(cleanupExit) ? Cause.sequential(pendingCause, cleanupExit.cause) : pendingCause);
  });

const cleanupReleasedTransaction = (transaction: TransactionRuntime) =>
  Effect.gen(function* () {
    yield* verifyRecoveryMarker(transaction);
    yield* removeRecoveryMarker(transaction);
    yield* removeTransaction(transaction.stagedPlan);
    yield* removeCreatedDirectories(transaction.createdDirectories);
  });

const reconcileMarkerAttempt = (transaction: TransactionRuntime) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const markerExists = yield* fileSystem.stat(transaction.stagedPlan.receipt.recoveryPath).pipe(
      Effect.as(true),
      Effect.catchIf(isNotFound, () => Effect.succeed(false)),
    );

    if (markerExists) {
      return yield* cleanupReleasedTransaction(transaction);
    }

    return yield* cleanupUnpublishedMarker(transaction);
  });

const failAfterMarkerAttempt = (transaction: TransactionRuntime, cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    const reconciliationExit = yield* Effect.exit(reconcileMarkerAttempt(transaction));
    if (Exit.isSuccess(reconciliationExit)) {
      return yield* Effect.failCause(cause);
    }

    const pendingCause = Cause.fail(new ArtifactRecoveryPendingError({ recoveryPath: transaction.stagedPlan.transactionRoot }));

    return yield* Effect.failCause(combineCauses([cause, reconciliationExit.cause, pendingCause]));
  });

const cleanupCommittedTransaction = (transaction: TransactionRuntime) =>
  Effect.gen(function* () {
    yield* verifyRecoveryMarker(transaction);
    yield* removeRecoveryMarker(transaction);
    yield* removeTransaction(transaction.stagedPlan);
  });

const recoverCommit = (transaction: TransactionRuntime, originalCause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    // 1. Restore recorded targets in reverse mutation order.
    const restoration = yield* restoreTargets(transaction);

    // 2. Release the marker and snapshots only after complete restoration.
    if (restoration.failedSnapshots.length === 0) {
      const cleanupExit = yield* Effect.exit(cleanupReleasedTransaction(transaction));
      const cleanupCauses = Exit.isFailure(cleanupExit) ? [cleanupExit.cause] : [];

      return yield* Effect.failCause(combineCauses([originalCause, ...cleanupCauses]));
    }

    // 3. Keep the complete marker and durable snapshots when restoration is incomplete.
    const fileSystem = yield* FileSystem.FileSystem;
    const recoveryCleanupExit = yield* Effect.exit(
      Effect.gen(function* () {
        yield* verifyRecoveryMarker(transaction);
        yield* fileSystem.remove(transaction.stagedPlan.stagedDirectory, { recursive: true, force: true });
      }),
    );
    const cleanupCauses = Exit.isFailure(recoveryCleanupExit) ? [recoveryCleanupExit.cause] : [];
    const pendingCause = Cause.fail(new ArtifactRecoveryPendingError({ recoveryPath: transaction.stagedPlan.receipt.recoveryPath }));

    // 4. Re-raise the commit and rollback causes with the pending recovery location.
    return yield* Effect.failCause(combineCauses([originalCause, restoration.rollbackCause, pendingCause, ...cleanupCauses]));
  });

/**
 * Applies one validated artifact plan transactionally.
 * Commit failures restore recorded mutations; incomplete recovery retains a marker and snapshots.
 */
export const applyArtifactPlan = (plan: ArtifactPlan) =>
  Effect.uninterruptibleMask((restoreInterruptibility) =>
    Effect.gen(function* () {
      // 1. Resolve one canonical root and derive every transaction path from it.
      const validatedRoot = yield* restoreInterruptibility(validatePlanRoot(plan.root));
      const stagedPlan = yield* createStagedPlan({ plan, validatedRoot });
      const captureRequest = { stagedPlan, validatedRoot };

      // 2. Preflight and capture every original target before destination mutation.
      yield* restoreInterruptibility(preflightTargets(captureRequest));
      yield* restoreInterruptibility(ensureRecoveryAbsent(stagedPlan.receipt));
      const snapshots = yield* captureTargets(captureRequest);

      // 3. Reject stale planning evidence before staging any desired state.
      const preconditionExit = yield* Effect.exit(restoreInterruptibility(validatePlanPreconditions({ stagedPlan, snapshots })));
      if (Exit.isFailure(preconditionExit)) {
        return yield* failAfterCleanup(stagedPlan, preconditionExit.cause);
      }

      // 4. Stage every desired artifact and the next ownership receipt.
      const stagingExit = yield* Effect.exit(restoreInterruptibility(stageTargets(stagedPlan)));
      if (Exit.isFailure(stagingExit)) {
        return yield* failAfterCleanup(stagedPlan, stagingExit.cause);
      }

      const mutations = yield* Ref.make<ReadonlyArray<CommittedMutation>>([]);
      const createdDirectories = yield* Ref.make<ReadonlyArray<string>>([]);
      const transaction: TransactionRuntime = {
        stagedPlan,
        validatedRoot,
        snapshots,
        mutations,
        createdDirectories,
      };

      // 5. Publish the recovery lock, then revalidate and commit artifacts in order.
      const markerExit = yield* Effect.exit(publishRecoveryMarker(transaction));
      if (Exit.isFailure(markerExit)) {
        return yield* failAfterMarkerAttempt(transaction, markerExit.cause);
      }
      if (!markerExit.value) {
        return yield* failForOccupiedMarker(transaction);
      }

      const commitExit = yield* Effect.exit(
        restoreInterruptibility(
          Effect.gen(function* () {
            yield* commitArtifacts(transaction);

            // 6. Publish ownership only after every artifact succeeds.
            yield* commitReceipt(transaction);
          }),
        ),
      );

      // 7. Restore on failure, or release the recovery marker before snapshots.
      if (Exit.isFailure(commitExit)) {
        return yield* recoverCommit(transaction, commitExit.cause);
      }

      const cleanupExit = yield* Effect.exit(cleanupCommittedTransaction(transaction));
      if (Exit.isFailure(cleanupExit)) {
        return yield* Effect.failCause(cleanupExit.cause);
      }
    }),
  );
