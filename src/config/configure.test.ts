import { createHash } from "node:crypto";

import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { type BagConfig, defaultBagConfig, legacyBagConfigEnvironmentSchema } from "./bagConfigSchema.js";
import {
  ConfigurePlanError,
  configureRequestSchema,
  type ManagedConfigPlan,
  managedConfigPath,
  managedConfigPlanSchema,
  planManagedConfig,
  settingsPath,
} from "./configure.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const missingConfigSnapshot = { _tag: "missing" };
const presentConfigSnapshot = (config: BagConfig) => ({
  _tag: "present",
  bytes: textEncoder.encode(`${JSON.stringify(config)}\n`),
  config,
});
const settingsJsonSchema = Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.Unknown }));
const decodeSettings = Schema.decodeUnknownSync(settingsJsonSchema, {
  onExcessProperty: "error",
});
const missingPrevious = { _tag: "missing" };

const unwrap = (result: Either.Either<ManagedConfigPlan, ConfigurePlanError>): ManagedConfigPlan =>
  Either.getOrThrowWith(result, (error) => new Error(error.message));

const settingsBytes = (settings: unknown): Uint8Array => textEncoder.encode(`${JSON.stringify(settings, null, 2)}\n`);

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const selectedRequest = (scope: "global" | "project", config: BagConfig) => ({
  scope,
  selection: { _tag: "selected", config },
  previousConfigFile: missingPrevious,
});

const expectManagedConfigWrite = (plan: ManagedConfigPlan) => {
  const operation = plan.managedConfigWrite;

  expect(operation.artifact.path).toBe(managedConfigPath);
  expect(operation.artifact.kind._tag).toBe("managedConfig");
  if (operation.artifact.ownership._tag !== "wholeFile") {
    throw new Error("Expected one whole-file managed config write.");
  }

  expect(operation.artifact.ownership.installedHash).toBe(hashBytes(operation.bytes));
  expect(textDecoder.decode(operation.bytes)).toContain('"contextWarnFraction"');
};

const expectCleanup = (plan: ManagedConfigPlan) => {
  if (plan.legacySettings._tag !== "cleanup") {
    throw new Error("Expected one mergeable legacy settings evidence value.");
  }

  return plan.legacySettings;
};

