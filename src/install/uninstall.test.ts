import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { defaultBagConfig } from "../config/bagConfigSchema.js";
import { install } from "./install.js";
import { uninstall, uninstallRequestSchema } from "./uninstall.js";
import { update } from "./update.js";

const stagePackage = (root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = [
      ["runtime/contextGuard/hooks/contextGuard.js", "export {};\n"],
      ["runtime/contextGuard/hooks/ctxWatchSpawn.js", "export {};\n"],
      ["runtime/contextGuard/hooks/ctxLoopCtl.js", "export {};\n"],
      ["skills/autorun/SKILL.md", "---\nname: autorun\n---\nRun @@CTL@@ when armed.\n"],
    ];

    yield* Effect.forEach(files, ([relativePath, contents]) =>
      Effect.gen(function* () {
        const destination = path.join(root, relativePath);

        yield* fileSystem.makeDirectory(path.dirname(destination), { recursive: true });
        yield* fileSystem.writeFileString(destination, contents);
      }),
    );
  });

const installRequest = (input: { root: string; stagedRoot: string }) => ({
  destination: { _tag: "project", root: input.root },
  host: { homeRoot: input.root },
  stagedPackage: { root: input.stagedRoot, version: "0.12.0" },
  features: { _tag: "selected", ids: ["autonomous-loop"] },
  agents: { _tag: "selected", ids: ["claude-code", "cursor", "codex", "aider", "continue"] },
  interaction: { _tag: "scripted" },
  configuration: { _tag: "selected", config: { ...defaultBagConfig, speechVoice: "Daniel" } },
});

const uninstallRequest = (root: string) => ({
  destination: { _tag: "project", root },
  host: { homeRoot: root },
  interaction: { _tag: "scripted" },
});

