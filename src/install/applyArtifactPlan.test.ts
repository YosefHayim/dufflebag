import * as PlatformError from "@effect/platform/Error";
import * as FileSystem from "@effect/platform/FileSystem";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Cause, Effect, Layer, Option, Schema } from "effect";

import { applyArtifactPlan } from "./applyArtifactPlan.js";
import { type ArtifactPlan, createUninstallPlan, migrateLegacyManifest, validateArtifactPlan } from "./artifactPlan.js";
import {
  type ArtifactReceipt,
  artifactReceiptJsonSchema,
  artifactReceiptSchema,
  ownedArtifactSchema,
  sha256Bytes,
} from "./artifactReceipt.js";

const receiptPath = ".dufflebag/receipt.json";
const recoveryPath = ".dufflebag/recovery.json";

const bytes = (value: string): Uint8Array => {
  return new TextEncoder().encode(value);
};

const decodeArtifact = Schema.validateSync(ownedArtifactSchema, {
  onExcessProperty: "error",
});

const decodeReceipt = Schema.validateSync(artifactReceiptSchema, {
  onExcessProperty: "error",
});

const encodeReceipt = Schema.encodeSync(artifactReceiptJsonSchema);

type FileSpec = {
  readonly path: string;
  readonly desired: Uint8Array;
  readonly prior?: Uint8Array;
  readonly mode?: number;
};

const wholeFileArtifact = (spec: FileSpec) => {
  return decodeArtifact({
    path: spec.path,
    owner: { _tag: "application" },
    kind: "runtime",
    ownership: {
      _tag: "wholeFile",
      installedSha256: sha256Bytes(spec.desired),
      prior:
        spec.prior === undefined
          ? { _tag: "missing" }
          : {
              _tag: "file",
              bytes: spec.prior,
              sha256: sha256Bytes(spec.prior),
            },
    },
  });
};

const freshPlan = (root: string, ...input: [specs: ReadonlyArray<FileSpec>, operationPaths?: ReadonlyArray<string>]): ArtifactPlan => {
  const [specs, requestedOperationPaths] = input;
  const operationPaths = requestedOperationPaths ?? specs.map((spec) => spec.path);
  const artifacts = specs.map(wholeFileArtifact).sort((left, right) => left.path.localeCompare(right.path));
  const receipt = decodeReceipt({
    version: 1,
    installerVersion: "0.11.0",
    scope: "project",
    features: ["context-guard"],
    artifacts,
  });
  const observations = artifacts.map((artifact) => {
    const spec = specs.find((candidate) => candidate.path === artifact.path);
    if (spec === undefined) {
      throw new Error(`Missing fixture for ${artifact.path}.`);
    }

    return spec.prior === undefined
      ? {
          path: artifact.path,
          snapshot: { _tag: "missing" },
        }
      : {
          path: artifact.path,
          snapshot: {
            _tag: "file",
            bytes: spec.prior,
            sha256: sha256Bytes(spec.prior),
          },
        };
  });
  const operations = operationPaths.map((operationPath) => {
    const spec = specs.find((candidate) => candidate.path === operationPath);
    if (spec === undefined) {
      throw new Error(`Missing operation fixture for ${operationPath}.`);
    }

    return {
      _tag: "write",
      path: operationPath,
      bytes: spec.desired,
      source: { _tag: "desiredArtifact" },
    };
  });

  return validateArtifactPlan({
    scope: "project",
    root,
    authority: {
      _tag: "fresh",
      observations,
    },
    artifacts,
    operations,
    receipt: {
      _tag: "publishReceipt",
      path: receiptPath,
      value: receipt,
    },
  });
};

type UpdateWholeFilePlanRequest = {
  readonly root: string;
  readonly previousReceipt: ArtifactReceipt;
  readonly targetPath: string;
  readonly currentBytes: Uint8Array;
  readonly desiredBytes: Uint8Array;
};

const updateWholeFilePlan = ({
  root,
  previousReceipt,
  targetPath,
  currentBytes,
  desiredBytes,
}: UpdateWholeFilePlanRequest): ArtifactPlan => {
  if (previousReceipt.artifacts.length !== 1) {
    throw new Error("The simple update fixture requires exactly one prior artifact.");
  }

  const previousArtifact = previousReceipt.artifacts.find((artifact) => artifact.path === targetPath);
  if (previousArtifact?.ownership._tag !== "wholeFile") {
    throw new Error(`Expected whole-file receipt ownership for ${targetPath}.`);
  }

  const desiredArtifact = decodeArtifact({
    ...previousArtifact,
    ownership: {
      ...previousArtifact.ownership,
      installedSha256: sha256Bytes(desiredBytes),
    },
  });
  const desiredReceipt = decodeReceipt({
    ...previousReceipt,
    installerVersion: "0.12.0",
    artifacts: [desiredArtifact],
  });
  const receiptBytes = bytes(encodeReceipt(previousReceipt));

  return validateArtifactPlan({
    scope: previousReceipt.scope,
    root,
    authority: {
      _tag: "receipt",
      receiptPath,
      receiptSha256: sha256Bytes(receiptBytes),
      receipt: previousReceipt,
      observations: [
        {
          path: targetPath,
          snapshot: {
            _tag: "file",
            bytes: currentBytes,
            sha256: sha256Bytes(currentBytes),
          },
        },
      ],
    },
    artifacts: [desiredArtifact],
    operations: [
      {
        _tag: "write",
        path: targetPath,
        bytes: desiredBytes,
        source: { _tag: "desiredArtifact" },
      },
    ],
    receipt: {
      _tag: "publishReceipt",
      path: receiptPath,
      value: desiredReceipt,
    },
  });
};

const makeSystemError = (method: string, targetPath: string) => {
  return new PlatformError.SystemError({
    reason: "PermissionDenied",
    module: "FileSystem",
    method,
    pathOrDescriptor: targetPath,
    description: `Injected ${method} failure for ${targetPath}.`,
  });
};

const withTemporaryRoot = <A, E, R>(run: (root: string) => Effect.Effect<A, E, R>) => {
  // Allocate the fixture root before the test and remove it after every exit path.
  return Effect.gen(function* () {
    // 1. Load the filesystem used by the caller's test layer.
    const fileSystem = yield* FileSystem.FileSystem;
    // 2. Create one isolated root for the transaction fixture.
    const root = yield* fileSystem.makeTempDirectory({ prefix: "dufflebag-writer-test-" });

    // 3. Run the fixture and make cleanup the finalizer for success or failure.
    return yield* run(root).pipe(
      Effect.ensuring(fileSystem.remove(root, { recursive: true, force: true }).pipe(Effect.catchAll(() => Effect.void))),
    );
  });
};

const preparePriorFiles = (root: string, specs: ReadonlyArray<FileSpec>) => {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    // Recreate only the declared pre-transaction state for each independent fixture target.
    for (const spec of specs) {
      if (spec.prior === undefined) {
        continue;
      }

      const targetPath = `${root}/${spec.path}`;
      const parentPath = targetPath.slice(0, targetPath.lastIndexOf("/"));
      yield* fileSystem.makeDirectory(parentPath, { recursive: true });
      yield* fileSystem.writeFile(targetPath, spec.prior, { mode: spec.mode });
      if (spec.mode !== undefined) {
        yield* fileSystem.chmod(targetPath, spec.mode);
      }
    }
  });
};

const readText = (targetPath: string) => {
  return Effect.map(FileSystem.FileSystem, (fileSystem) => fileSystem.readFileString(targetPath)).pipe(Effect.flatten);
};

const expectMissing = (targetPath: string) => {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    expect(yield* fileSystem.exists(targetPath)).toBe(false);
  });
};

