import path from "node:path";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  artifactReceiptJsonSchema,
  artifactReceiptSchema,
  type OwnedArtifact,
  ownedArtifactSchema,
  sha256Bytes,
} from "../install/artifactReceipt.js";
import { type BagConfig, bagConfigJsonSchema, defaultBagConfig, legacyBagConfigEnvironmentSchema } from "./bagConfigSchema.js";
import { planManagedConfiguration } from "./configure.js";

const configPath = ".claude/dufflebag/config.json";
const settingsPath = ".claude/settings.json";
const receiptPath = ".claude/dufflebag/receipt.json";
const root = path.resolve("/tmp/dufflebag-configure-test");

const bytes = (value: string): Uint8Array => {
  return new TextEncoder().encode(value);
};

const encodeConfig = (config: BagConfig): Uint8Array => {
  return bytes(Schema.encodeSync(bagConfigJsonSchema)(config));
};

const fileConfig = (config: BagConfig, raw = encodeConfig(config)) => ({
  _tag: "file",
  file: {
    bytes: raw,
    config,
  },
});

const missing = {
  _tag: "missing",
};

const fileSettings = (document: unknown) => ({
  _tag: "file",
  bytes: bytes(JSON.stringify(document)),
});

const notRead = {
  _tag: "notRead",
};

const resolveSelection = {
  _tag: "resolve",
};

const baseRequest = () => ({
  scope: "project",
  root,
  installerVersion: "0.11.0",
  selection: resolveSelection,
  targetConfig: missing,
  settings: missing,
  receipt: missing,
  receiptArtifactObservations: [],
  globalSnapshot: notRead,
});

const plannedFrom = (input: unknown) => {
  const result = planManagedConfiguration(input);
  if (result._tag !== "planned") {
    throw new Error("Expected a managed configuration plan.");
  }

  return result;
};

const fileObservation = (artifactPath: string, value: Uint8Array) => ({
  path: artifactPath,
  snapshot: {
    _tag: "file",
    bytes: value,
    sha256: sha256Bytes(value),
  },
});

const missingObservation = (artifactPath: string) => ({
  path: artifactPath,
  snapshot: {
    _tag: "missing",
  },
});

const decodeArtifact = Schema.validateSync(ownedArtifactSchema, {
  onExcessProperty: "error",
});

const decodeReceipt = Schema.validateSync(artifactReceiptSchema, {
  onExcessProperty: "error",
});

const encodeReceipt = (receipt: Schema.Schema.Type<typeof artifactReceiptSchema>): Uint8Array => {
  return bytes(Schema.encodeSync(artifactReceiptJsonSchema)(receipt));
};

const operationBytes = (
  operations: ReadonlyArray<{ readonly _tag: string; readonly path: string; readonly bytes?: Uint8Array }>,
  target: string,
) => {
  const operation = operations.find((candidate) => candidate.path === target);
  if (operation === undefined || operation._tag !== "write" || operation.bytes === undefined) {
    throw new Error(`Expected a write for ${target}.`);
  }

  return operation.bytes;
};

const canonicalLegacyEnvironment = Schema.encodeSync(legacyBagConfigEnvironmentSchema)(defaultBagConfig);
const ownedLegacyPairs = Object.entries(canonicalLegacyEnvironment);
const ownedLegacyKeys = ownedLegacyPairs.map(([key]) => key);

