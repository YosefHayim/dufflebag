import { FileSystem, Path } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { NodeContext, NodeFileSystem, NodePath } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Cause, Deferred, Effect, Either, Exit, Fiber, Layer, Ref } from "effect";

import { applyArtifactPlan } from "./applyArtifactPlan.js";
import { type ArtifactPlan, validateArtifactPlan } from "./artifactPlan.js";
import { decodeArtifactReceiptJson } from "./artifactReceipt.js";
import { decodeArtifactRecoveryRecordJson } from "./artifactRecovery.js";

const installedHash = "1111111111111111111111111111111111111111111111111111111111111111";
const installedBytes = new TextEncoder().encode("installed");
const originalBytes = new Uint8Array([0, 255, 128, 10]);
const secondOriginalBytes = new TextEncoder().encode("second-original");
const externallyChangedBytes = new TextEncoder().encode("changed after transaction mutation");
const applicationOwner = { _tag: "application" };
const missingPrevious = { _tag: "missing" };

const portablePath = (filePath: string): string => filePath.replaceAll("\\", "/");

const unwrapPlan = (input: unknown): ArtifactPlan =>
  Either.getOrThrowWith(validateArtifactPlan(input), (error) => new Error(String(error)));

const createWritePlan = (root: string, artifactPaths: ReadonlyArray<string>): ArtifactPlan => {
  const artifacts = artifactPaths.map((artifactPath) => ({
    path: artifactPath,
    kind: { _tag: "managedConfig" },
    owner: applicationOwner,
    ownership: {
      _tag: "wholeFile",
      installedHash,
      previous: missingPrevious,
    },
  }));
  const receipt = {
    version: "0.12.0",
    scope: "project",
    features: [],
    artifacts,
  };

  return unwrapPlan({
    scope: "project",
    root,
    operations: artifacts.map((artifact) => ({ _tag: "write", artifact, bytes: installedBytes })),
    receipt: {
      _tag: "receiptPublish",
      target: {
        path: ".dufflebag/receipt.json",
        kind: { _tag: "receipt" },
        owner: applicationOwner,
      },
      receipt,
    },
  });
};

const createMixedPlan = (root: string): ArtifactPlan => {
  const writeArtifact = {
    path: "write.txt",
    kind: { _tag: "managedConfig" },
    owner: applicationOwner,
    ownership: { _tag: "wholeFile", installedHash, previous: missingPrevious },
  };
  const restoreArtifact = {
    path: "restore.txt",
    kind: { _tag: "managedConfig" },
    owner: applicationOwner,
    ownership: {
      _tag: "wholeFile",
      installedHash,
      previous: { _tag: "priorFile", bytes: originalBytes },
    },
  };
  const removeArtifact = {
    path: "remove.txt",
    kind: { _tag: "managedConfig" },
    owner: applicationOwner,
    ownership: { _tag: "wholeFile", installedHash, previous: missingPrevious },
  };

  return unwrapPlan({
    scope: "project",
    root,
    operations: [
      { _tag: "write", artifact: writeArtifact, bytes: installedBytes },
      { _tag: "restore", artifact: restoreArtifact, bytes: originalBytes },
      { _tag: "remove", artifact: removeArtifact, unownedBytes: new Uint8Array() },
    ],
    receipt: {
      _tag: "receiptPublish",
      target: {
        path: ".dufflebag/receipt.json",
        kind: { _tag: "receipt" },
        owner: applicationOwner,
      },
      receipt: {
        version: "0.12.0",
        scope: "project",
        features: [],
        artifacts: [writeArtifact],
      },
    },
  });
};

const createReceiptRemovalPlan = (root: string): ArtifactPlan =>
  unwrapPlan({
    scope: "project",
    root,
    operations: [],
    receipt: {
      _tag: "remove",
      target: {
        path: ".dufflebag/receipt.json",
        kind: { _tag: "receipt" },
        owner: applicationOwner,
      },
    },
  });

