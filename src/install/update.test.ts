import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";

import { defaultBagConfig } from "../config/bagConfigSchema.js";
import { install } from "./install.js";
import { update } from "./update.js";

const stagePackage = (root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = [
      ["runtime/contextGuard/hooks/contextGuard.js", "export {};\n"],
      ["runtime/contextGuard/hooks/ctxWatchSpawn.js", "export {};\n"],
      ["runtime/contextGuard/hooks/ctxLoopCtl.js", "export {};\n"],
      ["runtime/contextGuard/hooks/idleCompactHook.js", "export {};\n"],
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

const request = (input: { root: string; stagedRoot: string; features: ReadonlyArray<string> }) => ({
  destination: { _tag: "project", root: input.root },
  host: { homeRoot: input.root },
  stagedPackage: { root: input.stagedRoot, version: "0.12.0" },
  features: { _tag: "selected", ids: input.features },
  agents: { _tag: "selected", ids: ["claude-code", "cursor", "codex", "aider", "continue"] },
  interaction: { _tag: "scripted" },
  configuration: { _tag: "automatic" },
});

layer(NodeContext.layer)("update", (it) => {
  it.effect("restores removed feature artifacts while retaining user bytes outside owned regions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-update-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-update-stage-" });
        const instructionsPath = path.join(root, "AGENTS.md");
        const settingsPath = path.join(root, ".claude/settings.json");

        yield* stagePackage(stagedRoot);
        yield* fileSystem.writeFileString(instructionsPath, "User instructions.\n");
        yield* fileSystem.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fileSystem.writeFileString(settingsPath, '{\n  "theme": "dark"\n}\n');
        yield* install({
          ...request({ root, stagedRoot, features: ["autonomous-loop"] }),
          configuration: { _tag: "selected", config: defaultBagConfig },
        });

        const result = yield* update(request({ root, stagedRoot, features: ["context-guard"] }));

        expect(result._tag).toBe("updated");
        expect(yield* fileSystem.exists(path.join(root, ".claude/skills/autorun/SKILL.md"))).toBe(false);
        expect(yield* fileSystem.exists(path.join(root, ".cursor/rules/autorun.mdc"))).toBe(false);
        expect(yield* fileSystem.exists(path.join(root, ".aider.conf.yml"))).toBe(false);
        expect(yield* fileSystem.exists(path.join(root, ".continue/config.json"))).toBe(false);
        expect(yield* fileSystem.readFileString(instructionsPath)).toBe("User instructions.\n");
        expect(yield* fileSystem.readFileString(settingsPath)).toContain('"theme": "dark"');
        expect(yield* fileSystem.readFileString(settingsPath)).toContain("SessionStart");

        const receipt = JSON.parse(yield* fileSystem.readFileString(path.join(root, ".claude/dufflebag/receipt.json")));
        expect(receipt.features).toEqual(["context-guard"]);
        expect(receipt.artifacts.some((artifact: { path: string }) => artifact.path.includes("autorun"))).toBe(false);
      }),
    ),
  );

  it.effect("refuses an update after bytes inside a receipted instruction block change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-update-conflict-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-update-conflict-stage-" });
        const instructionsPath = path.join(root, "AGENTS.md");
        const receiptPath = path.join(root, ".claude/dufflebag/receipt.json");

        yield* stagePackage(stagedRoot);
        yield* install({
          ...request({ root, stagedRoot, features: ["autonomous-loop"] }),
          configuration: { _tag: "selected", config: defaultBagConfig },
        });
        const originalReceipt = yield* fileSystem.readFile(receiptPath);
        const instructions = yield* fileSystem.readFileString(instructionsPath);

        yield* fileSystem.writeFileString(instructionsPath, instructions.replace("Run", "Changed"));

        const exit = yield* Effect.exit(update(request({ root, stagedRoot, features: ["context-guard"] })));

        expect(exit._tag).toBe("Failure");
        expect(yield* fileSystem.readFile(receiptPath)).toEqual(originalReceipt);
        expect(yield* fileSystem.readFileString(instructionsPath)).toContain("Changed");
      }),
    ),
  );

  it.effect("preserves a user-owned empty hooks object after the last managed hook is removed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-update-empty-hooks-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-update-empty-hooks-stage-" });
        const settingsPath = path.join(root, ".claude/settings.json");
        const originalSettings = '{\r\n\t"hooks": { }\r\n}\r\n';

        yield* stagePackage(stagedRoot);
        yield* fileSystem.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fileSystem.writeFileString(settingsPath, originalSettings);
        yield* install({
          ...request({ root, stagedRoot, features: ["context-guard"] }),
          configuration: { _tag: "selected", config: defaultBagConfig },
        });

        yield* update({
          ...request({ root, stagedRoot, features: ["context-guard"] }),
          agents: { _tag: "selected", ids: ["cursor"] },
        });

        expect(yield* fileSystem.readFileString(settingsPath)).toBe(originalSettings);
      }),
    ),
  );

  it.effect("removes its created hooks container without reformatting any user byte", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-update-created-hooks-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-update-created-hooks-stage-" });
        const settingsPath = path.join(root, ".claude/settings.json");
        const originalSettings = '{\r\n\t"theme":"dark"\r\n}\r\n';

        yield* stagePackage(stagedRoot);
        yield* fileSystem.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fileSystem.writeFileString(settingsPath, originalSettings);
        yield* install({
          ...request({ root, stagedRoot, features: ["context-guard"] }),
          configuration: { _tag: "selected", config: defaultBagConfig },
        });

        yield* update({
          ...request({ root, stagedRoot, features: ["context-guard"] }),
          agents: { _tag: "selected", ids: ["cursor"] },
        });

        expect(yield* fileSystem.readFileString(settingsPath)).toBe(originalSettings);
      }),
    ),
  );

  it.effect("tracks a hooks container created after a cleanup-only installation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-update-cleanup-hooks-root-" });
        const stagedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-update-cleanup-hooks-stage-" });
        const settingsPath = path.join(root, ".claude/settings.json");
        const originalSettings = '{\r\n\t"env": { "keep":"yes", "dufflebagDebugEnabled":"true" }\r\n}\r\n';
        const baseRequest = request({ root, stagedRoot, features: ["context-guard"] });

        yield* stagePackage(stagedRoot);
        yield* fileSystem.makeDirectory(path.dirname(settingsPath), { recursive: true });
        yield* fileSystem.writeFileString(settingsPath, originalSettings);
        yield* install({ ...baseRequest, agents: { _tag: "selected", ids: ["cursor"] } });
        const settingsAfterCleanup = yield* fileSystem.readFileString(settingsPath);

        yield* update({ ...baseRequest, agents: { _tag: "selected", ids: ["claude-code"] } });
        yield* update({ ...baseRequest, agents: { _tag: "selected", ids: ["cursor"] } });

        expect(yield* fileSystem.readFileString(settingsPath)).toBe(settingsAfterCleanup);
      }),
    ),
  );
});
