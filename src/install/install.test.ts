import { createHash } from "node:crypto";

import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { defaultBagConfig } from "../config/bagConfigSchema.js";
import { install, installRequestSchema, reconcileInstallation } from "./install.js";

const textEncoder = new TextEncoder();

const installRequest = (input: { root: string; stagedRoot: string }) => ({
  destination: { _tag: "project", root: input.root },
  host: { homeRoot: input.root },
  stagedPackage: { root: input.stagedRoot, version: "0.12.0" },
  features: { _tag: "selected", ids: ["context-guard"] },
  agents: { _tag: "selected", ids: ["claude-code"] },
  interaction: { _tag: "scripted" },
  configuration: { _tag: "selected", config: defaultBagConfig },
});

layer(NodeContext.layer)("install", (it) => {
  it.effect("installs one decoded staged runtime, managed config, settings hook, and ownership receipt", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-stage-" });
        const stagedEntrypoint = path.join(stagedRoot, "runtime/contextGuard/hooks/contextGuard.js");
        const settingsPath = path.join(root, ".claude/settings.json");

        yield* fileSystem.makeDirectory(path.dirname(stagedEntrypoint), { recursive: true });
        yield* fileSystem.writeFile(stagedEntrypoint, textEncoder.encode("export {};\n"));
        yield* fileSystem.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fileSystem.writeFileString(
          settingsPath,
          '{\n  "theme": "dark",\n  "hooks": {\n    "Stop": [{ "hooks": [{ "type": "command", "command": "user-command" }] }]\n  }\n}\n',
        );

        const result = yield* install(installRequest({ root, stagedRoot }));

        expect(result).toMatchObject({
          _tag: "installed",
          scope: "project",
          features: ["context-guard"],
          agents: ["claude-code"],
        });
        expect(result.platformRequirements).toEqual([{ featureId: "context-guard", platform: "any" }]);
        expect(yield* fileSystem.readFileString(path.join(root, ".claude/dufflebag/runtime/contextGuard/hooks/contextGuard.js"))).toBe(
          "export {};\n",
        );
        expect(JSON.parse(yield* fileSystem.readFileString(path.join(root, ".claude/dufflebag/config.json")))).toEqual(defaultBagConfig);

        const settings = yield* fileSystem.readFileString(settingsPath);
        expect(settings).toContain('"theme": "dark"');
        expect(settings).toContain("user-command");
        expect(settings).toContain("contextGuard/hooks/contextGuard.js");

        const receipt = JSON.parse(yield* fileSystem.readFileString(path.join(root, ".claude/dufflebag/receipt.json")));
        expect(receipt.features).toEqual(["context-guard"]);
        expect(receipt.artifacts.map((artifact: { path: string }) => artifact.path)).toEqual([
          ".claude/dufflebag/runtime/contextGuard/hooks/contextGuard.js",
          ".claude/dufflebag/config.json",
          ".claude/settings.json",
        ]);
      }),
    ),
  );

  it.effect("returns unchanged without rewriting an identical installation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-repeat-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-repeat-stage-" });
        const stagedEntrypoint = path.join(stagedRoot, "runtime/contextGuard/hooks/contextGuard.js");
        const request = installRequest({ root, stagedRoot });

        yield* fileSystem.makeDirectory(path.dirname(stagedEntrypoint), { recursive: true });
        yield* fileSystem.writeFile(stagedEntrypoint, textEncoder.encode("export {};\n"));

        yield* install(request);
        const before = yield* fileSystem.readFile(path.join(root, ".claude/dufflebag/receipt.json"));
        const result = yield* install(request);
        const after = yield* fileSystem.readFile(path.join(root, ".claude/dufflebag/receipt.json"));

        expect(result._tag).toBe("unchanged");
        expect(after).toEqual(before);
      }),
    ),
  );

  it.effect("rejects receipt authority that does not match its source bytes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-receipt-correlation-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-receipt-correlation-stage-" });
        const stagedEntrypoint = path.join(stagedRoot, "runtime/contextGuard/hooks/contextGuard.js");
        const victimPath = path.join(root, "victim.txt");
        const victimBytes = textEncoder.encode("user-owned\n");

        yield* fileSystem.makeDirectory(path.dirname(stagedEntrypoint), { recursive: true });
        yield* fileSystem.writeFileString(stagedEntrypoint, "export {};\n");
        yield* fileSystem.writeFile(victimPath, victimBytes);

        const harmlessReceipt = {
          version: "0.11.0",
          scope: "project",
          features: ["context-guard"],
          artifacts: [],
        };
        const forgedReceipt = {
          ...harmlessReceipt,
          artifacts: [
            {
              owner: { _tag: "application" },
              path: "victim.txt",
              kind: { _tag: "runtime" },
              ownership: {
                _tag: "wholeFile",
                installedHash: createHash("sha256").update(victimBytes).digest("hex"),
                previous: { _tag: "missing" },
              },
            },
          ],
        };

        const exit = yield* Effect.exit(
          reconcileInstallation({
            request: installRequest({ root, stagedRoot }),
            receiptSnapshot: {
              _tag: "present",
              bytes: textEncoder.encode(`${JSON.stringify(harmlessReceipt)}\n`),
              receipt: forgedReceipt,
            },
          }),
        );

        expect(exit._tag).toBe("Failure");
        expect(yield* fileSystem.readFileString(victimPath)).toBe("user-owned\n");
        expect(yield* fileSystem.exists(path.join(root, ".claude/dufflebag/config.json"))).toBe(false);
      }),
    ),
  );

  it.effect("plans all four native agent formats without duplicate instruction destinations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-formats-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-formats-stage-" });
        const stagedFiles = [
          ["runtime/contextGuard/hooks/contextGuard.js", "export {};\n"],
          ["runtime/autorun/hooks/autorun.js", "export {};\n"],
          ["skills/autorun/SKILL.md", "---\nname: autorun\n---\nRun @@CTL@@ when the loop is armed.\n"],
        ];

        yield* Effect.forEach(stagedFiles, ([relativePath, contents]) =>
          Effect.gen(function* () {
            const destination = path.join(stagedRoot, relativePath);

            yield* fileSystem.makeDirectory(path.dirname(destination), { recursive: true });
            yield* fileSystem.writeFileString(destination, contents);
          }),
        );

        yield* install({
          ...installRequest({ root, stagedRoot }),
          features: { _tag: "selected", ids: ["autonomous-loop"] },
          agents: { _tag: "selected", ids: ["continue", "aider", "codex", "cursor", "claude-code"] },
        });

        expect(yield* fileSystem.readFileString(path.join(root, ".claude/skills/autorun/SKILL.md"))).toContain("Run");
        expect(yield* fileSystem.readFileString(path.join(root, ".cursor/rules/autorun.mdc"))).toContain(
          ".claude/dufflebag/runtime/autorun/hooks/autorun.js",
        );

        const instructions = yield* fileSystem.readFileString(path.join(root, "AGENTS.md"));
        expect(instructions.match(/<!-- dufflebag:skills start -->/g)).toHaveLength(1);
        expect(instructions).toContain("## autorun");
        expect(yield* fileSystem.readFileString(path.join(root, ".aider.conf.yml"))).toContain("AGENTS.md");
        expect(JSON.parse(yield* fileSystem.readFileString(path.join(root, ".continue/config.json"))).rules).toEqual(["AGENTS.md"]);

        const receipt = JSON.parse(yield* fileSystem.readFileString(path.join(root, ".claude/dufflebag/receipt.json")));
        const instructionArtifacts = receipt.artifacts.filter(
          (artifact: { kind: { _tag: string }; path: string }) => artifact.kind._tag === "instruction" && artifact.path === "AGENTS.md",
        );

        expect(instructionArtifacts).toHaveLength(1);
        expect(instructionArtifacts[0].owner.agentIds).toEqual(["codex", "aider", "continue"]);
      }),
    ),
  );

  it.effect("installs a skill control runtime when Claude is not selected", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-non-claude-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-non-claude-stage-" });
        const stagedFiles = [
          ["runtime/contextGuard/hooks/contextGuard.js", "export {};\n"],
          ["runtime/autorun/hooks/autorun.js", "export {};\n"],
          ["skills/autorun/SKILL.md", "---\nname: autorun\n---\nRun @@CTL@@ when the loop is armed.\n"],
        ];

        yield* Effect.forEach(stagedFiles, ([relativePath, contents]) =>
          Effect.gen(function* () {
            const destination = path.join(stagedRoot, relativePath);

            yield* fileSystem.makeDirectory(path.dirname(destination), { recursive: true });
            yield* fileSystem.writeFileString(destination, contents);
          }),
        );

        yield* install({
          ...installRequest({ root, stagedRoot }),
          features: { _tag: "selected", ids: ["autonomous-loop"] },
          agents: { _tag: "selected", ids: ["cursor"] },
        });

        expect(yield* fileSystem.readFileString(path.join(root, ".claude/dufflebag/runtime/autorun/hooks/autorun.js"))).toBe(
          "export {};\n",
        );
        expect(yield* fileSystem.readFileString(path.join(root, ".cursor/rules/autorun.mdc"))).toContain(
          ".claude/dufflebag/runtime/autorun/hooks/autorun.js",
        );
      }),
    ),
  );

  it.effect("rejects an extra staged skill file before writing host artifacts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-allowlist-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-allowlist-stage-" });
        const stagedFiles = [
          ["runtime/contextGuard/hooks/contextGuard.js", "export {};\n"],
          ["runtime/autorun/hooks/autorun.js", "export {};\n"],
          ["skills/autorun/SKILL.md", "---\nname: autorun\n---\nRun @@CTL@@ when armed.\n"],
          ["skills/autorun/EXTRA.md", "not catalog-shipped\n"],
        ];

        yield* Effect.forEach(stagedFiles, ([relativePath, contents]) =>
          Effect.gen(function* () {
            const destination = path.join(stagedRoot, relativePath);

            yield* fileSystem.makeDirectory(path.dirname(destination), { recursive: true });
            yield* fileSystem.writeFileString(destination, contents);
          }),
        );

        const exit = yield* Effect.exit(
          install({
            ...installRequest({ root, stagedRoot }),
            features: { _tag: "selected", ids: ["autonomous-loop"] },
          }),
        );

        expect(exit._tag).toBe("Failure");
        expect(yield* fileSystem.exists(path.join(root, ".claude/dufflebag/receipt.json"))).toBe(false);
        expect(yield* fileSystem.exists(path.join(root, ".claude/dufflebag/config.json"))).toBe(false);
      }),
    ),
  );

  it.effect("migrates legacy configuration and merges cleanup with hooks in one settings artifact", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-legacy-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-legacy-stage-" });
        const stagedEntrypoint = path.join(stagedRoot, "runtime/contextGuard/hooks/contextGuard.js");
        const settingsPath = path.join(root, ".claude/settings.json");

        yield* fileSystem.makeDirectory(path.dirname(stagedEntrypoint), { recursive: true });
        yield* fileSystem.writeFileString(stagedEntrypoint, "export {};\n");
        yield* fileSystem.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fileSystem.writeFileString(
          settingsPath,
          '{\n  "theme": "dark",\n  "env": { "keep": "yes", "dufflebagSpeechVoice": "Daniel" }\n}\n',
        );

        yield* install({
          ...installRequest({ root, stagedRoot }),
          configuration: { _tag: "automatic" },
        });

        expect(JSON.parse(yield* fileSystem.readFileString(path.join(root, ".claude/dufflebag/config.json")))).toMatchObject({
          speechVoice: "Daniel",
        });
        const settings = JSON.parse(yield* fileSystem.readFileString(settingsPath));
        expect(settings).toMatchObject({ theme: "dark", env: { keep: "yes" } });
        expect(settings.env).not.toHaveProperty("dufflebagSpeechVoice");
        expect(settings.hooks.PreToolUse).toBeDefined();

        const receipt = JSON.parse(yield* fileSystem.readFileString(path.join(root, ".claude/dufflebag/receipt.json")));
        const settingsArtifacts = receipt.artifacts.filter((artifact: { kind: { _tag: string } }) => artifact.kind._tag === "settings");
        expect(settingsArtifacts).toHaveLength(1);
        expect(settingsArtifacts[0].ownership.values).toContainEqual(
          expect.objectContaining({ pointer: "/env/dufflebagSpeechVoice", installed: { _tag: "missing" } }),
        );
      }),
    ),
  );

  it.effect("copies a validated global config once into a first project installation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const homeRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-home-" });
        const projectRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-project-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-global-stage-" });
        const stagedEntrypoint = path.join(stagedRoot, "runtime/contextGuard/hooks/contextGuard.js");
        const globalConfigPath = path.join(homeRoot, ".claude/dufflebag/config.json");
        const globalConfig = { ...defaultBagConfig, speechVoice: "Daniel" };

        yield* fileSystem.makeDirectory(path.dirname(stagedEntrypoint), { recursive: true });
        yield* fileSystem.writeFileString(stagedEntrypoint, "export {};\n");
        yield* fileSystem.makeDirectory(path.dirname(globalConfigPath), { recursive: true });
        yield* fileSystem.writeFileString(globalConfigPath, `${JSON.stringify(globalConfig, null, 2)}\n`);

        const request = {
          ...installRequest({ root: projectRoot, stagedRoot }),
          host: { homeRoot },
          configuration: { _tag: "automatic" },
        };
        yield* install(request);
        yield* fileSystem.writeFileString(globalConfigPath, `${JSON.stringify({ ...globalConfig, speechVoice: "Moira" }, null, 2)}\n`);
        yield* install(request);

        expect(JSON.parse(yield* fileSystem.readFileString(path.join(projectRoot, ".claude/dufflebag/config.json")))).toEqual(globalConfig);
      }),
    ),
  );

  it.effect("receipts cleanup-only legacy settings when Claude is not selected", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-cleanup-only-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-cleanup-only-stage-" });
        const stagedEntrypoint = path.join(stagedRoot, "runtime/contextGuard/hooks/contextGuard.js");
        const settingsPath = path.join(root, ".claude/settings.json");

        yield* fileSystem.makeDirectory(path.dirname(stagedEntrypoint), { recursive: true });
        yield* fileSystem.writeFileString(stagedEntrypoint, "export {};\n");
        yield* fileSystem.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fileSystem.writeFileString(settingsPath, '{\n  "env": { "keep": "yes", "dufflebagDebugEnabled": "true" }\n}\n');

        yield* install({
          ...installRequest({ root, stagedRoot }),
          agents: { _tag: "selected", ids: ["cursor"] },
          configuration: { _tag: "automatic" },
        });

        expect(JSON.parse(yield* fileSystem.readFileString(settingsPath))).toEqual({ env: { keep: "yes" } });
        const receipt = JSON.parse(yield* fileSystem.readFileString(path.join(root, ".claude/dufflebag/receipt.json")));
        const settingsArtifact = receipt.artifacts.find((artifact: { kind: { _tag: string } }) => artifact.kind._tag === "settings");
        expect(settingsArtifact.ownership.values).toContainEqual(
          expect.objectContaining({ pointer: "/env/dufflebagDebugEnabled", installed: { _tag: "missing" } }),
        );
      }),
    ),
  );

  it.effect("rejects invalid legacy settings before writing config, settings, or a receipt", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-invalid-legacy-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-invalid-legacy-stage-" });
        const stagedEntrypoint = path.join(stagedRoot, "runtime/contextGuard/hooks/contextGuard.js");
        const settingsPath = path.join(root, ".claude/settings.json");
        const originalSettings = '{\n  "env": { "dufflebagDebugEnabled": "yes" }\n}\n';

        yield* fileSystem.makeDirectory(path.dirname(stagedEntrypoint), { recursive: true });
        yield* fileSystem.writeFileString(stagedEntrypoint, "export {};\n");
        yield* fileSystem.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fileSystem.writeFileString(settingsPath, originalSettings);

        const exit = yield* Effect.exit(
          install({
            ...installRequest({ root, stagedRoot }),
            configuration: { _tag: "automatic" },
          }),
        );

        expect(exit._tag).toBe("Failure");
        expect(yield* fileSystem.readFileString(settingsPath)).toBe(originalSettings);
        expect(yield* fileSystem.exists(path.join(root, ".claude/dufflebag/config.json"))).toBe(false);
        expect(yield* fileSystem.exists(path.join(root, ".claude/dufflebag/receipt.json"))).toBe(false);
      }),
    ),
  );

  it.effect("uses one canonical root for inspection, writes, and generated commands", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const container = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-symlink-container-" });
        const realRoot = path.join(container, "realRoot");
        const linkedRoot = path.join(container, "linkedRoot");
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-symlink-stage-" });
        const stagedEntrypoint = path.join(stagedRoot, "runtime/contextGuard/hooks/contextGuard.js");

        yield* fileSystem.makeDirectory(realRoot);
        yield* fileSystem.symlink(realRoot, linkedRoot);
        yield* fileSystem.makeDirectory(path.dirname(stagedEntrypoint), { recursive: true });
        yield* fileSystem.writeFileString(stagedEntrypoint, "export {};\n");

        yield* install(installRequest({ root: linkedRoot, stagedRoot }));

        const settings = yield* fileSystem.readFileString(path.join(realRoot, ".claude/settings.json"));
        expect(settings).toContain(realRoot);
        expect(settings).not.toContain(linkedRoot);
      }),
    ),
  );

  it("strictly rejects unknown request properties", () => {
    const decoded = Schema.decodeUnknownEither(installRequestSchema, {
      onExcessProperty: "error",
    })({
      ...installRequest({ root: "/workspace", stagedRoot: "/package/dist" }),
      global: true,
    });

    expect(decoded._tag).toBe("Left");
  });

  it.each([
    "/workspace/$HOME",
    '/workspace/"quoted"',
    "/workspace/`command`",
    "/workspace/back\\slash",
  ])("rejects an installation root that cannot be embedded safely in generated commands: %s", (root) => {
    const decoded = Schema.decodeUnknownEither(installRequestSchema, {
      onExcessProperty: "error",
    })(installRequest({ root, stagedRoot: "/package/dist" }));

    expect(decoded._tag).toBe("Left");
  });
});