layer(NodeContext.layer)("uninstall", (it) => {
  it.effect("restores every receipted format exactly and removes installer-created files", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-stage-" });
        const originals = [
          [".claude/dufflebag/config.json", `${JSON.stringify(defaultBagConfig, null, 2)}\n`],
          [".claude/settings.json", '{\r\n\t"theme":"dark",\r\n\t"hooks": { }\r\n}\r\n'],
          ["AGENTS.md", "User instructions.\n"],
          [".aider.conf.yml", "model: sonnet\n"],
          [".continue/config.json", '{\r\n\t"models": []\r\n}\r\n'],
        ];

        yield* stagePackage(stagedRoot);
        yield* Effect.forEach(originals, ([relativePath, contents]) =>
          Effect.gen(function* () {
            const destination = path.join(root, relativePath);

            yield* fileSystem.makeDirectory(path.dirname(destination), { recursive: true });
            yield* fileSystem.writeFileString(destination, contents);
          }),
        );
        yield* install(installRequest({ root, stagedRoot }));

        const result = yield* uninstall(uninstallRequest(root));

        expect(result).toEqual({ _tag: "uninstalled", scope: "project", interaction: { _tag: "scripted" } });
        yield* Effect.forEach(originals, ([relativePath, contents]) =>
          Effect.gen(function* () {
            expect(yield* fileSystem.readFileString(path.join(root, relativePath))).toBe(contents);
          }),
        );
        expect(yield* fileSystem.exists(path.join(root, ".claude/dufflebag/receipt.json"))).toBe(false);
        expect(yield* fileSystem.exists(path.join(root, ".claude/dufflebag/runtime/contextGuard/hooks/ctxWatchSpawn.js"))).toBe(false);
        expect(yield* fileSystem.exists(path.join(root, ".claude/skills/autorun/SKILL.md"))).toBe(false);
        expect(yield* fileSystem.exists(path.join(root, ".cursor/rules/autorun.mdc"))).toBe(false);
      }),
    ),
  );

  it.effect("leaves unreceipted agent files untouched", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-authority-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-authority-stage-" });
        const userRulePath = path.join(root, ".cursor/rules/user.mdc");
        const userSkillPath = path.join(root, ".claude/skills/user/SKILL.md");

        yield* stagePackage(stagedRoot);
        yield* install(installRequest({ root, stagedRoot }));
        yield* fileSystem.makeDirectory(path.dirname(userRulePath), { recursive: true });
        yield* fileSystem.makeDirectory(path.dirname(userSkillPath), { recursive: true });
        yield* fileSystem.writeFileString(userRulePath, "User-owned rule.\n");
        yield* fileSystem.writeFileString(userSkillPath, "User-owned skill.\n");

        yield* uninstall(uninstallRequest(root));

        expect(yield* fileSystem.readFileString(userRulePath)).toBe("User-owned rule.\n");
        expect(yield* fileSystem.readFileString(userSkillPath)).toBe("User-owned skill.\n");
      }),
    ),
  );

  it.effect("returns absent without mutating files when no receipt exists", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-absent-root-" });
        const userPath = path.join(root, ".cursor/rules/user.mdc");

        yield* fileSystem.makeDirectory(path.dirname(userPath), { recursive: true });
        yield* fileSystem.writeFileString(userPath, "User-owned rule.\n");

        const result = yield* uninstall(uninstallRequest(root));

        expect(result).toEqual({ _tag: "absent", scope: "project", interaction: { _tag: "scripted" } });
        expect(yield* fileSystem.readFileString(userPath)).toBe("User-owned rule.\n");
      }),
    ),
  );

  it.effect("fails before commit when a receipted artifact changed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-conflict-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-conflict-stage-" });
        const runtimePath = path.join(root, ".claude/dufflebag/runtime/contextGuard/hooks/ctxWatchSpawn.js");
        const receiptPath = path.join(root, ".claude/dufflebag/receipt.json");

        yield* stagePackage(stagedRoot);
        yield* install(installRequest({ root, stagedRoot }));
        const receiptBytes = yield* fileSystem.readFile(receiptPath);
        yield* fileSystem.writeFileString(runtimePath, "user changed this\n");

        const error = yield* Effect.flip(uninstall(uninstallRequest(root)));

        expect(error._tag).toBe("UninstallError");
        expect(error.issue).not.toContain("Cannot install dufflebag");
        expect(yield* fileSystem.readFile(receiptPath)).toEqual(receiptBytes);
        expect(yield* fileSystem.readFileString(runtimePath)).toBe("user changed this\n");
      }),
    ),
  );

  it.effect("restores legacy settings after install and update preserve their missing-state ownership", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-legacy-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-legacy-stage-" });
        const settingsPath = path.join(root, ".claude/settings.json");
        const originalSettings = '{\r\n\t"env": { "keep":"yes", "dufflebagSpeechVoice":"Daniel" }\r\n}\r\n';
        const request = {
          ...installRequest({ root, stagedRoot }),
          agents: { _tag: "selected", ids: ["cursor"] },
          configuration: { _tag: "automatic" },
        };

        yield* stagePackage(stagedRoot);
        yield* fileSystem.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fileSystem.writeFileString(settingsPath, originalSettings);
        yield* install(request);
        yield* update({ ...request, features: { _tag: "preserve" } });

        yield* uninstall(uninstallRequest(root));

        expect(yield* fileSystem.readFileString(settingsPath)).toBe(originalSettings);
      }),
    ),
  );

  it.effect("restores escaped first-position legacy settings without changing property order", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-escaped-legacy-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-escaped-legacy-stage-" });
        const settingsPath = path.join(root, ".claude/settings.json");
        const originalSettings = '{\r\n\t"env": { "dufflebagSpeechVoice":"Dan\\u0069el", "keep":"yes" },\r\n\t"theme":"dark"\r\n}\r\n';
        const request = {
          ...installRequest({ root, stagedRoot }),
          agents: { _tag: "selected", ids: ["cursor"] },
          configuration: { _tag: "automatic" },
        };

        yield* stagePackage(stagedRoot);
        yield* fileSystem.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fileSystem.writeFileString(settingsPath, originalSettings);
        yield* install(request);

        yield* uninstall(uninstallRequest(root));

        expect(yield* fileSystem.readFileString(settingsPath)).toBe(originalSettings);
      }),
    ),
  );

  it.effect("restores a multiline pre-existing hook value byte for byte", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-multiline-hook-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-uninstall-multiline-hook-stage-" });
        const settingsPath = path.join(root, ".claude/settings.json");
        const originalSettings = [
          "{",
          '  "hooks": {',
          '    "PreToolUse": [',
          "      {",
          '        "matcher": "Read",',
          '        "hooks": [{ "type": "command", "command": "user-command" }]',
          "      }",
          "    ]",
          "  },",
          '  "theme": "dark"',
          "}",
          "",
        ].join("\n");

        yield* stagePackage(stagedRoot);
        yield* fileSystem.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fileSystem.writeFileString(settingsPath, originalSettings);
        yield* install(installRequest({ root, stagedRoot }));

        yield* uninstall(uninstallRequest(root));

        expect(yield* fileSystem.readFileString(settingsPath)).toBe(originalSettings);
      }),
    ),
  );

  it("strictly rejects agent detection and staged-package inputs", () => {
    const decoded = Schema.decodeUnknownEither(uninstallRequestSchema, {
      onExcessProperty: "error",
    })({
      ...uninstallRequest("/workspace"),
      agents: { _tag: "detected", evidence: { homePaths: [".cursor"], absolutePaths: [], commands: [] } },
      stagedPackage: { root: "/package/dist", version: "0.12.0" },
    });

    expect(decoded._tag).toBe("Left");
  });
});