layer(NodeContext.layer)("applyArtifactPlan", (it) => {
  it.effect("rejects a cross-platform root that is not fully qualified on this host", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const foreignRoot = path.isAbsolute("C:/workspace") ? "/workspace" : "C:/workspace";
      const result = yield* Effect.exit(applyArtifactPlan(createWritePlan(foreignRoot, ["settings.json"])));

      expect(Exit.isFailure(result)).toBe(true);
    }),
  );

  it.effect("commits artifact bytes and publishes their receipt", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-success-" });
        const plan = createWritePlan(root, ["config/settings.json"]);

        yield* applyArtifactPlan(plan);

        expect([...(yield* fileSystem.readFile(path.join(root, "config/settings.json")))]).toEqual([...installedBytes]);

        const receiptJson = yield* fileSystem.readFileString(path.join(root, ".dufflebag/receipt.json"));
        expect(yield* decodeArtifactReceiptJson(receiptJson)).toEqual(plan.receipt.receipt);

        const rootEntries = yield* fileSystem.readDirectory(root);
        expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
      }),
    ),
  );

  it.effect("refuses to start while durable recovery evidence is pending", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-pending-" });
        const recoveryPath = path.join(root, ".dufflebag/recovery.json");
        const artifactPath = path.join(root, "config/settings.json");
        const plan = createWritePlan(root, ["config/settings.json"]);

        yield* fileSystem.makeDirectory(path.dirname(recoveryPath), { recursive: true });
        yield* fileSystem.writeFileString(recoveryPath, "pending recovery");

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect(yield* fileSystem.exists(artifactPath)).toBe(false);
        expect(yield* fileSystem.readFileString(recoveryPath)).toBe("pending recovery");

        const rootEntries = yield* fileSystem.readDirectory(root);
        expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
      }),
    ),
  );

  it.effect("rejects a symlinked parent before creating transaction state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-symlink-root-" });
        const outside = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-symlink-outside-" });
        const escapedPath = path.join(outside, "escaped.json");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const plan = createWritePlan(root, ["link/escaped.json"]);

        yield* fileSystem.symlink(outside, path.join(root, "link"));

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect(yield* fileSystem.exists(escapedPath)).toBe(false);
        expect(yield* fileSystem.exists(receiptPath)).toBe(false);

        const rootEntries = yield* fileSystem.readDirectory(root);
        expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
      }),
    ),
  );

  it.effect("applies write, restore, and remove operations before publishing ownership", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-mixed-" });
        const restorePath = path.join(root, "restore.txt");
        const removePath = path.join(root, "remove.txt");
        const writePath = path.join(root, "write.txt");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const plan = createMixedPlan(root);

        yield* fileSystem.writeFile(restorePath, installedBytes);
        yield* fileSystem.writeFile(removePath, installedBytes);

        yield* applyArtifactPlan(plan);

        expect([...(yield* fileSystem.readFile(writePath))]).toEqual([...installedBytes]);
        expect([...(yield* fileSystem.readFile(restorePath))]).toEqual([...originalBytes]);
        expect(yield* fileSystem.exists(removePath)).toBe(false);

        const receipt = yield* decodeArtifactReceiptJson(yield* fileSystem.readFileString(receiptPath));
        expect(receipt.artifacts.map((artifact) => artifact.path)).toEqual(["write.txt"]);
      }),
    ),
  );

  it.effect("removes the ownership receipt for a completed uninstall plan", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-uninstall-" });
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const plan = createReceiptRemovalPlan(root);

        yield* fileSystem.makeDirectory(path.dirname(receiptPath), { recursive: true });
        yield* fileSystem.writeFileString(receiptPath, "previous receipt");

        yield* applyArtifactPlan(plan);

        expect(yield* fileSystem.exists(receiptPath)).toBe(false);
      }),
    ),
  );
});

const transactionOrderFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const appendEvent = (transactionPath: string, event: string) => {
      const transactionRoot = path.dirname(path.dirname(transactionPath));
      const root = path.dirname(transactionRoot);

      return fileSystem.writeFileString(path.join(root, ".transaction-order.log"), `${event}\n`, { flag: "a" });
    };

    return FileSystem.make({
      ...fileSystem,
      copyFile: (oldPath, newPath) =>
        fileSystem
          .copyFile(oldPath, newPath)
          .pipe(
            Effect.zipRight(
              portablePath(oldPath).includes("/snapshots/") ? appendEvent(oldPath, `restore:${path.basename(newPath)}`) : Effect.void,
            ),
          ),
      rename: (oldPath, newPath) =>
        path.basename(newPath) === "fail.txt"
          ? Effect.fail(
              new SystemError({
                reason: "PermissionDenied",
                module: "FileSystem",
                method: "rename",
                pathOrDescriptor: newPath,
                description: "Injected ordered commit failure.",
              }),
            )
          : fileSystem.rename(oldPath, newPath).pipe(Effect.zipRight(appendEvent(oldPath, `commit:${path.basename(newPath)}`))),
    });
  }),
).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

const transactionOrderLayer = Layer.merge(transactionOrderFileSystemLayer, NodePath.layer);

layer(transactionOrderLayer)("applyArtifactPlan transaction order", (it) => {
  it.effect("commits the ownership receipt after every artifact", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-order-success-" });
        const plan = createWritePlan(root, ["first.txt", "second.txt"]);

        yield* applyArtifactPlan(plan);

        const events = (yield* fileSystem.readFileString(path.join(root, ".transaction-order.log"))).trim().split("\n");
        expect(events).toEqual(["commit:first.txt", "commit:second.txt", "commit:receipt.json"]);
      }),
    ),
  );

  it.effect("restores captured targets in reverse mutation order", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-order-rollback-" });
        const plan = createWritePlan(root, ["first.txt", "second.txt", "fail.txt"]);

        yield* fileSystem.writeFile(path.join(root, "first.txt"), originalBytes);
        yield* fileSystem.writeFile(path.join(root, "second.txt"), secondOriginalBytes);
        yield* fileSystem.writeFile(path.join(root, "fail.txt"), originalBytes);

        const result = yield* Effect.exit(applyArtifactPlan(plan));
        const events = (yield* fileSystem.readFileString(path.join(root, ".transaction-order.log"))).trim().split("\n");

        expect(Exit.isFailure(result)).toBe(true);
        expect(events).toEqual(["commit:first.txt", "commit:second.txt", "restore:fail.txt", "restore:second.txt", "restore:first.txt"]);
      }),
    ),
  );
});

type PausedCommit = {
  readonly targetName: string;
  readonly targetCommitted: Deferred.Deferred<void>;
  readonly releaseCommit: Deferred.Deferred<void>;
};

