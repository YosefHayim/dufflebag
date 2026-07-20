import { FileSystem, Path } from "@effect/platform";
import { Effect, ParseResult, Schema } from "effect";

import { type AgentEvidence, agentCatalog, agentEvidenceSchema, agentIdSchema, classifyAgents } from "./catalog/agentCatalog.js";
import { type FeatureDefinition, featureCatalog, featureDefinitionSchema, featureIdSchema } from "./catalog/featureCatalog.js";
import { type ManagedConfigFile, managedConfigFileSchema, readConfigFile } from "./config/configFile.js";
import { managedConfigPath } from "./config/configure.js";
import {
  type ArtifactReceipt,
  artifactReceiptSchema,
  readArtifactReceiptSnapshot,
  relativeArtifactPathSchema,
  scopeSchema,
  versionSchema,
} from "./install/artifactReceipt.js";
import { installationDestinationSchema, receiptPath, stagedPackageSchema } from "./install/install.js";

/** Loop state dir relative to a Claude home root (always under ~/.claude, not project). */
const loopStateRelativePath = ".claude/.ctx-loop-state";

/** Autorun fields frozen into the detached daemon at spawn. */
const daemonConfigKeys = [
  "contextWarnFraction",
  "contextBlockFraction",
  "autorunDefaultCycleCount",
  "autorunMaxCycleCount",
  "autorunPollIntervalSeconds",
  "autorunIdleThresholdSeconds",
] as const;

export const doctorPlatformSchema = Schema.Struct({
  operatingSystem: Schema.Literal(
    "aix",
    "android",
    "darwin",
    "freebsd",
    "haiku",
    "linux",
    "openbsd",
    "sunos",
    "win32",
    "cygwin",
    "netbsd",
  ).annotations({
    description: "Node operating-system identifier used to evaluate feature platform requirements.",
  }),
  ghosttyAvailable: Schema.Boolean.annotations({
    description: "Whether Ghostty was observed on this host.",
  }),
}).annotations({
  description: "Read-only host observations used by feature diagnostics.",
});

export type DoctorPlatform = Schema.Schema.Type<typeof doctorPlatformSchema>;

export const doctorRequestSchema = Schema.Struct({
  destination: installationDestinationSchema,
  stagedPackage: stagedPackageSchema,
  platform: doctorPlatformSchema,
  agentEvidence: agentEvidenceSchema,
}).annotations({
  description: "Complete read-only doctor request decoded before filesystem inspection.",
});

export type DoctorRequest = Schema.Schema.Type<typeof doctorRequestSchema>;

const doctorConfigSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("present", {
    config: managedConfigFileSchema.annotations({
      description: "Strict complete managed configuration decoded from disk.",
    }),
  }),
).annotations({
  description: "Managed configuration state observed without changing it.",
});

const doctorInstallationSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("present", {
    version: artifactReceiptSchema.fields.version.annotations({
      description: "Installed package version recorded by the receipt.",
    }),
    features: artifactReceiptSchema.fields.features.annotations({
      description: "Dependency-resolved installed features recorded by the receipt.",
    }),
  }),
).annotations({
  description: "Installed state derived only from a strict ownership receipt.",
});

const stagedRuntimeStatusSchema = Schema.Union(
  Schema.TaggedStruct("notRequired", {}),
  Schema.TaggedStruct("present", {
    path: relativeArtifactPathSchema.annotations({
      description: "Verified staged runtime entrypoint relative to the staged package root.",
    }),
  }),
  Schema.TaggedStruct("missing", {
    path: relativeArtifactPathSchema.annotations({
      description: "Expected staged runtime entrypoint missing from the staged package.",
    }),
  }),
).annotations({
  description: "Catalog-derived staged runtime availability for one installed feature.",
});

const doctorFeatureSchema = Schema.Struct({
  id: featureIdSchema,
  title: Schema.NonEmptyTrimmedString.annotations({
    description: "Catalog title for the installed feature.",
  }),
  platform: featureDefinitionSchema.fields.platform,
  platformAvailable: Schema.Boolean.annotations({
    description: "Whether the observed host satisfies the catalog platform requirement.",
  }),
  stagedRuntime: stagedRuntimeStatusSchema,
}).annotations({
  description: "Read-only catalog, host, and staged-runtime diagnosis for one installed feature.",
});

const validateDoctorFeature = Schema.validate(doctorFeatureSchema, {
  onExcessProperty: "error",
});

