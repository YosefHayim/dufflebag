import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { defaultBagConfig } from "./config/bagConfigSchema.js";
import { DoctorError, doctor, doctorRequestSchema } from "./doctor.js";

const validRequest = {
  destination: { _tag: "project", root: "/workspace" },
  stagedPackage: { root: "/package/dist", version: "1.0.0" },
  platform: { operatingSystem: "darwin", ghosttyAvailable: true },
  agentEvidence: { homePaths: [], absolutePaths: [], commands: [] },
};

layer(NodeContext.layer)("doctor", (it) => {
  it.effect("strictly rejects unknown doctor request properties at the capability boundary", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(doctor({ ...validRequest, repair: true }));

      expect(error).toBeInstanceOf(DoctorError);
      expect(error.message).toContain("repair");
    }),
  );

  it("strictly rejects an unknown host platform", () => {
    const decoded = Schema.decodeUnknownEither(doctorRequestSchema, {
      onExcessProperty: "error",
    })({ ...validRequest, platform: { operatingSystem: "temple-os", ghosttyAvailable: false } });

    expect(decoded._tag).toBe("Left");
  });

  it.effect("reports decoded receipt, catalog, platform, staged-runtime, and agent discrepancies without writing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-doctor-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-doctor-stage-" });
        const configPath = path.join(root, ".claude/dufflebag/config.json");
        const receiptPath = path.join(root, ".claude/dufflebag/receipt.json");
        const stagedContextGuardPath = path.join(stagedRoot, "runtime/contextGuard/hooks/contextGuard.js");
        const installedBodyHash = "a".repeat(64);
        const receipt = {
          version: "0.9.0",
          scope: "global",
          features: ["context-guard", "autonomous-loop", "deslop"],
          artifacts: [
            {
              owner: { _tag: "agent", agentIds: ["codex"] },
              path: "AGENTS.md",
              kind: { _tag: "instruction" },
              ownership: {
                _tag: "managedBlock",
                filePreviouslyPresent: false,
                startMarker: "<!-- dufflebag start -->",
                endMarker: "<!-- dufflebag end -->",
                installedBodyHash,
              },
            },
          ],
        };

        yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true });
        yield* fileSystem.makeDirectory(path.dirname(stagedContextGuardPath), { recursive: true });
        yield* fileSystem.writeFileString(configPath, `${JSON.stringify(defaultBagConfig)}\n`);
        yield* fileSystem.writeFileString(receiptPath, `${JSON.stringify(receipt)}\n`);
        yield* fileSystem.writeFileString(stagedContextGuardPath, "export {};\n");

        const configBefore = yield* fileSystem.readFile(configPath);
        const receiptBefore = yield* fileSystem.readFile(receiptPath);
        const report = yield* doctor({
          destination: { _tag: "project", root },
          stagedPackage: { root: stagedRoot, version: "1.0.0" },
          platform: { operatingSystem: "linux", ghosttyAvailable: false },
          agentEvidence: { homePaths: [".cursor"], absolutePaths: [], commands: [] },
        });

        expect(report.installation).toEqual({
          _tag: "present",
          version: "0.9.0",
          features: ["context-guard", "autonomous-loop", "deslop"],
        });
        expect(report.config).toEqual({ _tag: "present", config: defaultBagConfig });
        expect(report.features).toEqual([
          {
            id: "context-guard",
            title: "Context guard",
            platform: "any",
            platformAvailable: true,
            stagedRuntime: { _tag: "present", path: "runtime/contextGuard/hooks/contextGuard.js" },
          },
          {
            id: "autonomous-loop",
            title: "Autonomous loop (autorun)",
            platform: "macos+ghostty",
            platformAvailable: false,
            stagedRuntime: { _tag: "missing", path: "runtime/autorun/hooks/autorun.js" },
          },
          {
            id: "deslop",
            title: "Deslop",
            platform: "any",
            platformAvailable: true,
            stagedRuntime: { _tag: "notRequired" },
          },
        ]);
        expect(report.agents.find((agent) => agent.id === "codex")).toEqual({
          id: "codex",
          displayName: "Codex",
          detected: false,
          managed: true,
        });
        expect(report.agents.find((agent) => agent.id === "cursor")).toEqual({
          id: "cursor",
          displayName: "Cursor",
          detected: true,
          managed: false,
        });
        expect(report.discrepancies).toEqual([
          { _tag: "receiptScopeMismatch", requestedScope: "project", receiptScope: "global" },
          { _tag: "packageVersionMismatch", installedVersion: "0.9.0", stagedVersion: "1.0.0" },
          { _tag: "unsupportedFeaturePlatform", featureId: "autonomous-loop", platform: "macos+ghostty" },
          {
            _tag: "missingStagedRuntime",
            featureId: "autonomous-loop",
            path: "runtime/autorun/hooks/autorun.js",
          },
          { _tag: "detectedAgentNotManaged", agentId: "cursor" },
          { _tag: "managedAgentNotDetected", agentId: "codex" },
        ]);
        expect([...(yield* fileSystem.readFile(configPath))]).toEqual([...configBefore]);
        expect([...(yield* fileSystem.readFile(receiptPath))]).toEqual([...receiptBefore]);
        expect(yield* fileSystem.exists(path.join(root, ".claude/dufflebag/recovery.json"))).toBe(false);
      }),
    ),
  );

  it.effect("reports an absent installation without treating detected paths as deletion authority", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-doctor-absent-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-doctor-absent-stage-" });
        const detectedMarker = path.join(root, ".cursor/user-owned.txt");

        yield* fileSystem.makeDirectory(path.dirname(detectedMarker), { recursive: true });
        yield* fileSystem.writeFileString(detectedMarker, "keep me\n");

        const report = yield* doctor({
          destination: { _tag: "project", root },
          stagedPackage: { root: stagedRoot, version: "1.0.0" },
          platform: { operatingSystem: "darwin", ghosttyAvailable: true },
          agentEvidence: { homePaths: [".cursor"], absolutePaths: [], commands: [] },
        });

        expect(report.installation).toEqual({ _tag: "missing" });
        expect(report.config).toEqual({ _tag: "missing" });
        expect(report.features).toEqual([]);
        expect(report.agents.find((agent) => agent.id === "cursor")).toEqual({
          id: "cursor",
          displayName: "Cursor",
          detected: true,
          managed: false,
        });
        expect(report.discrepancies).toEqual([{ _tag: "detectedAgentNotManaged", agentId: "cursor" }]);
        expect(yield* fileSystem.readFileString(detectedMarker)).toBe("keep me\n");
        expect(yield* fileSystem.exists(path.join(root, ".claude"))).toBe(false);
      }),
    ),
  );

  it.effect("reports a missing managed config for a receipted installation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-doctor-missing-config-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-doctor-missing-config-stage-" });
        const receiptPath = path.join(root, ".claude/dufflebag/receipt.json");

        yield* fileSystem.makeDirectory(path.dirname(receiptPath), { recursive: true });
        yield* fileSystem.writeFileString(
          receiptPath,
          `${JSON.stringify({ version: "1.0.0", scope: "project", features: [], artifacts: [] })}\n`,
        );

        const report = yield* doctor({
          destination: { _tag: "project", root },
          stagedPackage: { root: stagedRoot, version: "1.0.0" },
          platform: { operatingSystem: "darwin", ghosttyAvailable: true },
          agentEvidence: { homePaths: [], absolutePaths: [], commands: [] },
        });

        expect(report.config).toEqual({ _tag: "missing" });
        expect(report.discrepancies).toEqual([{ _tag: "missingManagedConfig" }]);
        expect(yield* fileSystem.exists(path.join(root, ".claude/dufflebag/config.json"))).toBe(false);
      }),
    ),
  );

  it.effect("rejects an ambiguous receipt without normalizing or rewriting it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-doctor-invalid-receipt-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-doctor-invalid-receipt-stage-" });
        const configPath = path.join(root, ".claude/dufflebag/config.json");
        const receiptPath = path.join(root, ".claude/dufflebag/receipt.json");
        const receiptBytes = new TextEncoder().encode(
          '{"version":"1.0.0","scope":"project","features":[],"artifacts":[],"scope":"global"}\n',
        );

        yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true });
        yield* fileSystem.writeFileString(configPath, `${JSON.stringify(defaultBagConfig)}\n`);
        yield* fileSystem.writeFile(receiptPath, receiptBytes);

        const error = yield* Effect.flip(
          doctor({
            destination: { _tag: "project", root },
            stagedPackage: { root: stagedRoot, version: "1.0.0" },
            platform: { operatingSystem: "darwin", ghosttyAvailable: true },
            agentEvidence: { homePaths: [], absolutePaths: [], commands: [] },
          }),
        );

        expect(error).toBeInstanceOf(DoctorError);
        expect(error.message).toContain("duplicate JSON property");
        expect([...(yield* fileSystem.readFile(receiptPath))]).toEqual([...receiptBytes]);
      }),
    ),
  );
});