const pausedCommitLayer = (pause: PausedCommit) =>
  Layer.merge(
    Layer.effect(
      FileSystem.FileSystem,
      Effect.map(FileSystem.FileSystem, (fileSystem) =>
        FileSystem.make({
          ...fileSystem,
          rename: (oldPath, newPath) =>
            portablePath(newPath).endsWith(`/${pause.targetName}`)
              ? fileSystem.rename(oldPath, newPath).pipe(
                  Effect.tap(() => Deferred.succeed(pause.targetCommitted, undefined)),
                  Effect.zipRight(Deferred.await(pause.releaseCommit)),
                )
              : fileSystem.rename(oldPath, newPath),
        }),
      ),
    ).pipe(Layer.provide(NodeFileSystem.layer)),
    NodePath.layer,
  );

layer(NodeContext.layer)("applyArtifactPlan interruption", (it) => {
  it.effect("rolls back when interrupted between atomic artifact commits", () =>
    Effect.gen(function* () {
      const firstCommitted = yield* Deferred.make<void>();
      const releaseCommit = yield* Deferred.make<void>();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-interrupt-" });
          const firstPath = path.join(root, "first.txt");
          const secondPath = path.join(root, "second.txt");
          const receiptPath = path.join(root, ".dufflebag/receipt.json");
          const recoveryPath = path.join(root, ".dufflebag/recovery.json");
          const plan = createWritePlan(root, ["first.txt", "second.txt"]);
          const applyFiber = yield* Effect.fork(applyArtifactPlan(plan));

          yield* Deferred.await(firstCommitted);
          const interruptionFiber = yield* Effect.fork(Fiber.interrupt(applyFiber));
          yield* Effect.yieldNow();
          yield* Deferred.succeed(releaseCommit, undefined);
          const result = yield* Fiber.join(interruptionFiber);

          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) {
            expect(Cause.isInterruptedOnly(result.cause)).toBe(true);
          }
          expect(yield* fileSystem.exists(firstPath)).toBe(false);
          expect(yield* fileSystem.exists(secondPath)).toBe(false);
          expect(yield* fileSystem.exists(receiptPath)).toBe(false);
          expect(yield* fileSystem.exists(recoveryPath)).toBe(false);

          const rootEntries = yield* fileSystem.readDirectory(root);
          expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
        }).pipe(
          Effect.provide(
            pausedCommitLayer({
              targetName: "first.txt",
              targetCommitted: firstCommitted,
              releaseCommit,
            }),
          ),
        ),
      );
    }),
  );

  it.effect("rolls back when interrupted inside the atomic receipt commit", () =>
    Effect.gen(function* () {
      const receiptCommitted = yield* Deferred.make<void>();
      const releaseCommit = yield* Deferred.make<void>();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-receipt-interrupt-" });
          const artifactPath = path.join(root, "settings.json");
          const receiptPath = path.join(root, ".dufflebag/receipt.json");
          const recoveryPath = path.join(root, ".dufflebag/recovery.json");
          const plan = createWritePlan(root, ["settings.json"]);
          const applyFiber = yield* Effect.fork(applyArtifactPlan(plan));

          yield* Deferred.await(receiptCommitted);
          const interruptionFiber = yield* Effect.fork(Fiber.interrupt(applyFiber));
          yield* Effect.yieldNow();
          yield* Deferred.succeed(releaseCommit, undefined);
          const result = yield* Fiber.join(interruptionFiber);

          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) {
            expect(Cause.isInterruptedOnly(result.cause)).toBe(true);
          }
          expect(yield* fileSystem.exists(artifactPath)).toBe(false);
          expect(yield* fileSystem.exists(receiptPath)).toBe(false);
          expect(yield* fileSystem.exists(recoveryPath)).toBe(false);

          const rootEntries = yield* fileSystem.readDirectory(root);
          expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
        }).pipe(
          Effect.provide(
            pausedCommitLayer({
              targetName: "receipt.json",
              targetCommitted: receiptCommitted,
              releaseCommit,
            }),
          ),
        ),
      );
    }),
  );
});

const symlinkSwapFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return FileSystem.make({
      ...fileSystem,
      writeFile: (filePath, value) =>
        fileSystem.writeFile(filePath, value).pipe(
          Effect.tap(() => {
            if (!portablePath(filePath).endsWith("/staged/receipt")) {
              return Effect.void;
            }

            const transactionRoot = path.dirname(path.dirname(filePath));
            const root = path.dirname(transactionRoot);

            return Effect.gen(function* () {
              yield* fileSystem.rename(path.join(root, "safe"), path.join(root, "safe-before-swap"));
              yield* fileSystem.symlink(`${root}-outside`, path.join(root, "safe"));
            });
          }),
        ),
    });
  }),
).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

const symlinkSwapLayer = Layer.merge(symlinkSwapFileSystemLayer, NodePath.layer);

layer(symlinkSwapLayer)("applyArtifactPlan symlink swap", (it) => {
  it.effect("rejects a parent swapped to an outside symlink before commit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-symlink-swap-root-" });
        const outside = `${root}-outside`;
        const firstPath = path.join(root, "first.txt");
        const escapedPath = path.join(outside, "escaped.json");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const plan = createWritePlan(root, ["first.txt", "safe/escaped.json"]);

        yield* fileSystem.makeDirectory(path.join(root, "safe"));
        yield* fileSystem.makeDirectory(outside);
        yield* Effect.addFinalizer(() => fileSystem.remove(outside, { recursive: true, force: true }));

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect(yield* fileSystem.exists(firstPath)).toBe(false);
        expect(yield* fileSystem.exists(escapedPath)).toBe(false);
        expect(yield* fileSystem.exists(receiptPath)).toBe(false);
      }),
    ),
  );
});

const recoveryParentSwapFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return FileSystem.make({
      ...fileSystem,
      writeFile: (filePath, value) =>
        fileSystem.writeFile(filePath, value).pipe(
          Effect.tap(() => {
            if (!portablePath(filePath).endsWith("/staged/receipt")) {
              return Effect.void;
            }

            const transactionRoot = path.dirname(path.dirname(filePath));
            const root = path.dirname(transactionRoot);

            return Effect.gen(function* () {
              yield* fileSystem.rename(path.join(root, ".dufflebag"), path.join(root, ".dufflebag-before-swap"));
              yield* fileSystem.symlink(`${root}-recovery-outside`, path.join(root, ".dufflebag"));
            });
          }),
        ),
    });
  }),
).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

const recoveryParentSwapLayer = Layer.merge(recoveryParentSwapFileSystemLayer, NodePath.layer);

layer(recoveryParentSwapLayer)("applyArtifactPlan recovery parent swap", (it) => {
  it.effect("never publishes the recovery marker through a swapped parent", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-recovery-swap-root-" });
        const outside = `${root}-recovery-outside`;
        const artifactPath = path.join(root, "settings.json");
        const outsideRecoveryPath = path.join(outside, "recovery.json");
        const outsideReceiptPath = path.join(outside, "receipt.json");
        const plan = createWritePlan(root, ["settings.json"]);

        yield* fileSystem.makeDirectory(path.join(root, ".dufflebag"));
        yield* fileSystem.makeDirectory(outside);
        yield* Effect.addFinalizer(() => fileSystem.remove(outside, { recursive: true, force: true }));

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect(yield* fileSystem.exists(artifactPath)).toBe(false);
        expect(yield* fileSystem.exists(outsideRecoveryPath)).toBe(false);
        expect(yield* fileSystem.exists(outsideReceiptPath)).toBe(false);
      }),
    ),
  );
});

const markerFailureFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fileSystem) =>
    FileSystem.make({
      ...fileSystem,
      link: (oldPath, newPath) =>
        portablePath(newPath).endsWith("/recovery.json")
          ? Effect.fail(
              new SystemError({
                reason: "PermissionDenied",
                module: "FileSystem",
                method: "link",
                pathOrDescriptor: newPath,
                description: "Injected recovery marker failure.",
              }),
            )
          : fileSystem.link(oldPath, newPath),
    }),
  ),
).pipe(Layer.provide(NodeFileSystem.layer));

const markerFailureLayer = Layer.merge(markerFailureFileSystemLayer, NodePath.layer);

layer(markerFailureLayer)("applyArtifactPlan recovery marker failure", (it) => {
  it.effect("cleans staged state without mutating destinations when marker publication fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-marker-failure-" });
        const artifactPath = path.join(root, "settings.json");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const recoveryPath = path.join(root, ".dufflebag/recovery.json");
        const plan = createWritePlan(root, ["settings.json"]);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect(yield* fileSystem.exists(artifactPath)).toBe(false);
        expect(yield* fileSystem.exists(receiptPath)).toBe(false);
        expect(yield* fileSystem.exists(recoveryPath)).toBe(false);

        const rootEntries = yield* fileSystem.readDirectory(root);
        expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
      }),
    ),
  );
});

const markerDefectFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fileSystem) =>
    FileSystem.make({
      ...fileSystem,
      link: (oldPath, newPath) =>
        portablePath(newPath).endsWith("/recovery.json")
          ? fileSystem.link(oldPath, newPath).pipe(Effect.zipRight(Effect.dieMessage("Injected post-link defect.")))
          : fileSystem.link(oldPath, newPath),
    }),
  ),
).pipe(Layer.provide(NodeFileSystem.layer));

const markerDefectLayer = Layer.merge(markerDefectFileSystemLayer, NodePath.layer);

layer(markerDefectLayer)("applyArtifactPlan post-link marker defect", (it) => {
  it.effect("reconciles a marker published before the link effect defects", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-marker-defect-" });
        const artifactPath = path.join(root, "settings.json");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const recoveryPath = path.join(root, ".dufflebag/recovery.json");
        const plan = createWritePlan(root, ["settings.json"]);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          expect(Cause.pretty(result.cause)).toContain("Injected post-link defect");
        }
        expect(yield* fileSystem.exists(artifactPath)).toBe(false);
        expect(yield* fileSystem.exists(receiptPath)).toBe(false);
        expect(yield* fileSystem.exists(recoveryPath)).toBe(false);

        const rootEntries = yield* fileSystem.readDirectory(root);
        expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
      }),
    ),
  );
});

const competingWriterFileSystemLayer = (releaseWinner: Deferred.Deferred<void>) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const linkArrivals = yield* Ref.make(0);
      const bothWritersReady = yield* Deferred.make<void>();

      return FileSystem.make({
        ...fileSystem,
        link: (oldPath, newPath) => {
          if (!portablePath(newPath).endsWith("/recovery.json")) {
            return fileSystem.link(oldPath, newPath);
          }

          return Effect.gen(function* () {
            const arrivalCount = yield* Ref.updateAndGet(linkArrivals, (count) => count + 1);
            if (arrivalCount === 2) {
              yield* Deferred.succeed(bothWritersReady, undefined);
            }
            yield* Deferred.await(bothWritersReady);

            const linkExit = yield* Effect.exit(fileSystem.link(oldPath, newPath));
            if (Exit.isFailure(linkExit)) {
              return yield* Effect.failCause(linkExit.cause);
            }

            yield* Deferred.await(releaseWinner);
          });
        },
      });
    }),
  ).pipe(Layer.provide(NodeFileSystem.layer));