const doctorAgentSchema = Schema.Struct({
  id: agentIdSchema,
  displayName: Schema.NonEmptyTrimmedString.annotations({
    description: "Catalog display name for the diagnosed agent.",
  }),
  detected: Schema.Boolean.annotations({
    description: "Whether caller-observed evidence matches this catalog agent.",
  }),
  managed: Schema.Boolean.annotations({
    description: "Whether the strict receipt owns an artifact for this agent.",
  }),
}).annotations({
  description: "Receipt ownership compared with non-authoritative detection evidence.",
});

const doctorDaemonSchema = Schema.Struct({
  sessionId: Schema.NonEmptyTrimmedString.annotations({
    description: "Claude session id whose detached ctx-watch daemon was observed.",
  }),
  pid: Schema.Number.pipe(Schema.int(), Schema.positive()).annotations({
    description: "Live process id recorded in the daemon pid lockfile.",
  }),
  snapshot: Schema.Union(
    Schema.TaggedStruct("missing", {}),
    Schema.TaggedStruct("present", {
      config: managedConfigFileSchema.annotations({
        description: "BagConfig snapshot written when the daemon was spawned.",
      }),
    }),
  ).annotations({
    description: "Whether the spawn-time config snapshot is available for comparison.",
  }),
}).annotations({
  description: "One live autorun daemon observed under the loop state directory.",
});

const doctorDiscrepancySchema = Schema.Union(
  Schema.TaggedStruct("receiptScopeMismatch", {
    requestedScope: scopeSchema,
    receiptScope: scopeSchema,
  }),
  Schema.TaggedStruct("packageVersionMismatch", {
    installedVersion: versionSchema,
    stagedVersion: versionSchema,
  }),
  Schema.TaggedStruct("missingManagedConfig", {}),
  Schema.TaggedStruct("unsupportedFeaturePlatform", {
    featureId: featureIdSchema,
    platform: featureDefinitionSchema.fields.platform,
  }),
  Schema.TaggedStruct("missingStagedRuntime", {
    featureId: featureIdSchema,
    path: relativeArtifactPathSchema,
  }),
  Schema.TaggedStruct("detectedAgentNotManaged", {
    agentId: agentIdSchema,
  }),
  Schema.TaggedStruct("managedAgentNotDetected", {
    agentId: agentIdSchema,
  }),
  Schema.TaggedStruct("daemonConfigSnapshotMissing", {
    sessionId: Schema.NonEmptyTrimmedString.annotations({
      description: "Live daemon session whose spawn-time config snapshot is absent.",
    }),
  }),
  Schema.TaggedStruct("daemonConfigMismatch", {
    sessionId: Schema.NonEmptyTrimmedString.annotations({
      description: "Live daemon session whose frozen config differs from managed config.",
    }),
    key: Schema.Literal(...daemonConfigKeys).annotations({
      description: "Autorun config field that differs between managed config and the daemon.",
    }),
    managedValue: Schema.Number.annotations({
      description: "Value from managed config.json (or defaults when config is missing).",
    }),
    daemonValue: Schema.Number.annotations({
      description: "Value frozen into the daemon at spawn.",
    }),
  }),
).annotations({
  description: "Read-only discrepancy that never grants repair or deletion authority.",
});

type DoctorDiscrepancy = Schema.Schema.Type<typeof doctorDiscrepancySchema>;
type DoctorDaemon = Schema.Schema.Type<typeof doctorDaemonSchema>;

export const doctorReportSchema = Schema.Struct({
  scope: scopeSchema.annotations({
    description: "Installation scope inspected by this report.",
  }),
  config: doctorConfigSchema,
  installation: doctorInstallationSchema,
  features: Schema.Array(doctorFeatureSchema).annotations({
    description: "Installed features diagnosed in catalog order.",
  }),
  agents: Schema.Array(doctorAgentSchema).annotations({
    description: "All catalog agents compared with receipt and detection evidence.",
  }),
  daemons: Schema.Array(doctorDaemonSchema).annotations({
    description: "Live autorun daemons observed under the destination Claude home loop state.",
  }),
  discrepancies: Schema.Array(doctorDiscrepancySchema).annotations({
    description: "Deterministic diagnostic differences observed without authorizing mutation.",
  }),
}).annotations({
  description: "Complete read-only dufflebag health report.",
});

export type DoctorReport = Schema.Schema.Type<typeof doctorReportSchema>;

export class DoctorError extends Schema.TaggedError<DoctorError>()("DoctorError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable request or read-only inspection failure.",
  }),
}) {
  get message(): string {
    return `Cannot inspect dufflebag: ${this.issue}`;
  }
}

const decodeDoctorRequest = (input: unknown) =>
  Schema.decodeUnknown(doctorRequestSchema, {
    onExcessProperty: "error",
  })(input).pipe(
    Effect.mapError(
      (error) =>
        new DoctorError({
          issue: ParseResult.TreeFormatter.formatErrorSync(error),
        }),
    ),
  );

