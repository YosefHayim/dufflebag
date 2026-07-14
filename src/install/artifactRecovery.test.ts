import { expect, layer } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";

import { decodeArtifactRecoveryRecordJson } from "./artifactRecovery.js";

const recoveryTransactionName = ".dufflebag-transaction-00000000-0000-4000-8000-000000000000";
const transactionRoot = `/safe/${recoveryTransactionName}`;
const receiptSnapshot = {
  targetPath: "/safe/.dufflebag/receipt.json",
  original: { _tag: "missing" },
};
const validRecord = {
  _tag: "pending",
  version: 1,
  root: "/safe",
  receiptPath: "/safe/.dufflebag/receipt.json",
  transactionRoot,
  snapshots: [receiptSnapshot],
};

layer(Layer.empty)("artifactRecovery", (it) => {
  it.effect("decodes strict contained recovery records", () =>
    Effect.gen(function* () {
      expect(yield* decodeArtifactRecoveryRecordJson(JSON.stringify(validRecord))).toEqual(validRecord);

      const rootRecord = {
        ...validRecord,
        root: "/",
        receiptPath: "/.dufflebag/receipt.json",
        transactionRoot: `/${recoveryTransactionName}`,
        snapshots: [
          {
            targetPath: "/.dufflebag/receipt.json",
            original: { _tag: "missing" },
          },
        ],
      };
      expect((yield* decodeArtifactRecoveryRecordJson(JSON.stringify(rootRecord))).root).toBe("/");
    }),
  );

  it.effect("rejects ambiguous or self-destructive recovery records", () =>
    Effect.gen(function* () {
      const invalidRecords = [
        {
          name: "embedded NUL",
          record: {
            ...validRecord,
            snapshots: [{ targetPath: "/safe/file\0.txt", original: { _tag: "missing" } }, receiptSnapshot],
          },
        },
        {
          name: "recovery marker target",
          record: {
            ...validRecord,
            snapshots: [{ targetPath: "/safe/.dufflebag/recovery.json", original: { _tag: "missing" } }, receiptSnapshot],
          },
        },
        {
          name: "recovery marker descendant",
          record: {
            ...validRecord,
            snapshots: [{ targetPath: "/safe/.dufflebag/recovery.json/child", original: { _tag: "missing" } }, receiptSnapshot],
          },
        },
        {
          name: "root target",
          record: {
            ...validRecord,
            snapshots: [{ targetPath: "/safe", original: { _tag: "missing" } }, receiptSnapshot],
          },
        },
        {
          name: "transaction target",
          record: {
            ...validRecord,
            snapshots: [{ targetPath: `${transactionRoot}/snapshots/evidence`, original: { _tag: "missing" } }, receiptSnapshot],
          },
        },
        {
          name: "ancestor targets",
          record: {
            ...validRecord,
            snapshots: [
              { targetPath: "/safe/a", original: { _tag: "missing" } },
              { targetPath: "/safe/a/b", original: { _tag: "missing" } },
              receiptSnapshot,
            ],
          },
        },
        {
          name: "case-fold target aliases",
          record: {
            ...validRecord,
            snapshots: [
              { targetPath: "/safe/A", original: { _tag: "missing" } },
              { targetPath: "/safe/a", original: { _tag: "missing" } },
              receiptSnapshot,
            ],
          },
        },
        {
          name: "duplicate snapshot source",
          record: {
            ...validRecord,
            snapshots: [
              { targetPath: "/safe/a", original: { _tag: "file", snapshotPath: `${transactionRoot}/snapshots/0` } },
              { targetPath: "/safe/b", original: { _tag: "file", snapshotPath: `${transactionRoot}/snapshots/0` } },
              receiptSnapshot,
            ],
          },
        },
        {
          name: "case-fold snapshot aliases",
          record: {
            ...validRecord,
            snapshots: [
              { targetPath: "/safe/a", original: { _tag: "file", snapshotPath: `${transactionRoot}/snapshots/A` } },
              { targetPath: "/safe/b", original: { _tag: "file", snapshotPath: `${transactionRoot}/snapshots/a` } },
              receiptSnapshot,
            ],
          },
        },
        {
          name: "nested snapshot source",
          record: {
            ...validRecord,
            snapshots: [
              { targetPath: "/safe/a", original: { _tag: "file", snapshotPath: `${transactionRoot}/snapshots/nested/0` } },
              receiptSnapshot,
            ],
          },
        },
        {
          name: "staged snapshot source",
          record: {
            ...validRecord,
            snapshots: [
              { targetPath: "/safe/a", original: { _tag: "file", snapshotPath: `${transactionRoot}/staged/0` } },
              receiptSnapshot,
            ],
          },
        },
        {
          name: "malformed transaction suffix",
          record: { ...validRecord, transactionRoot: "/safe/.dufflebag-transaction-invalid" },
        },
        {
          name: "uppercase transaction path",
          record: {
            ...validRecord,
            transactionRoot: "/safe/.DUFFLEBAG-TRANSACTION-00000000-0000-4000-8000-000000000000",
          },
        },
        {
          name: "drive-qualified uppercase transaction path",
          record: {
            ...validRecord,
            root: "C:/safe",
            receiptPath: "C:/safe/.dufflebag/receipt.json",
            transactionRoot: "C:/safe/.DUFFLEBAG-TRANSACTION-00000000-0000-4000-8000-000000000000",
            snapshots: [
              {
                targetPath: "C:/safe/.dufflebag/receipt.json",
                original: { _tag: "missing" },
              },
            ],
          },
        },
        {
          name: "case-only receipt target",
          record: {
            ...validRecord,
            snapshots: [{ targetPath: "/safe/.DUFFLEBAG/RECEIPT.JSON", original: { _tag: "missing" } }],
          },
        },
        {
          name: "drive-qualified case-only receipt target",
          record: {
            ...validRecord,
            root: "C:/safe",
            receiptPath: "C:/safe/.dufflebag/receipt.json",
            transactionRoot: `C:/safe/${recoveryTransactionName}`,
            snapshots: [{ targetPath: "C:/safe/.DUFFLEBAG/RECEIPT.JSON", original: { _tag: "missing" } }],
          },
        },
        {
          name: "drive-qualified case-only snapshot parent",
          record: {
            ...validRecord,
            root: "C:/safe",
            receiptPath: "C:/safe/.dufflebag/receipt.json",
            transactionRoot: `C:/safe/${recoveryTransactionName}`,
            snapshots: [
              {
                targetPath: "C:/safe/a",
                original: {
                  _tag: "file",
                  snapshotPath: `C:/safe/${recoveryTransactionName.toUpperCase()}/SNAPSHOTS/0`,
                },
              },
              {
                targetPath: "C:/safe/.dufflebag/receipt.json",
                original: { _tag: "missing" },
              },
            ],
          },
        },
        {
          name: "drive-qualified case-only root alias",
          record: {
            ...validRecord,
            root: "C:/safe",
            receiptPath: "C:/safe/.dufflebag/receipt.json",
            transactionRoot: `C:/safe/${recoveryTransactionName}`,
            snapshots: [
              { targetPath: "C:/SAFE/file.txt", original: { _tag: "missing" } },
              { targetPath: "C:/safe/.dufflebag/receipt.json", original: { _tag: "missing" } },
            ],
          },
        },
        {
          name: "target outside root",
          record: {
            ...validRecord,
            snapshots: [{ targetPath: "/outside.txt", original: { _tag: "missing" } }, receiptSnapshot],
          },
        },
        {
          name: "relative root",
          record: { ...validRecord, root: "relative" },
        },
        {
          name: "unknown property",
          record: { ...validRecord, unexpected: true },
        },
        {
          name: "POSIX backslash target",
          record: {
            ...validRecord,
            snapshots: [{ targetPath: "/safe\\outside/victim", original: { _tag: "missing" } }, receiptSnapshot],
          },
        },
        {
          name: "POSIX backslash snapshot",
          record: {
            ...validRecord,
            snapshots: [
              { targetPath: "/safe/a", original: { _tag: "file", snapshotPath: `${transactionRoot}/snapshots\\0` } },
              receiptSnapshot,
            ],
          },
        },
      ];

      // Every malformed record must fail before recovery can touch the filesystem.
      yield* Effect.forEach(
        invalidRecords,
        ({ name, record }) =>
          Effect.gen(function* () {
            const result = yield* Effect.exit(decodeArtifactRecoveryRecordJson(JSON.stringify(record)));
            expect(Exit.isFailure(result), name).toBe(true);
          }),
        { discard: true },
      );
    }),
  );
});