describe("planManagedConfiguration", () => {
  it("requests one lazy global snapshot only for a first project config without a target or legacy source", () => {
    const result = planManagedConfiguration(baseRequest());

    expect(result).toEqual({
      _tag: "globalSnapshotRequired",
      path: configPath,
    });

    const globalPlan = plannedFrom({
      ...baseRequest(),
      globalSnapshot: fileConfig({
        ...defaultBagConfig,
        debugEnabled: true,
      }),
    });
    expect(globalPlan.source._tag).toBe("globalSnapshot");
    expect(globalPlan.config.debugEnabled).toBe(true);

    const defaultPlan = plannedFrom({
      ...baseRequest(),
      globalSnapshot: missing,
    });
    expect(defaultPlan.source._tag).toBe("defaults");
    expect(defaultPlan.config).toEqual(defaultBagConfig);
  });

  it("keeps an existing project target independent of a later unread global config", () => {
    const target = {
      ...defaultBagConfig,
      speechVoice: "Daniel",
    };
    const result = plannedFrom({
      ...baseRequest(),
      targetConfig: fileConfig(target),
    });

    expect(result.source._tag).toBe("target");
    expect(result.config).toEqual(target);
  });

  it("uses defaults directly for a fresh global target and rejects an unnecessary global snapshot", () => {
    const result = plannedFrom({
      ...baseRequest(),
      scope: "global",
    });

    expect(result.source._tag).toBe("defaults");
    expect(() => {
      planManagedConfiguration({
        ...baseRequest(),
        scope: "global",
        globalSnapshot: missing,
      });
    }).toThrow(expect.objectContaining({ _tag: "ManagedConfigurationError", code: "global-snapshot-unexpected" }));
  });

  it("migrates a complete legacy candidate, removes only exact owned keys, and preserves exact prior strings", () => {
    const settings = {
      env: {
        dufflebagSpeechWordsPerMinute: " 240 ",
        dufflebagDebugEnabled: " true ",
        dufflebagFutureOption: "keep",
        OTHER_TOKEN: "secret",
      },
      hooks: {
        PreToolUse: ["node existing.js"],
      },
    };
    const result = plannedFrom({
      ...baseRequest(),
      settings: fileSettings(settings),
    });

    expect(result.source._tag).toBe("legacy");
    expect(result.config).toEqual({
      ...defaultBagConfig,
      speechWordsPerMinute: 240,
      debugEnabled: true,
    });
    expect(result.plan.operations.map((operation) => operation.path)).toEqual([configPath, settingsPath]);
    expect(result.plan.receipt.path).toBe(receiptPath);

    const writtenSettings = JSON.parse(new TextDecoder().decode(operationBytes(result.plan.operations, settingsPath)));
    expect(writtenSettings).toEqual({
      env: {
        dufflebagFutureOption: "keep",
        OTHER_TOKEN: "secret",
      },
      hooks: settings.hooks,
    });

    const settingsArtifact = result.plan.artifacts.find((artifact) => artifact.path === settingsPath);
    if (settingsArtifact === undefined || settingsArtifact.ownership._tag !== "jsonValues") {
      throw new Error("Expected settings ownership.");
    }

    expect(settingsArtifact.ownership.entries.map((entry) => [entry.pointer, entry.prior])).toEqual([
      ["/env/dufflebagDebugEnabled", { _tag: "value", value: " true " }],
      ["/env/dufflebagSpeechWordsPerMinute", { _tag: "value", value: " 240 " }],
    ]);
  });

  it("leaves an emptied env object and preserves unknown dufflebag-prefixed keys", () => {
    const result = plannedFrom({
      ...baseRequest(),
      settings: fileSettings({
        env: {
          dufflebagDebugEnabled: "false",
          dufflebagUnknown: "keep",
        },
      }),
    });
    const writtenSettings = JSON.parse(new TextDecoder().decode(operationBytes(result.plan.operations, settingsPath)));

    expect(writtenSettings).toEqual({
      env: {
        dufflebagUnknown: "keep",
      },
    });

    const onlyOwnedResult = plannedFrom({
      ...baseRequest(),
      settings: fileSettings({
        env: {
          dufflebagDebugEnabled: "false",
        },
      }),
    });
    expect(JSON.parse(new TextDecoder().decode(operationBytes(onlyOwnedResult.plan.operations, settingsPath)))).toEqual({ env: {} });
  });

  it("fails closed on invalid legacy strings, malformed settings, and cross-field contradictions", () => {
    for (const settings of [
      fileSettings({ env: { dufflebagDebugEnabled: "TRUE" } }),
      fileSettings({
        env: {
          dufflebagContextWarnFraction: "0.3",
          dufflebagContextBlockFraction: "0.2",
        },
      }),
      { _tag: "file", bytes: bytes("{") },
    ]) {
      expect(() => {
        planManagedConfiguration({
          ...baseRequest(),
          settings,
        });
      }).toThrow(expect.objectContaining({ _tag: "ManagedConfigurationError", code: "legacy-invalid" }));
    }
  });

  it("cleans equal legacy values beside a target but rejects a different valid legacy source", () => {
    const target = {
      ...defaultBagConfig,
      debugEnabled: true,
    };
    const equal = plannedFrom({
      ...baseRequest(),
      targetConfig: fileConfig(target),
      settings: fileSettings({ env: { dufflebagDebugEnabled: "true" } }),
    });

    expect(equal.source._tag).toBe("target");
    expect(equal.plan.operations.map((operation) => operation.path)).toEqual([configPath, settingsPath]);

    expect(() => {
      planManagedConfiguration({
        ...baseRequest(),
        targetConfig: fileConfig(target),
        settings: fileSettings({ env: { dufflebagDebugEnabled: "false" } }),
      });
    }).toThrow(expect.objectContaining({ _tag: "ManagedConfigurationError", code: "source-conflict" }));
  });

  it("lets a complete replacement supersede valid differing legacy values but still rejects invalid legacy input", () => {
    const replacement = {
      ...defaultBagConfig,
      speechVoice: "Daniel",
      debugEnabled: true,
    };
    const result = plannedFrom({
      ...baseRequest(),
      selection: {
        _tag: "replace",
        config: replacement,
      },
      settings: fileSettings({ env: { dufflebagDebugEnabled: "false" } }),
    });

    expect(result.source._tag).toBe("replacement");
    expect(result.config).toEqual(replacement);
    expect(result.plan.operations.map((operation) => operation.path)).toEqual([configPath, settingsPath]);

    expect(() => {
      planManagedConfiguration({
        ...baseRequest(),
        selection: {
          _tag: "replace",
          config: replacement,
        },
        settings: fileSettings({ env: { dufflebagDebugEnabled: "FALSE" } }),
      });
    }).toThrow(expect.objectContaining({ _tag: "ManagedConfigurationError", code: "legacy-invalid" }));
  });

  it("requires every key on already decoded replacements and rejects excess request fields", () => {
    expect(() => {
      planManagedConfiguration({
        ...baseRequest(),
        selection: {
          _tag: "replace",
          config: {
            debugEnabled: true,
          },
        },
      });
    }).toThrow(expect.objectContaining({ _tag: "ManagedConfigurationError", code: "invalid-request" }));

    expect(() => {
      planManagedConfiguration({
        ...baseRequest(),
        extra: true,
      });
    }).toThrow(expect.objectContaining({ _tag: "ManagedConfigurationError", code: "invalid-request" }));
  });

  it("fails closed on inconsistent target, global, and receipt snapshots", () => {
    expect(() => {
      planManagedConfiguration({
        ...baseRequest(),
        targetConfig: fileConfig(defaultBagConfig, bytes("{}")),
      });
    }).toThrow(expect.objectContaining({ _tag: "ManagedConfigurationError", code: "target-invalid" }));

    expect(() => {
      planManagedConfiguration({
        ...baseRequest(),
        globalSnapshot: fileConfig(defaultBagConfig, bytes("{}")),
      });
    }).toThrow(expect.objectContaining({ _tag: "ManagedConfigurationError", code: "global-snapshot-invalid" }));

    const receipt = decodeReceipt({
      version: 1,
      installerVersion: "0.10.0",
      scope: "project",
      features: [],
      artifacts: [],
    });
    expect(() => {
      planManagedConfiguration({
        ...baseRequest(),
        receipt: {
          _tag: "file",
          bytes: bytes(`${new TextDecoder().decode(encodeReceipt(receipt))}\n`),
        },
      });
    }).toThrow(expect.objectContaining({ _tag: "ManagedConfigurationError", code: "receipt-invalid" }));
  });

  it("patches through receipt authority without deleting unrelated features or artifacts", () => {
    const originalConfigBytes = encodeConfig(defaultBagConfig);
    const runtimeBytes = bytes("runtime-v1");
    const configArtifact = decodeArtifact({
      path: configPath,
      owner: { _tag: "application" },
      kind: "managedConfig",
      ownership: {
        _tag: "wholeFile",
        installedSha256: sha256Bytes(originalConfigBytes),
        prior: { _tag: "missing" },
      },
    });
    const runtimeArtifact = decodeArtifact({
      path: ".claude/dufflebag/hooks/contextGuard.js",
      owner: { _tag: "application" },
      kind: "runtime",
      ownership: {
        _tag: "wholeFile",
        installedSha256: sha256Bytes(runtimeBytes),
        prior: { _tag: "missing" },
      },
    });
    const receipt = decodeReceipt({
      version: 1,
      installerVersion: "0.10.0",
      scope: "project",
      features: ["context-guard"],
      artifacts: [configArtifact, runtimeArtifact],
    });
    const observations = [fileObservation(configPath, originalConfigBytes), fileObservation(runtimeArtifact.path, runtimeBytes)];
    const result = plannedFrom({
      ...baseRequest(),
      installerVersion: "0.11.0",
      selection: {
        _tag: "replace",
        config: {
          ...defaultBagConfig,
          debugEnabled: true,
        },
      },
      targetConfig: fileConfig(defaultBagConfig, originalConfigBytes),
      receipt: {
        _tag: "file",
        bytes: encodeReceipt(receipt),
      },
      receiptArtifactObservations: observations,
    });

    expect(result.plan.receipt._tag).toBe("publishReceipt");
    if (result.plan.receipt._tag !== "publishReceipt") {
      throw new Error("Expected a published receipt.");
    }

    expect(result.plan.receipt.value.features).toEqual(["context-guard"]);
    expect(result.plan.receipt.value.artifacts.map((artifact) => artifact.path)).toEqual([configPath, runtimeArtifact.path]);
    expect(result.plan.operations.map((operation) => operation.path)).toEqual([configPath]);
  });

  it("allows a receipt-only update when the exact owned config is already desired", () => {
    const raw = encodeConfig(defaultBagConfig);
    const configArtifact = decodeArtifact({
      path: configPath,
      owner: { _tag: "application" },
      kind: "managedConfig",
      ownership: {
        _tag: "wholeFile",
        installedSha256: sha256Bytes(raw),
        prior: { _tag: "missing" },
      },
    });
    const receipt = decodeReceipt({
      version: 1,
      installerVersion: "0.10.0",
      scope: "project",
      features: ["context-guard"],
      artifacts: [configArtifact],
    });
    const result = plannedFrom({
      ...baseRequest(),
      targetConfig: fileConfig(defaultBagConfig, raw),
      receipt: {
        _tag: "file",
        bytes: encodeReceipt(receipt),
      },
      receiptArtifactObservations: [fileObservation(configPath, raw)],
    });

    expect(result.plan.operations).toEqual([]);
    expect(result.plan.receipt._tag).toBe("publishReceipt");
    if (result.plan.receipt._tag === "publishReceipt") {
      expect(result.plan.receipt.value.installerVersion).toBe("0.11.0");
      expect(result.plan.receipt.value.features).toEqual(["context-guard"]);
    }
  });

  it("recommits an exact owned config before cleaning newly discovered legacy settings", () => {
    const raw = encodeConfig(defaultBagConfig);
    const configArtifact = decodeArtifact({
      path: configPath,
      owner: { _tag: "application" },
      kind: "managedConfig",
      ownership: {
        _tag: "wholeFile",
        installedSha256: sha256Bytes(raw),
        prior: { _tag: "missing" },
      },
    });
    const receipt = decodeReceipt({
      version: 1,
      installerVersion: "0.10.0",
      scope: "project",
      features: [],
      artifacts: [configArtifact],
    });
    const result = plannedFrom({
      ...baseRequest(),
      targetConfig: fileConfig(defaultBagConfig, raw),
      settings: fileSettings({ env: { dufflebagDebugEnabled: "false" } }),
      receipt: {
        _tag: "file",
        bytes: encodeReceipt(receipt),
      },
      receiptArtifactObservations: [fileObservation(configPath, raw)],
    });

    expect(result.plan.operations.map((operation) => operation.path)).toEqual([configPath, settingsPath]);
  });

  it("rejects a receipt-owned config that differs from its authority-bound observation", () => {
    const installed = encodeConfig(defaultBagConfig);
    const changedConfig = {
      ...defaultBagConfig,
      debugEnabled: true,
    };
    const changed = encodeConfig(changedConfig);
    const configArtifact = decodeArtifact({
      path: configPath,
      owner: { _tag: "application" },
      kind: "managedConfig",
      ownership: {
        _tag: "wholeFile",
        installedSha256: sha256Bytes(installed),
        prior: { _tag: "missing" },
      },
    });
    const receipt = decodeReceipt({
      version: 1,
      installerVersion: "0.10.0",
      scope: "project",
      features: [],
      artifacts: [configArtifact],
    });

    expect(() => {
      planManagedConfiguration({
        ...baseRequest(),
        selection: {
          _tag: "replace",
          config: changedConfig,
        },
        targetConfig: fileConfig(changedConfig, changed),
        receipt: {
          _tag: "file",
          bytes: encodeReceipt(receipt),
        },
        receiptArtifactObservations: [fileObservation(configPath, changed)],
      });
    }).toThrow(expect.objectContaining({ _tag: "ManagedConfigurationError", code: "ownership-conflict" }));
  });

  it("carries exact legacy restoration values through a later config-only update", () => {
    const initial = plannedFrom({
      ...baseRequest(),
      settings: fileSettings({ env: { dufflebagSpeechWordsPerMinute: " 240 " } }),
    });
    if (initial.plan.receipt._tag !== "publishReceipt") {
      throw new Error("Expected an initial receipt.");
    }

    const installedConfig = operationBytes(initial.plan.operations, configPath);
    const installedSettings = operationBytes(initial.plan.operations, settingsPath);
    const updated = plannedFrom({
      ...baseRequest(),
      selection: {
        _tag: "replace",
        config: {
          ...initial.config,
          speechVoice: "Daniel",
        },
      },
      targetConfig: fileConfig(initial.config, installedConfig),
      settings: {
        _tag: "file",
        bytes: installedSettings,
      },
      receipt: {
        _tag: "file",
        bytes: encodeReceipt(initial.plan.receipt.value),
      },
      receiptArtifactObservations: [fileObservation(configPath, installedConfig), fileObservation(settingsPath, installedSettings)],
    });
    const settingsArtifact = updated.plan.artifacts.find((artifact) => artifact.path === settingsPath);
    if (settingsArtifact === undefined || settingsArtifact.ownership._tag !== "jsonValues") {
      throw new Error("Expected carried settings ownership.");
    }

    expect(settingsArtifact.ownership.entries).toEqual([
      {
        pointer: "/env/dufflebagSpeechWordsPerMinute",
        installed: { _tag: "missing" },
        prior: { _tag: "value", value: " 240 " },
      },
    ]);
  });

  it("rejects a receipt-owned missing legacy pointer when it reappears", () => {
    const initial = plannedFrom({
      ...baseRequest(),
      settings: fileSettings({ env: { dufflebagDebugEnabled: "false" } }),
    });
    if (initial.plan.receipt._tag !== "publishReceipt") {
      throw new Error("Expected an initial receipt.");
    }

    const installedConfig = operationBytes(initial.plan.operations, configPath);
    const changedSettings = bytes('{"env":{"dufflebagDebugEnabled":"false"}}');

    expect(() => {
      planManagedConfiguration({
        ...baseRequest(),
        targetConfig: fileConfig(initial.config, installedConfig),
        settings: {
          _tag: "file",
          bytes: changedSettings,
        },
        receipt: {
          _tag: "file",
          bytes: encodeReceipt(initial.plan.receipt.value),
        },
        receiptArtifactObservations: [fileObservation(configPath, installedConfig), fileObservation(settingsPath, changedSettings)],
      });
    }).toThrow(expect.objectContaining({ _tag: "ManagedConfigurationError", code: "ownership-conflict" }));
  });

  it("derives the exact legacy key set from schema encoding instead of claiming unknown names", () => {
    expect(ownedLegacyKeys).toHaveLength(11);

    const result = plannedFrom({
      ...baseRequest(),
      settings: fileSettings({
        env: Object.fromEntries([...ownedLegacyPairs, ["dufflebagNotOwned", "keep"]]),
      }),
    });
    const settingsArtifact = result.plan.artifacts.find((artifact) => artifact.path === settingsPath);
    if (settingsArtifact === undefined || settingsArtifact.ownership._tag !== "jsonValues") {
      throw new Error("Expected complete legacy ownership.");
    }

    expect(settingsArtifact.ownership.entries).toHaveLength(11);
    const written = JSON.parse(new TextDecoder().decode(operationBytes(result.plan.operations, settingsPath)));
    expect(written.env).toEqual({ dufflebagNotOwned: "keep" });
  });

  it("rejects receipt observations that omit or invent owned artifact state", () => {
    const raw = encodeConfig(defaultBagConfig);
    const configArtifact: OwnedArtifact = decodeArtifact({
      path: configPath,
      owner: { _tag: "application" },
      kind: "managedConfig",
      ownership: {
        _tag: "wholeFile",
        installedSha256: sha256Bytes(raw),
        prior: { _tag: "missing" },
      },
    });
    const receipt = decodeReceipt({
      version: 1,
      installerVersion: "0.10.0",
      scope: "project",
      features: [],
      artifacts: [configArtifact],
    });

    for (const receiptArtifactObservations of [[], [fileObservation(configPath, raw), missingObservation("invented.txt")]]) {
      expect(() => {
        planManagedConfiguration({
          ...baseRequest(),
          targetConfig: fileConfig(defaultBagConfig, raw),
          receipt: {
            _tag: "file",
            bytes: encodeReceipt(receipt),
          },
          receiptArtifactObservations,
        });
      }).toThrow(expect.objectContaining({ _tag: "ManagedConfigurationError", code: "ownership-conflict" }));
    }
  });
});