const platformAvailable = (feature: FeatureDefinition, platform: DoctorPlatform): boolean => {
  if (feature.platform === "any") {
    return true;
  }

  if (platform.operatingSystem !== "darwin") {
    return false;
  }

  return feature.platform === "macos" || platform.ghosttyAvailable;
};

const createFeatureDiagnostics = (request: DoctorRequest, receipt: ArtifactReceipt) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const installedFeatureIds = new Set(receipt.features);
    const installedFeatures = featureCatalog.filter((feature) => installedFeatureIds.has(feature.id));

    return yield* Effect.forEach(installedFeatures, (feature) =>
      Effect.gen(function* () {
        if (feature.runtime._tag === "none") {
          return yield* validateDoctorFeature({
            id: feature.id,
            title: feature.title,
            platform: feature.platform,
            platformAvailable: platformAvailable(feature, request.platform),
            stagedRuntime: { _tag: "notRequired" },
          });
        }

        const entrypoint = `${feature.runtime.sourceEntrypoint.slice(0, -3)}.js`;
        const relativePath = `runtime/${feature.sourceDirectory}/${entrypoint}`;
        const present = yield* fileSystem.exists(path.join(request.stagedPackage.root, relativePath));
        if (present) {
          return yield* validateDoctorFeature({
            id: feature.id,
            title: feature.title,
            platform: feature.platform,
            platformAvailable: platformAvailable(feature, request.platform),
            stagedRuntime: { _tag: "present", path: relativePath },
          });
        }

        return yield* validateDoctorFeature({
          id: feature.id,
          title: feature.title,
          platform: feature.platform,
          platformAvailable: platformAvailable(feature, request.platform),
          stagedRuntime: { _tag: "missing", path: relativePath },
        });
      }),
    );
  });

const createAgentDiagnostics = (evidence: AgentEvidence, receipt: ArtifactReceipt | undefined) => {
  const managedIds = new Set(
    receipt?.artifacts.flatMap((artifact) => (artifact.owner._tag === "agent" ? artifact.owner.agentIds : [])) ?? [],
  );
  const detectedAgents = new Map(classifyAgents(evidence).map((agent) => [agent.id, agent.installed]));

  return agentCatalog.map((agent) => ({
    id: agent.id,
    displayName: agent.displayName,
    detected: detectedAgents.get(agent.id) === true,
    managed: managedIds.has(agent.id),
  }));
};

const toDoctorError = (error: unknown): DoctorError =>
  error instanceof DoctorError
    ? error
    : new DoctorError({
        issue: error instanceof Error ? error.message : String(error),
      });

