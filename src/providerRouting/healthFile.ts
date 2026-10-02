import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { Effect, Option, Schema } from "effect";

import { statePath } from "../install/installPaths.js";
import { type HealthRecord, HealthStoreError, healthRecordSchema } from "./providerContract.js";
import type { HealthStore } from "./providerRouting.js";

// Code outside this package reads this file, so its location and field names must stay stable.
const healthFileSchema = Schema.parseJson(
  Schema.Struct({
    acknowledgementVersion: Schema.optional(Schema.NonEmptyTrimmedString),
    healthRecords: Schema.Array(healthRecordSchema),
  }),
  { space: 2 },
);

type HealthFile = Schema.Schema.Type<typeof healthFileSchema>;

const decodeHealthFile = Schema.decodeUnknown(healthFileSchema);
const encodeHealthFile = Schema.encode(healthFileSchema);

const healthFilePath = (): string =>
  process.env.DUFFLEBAG_PROVIDER_HEALTH_FILE?.trim() || join(homedir(), statePath, "provider-health.json");

const readHealthFile = (): Effect.Effect<HealthFile, HealthStoreError> =>
  Effect.gen(function* () {
    const filePath = healthFilePath();
    if (!existsSync(filePath)) return { healthRecords: [] };
    const fileText = yield* Effect.tryPromise({
      try: () => readFile(filePath, "utf8"),
      catch: () => new HealthStoreError({ issue: `Could not read provider health at ${filePath}.` }),
    });
    return yield* decodeHealthFile(fileText).pipe(
      Effect.mapError(() => new HealthStoreError({ issue: `Provider health at ${filePath} is malformed.` })),
    );
  });

const writeHealthFile = (healthFile: HealthFile): Effect.Effect<void, HealthStoreError> =>
  Effect.gen(function* () {
    const filePath = healthFilePath();
    const stagedPath = `${filePath}.${String(process.pid)}.tmp`;
    const writeFailure = () => new HealthStoreError({ issue: `Could not write provider health at ${filePath}.` });
    const fileText = yield* encodeHealthFile(healthFile).pipe(Effect.mapError(writeFailure));
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(stagedPath, `${fileText}\n`, { mode: 0o600 });
        await rename(stagedPath, filePath);
      },
      catch: writeFailure,
    });
  });

const sameIdentity = (left: Pick<HealthRecord, "providerId" | "modelId">, right: HealthRecord): boolean =>
  left.providerId === right.providerId && left.modelId === right.modelId;

export const healthFileStore: HealthStore = {
  readHealth: (identity) =>
    readHealthFile().pipe(
      Effect.map((healthFile) =>
        Option.fromNullable(healthFile.healthRecords.find((healthRecord) => sameIdentity(identity, healthRecord))),
      ),
    ),
  writeHealth: (healthRecord) =>
    readHealthFile().pipe(
      Effect.flatMap((healthFile) =>
        writeHealthFile({
          ...healthFile,
          healthRecords: [
            ...healthFile.healthRecords.filter((storedRecord) => !sameIdentity(healthRecord, storedRecord)),
            healthRecord,
          ],
        }),
      ),
    ),
};

export const readAcknowledgement = () =>
  readHealthFile().pipe(Effect.map((healthFile) => Option.fromNullable(healthFile.acknowledgementVersion)));

export const saveAcknowledgement = (acknowledgementVersion: string) =>
  readHealthFile().pipe(Effect.flatMap((healthFile) => writeHealthFile({ ...healthFile, acknowledgementVersion })));
