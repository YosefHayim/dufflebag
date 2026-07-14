import * as FileSystem from "@effect/platform/FileSystem";
import * as Path from "@effect/platform/Path";
import { Effect, Schema, type SchemaAST } from "effect";

import type { ArtifactObservation } from "./artifactMaterialization.js";
import { type ArtifactOperation, type ArtifactPlan, validateArtifactPlan } from "./artifactPlan.js";
import { artifactReceiptJsonSchema, sha256Bytes } from "./artifactReceipt.js";

const strictParseOptions = {
  onExcessProperty: "error",
} satisfies SchemaAST.ParseOptions;

const transactionStateSchema = Schema.Literal("unchanged", "rolledBack", "committed");

export class ArtifactTargetError extends Schema.TaggedError<ArtifactTargetError>()("ArtifactTargetError", {
  code: Schema.String,
  path: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class ArtifactTransactionError extends Schema.TaggedError<ArtifactTransactionError>()("ArtifactTransactionError", {
  state: transactionStateSchema,
  phase: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class ArtifactRecoveryRequiredError extends Schema.TaggedError<ArtifactRecoveryRequiredError>()("ArtifactRecoveryRequiredError", {
  phase: Schema.Literal("rollback", "receipt"),
  message: Schema.String,
  workspacePath: Schema.String,
  indexPath: Schema.String,
  recoveryPath: Schema.String,
  recoveryRecordStatus: Schema.Literal("published", "failed"),
  unrecoveredPaths: Schema.Array(Schema.String),
  failures: Schema.Array(Schema.String),
  cause: Schema.optional(Schema.Defect),
}) {}

type MissingState = {
  readonly _tag: "missing";
};

type FileState = {
  readonly _tag: "file";
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly mode: number;
};

type TargetState = MissingState | FileState;

type RequiredState =
  | MissingState
  | {
      readonly _tag: "file";
      readonly bytes: Uint8Array;
      readonly sha256: string;
    };

type Mutation =
  | {
      readonly _tag: "write";
      readonly bytes: Uint8Array;
    }
  | {
      readonly _tag: "remove";
    };

type TargetSpec = {
  readonly path: string;
  readonly absolutePath: string;
  readonly required: RequiredState;
  readonly role: "artifact" | "legacyManifest" | "receipt";
  mutation?: Mutation;
};

type Snapshot = TargetSpec & {
  readonly original: TargetState;
  readonly expectedAfter: TargetState;
  readonly snapshotPath?: string;
};

type Stage = {
  readonly path: string;
  readonly absolutePath: string;
  readonly bytes: Uint8Array;
  readonly mode: number;
  readonly cleanupModes: Set<number>;
};

type PreparedTransaction = {
  readonly plan: ArtifactPlan;
  readonly root: string;
  readonly transactionId: string;
  readonly workspacePath: string;
  readonly indexPath: string;
  readonly recoveryPath: string;
  readonly snapshots: ReadonlyMap<string, Snapshot>;
  readonly ordinaryOperations: ReadonlyArray<ArtifactOperation>;
  readonly receiptSnapshot: Snapshot;
  readonly stages: ReadonlyMap<string, Stage>;
  readonly createdDirectories: Array<string>;
  readonly restoreStages: Array<Stage>;
};

type WriterContext = {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly root: string;
};

type RollbackFailure = {
  readonly path: string;
  readonly message: string;
};

type TargetFailureRequest = {
  readonly code: string;
  readonly targetPath: string;
  readonly message: string;
  readonly cause?: unknown;
};

type TransactionFailureRequest = {
  readonly state: "unchanged" | "rolledBack" | "committed";
  readonly phase: string;
  readonly message: string;
  readonly cause?: unknown;
};

type ContainmentRequest = {
  readonly pathService: Path.Path;
  readonly root: string;
  readonly absolutePath: string;
  readonly label: string;
};

type ResolveTargetRequest = {
  readonly pathService: Path.Path;
  readonly root: string;
  readonly relativePath: string;
};

type TargetPathRequest = {
  readonly context: WriterContext;
  readonly absolutePath: string;
  readonly relativePath: string;
};

type PresentNode = {
  readonly _tag: "present";
  readonly type: FileSystem.File.Type;
  readonly mode: number;
};

type NodePresence = MissingState | PresentNode;

type BuildTargetSpecsRequest = {
  readonly plan: ArtifactPlan;
  readonly root: string;
  readonly pathService: Path.Path;
};

type RecoveryPathRequest = {
  readonly context: WriterContext;
  readonly recoveryPath: string;
  readonly recoveryRelativePath: string;
};

type SnapshotTargetsRequest = {
  readonly context: WriterContext;
  readonly specs: ReadonlyMap<string, TargetSpec>;
  readonly workspacePath: string;
};

type ParentDirectoryRequest = {
  readonly context: WriterContext;
  readonly targetPath: string;
  readonly createdDirectories: Array<string>;
};

type WritePrivateFileRequest = {
  readonly fileSystem: FileSystem.FileSystem;
  readonly targetPath: string;
  readonly value: Uint8Array;
};

type CreateStageRequest = {
  readonly context: WriterContext;
  readonly snapshot: Snapshot;
  readonly transactionId: string;
  readonly ordinal: number;
  readonly stages: Map<string, Stage>;
};

type StageWritesRequest = {
  readonly context: WriterContext;
  readonly snapshots: ReadonlyMap<string, Snapshot>;
  readonly operations: ReadonlyArray<ArtifactOperation>;
  readonly receiptPath: string;
  readonly transactionId: string;
  readonly stages: Map<string, Stage>;
  readonly createdDirectories: Array<string>;
};

type VerifyStateRequest = {
  readonly context: WriterContext;
  readonly snapshot: Snapshot;
  readonly expected: TargetState;
};

type MutateSnapshotRequest = {
  readonly context: WriterContext;
  readonly snapshot: Snapshot;
  readonly stage: Stage | undefined;
};

type RestoreSnapshotRequest = {
  readonly context: WriterContext;
  readonly prepared: PreparedTransaction;
  readonly snapshot: Snapshot;
};

type RollbackJournalRequest = {
  readonly context: WriterContext;
  readonly prepared: PreparedTransaction;
  readonly journal: ReadonlyArray<Snapshot>;
};

type WriteRecoveryRecordRequest = {
  readonly context: WriterContext;
  readonly prepared: PreparedTransaction;
  readonly phase: "rollback" | "receipt";
  readonly rollbackFailures: ReadonlyArray<RollbackFailure>;
};

type RecoveryRequiredRequest = WriteRecoveryRecordRequest & {
  readonly cause: unknown;
};

type HandleCommitFailureRequest = {
  readonly context: WriterContext;
  readonly prepared: PreparedTransaction;
  readonly journal: ReadonlyArray<Snapshot>;
  readonly phase: "artifact" | "receipt";
  readonly cause: unknown;
};

type PreparationCleanupRequest = {
  readonly context: WriterContext;
  readonly workspacePath: string;
  readonly stages: Iterable<Stage>;
  readonly createdDirectories: ReadonlyArray<string>;
};

type IndexOriginalState = Schema.Schema.Type<typeof indexMissingStateSchema> | Schema.Schema.Type<typeof indexFileStateSchema>;

type IndexExpectedState = Schema.Schema.Type<typeof indexMissingStateSchema> | Schema.Schema.Type<typeof indexExpectedFileStateSchema>;

type StageOwnership = "missing" | "owned" | "unknown";

const missingState: MissingState = { _tag: "missing" };
const defaultFileMode = 0o644;
const privateFileMode = 0o600;
const privateDirectoryMode = 0o700;

const indexMissingStateSchema = Schema.TaggedStruct("missing", {});
const indexFileStateSchema = Schema.TaggedStruct("file", {
  sha256: Schema.String,
  mode: Schema.Number,
  snapshotPath: Schema.String,
});
const indexExpectedFileStateSchema = Schema.TaggedStruct("file", {
  sha256: Schema.String,
  mode: Schema.Number,
});
const indexEntrySchema = Schema.Struct({
  path: Schema.String,
  absolutePath: Schema.String,
  role: Schema.Literal("artifact", "legacyManifest", "receipt"),
  original: Schema.Union(indexMissingStateSchema, indexFileStateSchema),
  expectedAfter: Schema.Union(indexMissingStateSchema, indexExpectedFileStateSchema),
});
const snapshotIndexSchema = Schema.Struct({
  version: Schema.Literal(1),
  transactionId: Schema.String,
  phase: Schema.Literal("snapshotted", "staged"),
  root: Schema.String,
  receiptPath: Schema.String,
  workspacePath: Schema.String,
  createdDirectories: Schema.Array(Schema.String),
  mutationOrder: Schema.Array(Schema.String),
  entries: Schema.Array(indexEntrySchema),
}).annotations({
  parseOptions: strictParseOptions,
});

const recoverySnapshotSchema = Schema.Struct({
  path: Schema.String,
  original: Schema.Union(indexMissingStateSchema, indexFileStateSchema),
});
const recoveryRecordSchema = Schema.Struct({
  version: Schema.Literal(1),
  transactionId: Schema.String,
  phase: Schema.Literal("rollback", "receipt"),
  root: Schema.String,
  receiptPath: Schema.String,
  workspacePath: Schema.String,
  indexPath: Schema.String,
  unrecoveredPaths: Schema.Array(Schema.String),
  snapshots: Schema.Array(recoverySnapshotSchema),
  failures: Schema.Array(Schema.String),
}).annotations({
  parseOptions: strictParseOptions,
});

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  return Buffer.from(left).equals(Buffer.from(right));
};

const stateEquals = (left: TargetState, right: TargetState): boolean => {
  if (left._tag !== right._tag) {
    return false;
  }

  if (left._tag === "missing" || right._tag === "missing") {
    return true;
  }

  return left.sha256 === right.sha256 && left.mode === right.mode && bytesEqual(left.bytes, right.bytes);
};

const requiredStateMatches = (required: RequiredState, actual: TargetState): boolean => {
  if (required._tag !== actual._tag) {
    return false;
  }

  if (required._tag === "missing" || actual._tag === "missing") {
    return true;
  }

  return required.sha256 === actual.sha256 && bytesEqual(required.bytes, actual.bytes);
};

const platformCauseCode = (cause: unknown): string | undefined => {
  if (typeof cause !== "object" || cause === null || !("cause" in cause)) {
    return undefined;
  }

  const nested = cause.cause;
  if (typeof nested !== "object" || nested === null || !("code" in nested)) {
    return undefined;
  }

  return typeof nested.code === "string" ? nested.code : undefined;
};

const isNotFound = (cause: unknown): boolean => {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "SystemError" &&
    "reason" in cause &&
    cause.reason === "NotFound"
  );
};

const isNotLink = (cause: unknown): boolean => {
  return platformCauseCode(cause) === "EINVAL";
};

const targetFailure = ({ code, targetPath, message, cause }: TargetFailureRequest): ArtifactTargetError => {
  return new ArtifactTargetError({
    code,
    path: targetPath,
    message,
    ...(cause === undefined ? {} : { cause }),
  });
};

const transactionFailure = ({ state, phase, message, cause }: TransactionFailureRequest): ArtifactTransactionError => {
  return new ArtifactTransactionError({
    state,
    phase,
    message,
    ...(cause === undefined ? {} : { cause }),
  });
};

const assertContained = ({ pathService, root, absolutePath, label }: ContainmentRequest): void => {
  const relative = pathService.relative(root, absolutePath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${pathService.sep}`) || pathService.isAbsolute(relative)) {
    throw targetFailure({ code: "outside-root", targetPath: label, message: `Artifact path escapes the canonical scope root: ${label}` });
  }
};

const resolveTarget = ({ pathService, root, relativePath }: ResolveTargetRequest): string => {
  const absolutePath = pathService.resolve(root, relativePath);
  assertContained({ pathService, root, absolutePath, label: relativePath });

  return absolutePath;
};

const inspectNode = ({ context, absolutePath, relativePath }: TargetPathRequest): Effect.Effect<NodePresence, ArtifactTargetError> => {
  return Effect.gen(function* () {
    assertContained({ pathService: context.path, root: context.root, absolutePath, label: relativePath });
    const relative = context.path.relative(context.root, absolutePath);
    const components = relative.split(context.path.sep).filter((component) => component.length > 0);
    let currentPath = context.root;

    // Inspect every component in order because stat follows symlinks and cannot detect a linked ancestor.
    for (const [index, component] of components.entries()) {
      currentPath = context.path.join(currentPath, component);
      const linkProbe = yield* context.fileSystem.readLink(currentPath).pipe(
        Effect.as("link"),
        Effect.catchAll((cause) => {
          if (isNotFound(cause)) {
            return Effect.succeed("missing");
          }

          if (isNotLink(cause)) {
            return Effect.succeed("notLink");
          }

          return Effect.fail(
            targetFailure({
              code: "link-inspection-failed",
              targetPath: relativePath,
              message: `Unable to prove that ${relativePath} is not a symbolic link.`,
              cause,
            }),
          );
        }),
      );
      if (linkProbe === "link") {
        return yield* Effect.fail(
          targetFailure({
            code: "symbolic-link",
            targetPath: relativePath,
            message: `Artifact targets and their ancestors cannot be symbolic links: ${relativePath}`,
          }),
        );
      }

      if (linkProbe === "missing") {
        return missingState;
      }

      const targetMetadata = yield* context.fileSystem.stat(currentPath).pipe(
        Effect.catchAll((cause) => {
          if (isNotFound(cause)) {
            return Effect.succeed(undefined);
          }

          return Effect.fail(
            targetFailure({
              code: "stat-failed",
              targetPath: relativePath,
              message: `Unable to inspect artifact target ${relativePath}.`,
              cause,
            }),
          );
        }),
      );
      if (targetMetadata === undefined) {
        return missingState;
      }

      const isFinal = index === components.length - 1;
      if (!isFinal && targetMetadata.type !== "Directory") {
        return yield* Effect.fail(
          targetFailure({
            code: "invalid-ancestor",
            targetPath: relativePath,
            message: `Every artifact target ancestor must be a directory: ${relativePath}`,
          }),
        );
      }

      if (isFinal) {
        const presence: PresentNode = {
          _tag: "present",
          type: targetMetadata.type,
          mode: targetMetadata.mode & 0o7777,
        };

        return presence;
      }
    }

    return yield* Effect.fail(
      targetFailure({
        code: "invalid-target",
        targetPath: relativePath,
        message: `Artifact target cannot equal its scope root: ${relativePath}`,
      }),
    );
  });
};

const readTargetState = ({ context, absolutePath, relativePath }: TargetPathRequest) => {
  // Read a target only after proving its type, then reject any metadata race around the byte read.
  return Effect.gen(function* () {
    // 1. Inspect every target component without following a symbolic link.
    const presence = yield* inspectNode({ context, absolutePath, relativePath });
    if (presence._tag === "missing") {
      return missingState;
    }

    // 2. Reject an existing non-file target through the typed failure channel.
    if (presence.type !== "File") {
      return yield* Effect.fail(
        targetFailure({
          code: "invalid-target-type",
          targetPath: relativePath,
          message: `Artifact targets must be regular files or missing: ${relativePath}`,
        }),
      );
    }

    // 3. Read the bytes only after the target is proven to be a regular file.
    const value = yield* context.fileSystem.readFile(absolutePath).pipe(
      Effect.mapError((cause) =>
        targetFailure({
          code: "read-failed",
          targetPath: relativePath,
          message: `Unable to read artifact target ${relativePath}.`,
          cause,
        }),
      ),
    );
    // 4. Inspect again so the returned bytes stay bound to the proven file metadata.
    const confirmed = yield* inspectNode({ context, absolutePath, relativePath });
    // 5. Reject replacement, removal, or mode changes observed around the read.
    if (confirmed._tag === "missing" || confirmed.type !== "File" || confirmed.mode !== presence.mode) {
      return yield* Effect.fail(
        targetFailure({
          code: "target-raced",
          targetPath: relativePath,
          message: `Artifact target changed while it was being read: ${relativePath}`,
        }),
      );
    }

    const targetState: FileState = {
      _tag: "file",
      bytes: value,
      sha256: sha256Bytes(value),
      mode: presence.mode,
    };

    return targetState;
  });
};

const canonicalReceiptBytes = (plan: ArtifactPlan): Uint8Array => {
  if (plan.receipt._tag !== "publishReceipt") {
    throw new Error("Receipt bytes are available only for a published receipt.");
  }

  return new TextEncoder().encode(Schema.encodeSync(artifactReceiptJsonSchema)(plan.receipt.value));
};

const observationRequiredState = (observation: ArtifactObservation): RequiredState => {
  if (observation.snapshot._tag === "missing") {
    return missingState;
  }

  return {
    _tag: "file",
    bytes: observation.snapshot.bytes,
    sha256: observation.snapshot.sha256,
  };
};

const buildTargetSpecs = ({ plan, root, pathService }: BuildTargetSpecsRequest) => {
  const specs = new Map<string, TargetSpec>();
  for (const observation of plan.authority.observations) {
    specs.set(observation.path, {
      path: observation.path,
      absolutePath: resolveTarget({ pathService, root, relativePath: observation.path }),
      required: observationRequiredState(observation),
      role: "artifact",
    });
  }

  if (plan.authority._tag === "legacyManifest") {
    specs.set(plan.authority.manifestPath, {
      path: plan.authority.manifestPath,
      absolutePath: resolveTarget({ pathService, root, relativePath: plan.authority.manifestPath }),
      required: {
        _tag: "file",
        bytes: plan.authority.manifestBytes,
        sha256: plan.authority.manifestSha256,
      },
      role: "legacyManifest",
    });
  }

  // Bind each semantic operation to the exact authority-backed target already in the map.
  for (const operation of plan.operations) {
    const spec = specs.get(operation.path);
    if (spec === undefined) {
      throw targetFailure({
        code: "missing-authority",
        targetPath: operation.path,
        message: `No live authority snapshot covers ${operation.path}.`,
      });
    }

    spec.mutation = operation._tag === "write" ? { _tag: "write", bytes: operation.bytes } : { _tag: "remove" };
  }

  const receiptAbsolutePath = resolveTarget({ pathService, root, relativePath: plan.receipt.path });
  const receiptSeparator = plan.receipt.path.lastIndexOf("/");
  const recoveryRelativePath = `${receiptSeparator < 0 ? "" : plan.receipt.path.slice(0, receiptSeparator + 1)}recovery.json`;
  if (plan.receipt.path === recoveryRelativePath) {
    throw targetFailure({
      code: "recovery-path-collision",
      targetPath: plan.receipt.path,
      message: `The receipt cannot occupy the reserved recovery record path: ${recoveryRelativePath}.`,
    });
  }
  const recoveryCollision = [...specs.keys()].find((candidate) => {
    return (
      candidate === recoveryRelativePath ||
      candidate.startsWith(`${recoveryRelativePath}/`) ||
      recoveryRelativePath.startsWith(`${candidate}/`)
    );
  });
  if (recoveryCollision !== undefined) {
    throw targetFailure({
      code: "recovery-path-collision",
      targetPath: recoveryCollision,
      message: `Artifact ownership conflicts with the reserved recovery record path: ${recoveryRelativePath}.`,
    });
  }

  const receiptRequired: RequiredState =
    plan.authority._tag === "receipt"
      ? {
          _tag: "file",
          bytes: new TextEncoder().encode(Schema.encodeSync(artifactReceiptJsonSchema)(plan.authority.receipt)),
          sha256: plan.authority.receiptSha256,
        }
      : missingState;
  specs.set(plan.receipt.path, {
    path: plan.receipt.path,
    absolutePath: receiptAbsolutePath,
    required: receiptRequired,
    role: "receipt",
    mutation: plan.receipt._tag === "publishReceipt" ? { _tag: "write", bytes: canonicalReceiptBytes(plan) } : { _tag: "remove" },
  });

  return {
    specs,
    recoveryRelativePath,
    recoveryPath: resolveTarget({ pathService, root, relativePath: recoveryRelativePath }),
  };
};

const ensureRecoveryPathMissing = ({ context, recoveryPath, recoveryRelativePath }: RecoveryPathRequest) => {
  return inspectNode({ context, absolutePath: recoveryPath, relativePath: recoveryRelativePath }).pipe(
    Effect.flatMap((presence) => {
      if (presence._tag === "missing") {
        return Effect.void;
      }

      return Effect.fail(
        targetFailure({
          code: "recovery-exists",
          targetPath: recoveryRelativePath,
          message: `Existing recovery evidence must be resolved before another transaction: ${recoveryRelativePath}`,
        }),
      );
    }),
  );
};

const createWorkspace = (context: WriterContext) => {
  return context.fileSystem
    .makeTempDirectory({
      directory: context.root,
      prefix: ".dufflebag-transaction-",
    })
    .pipe(
      Effect.mapError((cause) =>
        transactionFailure({
          state: "unchanged",
          phase: "snapshot",
          message: "Unable to create a durable transaction workspace.",
          cause,
        }),
      ),
      Effect.flatMap((workspacePath) => {
        const normalizeWorkspace = Effect.sync(() => {
          assertContained({ pathService: context.path, root: context.root, absolutePath: workspacePath, label: workspacePath });
        }).pipe(Effect.zipRight(context.fileSystem.chmod(workspacePath, privateDirectoryMode)));

        return Effect.matchCauseEffect(normalizeWorkspace, {
          onFailure: (normalizationCause) => {
            return Effect.matchCauseEffect(context.fileSystem.remove(workspacePath, { recursive: true, force: true }), {
              onFailure: (cleanupCause) =>
                Effect.fail(
                  transactionFailure({
                    state: "unchanged",
                    phase: "cleanup",
                    message: "Workspace initialization failed and its directory could not be removed.",
                    cause: cleanupCause,
                  }),
                ),
              onSuccess: () =>
                Effect.fail(
                  transactionFailure({
                    state: "unchanged",
                    phase: "snapshot",
                    message: "Unable to normalize the durable transaction workspace.",
                    cause: normalizationCause,
                  }),
                ),
            });
          },
          onSuccess: () => Effect.succeed(workspacePath),
        });
      }),
    );
};

const writeVerifiedPrivateFile = ({ fileSystem, targetPath, value }: WritePrivateFileRequest) => {
  // Persist private transaction evidence exclusively, normalize its mode, and verify exact bytes.
  return Effect.gen(function* () {
    // 1. Create the evidence file without replacing an existing path.
    yield* fileSystem.writeFile(targetPath, value, { flag: "wx", mode: privateFileMode });
    // 2. Normalize permissions independently of the process umask.
    yield* fileSystem.chmod(targetPath, privateFileMode);
    // 3. Read back the newly written evidence.
    const written = yield* fileSystem.readFile(targetPath);
    // 4. Fail before publication when persisted bytes differ.
    if (!bytesEqual(written, value)) {
      return yield* Effect.fail(new Error(`Written bytes did not verify at ${targetPath}.`));
    }
  });
};

const snapshotTargets = ({ context, specs, workspacePath }: SnapshotTargetsRequest) => {
  // Create the private snapshot store before capturing every authority-bound target in stable order.
  return Effect.gen(function* () {
    const snapshotDirectory = context.path.join(workspacePath, "snapshots");
    assertContained({ pathService: context.path, root: context.root, absolutePath: snapshotDirectory, label: snapshotDirectory });
    // 1. Create the dedicated durable snapshot directory.
    yield* context.fileSystem.makeDirectory(snapshotDirectory, { mode: privateDirectoryMode });
    // 2. Normalize directory permissions independently of the process umask.
    yield* context.fileSystem.chmod(snapshotDirectory, privateDirectoryMode);
    const snapshots = new Map<string, Snapshot>();
    let snapshotNumber = 0;

    // 3. Snapshot sequentially so the durable index and later rollback use one deterministic target order.
    for (const spec of specs.values()) {
      const first = yield* readTargetState({ context, absolutePath: spec.absolutePath, relativePath: spec.path });
      if (!requiredStateMatches(spec.required, first)) {
        return yield* Effect.fail(
          targetFailure({
            code: "authority-changed",
            targetPath: spec.path,
            message: `Live target bytes no longer match the validated authority for ${spec.path}.`,
          }),
        );
      }

      let snapshotPath: string | undefined;
      if (first._tag === "file") {
        snapshotPath = context.path.join(snapshotDirectory, `${String(snapshotNumber).padStart(4, "0")}.bin`);
        assertContained({ pathService: context.path, root: context.root, absolutePath: snapshotPath, label: snapshotPath });
        yield* writeVerifiedPrivateFile({ fileSystem: context.fileSystem, targetPath: snapshotPath, value: first.bytes });
        snapshotNumber += 1;
      }

      const confirmed = yield* readTargetState({ context, absolutePath: spec.absolutePath, relativePath: spec.path });
      if (!stateEquals(first, confirmed)) {
        return yield* Effect.fail(
          targetFailure({ code: "snapshot-raced", targetPath: spec.path, message: `Target changed while snapshotting ${spec.path}.` }),
        );
      }

      const expectedAfter: TargetState =
        spec.mutation?._tag === "write"
          ? {
              _tag: "file",
              bytes: spec.mutation.bytes,
              sha256: sha256Bytes(spec.mutation.bytes),
              mode: first._tag === "file" ? first.mode : defaultFileMode,
            }
          : spec.mutation?._tag === "remove"
            ? missingState
            : first;
      snapshots.set(spec.path, {
        ...spec,
        original: first,
        expectedAfter,
        ...(snapshotPath === undefined ? {} : { snapshotPath }),
      });
    }

    return snapshots;
  });
};

const indexOriginalState = (snapshot: Snapshot): IndexOriginalState => {
  if (snapshot.original._tag === "missing") {
    return missingState;
  }

  if (snapshot.snapshotPath === undefined) {
    throw new Error(`Snapshot path is missing for ${snapshot.path}.`);
  }

  return {
    _tag: "file",
    sha256: snapshot.original.sha256,
    mode: snapshot.original.mode,
    snapshotPath: snapshot.snapshotPath,
  };
};

const indexExpectedState = (snapshot: Snapshot): IndexExpectedState => {
  if (snapshot.expectedAfter._tag === "missing") {
    return missingState;
  }

  return {
    _tag: "file",
    sha256: snapshot.expectedAfter.sha256,
    mode: snapshot.expectedAfter.mode,
  };
};

const writeSnapshotIndex = (prepared: Omit<PreparedTransaction, "stages" | "receiptSnapshot">, phase: "snapshotted" | "staged") => {
  // Publish one verified snapshot index after acquiring services and before later transaction phases consume it.
  return Effect.gen(function* () {
    // 1. Acquire the official filesystem service used for durable publication.
    const fileSystem = yield* FileSystem.FileSystem;
    // 2. Acquire native path semantics for the root-contained temporary path.
    const pathService = yield* Path.Path;
    const value = Schema.validateSync(
      snapshotIndexSchema,
      strictParseOptions,
    )({
      version: 1,
      transactionId: prepared.transactionId,
      phase,
      root: prepared.root,
      receiptPath: prepared.plan.receipt.path,
      workspacePath: prepared.workspacePath,
      createdDirectories: prepared.createdDirectories,
      mutationOrder: [...prepared.ordinaryOperations.map((operation) => operation.path), prepared.plan.receipt.path],
      entries: [...prepared.snapshots.values()].map((snapshot) => ({
        path: snapshot.path,
        absolutePath: snapshot.absolutePath,
        role: snapshot.role,
        original: indexOriginalState(snapshot),
        expectedAfter: indexExpectedState(snapshot),
      })),
    });
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    const temporaryPath = pathService.join(prepared.workspacePath, `snapshot-index-${phase}.tmp`);
    assertContained({ pathService, root: prepared.root, absolutePath: temporaryPath, label: temporaryPath });
    // 3. Write and verify a private sibling before publication.
    yield* writeVerifiedPrivateFile({ fileSystem, targetPath: temporaryPath, value: encoded });
    // 4. Atomically publish the new phase index.
    yield* fileSystem.rename(temporaryPath, prepared.indexPath);
    // 5. Read back the published index.
    const persisted = yield* fileSystem.readFile(prepared.indexPath);
    // 6. Reject a publication whose exact bytes changed.
    if (!bytesEqual(persisted, encoded)) {
      return yield* Effect.fail(new Error("The durable snapshot index did not verify after publication."));
    }
  });
};

const ensureParentDirectory = ({ context, targetPath, createdDirectories }: ParentDirectoryRequest) => {
  return Effect.gen(function* () {
    const transactionDirectories = createdDirectories;
    const parentPath = context.path.dirname(targetPath);
    const relativeParent = context.path.relative(context.root, parentPath);
    const components = relativeParent.split(context.path.sep).filter((component) => component.length > 0);
    let currentPath = context.root;

    // Create one component at a time so cleanup can remove only directories created by this transaction.
    for (const component of components) {
      currentPath = context.path.join(currentPath, component);
      const relative = context.path.relative(context.root, currentPath);
      const presence = yield* inspectNode({ context, absolutePath: currentPath, relativePath: relative });
      if (presence._tag === "missing") {
        transactionDirectories.push(currentPath);
        yield* context.fileSystem.makeDirectory(currentPath);
        continue;
      }

      if (presence.type !== "Directory") {
        return yield* Effect.fail(
          targetFailure({
            code: "invalid-parent",
            targetPath: relative,
            message: `A staged artifact parent is not a directory: ${relative}`,
          }),
        );
      }
    }
  });
};

const createStage = ({ context, snapshot, transactionId, ordinal, stages }: CreateStageRequest) => {
  // Prove a unique sibling is absent, write the intended bytes, and verify the complete staged state.
  return Effect.gen(function* () {
    const transactionStages = stages;
    if (snapshot.expectedAfter._tag !== "file") {
      throw new Error(`Cannot stage a missing target: ${snapshot.path}`);
    }

    const parentPath = context.path.dirname(snapshot.absolutePath);
    const stagePath = context.path.join(parentPath, `.${context.path.basename(snapshot.absolutePath)}.${transactionId}.${ordinal}.stage`);
    assertContained({ pathService: context.path, root: context.root, absolutePath: stagePath, label: stagePath });
    const stageRelativePath = context.path.relative(context.root, stagePath);
    // 1. Inspect the complete sibling path without following links.
    const stagePresence = yield* inspectNode({ context, absolutePath: stagePath, relativePath: stageRelativePath });
    // 2. Reject any collision before exclusive creation.
    if (stagePresence._tag !== "missing") {
      return yield* Effect.fail(
        targetFailure({
          code: "stage-exists",
          targetPath: snapshot.path,
          message: `Exclusive stage path already exists for ${snapshot.path}.`,
        }),
      );
    }

    const stage = {
      path: stagePath,
      absolutePath: snapshot.absolutePath,
      bytes: snapshot.expectedAfter.bytes,
      mode: snapshot.expectedAfter.mode,
      cleanupModes: new Set([snapshot.expectedAfter.mode]),
    } satisfies Stage;
    transactionStages.set(snapshot.path, stage);
    // 3. Create the same-directory stage without replacing another writer's path.
    yield* context.fileSystem.writeFile(stagePath, snapshot.expectedAfter.bytes, {
      flag: "wx",
      mode: snapshot.expectedAfter.mode,
    });
    // 4. Capture the exact effective mode before normalization so failed cleanup can prove ownership.
    const provisional = yield* readTargetState({ context, absolutePath: stagePath, relativePath: stageRelativePath });
    // 5. Refuse cleanup ownership when the exclusive write did not persist the planned bytes.
    if (provisional._tag !== "file" || !bytesEqual(provisional.bytes, snapshot.expectedAfter.bytes)) {
      return yield* Effect.fail(
        targetFailure({
          code: "stage-verification-failed",
          targetPath: snapshot.path,
          message: `Staged bytes did not verify for ${snapshot.path}.`,
        }),
      );
    }
    stage.cleanupModes.add(provisional.mode);
    // 6. Preserve the target mode independently of the process umask.
    yield* context.fileSystem.chmod(stagePath, snapshot.expectedAfter.mode);
    // 7. Read the staged bytes and metadata through the same safe target boundary.
    const staged = yield* readTargetState({ context, absolutePath: stagePath, relativePath: stageRelativePath });
    // 8. Reject a stage that does not equal the planned post-mutation state.
    if (!stateEquals(staged, snapshot.expectedAfter)) {
      return yield* Effect.fail(
        targetFailure({
          code: "stage-verification-failed",
          targetPath: snapshot.path,
          message: `Staged bytes did not verify for ${snapshot.path}.`,
        }),
      );
    }

    return stage;
  });
};

const stageWrites = ({ context, snapshots, operations, receiptPath, transactionId, stages, createdDirectories }: StageWritesRequest) => {
  return Effect.gen(function* () {
    const writePaths = [
      ...operations.filter((operation) => operation._tag === "write").map((operation) => operation.path),
      ...(snapshots.get(receiptPath)?.expectedAfter._tag === "file" ? [receiptPath] : []),
    ];

    // Stage in semantic operation order, with the receipt staged last but still committed separately.
    for (const [ordinal, targetPath] of writePaths.entries()) {
      const snapshot = snapshots.get(targetPath);
      if (snapshot === undefined) {
        return yield* Effect.fail(
          targetFailure({ code: "snapshot-missing", targetPath, message: `No captured snapshot exists for ${targetPath}.` }),
        );
      }

      yield* ensureParentDirectory({ context, targetPath: snapshot.absolutePath, createdDirectories });
      yield* createStage({ context, snapshot, transactionId, ordinal, stages });
    }
  });
};

const verifyState = ({ context, snapshot, expected }: VerifyStateRequest) => {
  return readTargetState({ context, absolutePath: snapshot.absolutePath, relativePath: snapshot.path }).pipe(
    Effect.flatMap((current) => {
      if (stateEquals(current, expected)) {
        return Effect.void;
      }

      return Effect.fail(
        targetFailure({ code: "target-raced", targetPath: snapshot.path, message: `Target state changed unexpectedly: ${snapshot.path}` }),
      );
    }),
  );
};

const stageMatches = (context: WriterContext, stage: Stage) => {
  const relativePath = context.path.relative(context.root, stage.path);
  return readTargetState({ context, absolutePath: stage.path, relativePath }).pipe(
    Effect.map((current) => {
      if (current._tag === "missing") {
        const ownership: StageOwnership = "missing";

        return ownership;
      }

      const expected: FileState = {
        _tag: "file",
        bytes: stage.bytes,
        sha256: sha256Bytes(stage.bytes),
        mode: stage.mode,
      };

      const ownership: StageOwnership = stateEquals(current, expected) ? "owned" : "unknown";

      return ownership;
    }),
  );
};

const disposableStageMatches = (context: WriterContext, stage: Stage) => {
  const relativePath = context.path.relative(context.root, stage.path);
  return readTargetState({ context, absolutePath: stage.path, relativePath }).pipe(
    Effect.map((current) => {
      if (current._tag === "missing") {
        const ownership: StageOwnership = "missing";

        return ownership;
      }

      const ownedBytes = current.sha256 === sha256Bytes(stage.bytes) && bytesEqual(current.bytes, stage.bytes);
      const ownership: StageOwnership = ownedBytes && stage.cleanupModes.has(current.mode) ? "owned" : "unknown";

      return ownership;
    }),
  );
};

const mutateSnapshot = ({ context, snapshot, stage }: MutateSnapshotRequest) => {
  if (snapshot.expectedAfter._tag === "file") {
    if (stage === undefined) {
      return Effect.fail(
        targetFailure({ code: "stage-missing", targetPath: snapshot.path, message: `No verified stage exists for ${snapshot.path}.` }),
      );
    }

    return stageMatches(context, stage).pipe(
      Effect.flatMap((ownership) => {
        if (ownership !== "owned") {
          return Effect.fail(
            targetFailure({
              code: "stage-raced",
              targetPath: snapshot.path,
              message: `Staged bytes changed before commit for ${snapshot.path}.`,
            }),
          );
        }

        return context.fileSystem.rename(stage.path, snapshot.absolutePath).pipe(
          Effect.mapError((cause) =>
            targetFailure({
              code: "write-commit-failed",
              targetPath: snapshot.path,
              message: `Unable to commit staged bytes for ${snapshot.path}.`,
              cause,
            }),
          ),
        );
      }),
    );
  }

  return context.fileSystem
    .remove(snapshot.absolutePath)
    .pipe(
      Effect.mapError((cause) =>
        targetFailure({ code: "remove-commit-failed", targetPath: snapshot.path, message: `Unable to remove ${snapshot.path}.`, cause }),
      ),
    );
};

const restoreSnapshot = ({ context, prepared, snapshot }: RestoreSnapshotRequest) => {
  // Restore only a target still equal to the transaction state, using verified durable bytes and an atomic sibling rename.
  return Effect.gen(function* () {
    const restoreStages = prepared.restoreStages;
    // 1. Read the live target before deciding whether rollback may touch it.
    const current = yield* readTargetState({ context, absolutePath: snapshot.absolutePath, relativePath: snapshot.path });
    if (stateEquals(current, snapshot.original)) {
      return;
    }

    // 2. Preserve an unknown racing writer instead of overwriting it.
    if (!stateEquals(current, snapshot.expectedAfter)) {
      return yield* Effect.fail(new Error(`Current bytes match neither the original nor transaction state for ${snapshot.path}.`));
    }

    // 3. Restore an originally missing path only after repeated transaction-state checks.
    if (snapshot.original._tag === "missing") {
      yield* verifyState({ context, snapshot, expected: snapshot.expectedAfter });
      yield* context.fileSystem.remove(snapshot.absolutePath);
      yield* verifyState({ context, snapshot, expected: snapshot.original });
      return;
    }

    // 4. Reject an impossible file snapshot that lacks durable evidence.
    if (snapshot.snapshotPath === undefined) {
      return yield* Effect.fail(new Error(`Durable original bytes are missing for ${snapshot.path}.`));
    }

    const original = snapshot.original;

    // 5. Read the retained original bytes from the transaction workspace.
    const snapshotBytes = yield* context.fileSystem.readFile(snapshot.snapshotPath);
    // 6. Verify the durable snapshot before it can become restoration input.
    if (sha256Bytes(snapshotBytes) !== original.sha256 || !bytesEqual(snapshotBytes, original.bytes)) {
      return yield* Effect.fail(new Error(`Durable snapshot verification failed for ${snapshot.path}.`));
    }

    const restorePath = context.path.join(
      context.path.dirname(snapshot.absolutePath),
      `.${context.path.basename(snapshot.absolutePath)}.${prepared.transactionId}.${restoreStages.length}.restore`,
    );
    assertContained({ pathService: context.path, root: context.root, absolutePath: restorePath, label: restorePath });
    const restoreStage: Stage = {
      path: restorePath,
      absolutePath: snapshot.absolutePath,
      bytes: snapshotBytes,
      mode: original.mode,
      cleanupModes: new Set([original.mode]),
    };
    restoreStages.push(restoreStage);

    // 7. Create, verify, and publish the restore sibling while removing exact owned bytes after any failed step.
    return yield* Effect.gen(function* () {
      // 1. Create a unique same-directory restore stage.
      yield* context.fileSystem.writeFile(restorePath, snapshotBytes, {
        flag: "wx",
        mode: original.mode,
      });
      // 2. Capture the effective mode created under the caller's umask.
      const provisional = yield* readTargetState({
        context,
        absolutePath: restorePath,
        relativePath: context.path.relative(context.root, restorePath),
      });
      // 3. Refuse cleanup ownership when the exclusive write did not persist the durable snapshot bytes.
      if (provisional._tag !== "file" || !bytesEqual(provisional.bytes, snapshotBytes)) {
        return yield* Effect.fail(new Error(`Restore sibling bytes did not verify for ${snapshot.path}.`));
      }
      restoreStage.cleanupModes.add(provisional.mode);
      // 4. Restore the exact captured mode on the sibling.
      yield* context.fileSystem.chmod(restorePath, original.mode);
      // 5. Recheck that no racing writer replaced the transaction state during staging.
      yield* verifyState({ context, snapshot, expected: snapshot.expectedAfter });
      // 6. Atomically replace the transaction state with the restored sibling.
      yield* context.fileSystem.rename(restorePath, snapshot.absolutePath);
      // 7. Verify the complete original state after restoration.
      yield* verifyState({ context, snapshot, expected: snapshot.original });
    }).pipe(
      Effect.onError(() => {
        return removeDisposableStages(context, [restoreStage]).pipe(Effect.catchAll(() => Effect.void));
      }),
    );
  });
};

const rollbackJournal = ({ context, prepared, journal }: RollbackJournalRequest) => {
  return Effect.gen(function* () {
    const failures: Array<RollbackFailure> = [];

    // Restore in reverse mutation order and continue after failures so one damaged target does not strand the rest.
    for (const snapshot of [...journal].reverse()) {
      const exit = yield* Effect.exit(restoreSnapshot({ context, prepared, snapshot }));
      if (exit._tag === "Failure") {
        failures.push({
          path: snapshot.path,
          message: `Unable to restore ${snapshot.path}: ${String(exit.cause)}`,
        });
      }
    }

    return failures;
  });
};

const removeDisposableStages = (context: WriterContext, stages: Iterable<Stage>) => {
  return Effect.gen(function* () {
    // Remove only verified transaction-owned siblings, stopping before any raced path can be touched.
    for (const stage of stages) {
      const ownership = yield* disposableStageMatches(context, stage);
      if (ownership === "missing") {
        continue;
      }

      if (ownership === "unknown") {
        return yield* Effect.fail(new Error(`Refusing to remove a raced staging path: ${stage.path}`));
      }

      yield* context.fileSystem.remove(stage.path);
    }
  });
};

const removeCreatedEmptyDirectories = (context: WriterContext, createdDirectories: ReadonlyArray<string>) => {
  return Effect.gen(function* () {
    const ordered = [...createdDirectories].sort((left, right) => right.length - left.length);
    // Walk deepest-first so a newly empty child can make its transaction-created parent removable.
    for (const directory of ordered) {
      const entries = yield* context.fileSystem.readDirectory(directory).pipe(
        Effect.catchAll((cause) => {
          if (isNotFound(cause)) {
            return Effect.succeed([]);
          }

          return Effect.fail(cause);
        }),
      );
      if (entries.length === 0) {
        yield* context.fileSystem.remove(directory, { recursive: true }).pipe(
          Effect.catchAll((cause) => {
            if (isNotFound(cause)) {
              return Effect.void;
            }

            return Effect.fail(cause);
          }),
        );
      }
    }
  });
};

const cleanupPreparation = ({ context, workspacePath, stages, createdDirectories }: PreparationCleanupRequest) => {
  // Attempt every disposable cleanup in dependency order, then surface the first retained cleanup failure.
  return Effect.gen(function* () {
    // 1. Remove only sibling stages whose exact transaction bytes still match.
    const stageCleanup = yield* Effect.exit(removeDisposableStages(context, stages));
    // 2. Remove durable preparation evidence after stage cleanup was attempted.
    const workspaceCleanup = yield* Effect.exit(context.fileSystem.remove(workspacePath, { recursive: true, force: true }));
    // 3. Prune only empty parent directories created by this preparation.
    const directoryCleanup = yield* Effect.exit(removeCreatedEmptyDirectories(context, createdDirectories));
    // 4. Preserve a failed stage-cleanup cause after every safe cleanup action was attempted.
    if (stageCleanup._tag === "Failure") {
      return yield* Effect.failCause(stageCleanup.cause);
    }
    // 5. Preserve a failed workspace-cleanup cause when all stage cleanup completed.
    if (workspaceCleanup._tag === "Failure") {
      return yield* Effect.failCause(workspaceCleanup.cause);
    }
    // 6. Preserve a failed directory-cleanup cause after earlier cleanup completed.
    if (directoryCleanup._tag === "Failure") {
      return yield* Effect.failCause(directoryCleanup.cause);
    }
  });
};

const cleanupTransaction = (context: WriterContext, prepared: PreparedTransaction) => {
  // Remove verified siblings, then durable evidence, then only empty directories created by this transaction.
  return Effect.gen(function* () {
    // 1. Remove only disposable stage paths still proven transaction-owned.
    yield* removeDisposableStages(context, [...prepared.stages.values(), ...prepared.restoreStages]);
    // 2. Remove durable transaction evidence after commit or complete rollback.
    yield* context.fileSystem.remove(prepared.workspacePath, { recursive: true });
    // 3. Prune only transaction-created directories that remain empty.
    yield* removeCreatedEmptyDirectories(context, prepared.createdDirectories);
  });
};

const conciseFailure = (failure: RollbackFailure): string => {
  const summary = `${failure.path}: ${failure.message}`;

  return summary.length <= 400 ? summary : `${summary.slice(0, 397)}...`;
};

const writeRecoveryRecord = ({ context, prepared, phase, rollbackFailures }: WriteRecoveryRecordRequest) => {
  // Publish strict recovery evidence atomically only after ensuring its parent and verifying exact serialized bytes.
  return Effect.gen(function* () {
    const unrecoveredPaths = [...new Set(rollbackFailures.map((failure) => failure.path))];
    const snapshots = unrecoveredPaths.map((targetPath) => {
      const snapshot = prepared.snapshots.get(targetPath);
      if (snapshot === undefined) {
        throw new Error(`Missing recovery snapshot for ${targetPath}.`);
      }

      return {
        path: targetPath,
        original: indexOriginalState(snapshot),
      };
    });
    const value = Schema.validateSync(
      recoveryRecordSchema,
      strictParseOptions,
    )({
      version: 1,
      transactionId: prepared.transactionId,
      phase,
      root: prepared.root,
      receiptPath: prepared.plan.receipt.path,
      workspacePath: prepared.workspacePath,
      indexPath: prepared.indexPath,
      unrecoveredPaths,
      snapshots,
      failures: rollbackFailures.map(conciseFailure),
    });
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    const temporaryPath = context.path.join(context.path.dirname(prepared.recoveryPath), `.recovery.${prepared.transactionId}.stage`);
    assertContained({ pathService: context.path, root: context.root, absolutePath: temporaryPath, label: temporaryPath });
    // 1. Ensure the reserved recovery parent exists and record only directories this transaction creates.
    yield* ensureParentDirectory({
      context,
      targetPath: prepared.recoveryPath,
      createdDirectories: prepared.createdDirectories,
    });
    // 2. Write and verify the complete record to a private same-directory sibling.
    yield* writeVerifiedPrivateFile({ fileSystem: context.fileSystem, targetPath: temporaryPath, value: encoded });
    // 3. Atomically publish the recovery record at its reserved path.
    yield* context.fileSystem.rename(temporaryPath, prepared.recoveryPath);
    // 4. Read back the published recovery evidence.
    const persisted = yield* context.fileSystem.readFile(prepared.recoveryPath);
    // 5. Reject any publication that does not preserve the encoded record exactly.
    if (!bytesEqual(persisted, encoded)) {
      return yield* Effect.fail(new Error("Recovery record bytes did not verify after publication."));
    }
  });
};

const recoveryRequired = ({ context, prepared, phase, rollbackFailures, cause }: RecoveryRequiredRequest) => {
  return Effect.gen(function* () {
    const recoveryExit = yield* Effect.exit(writeRecoveryRecord({ context, prepared, phase, rollbackFailures }));
    const recoveryRecordStatus: "published" | "failed" = recoveryExit._tag === "Success" ? "published" : "failed";
    const extraFailure = recoveryExit._tag === "Failure" ? [`recovery.json: ${String(recoveryExit.cause)}`] : [];

    return yield* Effect.fail(
      new ArtifactRecoveryRequiredError({
        phase,
        message: "The artifact transaction could not restore every target; durable recovery evidence was retained.",
        workspacePath: prepared.workspacePath,
        indexPath: prepared.indexPath,
        recoveryPath: prepared.recoveryPath,
        recoveryRecordStatus,
        unrecoveredPaths: [...new Set(rollbackFailures.map((failure) => failure.path))],
        failures: [...rollbackFailures.map(conciseFailure), ...extraFailure],
        cause,
      }),
    );
  });
};

const handleCommitFailure = ({ context, prepared, journal, phase, cause }: HandleCommitFailureRequest) => {
  // Classify the observed commit state, roll back journaled targets, and retain evidence when restoration is incomplete.
  return Effect.gen(function* () {
    // 1. Clean an artifact failure that occurred before the first target mutation.
    if (phase === "artifact" && journal.length === 0) {
      const cleanupExit = yield* Effect.exit(cleanupTransaction(context, prepared));

      return yield* Effect.fail(
        transactionFailure({
          state: "unchanged",
          phase: cleanupExit._tag === "Success" ? phase : "cleanup",
          message:
            cleanupExit._tag === "Success"
              ? "The artifact transaction stopped before its first target mutation."
              : "The artifact transaction made no target mutation, but disposable cleanup failed.",
          cause: cleanupExit._tag === "Success" ? cause : cleanupExit.cause,
        }),
      );
    }

    // 2. Resolve a delegated receipt failure by inspecting whether the commit point was reached.
    if (phase === "receipt") {
      const receiptInspection = yield* Effect.exit(
        readTargetState({
          context,
          absolutePath: prepared.receiptSnapshot.absolutePath,
          relativePath: prepared.receiptSnapshot.path,
        }),
      );
      if (receiptInspection._tag === "Failure") {
        return yield* recoveryRequired({
          context,
          prepared,
          phase: "receipt",
          rollbackFailures: [
            { path: prepared.receiptSnapshot.path, message: "Receipt state could not be safely inspected after delegated mutation." },
          ],
          cause: receiptInspection.cause,
        });
      }

      const receiptCurrent = receiptInspection.value;
      if (stateEquals(receiptCurrent, prepared.receiptSnapshot.expectedAfter)) {
        const cleanupExit = yield* Effect.exit(cleanupTransaction(context, prepared));

        return yield* Effect.fail(
          transactionFailure({
            state: "committed",
            phase: cleanupExit._tag === "Success" ? "receipt" : "cleanup",
            message: "The receipt disposition reached its committed state even though the delegated operation reported failure.",
            cause: cleanupExit._tag === "Success" ? cause : cleanupExit.cause,
          }),
        );
      }

      if (!stateEquals(receiptCurrent, prepared.receiptSnapshot.original)) {
        return yield* recoveryRequired({
          context,
          prepared,
          phase: "receipt",
          rollbackFailures: [
            { path: prepared.receiptSnapshot.path, message: "Receipt state matches neither the original nor committed disposition." },
          ],
          cause,
        });
      }
    }

    // 3. Restore every journaled mutation in reverse order.
    const rollbackFailures = yield* rollbackJournal({ context, prepared, journal });
    // 4. Publish recovery evidence instead of hiding an incomplete rollback.
    if (rollbackFailures.length > 0) {
      return yield* recoveryRequired({ context, prepared, phase: "rollback", rollbackFailures, cause });
    }

    // 5. Remove disposable state only after every target is restored.
    const cleanupExit = yield* Effect.exit(cleanupTransaction(context, prepared));
    // 6. Report the rolled-back state while preserving any cleanup failure.
    return yield* Effect.fail(
      transactionFailure({
        state: "rolledBack",
        phase: cleanupExit._tag === "Success" ? phase : "cleanup",
        message:
          cleanupExit._tag === "Success"
            ? "The artifact transaction failed and every mutation was rolled back."
            : "The artifact transaction rolled back, but disposable cleanup failed.",
        cause: cleanupExit._tag === "Success" ? cause : cleanupExit.cause,
      }),
    );
  });
};

const commitPreparedTransaction = (context: WriterContext, prepared: PreparedTransaction) => {
  // Commit ordinary mutations in semantic order, publish the receipt last, then clean only after the commit point.
  return Effect.uninterruptible(
    Effect.gen(function* () {
      const journal: Array<Snapshot> = [];

      // 1. Commit ordinary operations in the planner's semantic order, never in path-sorted order.
      for (const operation of prepared.ordinaryOperations) {
        const snapshot = prepared.snapshots.get(operation.path);
        if (snapshot === undefined) {
          return yield* Effect.fail(
            targetFailure({
              code: "snapshot-missing",
              targetPath: operation.path,
              message: `No captured snapshot exists for ${operation.path}.`,
            }),
          );
        }

        const before = yield* Effect.exit(verifyState({ context, snapshot, expected: snapshot.original }));
        if (before._tag === "Failure") {
          return yield* handleCommitFailure({ context, prepared, journal, phase: "artifact", cause: before.cause });
        }

        journal.push(snapshot);
        const mutation = yield* Effect.exit(mutateSnapshot({ context, snapshot, stage: prepared.stages.get(snapshot.path) }));
        if (mutation._tag === "Failure") {
          return yield* handleCommitFailure({ context, prepared, journal, phase: "artifact", cause: mutation.cause });
        }

        const after = yield* Effect.exit(verifyState({ context, snapshot, expected: snapshot.expectedAfter }));
        if (after._tag === "Failure") {
          return yield* handleCommitFailure({ context, prepared, journal, phase: "artifact", cause: after.cause });
        }
      }

      // 2. Recheck carried and committed artifacts immediately before the receipt claims their final state.
      for (const snapshot of prepared.snapshots.values()) {
        if (snapshot.role === "receipt") {
          continue;
        }

        const expected = snapshot.mutation === undefined ? snapshot.original : snapshot.expectedAfter;
        const confirmation = yield* Effect.exit(verifyState({ context, snapshot, expected }));
        if (confirmation._tag === "Failure") {
          return yield* handleCommitFailure({ context, prepared, journal, phase: "artifact", cause: confirmation.cause });
        }
      }

      // 3. Recheck the original receipt state immediately before the commit-point mutation.
      const receiptBefore = yield* Effect.exit(
        verifyState({ context, snapshot: prepared.receiptSnapshot, expected: prepared.receiptSnapshot.original }),
      );
      // 4. Roll back ordinary mutations when the receipt precondition changed.
      if (receiptBefore._tag === "Failure") {
        return yield* handleCommitFailure({ context, prepared, journal, phase: "artifact", cause: receiptBefore.cause });
      }

      journal.push(prepared.receiptSnapshot);
      // 5. Apply the receipt disposition only after every ordinary target is confirmed.
      const receiptMutation = yield* Effect.exit(
        mutateSnapshot({
          context,
          snapshot: prepared.receiptSnapshot,
          stage: prepared.stages.get(prepared.receiptSnapshot.path),
        }),
      );
      // 6. Classify a delegated receipt failure by inspecting its live state.
      if (receiptMutation._tag === "Failure") {
        return yield* handleCommitFailure({ context, prepared, journal, phase: "receipt", cause: receiptMutation.cause });
      }

      // 7. Verify that the receipt reached the exact planned commit-point state.
      const receiptAfter = yield* Effect.exit(
        verifyState({ context, snapshot: prepared.receiptSnapshot, expected: prepared.receiptSnapshot.expectedAfter }),
      );
      // 8. Preserve committed receipt semantics when post-mutation verification fails.
      if (receiptAfter._tag === "Failure") {
        return yield* handleCommitFailure({ context, prepared, journal, phase: "receipt", cause: receiptAfter.cause });
      }

      // 9. Clean disposable evidence only after the receipt is authoritative.
      const cleanupExit = yield* Effect.exit(cleanupTransaction(context, prepared));
      // 10. Report cleanup failure as committed without rolling back ownership.
      if (cleanupExit._tag === "Failure") {
        return yield* Effect.fail(
          transactionFailure({
            state: "committed",
            phase: "cleanup",
            message: "Artifacts and receipt committed, but disposable cleanup failed.",
            cause: cleanupExit.cause,
          }),
        );
      }
    }),
  );
};

const prepareTransaction = (plan: ArtifactPlan) => {
  // Validate the plan, bind canonical safe targets, then snapshot and stage everything before returning a prepared transaction.
  return Effect.gen(function* () {
    // 1. Acquire the official filesystem capability.
    const fileSystem = yield* FileSystem.FileSystem;
    // 2. Acquire native path semantics for containment checks.
    const pathService = yield* Path.Path;
    // 3. Revalidate the complete artifact plan inside the Effect boundary.
    const validated = yield* Effect.try({
      try: () => validateArtifactPlan(plan),
      catch: (cause) =>
        targetFailure({
          code: "invalid-plan",
          targetPath: plan.root,
          message: "Artifact plan validation failed before filesystem access.",
          cause,
        }),
    });
    // 4. Resolve aliases to the canonical scope root.
    const root = yield* fileSystem.realPath(validated.root).pipe(
      Effect.mapError((cause) =>
        targetFailure({
          code: "invalid-root",
          targetPath: validated.root,
          message: "Unable to canonicalize the artifact scope root.",
          cause,
        }),
      ),
    );
    // 5. Inspect the canonical root before deriving any descendant.
    const rootMetadata = yield* fileSystem.stat(root).pipe(
      Effect.mapError((cause) =>
        targetFailure({
          code: "invalid-root",
          targetPath: validated.root,
          message: "Unable to inspect the canonical artifact scope root.",
          cause,
        }),
      ),
    );
    // 6. Reject any canonical root that is not a directory.
    if (rootMetadata.type !== "Directory") {
      return yield* Effect.fail(
        targetFailure({ code: "invalid-root", targetPath: validated.root, message: "The artifact scope root must be a directory." }),
      );
    }

    const context: WriterContext = { fileSystem, path: pathService, root };
    // 7. Derive every authority, mutation, receipt, and recovery target under the root.
    const { specs, recoveryPath, recoveryRelativePath } = yield* Effect.try({
      try: () => buildTargetSpecs({ plan: validated, root, pathService }),
      catch: (cause) =>
        cause instanceof ArtifactTargetError
          ? cause
          : targetFailure({
              code: "invalid-targets",
              targetPath: validated.root,
              message: "Unable to derive validated transaction targets.",
              cause,
            }),
    });
    // 8. Stop before workspace creation when unresolved recovery evidence exists.
    yield* ensureRecoveryPathMissing({ context, recoveryPath, recoveryRelativePath });
    // 9. Create a durable root-local workspace that survives incomplete rollback.
    const workspacePath = yield* createWorkspace(context);
    const transactionId = pathService.basename(workspacePath);
    const indexPath = pathService.join(workspacePath, "snapshot-index.json");
    assertContained({ pathService, root, absolutePath: indexPath, label: indexPath });
    const createdDirectories: Array<string> = [];
    const restoreStages: Array<Stage> = [];
    const stages = new Map<string, Stage>();

    /* 10. Capture and stage the complete transaction within the cleanup boundary:
     * capture exact originals, publish their index, then stage every write in semantic order.
     */
    const preparation = Effect.gen(function* () {
      // 1. Capture every authority-bound and receipt target before target mutation.
      const snapshots = yield* snapshotTargets({ context, specs, workspacePath });
      const receiptSnapshot = snapshots.get(validated.receipt.path);
      // 2. Reject an incomplete snapshot map before writing its index.
      if (receiptSnapshot === undefined) {
        return yield* Effect.fail(
          targetFailure({
            code: "receipt-snapshot-missing",
            targetPath: validated.receipt.path,
            message: "Receipt snapshot was not captured.",
          }),
        );
      }

      const partial = {
        plan: validated,
        root,
        transactionId,
        workspacePath,
        indexPath,
        recoveryPath,
        snapshots,
        ordinaryOperations: validated.operations,
        createdDirectories,
        restoreStages,
      };
      // 3. Persist the exact pre-stage snapshot index.
      yield* writeSnapshotIndex(partial, "snapshotted");
      // 4. Stage ordinary writes in semantic order and the receipt write last.
      yield* stageWrites({
        context,
        snapshots,
        operations: validated.operations,
        receiptPath: validated.receipt.path,
        transactionId,
        stages,
        createdDirectories,
      });
      // 5. Persist the final prepared-stage index before commit can begin.
      yield* writeSnapshotIndex(partial, "staged");

      return {
        ...partial,
        receiptSnapshot,
        stages,
      } satisfies PreparedTransaction;
    }).pipe(
      Effect.mapError((cause) => {
        if (cause instanceof ArtifactTargetError) {
          return cause;
        }

        return transactionFailure({
          state: "unchanged",
          phase: "preparation",
          message: "Artifact snapshot or staging failed before target mutation.",
          cause,
        });
      }),
    );

    // 11. Return prepared state, or surface any failure that prevents complete pre-commit cleanup.
    return yield* Effect.matchCauseEffect(preparation, {
      onFailure: (preparationCause) => {
        return Effect.matchCauseEffect(
          cleanupPreparation({
            context,
            workspacePath,
            stages: [...stages.values(), ...restoreStages],
            createdDirectories,
          }),
          {
            onFailure: (cleanupCause) =>
              Effect.fail(
                transactionFailure({
                  state: "unchanged",
                  phase: "cleanup",
                  message: "Artifact preparation failed and disposable cleanup was incomplete.",
                  cause: cleanupCause,
                }),
              ),
            onSuccess: () => Effect.failCause(preparationCause),
          },
        );
      },
      onSuccess: Effect.succeed,
    });
  });
};

/**
 * Applies one validated artifact plan transactionally.
 * A failed stage or commit restores every target before temporary files are removed.
 */
export const applyArtifactPlan = (plan: ArtifactPlan) =>
  Effect.gen(function* () {
    // 1. Assign temporary paths without touching the filesystem.
    const prepared = yield* prepareTransaction(plan);

    // 2. Capture every original target before the first mutation.
    const context: WriterContext = {
      fileSystem: yield* FileSystem.FileSystem,
      path: yield* Path.Path,
      root: prepared.root,
    };

    /* 3. Write every desired artifact to its temporary path.
     * 4. Move staged artifacts into their final locations.
     * 5. Publish ownership only after every artifact succeeds.
     * 6. Restore originals on failure and always remove disposable staging.
     */
    yield* commitPreparedTransaction(context, prepared);
  });