const processAlive = (pid: number): boolean => {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const parseDaemonSnapshot = (raw: string): ManagedConfigFile | undefined => {
  try {
    const decoded = Schema.decodeUnknownEither(managedConfigFileSchema, {
      onExcessProperty: "error",
    })(JSON.parse(raw));
    return decoded._tag === "Right" ? decoded.right : undefined;
  } catch {
    return undefined;
  }
};

const createDaemonDiagnostics = (request: DoctorRequest) =>
  Effect.gen(function* () {
    // Project installs still share the user-home loop state; only global destinations own it.
    if (request.destination._tag !== "global") {
      return [] as Array<DoctorDaemon>;
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const loopStateDir = path.join(request.destination.root, loopStateRelativePath);
    const present = yield* fileSystem.exists(loopStateDir);
    if (!present) {
      return [];
    }

    const entries = yield* fileSystem.readDirectory(loopStateDir);
    const daemons: Array<DoctorDaemon> = [];

    // Inspect every pid lock the loop state dir still holds.
    for (const name of entries) {
      if (!name.endsWith(".pid")) continue;
      const sessionId = name.slice(0, -".pid".length);
      const pidText = yield* fileSystem.readFileString(path.join(loopStateDir, name)).pipe(Effect.catchAll(() => Effect.succeed("")));
      const pid = Number.parseInt(pidText.trim(), 10);
      if (!Number.isFinite(pid) || !processAlive(pid)) continue;

      const snapshotPath = path.join(loopStateDir, `${sessionId}.config`);
      const snapshotExists = yield* fileSystem.exists(snapshotPath);
      if (!snapshotExists) {
        daemons.push({ sessionId, pid, snapshot: { _tag: "missing" } });
        continue;
      }

      const raw = yield* fileSystem.readFileString(snapshotPath).pipe(Effect.catchAll(() => Effect.succeed("")));
      const config = parseDaemonSnapshot(raw);
      daemons.push({
        sessionId,
        pid,
        snapshot: config === undefined ? { _tag: "missing" } : { _tag: "present", config },
      });
    }

    return daemons;
  });

const appendDaemonDiscrepancies = (
  discrepancies: Array<DoctorDiscrepancy>,
  daemons: ReadonlyArray<DoctorDaemon>,
  managed: ManagedConfigFile | undefined,
): void => {
  // Compare each live daemon against managed config (or flag a missing snapshot).
  for (const daemon of daemons) {
    if (daemon.snapshot._tag === "missing") {
      discrepancies.push({ _tag: "daemonConfigSnapshotMissing", sessionId: daemon.sessionId });
      continue;
    }
    if (managed === undefined) continue;

    // Diff only autorun fields the detached process freezes at spawn.
    for (const key of daemonConfigKeys) {
      const managedValue = managed[key];
      const daemonValue = daemon.snapshot.config[key];
      if (managedValue === daemonValue) continue;
      discrepancies.push({
        _tag: "daemonConfigMismatch",
        sessionId: daemon.sessionId,
        key,
        managedValue,
        daemonValue,
      });
    }
  }
};

// Inspect strict persisted state and compare it with catalog-derived host observations without changing disk state.
export const doctor = (input: unknown) =>
  Effect.gen(function* () {
    // 1. Decode the complete diagnostic request before reading external state.
    const request = yield* decodeDoctorRequest(input);
    const path = yield* Path.Path;

    // 2. Read strict managed configuration and receipt snapshots exactly once.
    const configSnapshot = yield* readConfigFile(path.join(request.destination.root, managedConfigPath));
    const receiptSnapshot = yield* readArtifactReceiptSnapshot(path.join(request.destination.root, receiptPath));
    const receipt = receiptSnapshot._tag === "present" ? receiptSnapshot.receipt : undefined;

    // 3. Compare receipt ownership with the catalog, platform, staged runtime, observed agents, and live daemons.
    const featureDiagnostics = receipt === undefined ? [] : yield* createFeatureDiagnostics(request, receipt);
    const agentDiagnostics = createAgentDiagnostics(request.agentEvidence, receipt);
    const daemonDiagnostics = yield* createDaemonDiagnostics(request);

    // 4. Collect deterministic discrepancies as report data, never repair authority.
    const discrepancies: Array<DoctorDiscrepancy> = [];
    if (receipt !== undefined) {
      if (receipt.scope !== request.destination._tag) {
        discrepancies.push({
          _tag: "receiptScopeMismatch",
          requestedScope: request.destination._tag,
          receiptScope: receipt.scope,
        });
      }

      if (receipt.version !== request.stagedPackage.version) {
        discrepancies.push({
          _tag: "packageVersionMismatch",
          installedVersion: receipt.version,
          stagedVersion: request.stagedPackage.version,
        });
      }

      if (configSnapshot._tag === "missing") {
        discrepancies.push({ _tag: "missingManagedConfig" });
      }

      // Compare every installed feature in catalog order.
      featureDiagnostics.forEach((feature) => {
        if (!feature.platformAvailable) {
          discrepancies.push({
            _tag: "unsupportedFeaturePlatform",
            featureId: feature.id,
            platform: feature.platform,
          });
        }

        if (feature.stagedRuntime._tag === "missing") {
          discrepancies.push({
            _tag: "missingStagedRuntime",
            featureId: feature.id,
            path: feature.stagedRuntime.path,
          });
        }
      });
    }

    // Compare every agent in catalog order.
    agentDiagnostics.forEach((agent) => {
      if (agent.detected && !agent.managed) {
        discrepancies.push({ _tag: "detectedAgentNotManaged", agentId: agent.id });

        return;
      }

      if (agent.managed && !agent.detected) {
        discrepancies.push({ _tag: "managedAgentNotDetected", agentId: agent.id });
      }
    });

    appendDaemonDiscrepancies(discrepancies, daemonDiagnostics, configSnapshot._tag === "present" ? configSnapshot.config : undefined);

    const config = configSnapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "present", config: configSnapshot.config };

    // 5. Validate one presentation-ready report and return without invoking a writer.
    return yield* Schema.validate(doctorReportSchema, {
      onExcessProperty: "error",
    })({
      scope: request.destination._tag,
      config,
      installation:
        receipt === undefined
          ? { _tag: "missing" }
          : {
              _tag: "present",
              version: receipt.version,
              features: receipt.features,
            },
      features: featureDiagnostics,
      agents: agentDiagnostics,
      daemons: daemonDiagnostics,
      discrepancies,
    });
  }).pipe(Effect.mapError(toDoctorError));