const competingWriterLayer = (releaseWinner: Deferred.Deferred<void>) =>
  Layer.merge(competingWriterFileSystemLayer(releaseWinner), NodePath.layer);

layer(Layer.empty)("applyArtifactPlan competing writers", (it) => {
  it.effect("removes the losing transaction without touching the winning marker", () =>
    Effect.gen(function* () {
      const releaseWinner = yield* Deferred.make<void>();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-competing-" });
          const artifactPath = path.join(root, "settings.json");
          const receiptPath = path.join(root, ".dufflebag/receipt.json");
          const recoveryPath = path.join(root, ".dufflebag/recovery.json");
          const plan = createWritePlan(root, ["settings.json"]);

          yield* fileSystem.makeDirectory(path.dirname(receiptPath));
          yield* fileSystem.writeFile(artifactPath, originalBytes);

          const firstWriter = yield* Effect.fork(Effect.exit(applyArtifactPlan(plan)));
          const secondWriter = yield* Effect.fork(Effect.exit(applyArtifactPlan(plan)));
          const losingResult = yield* Effect.race(Fiber.join(firstWriter), Fiber.join(secondWriter));

          yield* Effect.gen(function* () {
            expect(Exit.isFailure(losingResult)).toBe(true);
            expect(yield* fileSystem.exists(recoveryPath)).toBe(true);

            const rootEntries = yield* fileSystem.readDirectory(root);
            expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toHaveLength(1);
          }).pipe(Effect.ensuring(Deferred.succeed(releaseWinner, undefined)));

          const results = yield* Effect.all([Fiber.join(firstWriter), Fiber.join(secondWriter)]);

          expect(results.filter(Exit.isSuccess)).toHaveLength(1);
          expect(results.filter(Exit.isFailure)).toHaveLength(1);
          expect([...(yield* fileSystem.readFile(artifactPath))]).toEqual([...installedBytes]);
          expect(yield* decodeArtifactReceiptJson(yield* fileSystem.readFileString(receiptPath))).toEqual(plan.receipt.receipt);
          expect(yield* fileSystem.exists(recoveryPath)).toBe(false);

          const rootEntries = yield* fileSystem.readDirectory(root);
          expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
        }).pipe(Effect.provide(competingWriterLayer(releaseWinner))),
      );
    }),
  );
});

const byteChangeFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return FileSystem.make({
      ...fileSystem,
      writeFile: (filePath, value) =>
        fileSystem.writeFile(filePath, value).pipe(
          Effect.tap(() => {
            if (!portablePath(filePath).endsWith("/staged/receipt")) {
              return Effect.void;
            }

            const transactionRoot = path.dirname(path.dirname(filePath));
            const root = path.dirname(transactionRoot);

            return fileSystem.writeFile(path.join(root, "changed.txt"), new TextEncoder().encode("changed after capture"));
          }),
        ),
    });
  }),
).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

const byteChangeLayer = Layer.merge(byteChangeFileSystemLayer, NodePath.layer);

layer(byteChangeLayer)("applyArtifactPlan target change", (it) => {
  it.effect("preserves bytes changed after capture instead of overwriting them", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-byte-race-" });
        const firstPath = path.join(root, "first.txt");
        const changedPath = path.join(root, "changed.txt");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const externallyChangedBytes = new TextEncoder().encode("changed after capture");
        const plan = createWritePlan(root, ["first.txt", "changed.txt"]);

        yield* fileSystem.writeFile(changedPath, originalBytes);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect(yield* fileSystem.exists(firstPath)).toBe(false);
        expect([...(yield* fileSystem.readFile(changedPath))]).toEqual([...externallyChangedBytes]);
        expect(yield* fileSystem.exists(receiptPath)).toBe(false);
      }),
    ),
  );
});

const commitFailureFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fileSystem) =>
    FileSystem.make({
      ...fileSystem,
      rename: (oldPath, newPath) =>
        portablePath(newPath).endsWith("/fail.txt")
          ? Effect.fail(
              new SystemError({
                reason: "PermissionDenied",
                module: "FileSystem",
                method: "rename",
                pathOrDescriptor: newPath,
                description: "Injected commit failure.",
              }),
            )
          : fileSystem.rename(oldPath, newPath),
    }),
  ),
).pipe(Layer.provide(NodeFileSystem.layer));

const commitFailureLayer = Layer.merge(commitFailureFileSystemLayer, NodePath.layer);

layer(commitFailureLayer)("applyArtifactPlan commit failure", (it) => {
  it.effect("restores original bytes and removes created parents after a middle commit failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-rollback-" });
        const originalPath = path.join(root, "existing.txt");
        const createdDirectory = path.join(root, "created");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const plan = createWritePlan(root, ["existing.txt", "created/nested/file.txt", "fail.txt"]);

        yield* fileSystem.writeFile(originalPath, originalBytes);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect([...(yield* fileSystem.readFile(originalPath))]).toEqual([...originalBytes]);
        expect(yield* fileSystem.exists(createdDirectory)).toBe(false);
        expect(yield* fileSystem.exists(path.join(root, "fail.txt"))).toBe(false);
        expect(yield* fileSystem.exists(receiptPath)).toBe(false);

        const rootEntries = yield* fileSystem.readDirectory(root);
        expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
      }),
    ),
  );
});

const rollbackParentContentFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return FileSystem.make({
      ...fileSystem,
      rename: (oldPath, newPath) =>
        portablePath(newPath).endsWith("/fail.txt")
          ? Effect.zipRight(
              fileSystem.writeFile(path.join(path.dirname(newPath), "created/nested/external.txt"), externallyChangedBytes),
              Effect.fail(
                new SystemError({
                  reason: "PermissionDenied",
                  module: "FileSystem",
                  method: "rename",
                  pathOrDescriptor: newPath,
                  description: "Injected commit failure after external parent content appeared.",
                }),
              ),
            )
          : fileSystem.rename(oldPath, newPath),
    });
  }),
).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

const rollbackParentContentLayer = Layer.merge(rollbackParentContentFileSystemLayer, NodePath.layer);

layer(rollbackParentContentLayer)("applyArtifactPlan rollback parent content", (it) => {
  it.effect("removes snapshots while preserving external content in a created parent", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-parent-content-" });
        const externalPath = path.join(root, "created/nested/external.txt");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const recoveryPath = path.join(root, ".dufflebag/recovery.json");
        const plan = createWritePlan(root, ["created/nested/file.txt", "fail.txt"]);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect([...(yield* fileSystem.readFile(externalPath))]).toEqual([...externallyChangedBytes]);
        expect(yield* fileSystem.exists(receiptPath)).toBe(false);
        expect(yield* fileSystem.exists(recoveryPath)).toBe(false);

        const rootEntries = yield* fileSystem.readDirectory(root);
        expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
      }),
    ),
  );
});

const rollbackRaceFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return FileSystem.make({
      ...fileSystem,
      rename: (oldPath, newPath) =>
        portablePath(newPath).endsWith("/fail.txt")
          ? Effect.zipRight(
              fileSystem.writeFile(path.join(path.dirname(newPath), "first.txt"), externallyChangedBytes),
              Effect.fail(
                new SystemError({
                  reason: "PermissionDenied",
                  module: "FileSystem",
                  method: "rename",
                  pathOrDescriptor: newPath,
                  description: "Injected commit failure after an external target change.",
                }),
              ),
            )
          : fileSystem.rename(oldPath, newPath),
    });
  }),
).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

const rollbackRaceLayer = Layer.merge(rollbackRaceFileSystemLayer, NodePath.layer);

layer(rollbackRaceLayer)("applyArtifactPlan rollback target change", (it) => {
  it.effect("retains recovery state instead of overwriting bytes changed after commit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-rollback-race-" });
        const firstPath = path.join(root, "first.txt");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const recoveryPath = path.join(root, ".dufflebag/recovery.json");
        const plan = createWritePlan(root, ["first.txt", "fail.txt"]);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect([...(yield* fileSystem.readFile(firstPath))]).toEqual([...externallyChangedBytes]);
        expect(yield* fileSystem.exists(receiptPath)).toBe(false);

        const recovery = yield* decodeArtifactRecoveryRecordJson(yield* fileSystem.readFileString(recoveryPath));
        expect(yield* fileSystem.exists(recovery.transactionRoot)).toBe(true);
      }),
    ),
  );
});

const receiptFailureFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fileSystem) =>
    FileSystem.make({
      ...fileSystem,
      rename: (oldPath, newPath) =>
        portablePath(newPath).endsWith("/receipt.json")
          ? Effect.fail(
              new SystemError({
                reason: "PermissionDenied",
                module: "FileSystem",
                method: "rename",
                pathOrDescriptor: newPath,
                description: "Injected receipt commit failure.",
              }),
            )
          : fileSystem.rename(oldPath, newPath),
    }),
  ),
).pipe(Layer.provide(NodeFileSystem.layer));

const receiptFailureLayer = Layer.merge(receiptFailureFileSystemLayer, NodePath.layer);

layer(receiptFailureLayer)("applyArtifactPlan receipt failure", (it) => {
  it.effect("rolls artifacts back and restores the prior receipt bytes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-receipt-failure-" });
        const artifactPath = path.join(root, "existing.txt");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const priorReceiptBytes = new Uint8Array([255, 0, 1, 128]);
        const plan = createWritePlan(root, ["existing.txt"]);

        yield* fileSystem.writeFile(artifactPath, originalBytes);
        yield* fileSystem.makeDirectory(path.dirname(receiptPath), { recursive: true });
        yield* fileSystem.writeFile(receiptPath, priorReceiptBytes);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect([...(yield* fileSystem.readFile(artifactPath))]).toEqual([...originalBytes]);
        expect([...(yield* fileSystem.readFile(receiptPath))]).toEqual([...priorReceiptBytes]);

        const rootEntries = yield* fileSystem.readDirectory(root);
        expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
      }),
    ),
  );
});

const stageFailureFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fileSystem) =>
    FileSystem.make({
      ...fileSystem,
      writeFile: (filePath, bytes) =>
        portablePath(filePath).includes("/staged/1")
          ? Effect.fail(
              new SystemError({
                reason: "PermissionDenied",
                module: "FileSystem",
                method: "writeFile",
                pathOrDescriptor: filePath,
                description: "Injected stage failure.",
              }),
            )
          : fileSystem.writeFile(filePath, bytes),
    }),
  ),
).pipe(Layer.provide(NodeFileSystem.layer));

const stageFailureLayer = Layer.merge(stageFailureFileSystemLayer, NodePath.layer);