describe("planManagedConfig", () => {
  it("copies the global snapshot once for a first project install and otherwise uses defaults", () => {
    const globalConfig = { ...defaultBagConfig, speechVoice: "Ava", debugEnabled: true };
    const copied = unwrap(
      planManagedConfig({
        scope: "project",
        selection: { _tag: "firstProjectInstall", globalConfig: presentConfigSnapshot(globalConfig) },
        previousConfigFile: missingPrevious,
      }),
    );
    const defaulted = unwrap(
      planManagedConfig({
        scope: "project",
        selection: { _tag: "firstProjectInstall", globalConfig: missingConfigSnapshot },
        previousConfigFile: missingPrevious,
      }),
    );

    expect(copied.config).toEqual(globalConfig);
    expect(defaulted.config).toEqual(defaultBagConfig);
    expect(copied.legacySettings).toEqual({ _tag: "none" });
    expectManagedConfigWrite(copied);
    expectManagedConfigWrite(defaulted);
  });

  it("rejects a global snapshot whose decoded config does not match its source bytes", () => {
    const sourceConfig = { ...defaultBagConfig, speechVoice: "Ava" };
    const result = planManagedConfig({
      scope: "project",
      selection: {
        _tag: "firstProjectInstall",
        globalConfig: {
          _tag: "present",
          bytes: textEncoder.encode(`${JSON.stringify(sourceConfig)}\n`),
          config: { ...sourceConfig, speechVoice: "Daniel" },
        },
      },
      previousConfigFile: missingPrevious,
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("source bytes");
    }
  });

  it("rejects first-project selection in global scope", () => {
    const result = planManagedConfig({
      scope: "global",
      selection: { _tag: "firstProjectInstall", globalConfig: missingConfigSnapshot },
      previousConfigFile: missingPrevious,
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ConfigurePlanError);
      expect(result.left.message).toContain("project");
    }
  });

  it.each([
    ["first project", { _tag: "firstProjectInstall", globalConfig: missingConfigSnapshot }],
    ["legacy migration", { _tag: "legacyEnvironment", settingsBytes: settingsBytes({ env: { dufflebagDebugEnabled: "true" } }) }],
  ])("rejects a one-time %s selection when a target config already exists", (_case, selection) => {
    const result = planManagedConfig({
      scope: "project",
      selection,
      previousConfigFile: { _tag: "priorFile", bytes: textEncoder.encode("original config") },
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("missing target managed config");
    }
  });

  it("keeps later global and project selections independent", () => {
    const global = unwrap(planManagedConfig(selectedRequest("global", { ...defaultBagConfig, speechVoice: "Daniel" })));
    const project = unwrap(planManagedConfig(selectedRequest("project", { ...defaultBagConfig, speechVoice: "Moira" })));

    expect(global.config.speechVoice).toBe("Daniel");
    expect(project.config.speechVoice).toBe("Moira");
    expect(global.managedConfigWrite).not.toEqual(project.managedConfigWrite);
  });

  it("migrates a validated legacy subset and records only those exact settings keys", () => {
    const originalSettings = {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "user-command" }] }] },
      env: {
        userSetting: "keep",
        dufflebagContextWarnFraction: "0.15",
        dufflebagContextBlockFraction: "0.25",
        dufflebagDebugEnabled: "true",
      },
      permissions: { allow: ["Read"] },
    };
    const plan = unwrap(
      planManagedConfig({
        scope: "project",
        selection: { _tag: "legacyEnvironment", settingsBytes: settingsBytes(originalSettings) },
        previousConfigFile: missingPrevious,
      }),
    );
    const cleanup = expectCleanup(plan);

    expect(plan.config).toEqual({
      ...defaultBagConfig,
      contextWarnFraction: 0.15,
      contextBlockFraction: 0.25,
      debugEnabled: true,
    });
    expect(cleanup.path).toBe(settingsPath);
    expect(cleanup.values).toMatchObject([
      { pointer: "/env/dufflebagContextBlockFraction" },
      { pointer: "/env/dufflebagContextWarnFraction" },
      { pointer: "/env/dufflebagDebugEnabled" },
    ]);
    expect(cleanup.values.every((value) => /^[a-f0-9]{64}$/.test(value.currentValueHash))).toBe(true);
    expect(decodeSettings(textDecoder.decode(cleanup.originalBytes))).toEqual(originalSettings);
  });

  it("retains every original source byte for the single later settings planner", () => {
    const original = '{"before":-0,"env":{"keep":"x","dufflebagDebugEnabled":"true","escaped":"\\u0061"},"huge":1e400}\n';
    const plan = unwrap(
      planManagedConfig({
        scope: "project",
        selection: { _tag: "legacyEnvironment", settingsBytes: textEncoder.encode(original) },
        previousConfigFile: missingPrevious,
      }),
    );

    expect(textDecoder.decode(expectCleanup(plan).originalBytes)).toBe(original);
  });

  it("migrates all schema-owned legacy properties into one complete config", () => {
    const config = {
      ...defaultBagConfig,
      contextWarnFraction: 0.12,
      contextBlockFraction: 0.24,
      autorunDefaultCycleCount: 12,
      autorunMaxCycleCount: 60,
      autorunPollIntervalSeconds: 6,
      autorunIdleThresholdSeconds: 9,
      speechVoice: "Ava",
      speechWordsPerMinute: 240,
      dedupEnforcement: "warn",
      dedupSkipDirectories: "dist,fixtures",
      debugEnabled: true,
    };
    const legacyEnvironment = Schema.encodeSync(legacyBagConfigEnvironmentSchema)(config);
    const plan = unwrap(
      planManagedConfig({
        scope: "global",
        selection: { _tag: "legacyEnvironment", settingsBytes: settingsBytes({ env: legacyEnvironment }) },
        previousConfigFile: missingPrevious,
      }),
    );

    expect(plan.config).toEqual(config);
    expect(expectCleanup(plan).values).toHaveLength(12);
  });

  it.each([
    ["unknown alias", { env: { dufflebagUnknownSetting: "1" } }],
    ["case-folded alias", { env: { DufflebagDebugEnabled: "true" } }],
    ["invalid value", { env: { dufflebagDebugEnabled: "yes" } }],
    ["invalid bound", { env: { dufflebagSpeechWordsPerMinute: "79" } }],
    ["cross-field contradiction", { env: { dufflebagContextWarnFraction: "0.3", dufflebagContextBlockFraction: "0.2" } }],
    ["missing legacy keys", { env: { userSetting: "keep" } }],
  ])("returns no plan for %s", (_case, settings) => {
    const result = planManagedConfig({
      scope: "project",
      selection: { _tag: "legacyEnvironment", settingsBytes: settingsBytes(settings) },
      previousConfigFile: missingPrevious,
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("returns no plan for malformed or duplicate settings data", () => {
    const malformed = planManagedConfig({
      scope: "project",
      selection: { _tag: "legacyEnvironment", settingsBytes: textEncoder.encode("{not-json") },
      previousConfigFile: missingPrevious,
    });
    const duplicate = planManagedConfig({
      scope: "project",
      selection: {
        _tag: "legacyEnvironment",
        settingsBytes: textEncoder.encode('{"env":{"dufflebagDebugEnabled":"false","dufflebagDebugEnabled":"true"}}'),
      },
      previousConfigFile: missingPrevious,
    });
    const duplicateUnowned = planManagedConfig({
      scope: "project",
      selection: {
        _tag: "legacyEnvironment",
        settingsBytes: textEncoder.encode('{"env":{"dufflebagDebugEnabled":"true"},"theme":"dark","theme":"light"}'),
      },
      previousConfigFile: missingPrevious,
    });

    expect(Either.isLeft(malformed)).toBe(true);
    expect(Either.isLeft(duplicate)).toBe(true);
    expect(Either.isLeft(duplicateUnowned)).toBe(true);
  });

  it("returns no plan for non-UTF-8 settings bytes", () => {
    const result = planManagedConfig({
      scope: "project",
      selection: { _tag: "legacyEnvironment", settingsBytes: new Uint8Array([0xff]) },
      previousConfigFile: missingPrevious,
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("UTF-8");
    }
  });

  it("rejects a UTF-8 BOM instead of silently dropping source bytes", () => {
    const json = settingsBytes({ env: { dufflebagDebugEnabled: "true" } });
    const result = planManagedConfig({
      scope: "project",
      selection: {
        _tag: "legacyEnvironment",
        settingsBytes: new Uint8Array([0xef, 0xbb, 0xbf, ...json]),
      },
      previousConfigFile: missingPrevious,
    });

    expect(Either.isLeft(result)).toBe(true);
  });

  it("preserves exact prior config bytes and correlates desired bytes with their hash", () => {
    const priorBytes = textEncoder.encode('{  "user": "format"  }\n');
    const plan = unwrap(
      planManagedConfig({
        scope: "project",
        selection: { _tag: "selected", config: defaultBagConfig },
        previousConfigFile: { _tag: "priorFile", bytes: priorBytes },
      }),
    );
    if (plan.managedConfigWrite.artifact.ownership._tag !== "wholeFile") {
      throw new Error("Expected one whole-file managed config write.");
    }

    expect(plan.managedConfigWrite.artifact.ownership.previous).toEqual({ _tag: "priorFile", bytes: priorBytes });
    expect(plan.managedConfigWrite.artifact.ownership.installedHash).toBe(hashBytes(plan.managedConfigWrite.bytes));
  });

  it("strictly rejects unknown request properties", () => {
    const decoded = Schema.decodeUnknownEither(configureRequestSchema, {
      onExcessProperty: "error",
    })({
      ...selectedRequest("project", defaultBagConfig),
      unexpected: true,
    });

    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects managed plan data whose config and write drift apart", () => {
    const plan = unwrap(planManagedConfig(selectedRequest("project", defaultBagConfig)));
    const bytes = settingsBytes({ ...defaultBagConfig, speechVoice: "Different" });
    if (plan.managedConfigWrite.artifact.ownership._tag !== "wholeFile") {
      throw new Error("Expected one whole-file managed config write.");
    }

    const decoded = Schema.validateEither(managedConfigPlanSchema, {
      onExcessProperty: "error",
    })({
      ...plan,
      managedConfigWrite: {
        ...plan.managedConfigWrite,
        artifact: {
          ...plan.managedConfigWrite.artifact,
          ownership: { ...plan.managedConfigWrite.artifact.ownership, installedHash: hashBytes(bytes) },
        },
        bytes,
      },
    });

    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects plan data whose legacy pointer evidence drifts from the inspected source", () => {
    const plan = unwrap(
      planManagedConfig({
        scope: "project",
        selection: {
          _tag: "legacyEnvironment",
          settingsBytes: settingsBytes({ env: { keep: "yes", dufflebagDebugEnabled: "true" } }),
        },
        previousConfigFile: missingPrevious,
      }),
    );
    const cleanup = expectCleanup(plan);
    const wrongOwnership = Schema.validateEither(managedConfigPlanSchema)({
      ...plan,
      legacySettings: {
        ...cleanup,
        values: [{ ...cleanup.values[0], pointer: "/env/userSetting" }],
      },
    });

    expect(Either.isLeft(wrongOwnership)).toBe(true);
  });

  it("returns evidence rather than a premature settings operation", () => {
    const plan = unwrap(
      planManagedConfig({
        scope: "project",
        selection: {
          _tag: "legacyEnvironment",
          settingsBytes: settingsBytes({ env: { keep: "yes", dufflebagDebugEnabled: "true" } }),
        },
        previousConfigFile: missingPrevious,
      }),
    );
    const cleanup = expectCleanup(plan);

    expect(cleanup.originalBytes).toEqual(plan.legacySettings.originalBytes);
    expect(Object.keys(cleanup).sort()).toEqual(["_tag", "originalBytes", "path", "values"]);
    expect("bytes" in cleanup).toBe(false);
    expect("artifact" in cleanup).toBe(false);
  });
});