const failureFrom = <A, E, R>(effect: Effect.Effect<A, E, R>) => {
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    if (exit._tag === "Success") {
      throw new Error("Expected the effect to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    if (Option.isNone(failure)) {
      throw new Error("Expected a typed failure.");
    }

    return failure.value;
  });
};

layer(Layer.merge(NodeFileSystem.layer, NodePath.layer))("applyArtifactPlan", (it) => {
  it.effect("commits binary writes in semantic order, preserves modes, and publishes the receipt last", () => {
    // Prepare prior bytes, apply the plan, then verify data, order, ownership, and cleanup.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to observe transaction calls.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve the canonical root used by decorated rename paths.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const specs = [
          { path: "z-last.bin", desired: new Uint8Array([0, 255, 4]), prior: bytes("old-z"), mode: 0o640 },
          { path: "a-first.txt", desired: bytes("new-a"), prior: bytes("old-a") },
        ];
        const plan = freshPlan(root, specs, ["z-last.bin", "a-first.txt"]);
        const committedTargets: Array<string> = [];
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            if (fromPath.endsWith(".stage")) {
              committedTargets.push(toPath.slice(canonicalRoot.length + 1));
            }

            return fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize the exact pre-transaction fixture.
        yield* preparePriorFiles(root, specs);
        // 4. Apply through the decorated filesystem that records publication order.
        yield* applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated));

        // 5. Verify the binary target bytes.
        expect(Array.from(yield* fileSystem.readFile(`${root}/z-last.bin`))).toEqual([0, 255, 4]);
        // 6. Verify replacement preserved the original target mode.
        expect((yield* fileSystem.stat(`${root}/z-last.bin`)).mode & 0o777).toBe(0o640);
        expect(committedTargets).toEqual(["z-last.bin", "a-first.txt", receiptPath]);
        // 7. Verify the final receipt encodes the planned ownership exactly.
        expect(JSON.parse(yield* readText(`${root}/${receiptPath}`))).toEqual(JSON.parse(encodeReceipt(plan.receipt.value)));
        // 8. Verify successful cleanup removed the transaction workspace.
        expect((yield* fileSystem.readDirectory(root)).some((name) => name.startsWith(".dufflebag-transaction-"))).toBe(false);
      }),
    );
  });

  it.effect("rolls back a failure before a middle rename and leaves no ownership receipt", () => {
    // Prepare three targets, fail the middle commit, then prove complete rollback without ownership.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to inject the commit failure.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve the canonical path matched by the decorated rename.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const specs = [
          { path: "first.txt", desired: bytes("new-first"), prior: bytes("old-first") },
          { path: "middle.txt", desired: bytes("new-middle"), prior: bytes("old-middle") },
          { path: "last.txt", desired: bytes("new-last"), prior: bytes("old-last") },
        ];
        const plan = freshPlan(root, specs);
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            return fromPath.endsWith(".stage") && toPath === `${canonicalRoot}/middle.txt`
              ? Effect.fail(makeSystemError("rename", toPath))
              : fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize every original target before the transaction.
        yield* preparePriorFiles(root, specs);
        // 4. Apply the plan and capture the expected typed failure.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "rolledBack" });
        // 5. Verify the first committed target was restored.
        expect(yield* readText(`${root}/first.txt`)).toBe("old-first");
        // 6. Verify the failed middle target kept its original bytes.
        expect(yield* readText(`${root}/middle.txt`)).toBe("old-middle");
        // 7. Verify the unattempted final target stayed unchanged.
        expect(yield* readText(`${root}/last.txt`)).toBe("old-last");
        // 8. Verify rollback did not publish ownership.
        yield* expectMissing(`${root}/${receiptPath}`);
      }),
    );
  });

  it.effect("rolls back a delegated rename that mutates and then reports failure", () => {
    // Prepare one owned target, inject an after-mutation failure, then prove rollback restored authority.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to fail after delegation.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve the canonical target path matched by the decorator.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const specs = [{ path: "after.txt", desired: bytes("new"), prior: bytes("old") }];
        const plan = freshPlan(root, specs);
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            if (fromPath.endsWith(".stage") && toPath === `${canonicalRoot}/after.txt`) {
              return fileSystem.rename(fromPath, toPath).pipe(Effect.zipRight(Effect.fail(makeSystemError("rename", toPath))));
            }

            return fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize the original bytes before applying the plan.
        yield* preparePriorFiles(root, specs);
        // 4. Apply and capture the failure reported after rename completed.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "rolledBack" });
        // 5. Verify rollback restored the original target bytes.
        expect(yield* readText(`${root}/after.txt`)).toBe("old");
        // 6. Verify a failed transaction did not publish a receipt.
        yield* expectMissing(`${root}/${receiptPath}`);
      }),
    );
  });

  it.effect("rejects an in-flight target race and preserves the racing writer's bytes", () => {
    // Prepare the observed target, race during staging, then verify fail-closed preservation.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to inject the concurrent write.
        const fileSystem = yield* FileSystem.FileSystem;
        const specs = [{ path: "race.txt", desired: bytes("desired"), prior: bytes("original") }];
        const plan = freshPlan(root, specs);
        let raced = false;
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          writeFile: (...input) => {
            const [targetPath, content, options] = input;
            const write = fileSystem.writeFile(targetPath, content, options);
            if (!raced && targetPath.endsWith(".stage")) {
              raced = true;

              return write.pipe(Effect.zipRight(fileSystem.writeFile(`${root}/race.txt`, bytes("racer"))));
            }

            return write;
          },
        };

        // 2. Materialize the bytes recorded by the plan observation.
        yield* preparePriorFiles(root, specs);
        // 3. Apply through the decorator and capture the authority race failure.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "unchanged" });
        // 4. Verify the transaction preserved the racing writer's bytes.
        expect(yield* readText(`${root}/race.txt`)).toBe("racer");
        // 5. Verify rejected authority never produced ownership evidence.
        yield* expectMissing(`${root}/${receiptPath}`);
      }),
    );
  });

  it.effect("rejects ancestor, target, and broken symlinks plus non-file targets", () => {
    // Create unsafe filesystem shapes, reject each independently, then remove the outside fixture.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to build unsafe target shapes.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Create an isolated path outside the transaction root.
        const outside = yield* fileSystem.makeTempDirectory({ prefix: "dufflebag-writer-outside-" });

        // 3. Exercise unsafe targets and guarantee cleanup of the outside directory.
        yield* Effect.gen(function* () {
          // 1. Create an ancestor symlink that would escape the root.
          yield* fileSystem.symlink(outside, `${root}/linked`);
          // 2. Create a broken target symlink with an outside destination.
          yield* fileSystem.symlink(`${outside}/missing`, `${root}/broken.txt`);
          // 3. Create a non-file target at an otherwise valid path.
          yield* fileSystem.makeDirectory(`${root}/directory.txt`);

          // 4. Validate each unsafe shape separately because one authority snapshot cannot cover the other fixtures.
          for (const targetPath of ["linked/file.txt", "broken.txt", "directory.txt"]) {
            const failure = yield* failureFrom(applyArtifactPlan(freshPlan(root, [{ path: targetPath, desired: bytes("x") }])));
            expect(failure).toMatchObject({ _tag: "ArtifactTargetError" });
          }

          // 5. Verify no rejected target wrote through the ancestor symlink.
          expect(yield* fileSystem.readDirectory(outside)).toEqual([]);
        }).pipe(Effect.ensuring(fileSystem.remove(outside, { recursive: true, force: true }).pipe(Effect.catchAll(() => Effect.void))));
      }),
    );
  });

  it.effect("accepts a plan root reached through a symlink and writes under its canonical directory", () => {
    // Create an alias root, apply through it, then verify the canonical destination receives the write.
    return withTemporaryRoot((container) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to construct the root alias.
        const fileSystem = yield* FileSystem.FileSystem;
        const actualRoot = `${container}/actual`;
        const aliasRoot = `${container}/alias`;
        // 2. Create the canonical transaction root.
        yield* fileSystem.makeDirectory(actualRoot);
        // 3. Point the accepted alias at that canonical root.
        yield* fileSystem.symlink(actualRoot, aliasRoot);

        // 4. Apply the plan through the symlinked root path.
        yield* applyArtifactPlan(freshPlan(aliasRoot, [{ path: "installed.txt", desired: bytes("installed") }]));

        // 5. Verify the artifact was committed inside the canonical directory.
        expect(yield* readText(`${actualRoot}/installed.txt`)).toBe("installed");
      }),
    );
  });

  it.effect("rejects pre-existing recovery evidence before creating a transaction workspace", () => {
    // Publish recovery evidence first, reject the plan, then prove no workspace was allocated.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to seed recovery evidence.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Create the recovery evidence parent directory.
        yield* fileSystem.makeDirectory(`${root}/.dufflebag`);
        // 3. Publish evidence that requires operator recovery.
        yield* fileSystem.writeFileString(`${root}/${recoveryPath}`, "manual recovery required");

        // 4. Apply and capture rejection before transaction preparation.
        const failure = yield* failureFrom(applyArtifactPlan(freshPlan(root, [{ path: "fresh.txt", desired: bytes("fresh") }])));

        expect(failure).toMatchObject({ _tag: "ArtifactTargetError", code: "recovery-exists" });
        // 5. Verify rejection happened before any durable workspace was created.
        expect((yield* fileSystem.readDirectory(root)).some((name) => name.startsWith(".dufflebag-transaction-"))).toBe(false);
      }),
    );
  });

  it.effect("removes the receipt last during uninstall and restores original bytes", () => {
    // Install ownership, plan uninstall, observe mutation order, then verify restoration and receipt removal.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to observe uninstall mutations.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve the canonical root used by decorated mutation paths.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "owned.txt", desired: bytes("installed"), prior: bytes("original") };
        const install = freshPlan(root, [spec]);
        // 3. Materialize the original file before installation.
        yield* preparePriorFiles(root, [spec]);
        // 4. Install the owned artifact and its receipt.
        yield* applyArtifactPlan(install);

        const receipt = install.receipt.value;
        const receiptBytes = bytes(encodeReceipt(receipt));
        const uninstall = createUninstallPlan({
          scope: "project",
          root,
          receiptPath,
          receiptSha256: sha256Bytes(receiptBytes),
          receipt,
          observations: [
            {
              path: spec.path,
              snapshot: { _tag: "file", bytes: spec.desired, sha256: sha256Bytes(spec.desired) },
            },
          ],
          restorations: [{ _tag: "write", path: spec.path, bytes: spec.prior }],
        });
        const mutations: Array<string> = [];
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            if (fromPath.endsWith(".stage")) {
              mutations.push(toPath.slice(canonicalRoot.length + 1));
            }

            return fileSystem.rename(fromPath, toPath);
          },
          remove: (targetPath, options) => {
            if (targetPath === `${canonicalRoot}/${receiptPath}`) {
              mutations.push(receiptPath);
            }

            return fileSystem.remove(targetPath, options);
          },
        };

        // 5. Apply uninstall through the mutation-order decorator.
        yield* applyArtifactPlan(uninstall).pipe(Effect.provideService(FileSystem.FileSystem, decorated));

        expect(mutations.slice(0, 2)).toEqual([spec.path, receiptPath]);
        // 6. Verify uninstall restored the original artifact bytes.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("original");
        // 7. Verify ownership was removed only after restoration.
        yield* expectMissing(`${root}/${receiptPath}`);
      }),
    );
  });

  it.effect("keeps committed artifacts authoritative when cleanup fails after receipt publication", () => {
    // Commit the transaction, fail workspace cleanup, then verify receipt-backed committed state remains.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to inject cleanup failure.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve the canonical workspace prefix matched by the decorator.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "committed.txt", desired: bytes("new"), prior: bytes("old") };
        const plan = freshPlan(root, [spec]);
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          remove: (targetPath, options) => {
            return targetPath.startsWith(`${canonicalRoot}/.dufflebag-transaction-`)
              ? Effect.fail(makeSystemError("remove", targetPath))
              : fileSystem.remove(targetPath, options);
          },
        };

        // 3. Materialize the original target before the transaction.
        yield* preparePriorFiles(root, [spec]);
        // 4. Apply and capture the failure after receipt publication.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "committed" });
        // 5. Verify the desired artifact remains committed.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("new");
        // 6. Verify the receipt still authorizes that committed artifact.
        expect(JSON.parse(yield* readText(`${root}/${receiptPath}`))).toEqual(JSON.parse(encodeReceipt(plan.receipt.value)));
      }),
    );
  });

  it.effect("continues reverse rollback, publishes strict recovery evidence, and retains snapshots", () => {
    // Fail commit and rollback, then verify reverse restoration, recovery evidence, and durable snapshots.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to inject commit and rollback failures.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve canonical paths matched by the decorated renames.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const specs = [
          { path: "first.txt", desired: bytes("new-first"), prior: bytes("old-first"), mode: 0o600 },
          { path: "second.txt", desired: bytes("new-second"), prior: bytes("old-second") },
          { path: "third.txt", desired: bytes("new-third"), prior: bytes("old-third") },
        ];
        const plan = freshPlan(root, specs);
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            if (fromPath.endsWith(".stage") && toPath === `${canonicalRoot}/third.txt`) {
              return Effect.fail(makeSystemError("rename", toPath));
            }
            if (fromPath.endsWith(".restore") && toPath === `${canonicalRoot}/second.txt`) {
              return Effect.fail(makeSystemError("rename", toPath));
            }

            return fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize all original targets and their modes.
        yield* preparePriorFiles(root, specs);
        // 4. Apply and capture the recovery-required rollback result.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({
          _tag: "ArtifactRecoveryRequiredError",
          phase: "rollback",
          unrecoveredPaths: ["second.txt"],
        });
        // 5. Verify reverse rollback restored the earliest committed target.
        expect(yield* readText(`${root}/first.txt`)).toBe("old-first");
        // 6. Verify the failed restore left its desired bytes for manual recovery.
        expect(yield* readText(`${root}/second.txt`)).toBe("new-second");
        // 7. Verify the rejected final commit kept original bytes.
        expect(yield* readText(`${root}/third.txt`)).toBe("old-third");
        // 8. Verify incomplete rollback did not publish ownership.
        yield* expectMissing(`${root}/${receiptPath}`);

        // 9. Read the strict recovery record published for the operator.
        const recovery = JSON.parse(yield* readText(`${root}/${recoveryPath}`));
        expect(recovery).toMatchObject({
          version: 1,
          phase: "rollback",
          root: canonicalRoot,
          receiptPath,
          unrecoveredPaths: ["second.txt"],
        });
        expect(typeof recovery.transactionId).toBe("string");
        expect(typeof recovery.workspacePath).toBe("string");
        // 10. Verify the retained workspace path remains readable.
        expect(yield* fileSystem.exists(recovery.workspacePath)).toBe(true);

        // 11. Read and verify the retained snapshot index and exact prior mode.
        const snapshotIndex = JSON.parse(yield* readText(`${recovery.workspacePath}/snapshot-index.json`));
        expect(snapshotIndex).toMatchObject({ version: 1, transactionId: recovery.transactionId, root: canonicalRoot, receiptPath });
        expect(snapshotIndex.entries).toHaveLength(4);
        expect(snapshotIndex.entries.find((entry: { path?: string }) => entry.path === "first.txt")).toMatchObject({
          original: { _tag: "file", sha256: sha256Bytes(bytes("old-first")), mode: 0o600 },
        });
      }),
    );
  });

  it.effect("retains the durable workspace when recovery-record publication also fails", () => {
    // Force rollback and recovery-record failures, then verify the durable index remains discoverable.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to inject all three failure points.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve canonical mutation paths matched by the decorator.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "owned.txt", desired: bytes("new"), prior: bytes("old") };
        const plan = freshPlan(root, [spec]);
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            if (fromPath.endsWith(".stage") && toPath === `${canonicalRoot}/owned.txt`) {
              return fileSystem.rename(fromPath, toPath).pipe(Effect.zipRight(Effect.fail(makeSystemError("rename", toPath))));
            }
            if (fromPath.endsWith(".restore") || toPath === `${canonicalRoot}/${recoveryPath}`) {
              return Effect.fail(makeSystemError("rename", toPath));
            }

            return fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize the original artifact before applying the plan.
        yield* preparePriorFiles(root, [spec]);
        // 4. Apply and capture the recovery-required result.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));
        if (typeof failure !== "object" || failure === null || !("_tag" in failure) || failure._tag !== "ArtifactRecoveryRequiredError") {
          throw new Error("Expected recovery-required failure details.");
        }

        expect(failure.recoveryRecordStatus).toBe("failed");
        // 5. Verify the workspace survives failed recovery-record publication.
        expect(yield* fileSystem.exists(failure.workspacePath)).toBe(true);
        // 6. Verify its durable index remains available for manual recovery.
        expect(yield* fileSystem.exists(`${failure.workspacePath}/snapshot-index.json`)).toBe(true);
        // 7. Verify the failed publication did not leave a recovery record.
        yield* expectMissing(`${root}/${recoveryPath}`);
      }),
    );
  });

  it.effect("uses exclusive same-directory stages without removing an existing target before rename", () => {
    // Observe stage creation and final renames, then prove exclusive same-directory replacement semantics.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to record staging and replacement calls.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve canonical target paths emitted by the transaction.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "mode.txt", desired: bytes("desired"), prior: bytes("original"), mode: 0o640 };
        const plan = freshPlan(root, [spec]);
        const writes = new Map<string, FileSystem.WriteFileOptions | undefined>();
        const finalRenames: Array<{ readonly fromPath: string; readonly toPath: string }> = [];
        const prematureRemovals: Array<string> = [];
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          writeFile: (...input) => {
            const [targetPath, content, options] = input;
            writes.set(targetPath, options);

            return fileSystem.writeFile(targetPath, content, options);
          },
          rename: (fromPath, toPath) => {
            if (toPath === `${canonicalRoot}/${spec.path}` || toPath === `${canonicalRoot}/${receiptPath}`) {
              finalRenames.push({ fromPath, toPath });
            }

            return fileSystem.rename(fromPath, toPath);
          },
          remove: (targetPath, options) => {
            if (targetPath === `${canonicalRoot}/${spec.path}`) {
              prematureRemovals.push(targetPath);
            }

            return fileSystem.remove(targetPath, options);
          },
        };

        // 3. Materialize the existing target and its mode.
        yield* preparePriorFiles(root, [spec]);
        // 4. Apply through the decorator that records stage and replacement behavior.
        yield* applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated));

        expect(finalRenames).toHaveLength(2);
        // Each final rename must originate from an exclusively created sibling stage.
        for (const rename of finalRenames) {
          expect(rename.fromPath.slice(0, rename.fromPath.lastIndexOf("/"))).toBe(rename.toPath.slice(0, rename.toPath.lastIndexOf("/")));
          expect(writes.get(rename.fromPath)?.flag).toBe("wx");
        }
        expect(prematureRemovals).toEqual([]);
        // 5. Verify receipt bytes are the canonical planned encoding.
        expect(yield* readText(`${root}/${receiptPath}`)).toBe(encodeReceipt(plan.receipt.value));
      }),
    );
  });

  it.effect("cleans a failed durable snapshot without mutating targets", () => {
    // Capture workspace creation, fail snapshot persistence, then verify unchanged state and cleanup.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to observe and fail workspace writes.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve the canonical root used to identify the transaction workspace.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "snapshot.txt", desired: bytes("desired"), prior: bytes("original") };
        const plan = freshPlan(root, [spec]);
        let workspacePath: string | undefined;
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          makeTempDirectory: (options) =>
            fileSystem.makeTempDirectory(options).pipe(
              Effect.tap((createdPath) => {
                if (options?.directory === canonicalRoot) {
                  workspacePath = createdPath;
                }
              }),
            ),
          writeFile: (...input) => {
            const [targetPath, content, options] = input;
            return workspacePath !== undefined && targetPath.startsWith(`${workspacePath}/`)
              ? Effect.fail(makeSystemError("writeFile", targetPath))
              : fileSystem.writeFile(targetPath, content, options);
          },
        };

        // 3. Materialize the target before snapshot preparation begins.
        yield* preparePriorFiles(root, [spec]);
        // 4. Apply and capture the pre-mutation snapshot failure.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "unchanged" });
        // 5. Verify the target retained its original bytes.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("original");
        // 6. Verify no receipt was published for the unchanged transaction.
        yield* expectMissing(`${root}/${receiptPath}`);
        if (workspacePath === undefined) {
          throw new Error("Expected the transaction workspace to be captured.");
        }
        // 7. Verify preparation cleanup removed the captured workspace.
        expect(yield* fileSystem.exists(workspacePath)).toBe(false);
      }),
    );
  });

  it.effect("cleans sibling stages and transaction-created parents after a delegated stage failure", () => {
    // Fail the second staged write, then prove all stages, new parents, ownership, and workspace are removed.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to observe workspace and sibling stages.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve the canonical root used to distinguish those writes.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const specs = [
          { path: "nested/first.txt", desired: bytes("first") },
          { path: "nested/second.txt", desired: bytes("second") },
        ];
        const plan = freshPlan(root, specs);
        let workspacePath: string | undefined;
        let siblingStageWrites = 0;
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          makeTempDirectory: (options) =>
            fileSystem.makeTempDirectory(options).pipe(
              Effect.tap((createdPath) => {
                if (options?.directory === canonicalRoot) {
                  workspacePath = createdPath;
                }
              }),
            ),
          writeFile: (...input) => {
            const [targetPath, content, options] = input;
            const isSiblingStage = options?.flag === "wx" && workspacePath !== undefined && !targetPath.startsWith(`${workspacePath}/`);
            if (!isSiblingStage) {
              return fileSystem.writeFile(targetPath, content, options);
            }

            siblingStageWrites += 1;
            const write = fileSystem.writeFile(targetPath, content, options);

            return siblingStageWrites === 2 ? write.pipe(Effect.zipRight(Effect.fail(makeSystemError("writeFile", targetPath)))) : write;
          },
        };

        // 3. Apply and capture the failure reported after the second stage was written.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "unchanged" });
        // 4. Verify cleanup removed the first staged destination.
        yield* expectMissing(`${root}/nested/first.txt`);
        // 5. Verify cleanup removed the second staged destination.
        yield* expectMissing(`${root}/nested/second.txt`);
        // 6. Verify cleanup pruned the transaction-created parent directory.
        expect(yield* fileSystem.exists(`${root}/nested`)).toBe(false);
        // 7. Verify the failed preparation never published ownership.
        yield* expectMissing(`${root}/${receiptPath}`);
        if (workspacePath === undefined) {
          throw new Error("Expected the transaction workspace to be captured.");
        }
        // 8. Verify cleanup removed the captured transaction workspace.
        expect(yield* fileSystem.exists(workspacePath)).toBe(false);
      }),
    );
  });

  it.effect("rolls artifacts back when receipt publication fails before delegation", () => {
    // Commit the artifact, fail receipt rename before delegation, then verify exact rollback and cleanup.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to reject receipt publication.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve the canonical receipt path matched by the decorator.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "receipt-before.txt", desired: bytes("desired"), prior: bytes("original"), mode: 0o640 };
        const plan = freshPlan(root, [spec]);
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            return toPath === `${canonicalRoot}/${receiptPath}`
              ? Effect.fail(makeSystemError("rename", toPath))
              : fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize the original bytes and mode.
        yield* preparePriorFiles(root, [spec]);
        // 4. Apply and capture the receipt publication failure.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "rolledBack" });
        // 5. Verify rollback restored the original bytes.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("original");
        // 6. Verify rollback restored the exact original mode.
        expect((yield* fileSystem.stat(`${root}/${spec.path}`)).mode & 0o777).toBe(0o640);
        // 7. Verify failed publication left no receipt.
        yield* expectMissing(`${root}/${receiptPath}`);
        // 8. Verify successful rollback required no recovery record.
        yield* expectMissing(`${root}/${recoveryPath}`);
      }),
    );
  });

  it.effect("reports committed when receipt publication mutates and then reports failure", () => {
    // Commit artifact and receipt, inject an after-publication failure, then verify committed authority.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to fail after receipt rename.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve the canonical receipt path matched by the decorator.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "receipt-after.txt", desired: bytes("desired"), prior: bytes("original") };
        const plan = freshPlan(root, [spec]);
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            return toPath === `${canonicalRoot}/${receiptPath}`
              ? fileSystem.rename(fromPath, toPath).pipe(Effect.zipRight(Effect.fail(makeSystemError("rename", toPath))))
              : fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize the original target before applying the plan.
        yield* preparePriorFiles(root, [spec]);
        // 4. Apply and capture the failure reported after receipt publication.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "committed" });
        // 5. Verify desired artifact bytes remain committed.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("desired");
        // 6. Verify the canonical receipt remains the authority.
        expect(yield* readText(`${root}/${receiptPath}`)).toBe(encodeReceipt(plan.receipt.value));
      }),
    );
  });

  it.effect("restores journal entries in reverse mutation order", () => {
    // Commit two targets, fail the third, then record the exact order used to restore the journal.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to observe delegated renames.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Canonicalize the root so captured rename targets can be compared exactly.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const specs = [
          { path: "first.txt", desired: bytes("new-first"), prior: bytes("old-first") },
          { path: "second.txt", desired: bytes("new-second"), prior: bytes("old-second") },
          { path: "third.txt", desired: bytes("new-third"), prior: bytes("old-third") },
        ];
        const plan = freshPlan(root, specs);
        const renameCounts = new Map<string, number>();
        const restoreOrder: Array<string> = [];
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            const relativeTarget = toPath.startsWith(`${canonicalRoot}/`) ? toPath.slice(canonicalRoot.length + 1) : undefined;
            if (relativeTarget === "third.txt") {
              return Effect.fail(makeSystemError("rename", toPath));
            }
            if (relativeTarget === "first.txt" || relativeTarget === "second.txt") {
              const count = (renameCounts.get(relativeTarget) ?? 0) + 1;
              renameCounts.set(relativeTarget, count);
              if (count === 2) {
                restoreOrder.push(relativeTarget);
              }
            }

            return fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize the original bytes before committing the plan.
        yield* preparePriorFiles(root, specs);
        // 4. Trigger the third commit failure and complete rollback.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "rolledBack" });
        expect(restoreOrder).toEqual(["second.txt", "first.txt"]);
      }),
    );
  });

  it.effect("removes an originally missing target when a later commit fails", () => {
    // Create a new nested target, fail a later commit, then prove rollback prunes only its new directory.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to inspect cleanup.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Canonicalize the root for the injected later-target failure.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const specs = [
          { path: "new/path.txt", desired: bytes("created") },
          { path: "later.txt", desired: bytes("new-later"), prior: bytes("old-later") },
        ];
        const plan = freshPlan(root, specs);
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            return toPath === `${canonicalRoot}/later.txt`
              ? Effect.fail(makeSystemError("rename", toPath))
              : fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize the pre-existing target while leaving the nested target absent.
        yield* preparePriorFiles(root, specs);
        // 4. Fail the later commit and let rollback remove the newly created target.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "rolledBack" });
        // 5. Verify the originally missing file was removed.
        yield* expectMissing(`${root}/new/path.txt`);
        // 6. Verify the transaction-created parent was pruned.
        expect(yield* fileSystem.exists(`${root}/new`)).toBe(false);
        // 7. Verify the pre-existing target regained its original bytes.
        expect(yield* readText(`${root}/later.txt`)).toBe("old-later");
      }),
    );
  });

  it.effect("rejects a receipt hash mismatch before changing an installed artifact", () => {
    // Install once, change only the raw receipt bytes, then prove update authority fails before mutation.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to alter the receipt bytes.
        const fileSystem = yield* FileSystem.FileSystem;
        const spec = { path: "update.txt", desired: bytes("v1"), prior: bytes("original") };
        const install = freshPlan(root, [spec]);
        // 2. Materialize the artifact's original bytes.
        yield* preparePriorFiles(root, [spec]);
        // 3. Publish the canonical installed artifact and receipt.
        yield* applyArtifactPlan(install);
        const update = updateWholeFilePlan({
          root,
          previousReceipt: install.receipt.value,
          targetPath: spec.path,
          currentBytes: spec.desired,
          desiredBytes: bytes("v2"),
        });
        // 4. Change the raw receipt while preserving its decoded JSON value.
        yield* fileSystem.writeFileString(`${root}/${receiptPath}`, `${encodeReceipt(install.receipt.value)}\n`);

        // 5. Reject the now-stale receipt authority.
        const failure = yield* failureFrom(applyArtifactPlan(update));

        expect(failure).toMatchObject({ _tag: "ArtifactTargetError", code: "authority-changed", path: receiptPath });
        // 6. Verify the installed artifact remained untouched.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("v1");
      }),
    );
  });

  it.effect("treats a delegated receipt removal failure as committed after uninstall state is visible", () => {
    // Install once, delegate receipt removal, then classify a post-removal error from the visible commit state.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to decorate receipt removal.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Canonicalize the root for the exact receipt path match.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "uninstall.txt", desired: bytes("installed"), prior: bytes("original") };
        const install = freshPlan(root, [spec]);
        // 3. Materialize the artifact's original bytes.
        yield* preparePriorFiles(root, [spec]);
        // 4. Publish the installed artifact and receipt.
        yield* applyArtifactPlan(install);
        const receiptBytes = bytes(encodeReceipt(install.receipt.value));
        const uninstall = createUninstallPlan({
          scope: "project",
          root,
          receiptPath,
          receiptSha256: sha256Bytes(receiptBytes),
          receipt: install.receipt.value,
          observations: [
            {
              path: spec.path,
              snapshot: { _tag: "file", bytes: spec.desired, sha256: sha256Bytes(spec.desired) },
            },
          ],
          restorations: [{ _tag: "write", path: spec.path, bytes: spec.prior }],
        });
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          remove: (targetPath, options) => {
            return targetPath === `${canonicalRoot}/${receiptPath}`
              ? fileSystem.remove(targetPath, options).pipe(Effect.zipRight(Effect.fail(makeSystemError("remove", targetPath))))
              : fileSystem.remove(targetPath, options);
          },
        };

        // 5. Capture the delegated failure after receipt removal changed the commit state.
        const failure = yield* failureFrom(applyArtifactPlan(uninstall).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "committed" });
        // 6. Verify the artifact restoration remains committed.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("original");
        // 7. Verify the removed receipt remains absent.
        yield* expectMissing(`${root}/${receiptPath}`);
      }),
    );
  });

  it.effect("retains recovery evidence when a failed receipt mutation leaves an invalid target", () => {
    // Commit an artifact, replace the receipt with a directory, then require durable ambiguous-state evidence.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to replace the receipt target.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Canonicalize the root for the exact receipt mutation path.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "ambiguous-receipt.txt", desired: bytes("desired"), prior: bytes("original") };
        const plan = freshPlan(root, [spec]);
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            return toPath === `${canonicalRoot}/${receiptPath}`
              ? fileSystem.makeDirectory(toPath).pipe(Effect.zipRight(Effect.fail(makeSystemError("rename", toPath))))
              : fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize the artifact's original bytes.
        yield* preparePriorFiles(root, [spec]);
        // 4. Capture the recovery-required failure after the ambiguous receipt mutation.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({
          _tag: "ArtifactRecoveryRequiredError",
          phase: "receipt",
          unrecoveredPaths: [receiptPath],
        });
        // 5. Verify the ordinary mutation remains visible for manual recovery.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("desired");
        // 6. Verify durable recovery evidence was published beside the invalid receipt.
        expect(JSON.parse(yield* readText(`${root}/${recoveryPath}`))).toMatchObject({
          phase: "receipt",
          unrecoveredPaths: [receiptPath],
        });
      }),
    );
  });

  it.effect("rechecks a staged file immediately before rename", () => {
    // Corrupt a verified stage after preparation and prove the final target rename is never delegated.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to corrupt the captured stage.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Canonicalize the root for exact target-read and rename observation.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "stage-race.txt", desired: bytes("desired"), prior: bytes("original") };
        const plan = freshPlan(root, [spec]);
        let stagePath: string | undefined;
        let targetReads = 0;
        let finalRenameCount = 0;
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          writeFile: (...input) => {
            const [targetPath, content, options] = input;
            if (options?.flag === "wx" && targetPath.includes(".stage-race.txt.") && targetPath.endsWith(".stage")) {
              stagePath = targetPath;
            }

            return fileSystem.writeFile(targetPath, content, options);
          },
          readFile: (targetPath, options) => {
            if (targetPath === `${canonicalRoot}/${spec.path}`) {
              targetReads += 1;
              if (targetReads === 3 && stagePath !== undefined) {
                return fileSystem.writeFile(stagePath, bytes("corrupt")).pipe(Effect.zipRight(fileSystem.readFile(targetPath, options)));
              }
            }

            return fileSystem.readFile(targetPath, options);
          },
          rename: (fromPath, toPath) => {
            if (toPath === `${canonicalRoot}/${spec.path}`) {
              finalRenameCount += 1;
            }

            return fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize the original target before staging.
        yield* preparePriorFiles(root, [spec]);
        // 4. Capture the transaction failure caused by the corrupted sibling.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "rolledBack" });
        expect(finalRenameCount).toBe(0);
        // 5. Verify the original target was never replaced by corrupt staged bytes.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("original");
        // 6. Verify no ownership receipt was published.
        yield* expectMissing(`${root}/${receiptPath}`);
      }),
    );
  });

  it.effect("surfaces a preparation cleanup failure without claiming disposable state was removed", () => {
    // Fail after creating a stage, fail its cleanup, then require the cleanup cause to become the typed result.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to fail stage creation and cleanup.
        const fileSystem = yield* FileSystem.FileSystem;
        const spec = { path: "cleanup.txt", desired: bytes("desired") };
        const plan = freshPlan(root, [spec]);
        let stagePath: string | undefined;
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          writeFile: (...input) => {
            const [targetPath, content, options] = input;
            if (options?.flag === "wx" && targetPath.includes(".cleanup.txt.") && targetPath.endsWith(".stage")) {
              stagePath = targetPath;

              return fileSystem
                .writeFile(targetPath, content, options)
                .pipe(Effect.zipRight(Effect.fail(makeSystemError("writeFile", targetPath))));
            }

            return fileSystem.writeFile(targetPath, content, options);
          },
          remove: (targetPath, options) => {
            return targetPath === stagePath ? Effect.fail(makeSystemError("remove", targetPath)) : fileSystem.remove(targetPath, options);
          },
        };

        // 2. Capture the typed failure after both preparation and cleanup fail.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({
          _tag: "ArtifactTransactionError",
          state: "unchanged",
          phase: "cleanup",
          cause: { _tag: "Fail", error: { method: "remove" } },
        });
        // 3. Verify the target and receipt were never committed.
        yield* expectMissing(`${root}/${spec.path}`);
        expect(stagePath).toBeDefined();
        // 4. Verify the failed stage cleanup remains observable instead of being silently claimed as removed.
        expect(yield* fileSystem.exists(stagePath ?? "")).toBe(true);
        // 5. Verify no receipt was published.
        yield* expectMissing(`${root}/${receiptPath}`);
      }),
    );
  });

  it.effect("preserves the cleanup cause after a delegated receipt commit failure", () => {
    // Commit receipt bytes, report a delegated error, fail workspace cleanup, then surface the cleanup cause.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to decorate receipt publication and cleanup.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Canonicalize the root for exact receipt and workspace path checks.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "receipt-cleanup.txt", desired: bytes("desired"), prior: bytes("original") };
        const plan = freshPlan(root, [spec]);
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            return toPath === `${canonicalRoot}/${receiptPath}`
              ? fileSystem.rename(fromPath, toPath).pipe(Effect.zipRight(Effect.fail(makeSystemError("rename", toPath))))
              : fileSystem.rename(fromPath, toPath);
          },
          remove: (targetPath, options) => {
            return targetPath.startsWith(`${canonicalRoot}/.dufflebag-transaction-`)
              ? Effect.fail(makeSystemError("remove", targetPath))
              : fileSystem.remove(targetPath, options);
          },
        };

        // 3. Materialize the original artifact bytes.
        yield* preparePriorFiles(root, [spec]);
        // 4. Capture the committed cleanup failure.
        const failure = yield* failureFrom(applyArtifactPlan(plan).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({
          _tag: "ArtifactTransactionError",
          state: "committed",
          phase: "cleanup",
          cause: { _tag: "Fail", error: { method: "remove" } },
        });
        // 5. Verify the desired artifact remains committed.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("desired");
        // 6. Verify the canonical receipt remains authoritative.
        expect(yield* readText(`${root}/${receiptPath}`)).toBe(encodeReceipt(plan.receipt.value));
      }),
    );
  });

  it.effect("publishes a successful update and restores its exact prior receipt when the next publication fails", () => {
    // Install, update once, then fail the next receipt publication and verify both prior authorities return exactly.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to compare exact receipt bytes.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Canonicalize the root for the injected receipt failure.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "updated.txt", desired: bytes("v1"), prior: bytes("original") };
        const install = freshPlan(root, [spec]);
        // 3. Materialize the pre-install target bytes.
        yield* preparePriorFiles(root, [spec]);
        // 4. Publish the first installed state.
        yield* applyArtifactPlan(install);
        const firstUpdate = updateWholeFilePlan({
          root,
          previousReceipt: install.receipt.value,
          targetPath: spec.path,
          currentBytes: spec.desired,
          desiredBytes: bytes("v2"),
        });
        // 5. Publish the successful successor artifact and receipt.
        yield* applyArtifactPlan(firstUpdate);
        const priorReceiptBytes = encodeReceipt(firstUpdate.receipt.value);
        const secondUpdate = updateWholeFilePlan({
          root,
          previousReceipt: firstUpdate.receipt.value,
          targetPath: spec.path,
          currentBytes: bytes("v2"),
          desiredBytes: bytes("v3"),
        });
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          rename: (fromPath, toPath) => {
            return toPath === `${canonicalRoot}/${receiptPath}`
              ? Effect.fail(makeSystemError("rename", toPath))
              : fileSystem.rename(fromPath, toPath);
          },
        };

        // 6. Fail the second successor receipt before delegation and complete rollback.
        const failure = yield* failureFrom(applyArtifactPlan(secondUpdate).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "rolledBack" });
        // 7. Verify the previously successful artifact bytes were restored.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("v2");
        // 8. Verify the prior receipt was restored byte-for-byte.
        expect(yield* readText(`${root}/${receiptPath}`)).toBe(priorReceiptBytes);
      }),
    );
  });

  it.effect("restores installed state when receipt removal fails before delegation", () => {
    // Install once, restore the artifact, fail receipt removal, then roll both authorities back to installed state.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to reject receipt removal.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Canonicalize the root for the exact receipt path.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const spec = { path: "uninstall-rollback.txt", desired: bytes("installed"), prior: bytes("original") };
        const install = freshPlan(root, [spec]);
        // 3. Materialize the original file before installation.
        yield* preparePriorFiles(root, [spec]);
        // 4. Publish the installed file and canonical receipt.
        yield* applyArtifactPlan(install);
        const receiptBytes = bytes(encodeReceipt(install.receipt.value));
        const uninstall = createUninstallPlan({
          scope: "project",
          root,
          receiptPath,
          receiptSha256: sha256Bytes(receiptBytes),
          receipt: install.receipt.value,
          observations: [
            {
              path: spec.path,
              snapshot: { _tag: "file", bytes: spec.desired, sha256: sha256Bytes(spec.desired) },
            },
          ],
          restorations: [{ _tag: "write", path: spec.path, bytes: spec.prior }],
        });
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          remove: (targetPath, options) => {
            return targetPath === `${canonicalRoot}/${receiptPath}`
              ? Effect.fail(makeSystemError("remove", targetPath))
              : fileSystem.remove(targetPath, options);
          },
        };

        // 5. Fail receipt removal before delegation and complete reverse rollback.
        const failure = yield* failureFrom(applyArtifactPlan(uninstall).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "rolledBack" });
        // 6. Verify installed artifact bytes were restored.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("installed");
        // 7. Verify the exact installed receipt remains authoritative.
        expect(yield* readText(`${root}/${receiptPath}`)).toBe(encodeReceipt(install.receipt.value));
      }),
    );
  });

  it.effect("migrates a validated legacy manifest and removes it before receipt publication", () => {
    // Bind exact legacy bytes, install the desired artifact, remove the manifest, then publish canonical ownership.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to materialize legacy authority.
        const fileSystem = yield* FileSystem.FileSystem;
        const spec = { path: "legacy.txt", desired: bytes("installed") };
        const desiredPlan = freshPlan(root, [spec]);
        const legacyManifest = {
          version: "0.10.0",
          scope: "project",
          features: ["context-guard"],
          skills: ["context-guard"],
          installedAt: "2026-07-14T00:00:00.000Z",
        };
        const legacyBytes = bytes(JSON.stringify(legacyManifest));
        const plan = migrateLegacyManifest({
          legacyManifest,
          legacyManifestBytes: legacyBytes,
          legacyManifestSha256: sha256Bytes(legacyBytes),
          desiredPlan,
        });
        const manifestPath = `${root}/.claude/dufflebag/manifest.json`;
        // 2. Create the legacy manifest parent directories.
        yield* fileSystem.makeDirectory(`${root}/.claude/dufflebag`, { recursive: true });
        // 3. Persist the exact authority bytes consumed by the migration plan.
        yield* fileSystem.writeFile(manifestPath, legacyBytes);
        // 4. Apply the complete legacy migration transaction.
        yield* applyArtifactPlan(plan);

        // 5. Verify the desired artifact was installed.
        expect(yield* readText(`${root}/${spec.path}`)).toBe("installed");
        // 6. Verify the legacy authority was removed in the same transaction.
        yield* expectMissing(manifestPath);
        // 7. Verify canonical receipt ownership was published last.
        expect(yield* readText(`${root}/${receiptPath}`)).toBe(encodeReceipt(plan.receipt.value));
      }),
    );
  });

  it.effect("rejects invalid roots and every pre-existing recovery node shape before workspace creation", () => {
    // Reject missing/file roots, then reject directory, link, and broken-link recovery evidence in isolated roots.
    return withTemporaryRoot((container) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to construct invalid roots and recovery shapes.
        const fileSystem = yield* FileSystem.FileSystem;
        const fileRoot = `${container}/root-file`;
        // 2. Create a non-directory root fixture.
        yield* fileSystem.writeFileString(fileRoot, "not a directory");
        // 3. Reject a missing root before any workspace exists.
        const missingFailure = yield* failureFrom(
          applyArtifactPlan(freshPlan(`${container}/missing-root`, [{ path: "target.txt", desired: bytes("x") }])),
        );
        // 4. Reject a non-directory root before any workspace exists.
        const fileFailure = yield* failureFrom(applyArtifactPlan(freshPlan(fileRoot, [{ path: "target.txt", desired: bytes("x") }])));
        expect(missingFailure).toMatchObject({ _tag: "ArtifactTargetError", code: "invalid-root" });
        expect(fileFailure).toMatchObject({ _tag: "ArtifactTargetError", code: "invalid-root" });

        // 5. Test each shape in an isolated root so one rejected recovery node cannot affect another assertion.
        for (const shape of ["directory", "symlink", "brokenSymlink"]) {
          const root = `${container}/${shape}`;
          yield* fileSystem.makeDirectory(`${root}/.dufflebag`, { recursive: true });
          const targetPath = `${root}/${recoveryPath}`;
          if (shape === "directory") {
            yield* fileSystem.makeDirectory(targetPath);
          } else {
            const destination = shape === "symlink" ? fileRoot : `${container}/missing-destination`;
            yield* fileSystem.symlink(destination, targetPath);
          }

          const failure = yield* failureFrom(applyArtifactPlan(freshPlan(root, [{ path: "target.txt", desired: bytes("x") }])));
          expect(failure).toMatchObject({
            _tag: "ArtifactTargetError",
            code: shape === "directory" ? "recovery-exists" : "symbolic-link",
          });
          expect((yield* fileSystem.readDirectory(root)).some((name) => name.startsWith(".dufflebag-transaction-"))).toBe(false);
        }
      }),
    );
  });

  it.effect("rejects artifact paths that make the reserved recovery path an ancestor", () => {
    // Validate the reserved recovery subtree before creating any transaction workspace.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to verify zero workspace creation.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Reject a plan whose artifact would require recovery.json to become a directory.
        const failure = yield* failureFrom(
          applyArtifactPlan(freshPlan(root, [{ path: `${recoveryPath}/child`, desired: bytes("unsafe") }])),
        );

        expect(failure).toMatchObject({ _tag: "ArtifactTargetError", code: "recovery-path-collision" });
        // 3. Verify target validation stopped before durable workspace creation.
        expect((yield* fileSystem.readDirectory(root)).some((name) => name.startsWith(".dufflebag-transaction-"))).toBe(false);
      }),
    );
  });

  it.effect("rejects a receipt that occupies its reserved recovery path", () => {
    // Derive recovery beside the receipt, then reject exact path equality before allocating durable state.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to verify zero workspace creation.
        const fileSystem = yield* FileSystem.FileSystem;
        // Build a structurally valid plan whose receipt is named recovery.json.
        const basePlan = freshPlan(root, [{ path: "target.txt", desired: bytes("unsafe") }]);
        if (basePlan.receipt._tag !== "publishReceipt") {
          throw new Error("Expected the fresh-plan fixture to publish a receipt.");
        }
        const plan = validateArtifactPlan({
          ...basePlan,
          receipt: {
            ...basePlan.receipt,
            path: recoveryPath,
          },
        });

        // 2. Reject the receipt and recovery collision before touching the root.
        const failure = yield* failureFrom(applyArtifactPlan(plan));

        expect(failure).toMatchObject({ _tag: "ArtifactTargetError", code: "recovery-path-collision" });
        // 3. Verify target validation stopped before durable workspace creation.
        expect((yield* fileSystem.readDirectory(root)).some((name) => name.startsWith(".dufflebag-transaction-"))).toBe(false);
      }),
    );
  });

  it.effect("removes a restore sibling when its delegated write mutates and then fails", () => {
    // Fail a later commit, create-and-fail the rollback sibling write, then prove the uncommitted sibling is removed.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to inject commit and rollback failures.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve canonical mutation paths matched by the decorator.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const specs = [
          { path: "first.txt", desired: bytes("new-first"), prior: bytes("old-first") },
          { path: "second.txt", desired: bytes("new-second"), prior: bytes("old-second") },
        ];
        let restorePath: string | undefined;
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          writeFile: (...input) => {
            const [targetPath, value, options] = input;
            if (targetPath.endsWith(".restore")) {
              restorePath = targetPath;

              return fileSystem
                .writeFile(targetPath, value, options)
                .pipe(Effect.zipRight(Effect.fail(makeSystemError("writeFile", targetPath))));
            }

            return fileSystem.writeFile(targetPath, value, options);
          },
          rename: (fromPath, toPath) => {
            return fromPath.endsWith(".stage") && toPath === `${canonicalRoot}/second.txt`
              ? Effect.fail(makeSystemError("rename", toPath))
              : fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize both original targets before the transaction.
        yield* preparePriorFiles(root, specs);
        // 4. Capture incomplete rollback after the delegated restore write reports failure.
        const failure = yield* failureFrom(
          applyArtifactPlan(freshPlan(root, specs)).pipe(Effect.provideService(FileSystem.FileSystem, decorated)),
        );

        expect(failure).toMatchObject({ _tag: "ArtifactRecoveryRequiredError", unrecoveredPaths: ["first.txt"] });
        if (restorePath === undefined) {
          throw new Error("Expected rollback to allocate a restore sibling.");
        }
        // 5. Verify the failed write cannot strand an untracked sibling outside the retained workspace.
        expect(yield* fileSystem.exists(restorePath)).toBe(false);
        // 6. Verify durable recovery evidence still identifies the unrecovered target.
        expect(JSON.parse(yield* readText(`${root}/${recoveryPath}`))).toMatchObject({ unrecoveredPaths: ["first.txt"] });
      }),
    );
  });

  it.effect("removes a masked restore sibling when mode normalization fails", () => {
    // Fail a later commit and restore chmod, then remove bytes created exclusively under a restrictive effective mode.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to inject commit and rollback failures.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Resolve canonical mutation paths matched by the decorator.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const specs = [
          { path: "first.txt", desired: bytes("new-first"), prior: bytes("old-first"), mode: 0o644 },
          { path: "second.txt", desired: bytes("new-second"), prior: bytes("old-second") },
        ];
        let restorePath: string | undefined;
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          writeFile: (...input) => {
            const [targetPath, value, options] = input;
            if (targetPath.endsWith(".restore")) {
              restorePath = targetPath;

              return fileSystem.writeFile(targetPath, value, options).pipe(Effect.zipRight(fileSystem.chmod(targetPath, 0o600)));
            }

            return fileSystem.writeFile(targetPath, value, options);
          },
          chmod: (targetPath, mode) => {
            if (targetPath.endsWith(".restore")) {
              return Effect.fail(makeSystemError("chmod", targetPath));
            }

            return fileSystem.chmod(targetPath, mode);
          },
          rename: (fromPath, toPath) => {
            return fromPath.endsWith(".stage") && toPath === `${canonicalRoot}/second.txt`
              ? Effect.fail(makeSystemError("rename", toPath))
              : fileSystem.rename(fromPath, toPath);
          },
        };

        // 3. Materialize both original targets with a mode that the decorated restore write masks.
        yield* preparePriorFiles(root, specs);
        // 4. Capture incomplete rollback after restore mode normalization fails.
        const failure = yield* failureFrom(
          applyArtifactPlan(freshPlan(root, specs)).pipe(Effect.provideService(FileSystem.FileSystem, decorated)),
        );

        expect(failure).toMatchObject({ _tag: "ArtifactRecoveryRequiredError", unrecoveredPaths: ["first.txt"] });
        if (restorePath === undefined) {
          throw new Error("Expected rollback to allocate a restore sibling.");
        }
        // 5. Verify cleanup recognizes the exact pre-normalization mode and removes the sibling.
        expect(yield* fileSystem.exists(restorePath)).toBe(false);
        // 6. Verify durable evidence still identifies the target whose restoration did not complete.
        expect(JSON.parse(yield* readText(`${root}/${recoveryPath}`))).toMatchObject({ unrecoveredPaths: ["first.txt"] });
      }),
    );
  });

  it.effect("removes a new workspace when private-mode normalization fails", () => {
    // Create the root-local workspace, fail its chmod, then require immediate cleanup before returning unchanged.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to observe workspace allocation and cleanup.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Canonicalize the root for exact workspace identification.
        const canonicalRoot = yield* fileSystem.realPath(root);
        let workspacePath: string | undefined;
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          makeTempDirectory: (options) =>
            fileSystem.makeTempDirectory(options).pipe(
              Effect.tap((createdPath) => {
                if (options?.directory === canonicalRoot) {
                  workspacePath = createdPath;
                }
              }),
            ),
          chmod: (targetPath, mode) => {
            return targetPath === workspacePath ? Effect.fail(makeSystemError("chmod", targetPath)) : fileSystem.chmod(targetPath, mode);
          },
        };

        // 3. Capture the workspace-normalization failure.
        const failure = yield* failureFrom(
          applyArtifactPlan(freshPlan(root, [{ path: "target.txt", desired: bytes("desired") }])).pipe(
            Effect.provideService(FileSystem.FileSystem, decorated),
          ),
        );

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "unchanged", phase: "snapshot" });
        if (workspacePath === undefined) {
          throw new Error("Expected the root-local workspace to be captured.");
        }
        // 4. Verify the failed workspace was removed before the error escaped.
        expect(yield* fileSystem.exists(workspacePath)).toBe(false);
        // 5. Verify no ownership receipt was published.
        yield* expectMissing(`${root}/${receiptPath}`);
      }),
    );
  });

  it.effect("prunes a parent directory when delegated creation mutates and then reports failure", () => {
    // Register a missing parent before mkdir, delegate its creation, then clean it after the delegated failure.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Load the filesystem used to decorate parent creation.
        const fileSystem = yield* FileSystem.FileSystem;
        // 2. Canonicalize the root for the exact parent path.
        const canonicalRoot = yield* fileSystem.realPath(root);
        const parentPath = `${canonicalRoot}/delegated`;
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          makeDirectory: (targetPath, options) => {
            return targetPath === parentPath
              ? fileSystem
                  .makeDirectory(targetPath, options)
                  .pipe(Effect.zipRight(Effect.fail(makeSystemError("makeDirectory", targetPath))))
              : fileSystem.makeDirectory(targetPath, options);
          },
        };

        // 3. Capture the delegated parent-creation failure before staging.
        const failure = yield* failureFrom(
          applyArtifactPlan(freshPlan(root, [{ path: "delegated/target.txt", desired: bytes("desired") }])).pipe(
            Effect.provideService(FileSystem.FileSystem, decorated),
          ),
        );

        expect(failure).toMatchObject({ _tag: "ArtifactTransactionError", state: "unchanged" });
        // 4. Verify the transaction-created parent was pruned.
        expect(yield* fileSystem.exists(parentPath)).toBe(false);
        // 5. Verify no target or receipt was committed.
        yield* expectMissing(`${root}/delegated/target.txt`);
        // 6. Verify no ownership receipt was published.
        yield* expectMissing(`${root}/${receiptPath}`);
      }),
    );
  });
});