layer(stageFailureLayer)("applyArtifactPlan stage failure", (it) => {
  it.effect("leaves every destination unchanged and removes transaction state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-stage-failure-" });
        const firstPath = path.join(root, "first.txt");
        const secondPath = path.join(root, "second.txt");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const plan = createWritePlan(root, ["first.txt", "second.txt"]);

        yield* fileSystem.writeFile(firstPath, originalBytes);
        yield* fileSystem.writeFile(secondPath, secondOriginalBytes);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect([...(yield* fileSystem.readFile(firstPath))]).toEqual([...originalBytes]);
        expect([...(yield* fileSystem.readFile(secondPath))]).toEqual([...secondOriginalBytes]);
        expect(yield* fileSystem.exists(receiptPath)).toBe(false);

        const rootEntries = yield* fileSystem.readDirectory(root);
        expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
      }),
    ),
  );
});

const snapshotFailureFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fileSystem) =>
    FileSystem.make({
      ...fileSystem,
      readFile: (filePath) =>
        portablePath(filePath).endsWith("/snapshot-fail.txt")
          ? Effect.fail(
              new SystemError({
                reason: "PermissionDenied",
                module: "FileSystem",
                method: "readFile",
                pathOrDescriptor: filePath,
                description: "Injected snapshot failure.",
              }),
            )
          : fileSystem.readFile(filePath),
    }),
  ),
).pipe(Layer.provide(NodeFileSystem.layer));

const snapshotFailureLayer = Layer.merge(snapshotFailureFileSystemLayer, NodePath.layer);

layer(snapshotFailureLayer)("applyArtifactPlan snapshot failure", (it) => {
  it.effect("leaves destinations unchanged and removes partial transaction state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-snapshot-failure-" });
        const firstPath = path.join(root, "first.txt");
        const failedPath = path.join(root, "snapshot-fail.txt");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const plan = createWritePlan(root, ["first.txt", "snapshot-fail.txt"]);

        yield* fileSystem.writeFile(firstPath, originalBytes);
        yield* fileSystem.writeFile(failedPath, secondOriginalBytes);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect([...(yield* fileSystem.readFile(firstPath))]).toEqual([...originalBytes]);
        expect((yield* fileSystem.stat(failedPath)).type).toBe("File");
        expect(yield* fileSystem.exists(receiptPath)).toBe(false);

        const rootEntries = yield* fileSystem.readDirectory(root);
        expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toEqual([]);
      }),
    ),
  );
});

const cleanupFailureFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fileSystem) =>
    FileSystem.make({
      ...fileSystem,
      remove: (filePath, options) =>
        portablePath(filePath).includes("/.dufflebag-transaction-") && options?.recursive === true
          ? Effect.fail(
              new SystemError({
                reason: "PermissionDenied",
                module: "FileSystem",
                method: "remove",
                pathOrDescriptor: filePath,
                description: "Injected cleanup failure.",
              }),
            )
          : fileSystem.remove(filePath, options),
    }),
  ),
).pipe(Layer.provide(NodeFileSystem.layer));

const cleanupFailureLayer = Layer.merge(cleanupFailureFileSystemLayer, NodePath.layer);

layer(cleanupFailureLayer)("applyArtifactPlan cleanup failure", (it) => {
  it.effect("surfaces cleanup failure without rolling back the committed receipt", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-cleanup-failure-" });
        const artifactPath = path.join(root, "settings.json");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const recoveryPath = path.join(root, ".dufflebag/recovery.json");
        const plan = createWritePlan(root, ["settings.json"]);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect([...(yield* fileSystem.readFile(artifactPath))]).toEqual([...installedBytes]);
        expect(yield* fileSystem.exists(receiptPath)).toBe(true);
        expect(yield* fileSystem.exists(recoveryPath)).toBe(false);

        const rootEntries = yield* fileSystem.readDirectory(root);
        expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toHaveLength(1);
      }),
    ),
  );
});

const markerCleanupFailureFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fileSystem) =>
    FileSystem.make({
      ...fileSystem,
      remove: (filePath, options) =>
        portablePath(filePath).endsWith("/.dufflebag/recovery.json")
          ? Effect.fail(
              new SystemError({
                reason: "PermissionDenied",
                module: "FileSystem",
                method: "remove",
                pathOrDescriptor: filePath,
                description: "Injected recovery marker cleanup failure.",
              }),
            )
          : fileSystem.remove(filePath, options),
    }),
  ),
).pipe(Layer.provide(NodeFileSystem.layer));

const markerCleanupFailureLayer = Layer.merge(markerCleanupFailureFileSystemLayer, NodePath.layer);

layer(markerCleanupFailureLayer)("applyArtifactPlan marker cleanup failure", (it) => {
  it.effect("retains the recovery marker and snapshots after committed cleanup fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-marker-cleanup-" });
        const artifactPath = path.join(root, "settings.json");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const recoveryPath = path.join(root, ".dufflebag/recovery.json");
        const plan = createWritePlan(root, ["settings.json"]);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect([...(yield* fileSystem.readFile(artifactPath))]).toEqual([...installedBytes]);
        expect(yield* fileSystem.exists(receiptPath)).toBe(true);

        const recovery = yield* decodeArtifactRecoveryRecordJson(yield* fileSystem.readFileString(recoveryPath));
        expect(yield* fileSystem.exists(recovery.transactionRoot)).toBe(true);
      }),
    ),
  );
});

const markerChangeFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return FileSystem.make({
      ...fileSystem,
      rename: (oldPath, newPath) =>
        fileSystem
          .rename(oldPath, newPath)
          .pipe(
            Effect.zipRight(
              path.basename(newPath) === "receipt.json"
                ? fileSystem.writeFileString(path.join(path.dirname(newPath), "recovery.json"), "changed marker")
                : Effect.void,
            ),
          ),
    });
  }),
).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

const markerChangeLayer = Layer.merge(markerChangeFileSystemLayer, NodePath.layer);

layer(markerChangeLayer)("applyArtifactPlan changed recovery marker", (it) => {
  it.effect("never unlinks a marker that changed before committed cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-marker-change-" });
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const recoveryPath = path.join(root, ".dufflebag/recovery.json");
        const plan = createWritePlan(root, ["settings.json"]);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        expect(yield* fileSystem.exists(receiptPath)).toBe(true);
        expect(yield* fileSystem.readFileString(recoveryPath)).toBe("changed marker");

        const rootEntries = yield* fileSystem.readDirectory(root);
        expect(rootEntries.filter((entry) => entry.startsWith(".dufflebag-transaction-"))).toHaveLength(1);
      }),
    ),
  );
});

const rollbackFailureFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fileSystem) =>
    FileSystem.make({
      ...fileSystem,
      copyFile: (oldPath, newPath) =>
        portablePath(newPath).endsWith("/existing.txt")
          ? Effect.fail(
              new SystemError({
                reason: "PermissionDenied",
                module: "FileSystem",
                method: "copyFile",
                pathOrDescriptor: newPath,
                description: "Injected rollback failure.",
              }),
            )
          : fileSystem.copyFile(oldPath, newPath),
      rename: (oldPath, newPath) =>
        portablePath(newPath).endsWith("/fail.txt")
          ? Effect.fail(
              new SystemError({
                reason: "PermissionDenied",
                module: "FileSystem",
                method: "rename",
                pathOrDescriptor: newPath,
                description: "Injected commit failure.",
              }),
            )
          : fileSystem.rename(oldPath, newPath),
    }),
  ),
).pipe(Layer.provide(NodeFileSystem.layer));

const rollbackFailureLayer = Layer.merge(rollbackFailureFileSystemLayer, NodePath.layer);

layer(rollbackFailureLayer)("applyArtifactPlan rollback failure", (it) => {
  it.effect("retains snapshots and writes strict durable recovery evidence", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-recovery-" });
        const originalPath = path.join(root, "existing.txt");
        const receiptPath = path.join(root, ".dufflebag/receipt.json");
        const recoveryPath = path.join(root, ".dufflebag/recovery.json");
        const plan = createWritePlan(root, ["existing.txt", "fail.txt"]);

        yield* fileSystem.writeFile(originalPath, originalBytes);

        const result = yield* Effect.exit(applyArtifactPlan(plan));

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          expect(Cause.pretty(result.cause)).toContain("Injected commit failure");
          expect(Cause.pretty(result.cause)).toContain("Injected rollback failure");
        }
        expect(yield* fileSystem.exists(originalPath)).toBe(false);
        expect(yield* fileSystem.exists(receiptPath)).toBe(false);

        const recoveryJson = yield* fileSystem.readFileString(recoveryPath);
        const recovery = yield* decodeArtifactRecoveryRecordJson(recoveryJson);
        const canonicalRoot = yield* fileSystem.realPath(root);
        const canonicalOriginalPath = path.join(canonicalRoot, "existing.txt");

        expect(recovery._tag).toBe("pending");
        expect(recovery.root).toBe(canonicalRoot);
        expect(recovery.receiptPath).toBe(path.join(canonicalRoot, ".dufflebag/receipt.json"));
        expect(recovery.snapshots.map((snapshot) => snapshot.targetPath)).toContain(canonicalOriginalPath);
        expect(yield* fileSystem.exists(recovery.transactionRoot)).toBe(true);

        const snapshot = recovery.snapshots.find((candidate) => candidate.targetPath === canonicalOriginalPath);
        expect(snapshot?.original._tag).toBe("file");
        if (snapshot?.original._tag === "file") {
          expect([...(yield* fileSystem.readFile(snapshot.original.snapshotPath))]).toEqual([...originalBytes]);
        }

        expect(yield* fileSystem.exists(path.join(recovery.transactionRoot, "staged"))).toBe(false);
      }),
    ),
  );

  it.effect.skipIf(process.platform === "win32")("keeps retained recovery state private on POSIX hosts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-apply-private-recovery-" });
        const originalPath = path.join(root, "existing.txt");
        const recoveryPath = path.join(root, ".dufflebag/recovery.json");
        const plan = createWritePlan(root, ["existing.txt", "fail.txt"]);

        yield* fileSystem.writeFile(originalPath, originalBytes, { mode: 0o600 });
        yield* Effect.exit(applyArtifactPlan(plan));

        const recovery = yield* decodeArtifactRecoveryRecordJson(yield* fileSystem.readFileString(recoveryPath));
        const snapshot = recovery.snapshots.find((candidate) => candidate.targetPath.endsWith("/existing.txt"));

        expect((yield* fileSystem.stat(recovery.transactionRoot)).mode & 0o777).toBe(0o700);
        expect((yield* fileSystem.stat(path.join(recovery.transactionRoot, "pending.json"))).mode & 0o777).toBe(0o600);
        expect(snapshot?.original._tag).toBe("file");
        if (snapshot?.original._tag === "file") {
          expect((yield* fileSystem.stat(snapshot.original.snapshotPath)).mode & 0o777).toBe(0o600);
        }
      }),
    ),
  );
});
