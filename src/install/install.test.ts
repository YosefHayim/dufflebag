import { createHash } from "node:crypto";

import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { defaultConfig } from "../config/configSchema.js";
import { install } from "./install.js";
import { installRequestSchema } from "./installRequest.js";
import { planRestores } from "./restore.js";

const textEncoder = new TextEncoder();

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

const contextGuardRuntime = {
  "hooks/contextGuard/hooks/contextGuard.js": "export {};\n",
  "hooks/contextGuard/hooks/startAutorunWatcher.js": "export {};\n",
  "hooks/contextGuard/hooks/autorunControl.js": "export {};\n",
  "hooks/contextGuard/hooks/recordIdleCompactEvent.js": "export {};\n",
  "hooks/contextGuard/hooks/idleCompactWatcher.js": "export {};\n",
};

const autorunSkill = { "skills/autorun/SKILL.md": "---\nname: autorun\n---\nRun @@AUTORUN_CONTROL@@ when armed.\n" };

const workspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-root-" });
  const preparedRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-prepared-" });
  const writeFiles = (base: string, files: Readonly<Record<string, string>>) =>
    Effect.forEach(Object.entries(files), ([relativePath, contents]) =>
      Effect.gen(function* () {
        const destination = path.join(base, relativePath);
        yield* fileSystem.makeDirectory(path.dirname(destination), { recursive: true });
        yield* fileSystem.writeFileString(destination, contents);
      }),
    );

  const readText = (relativePath: string) => fileSystem.readFileString(path.join(root, relativePath));

  const exists = (relativePath: string) => fileSystem.exists(path.join(root, relativePath));

  const readReceipt = Effect.map(readText(".claude/dufflebag/receipt.json"), (text) => JSON.parse(text));

  return { fileSystem, path, root, preparedRoot, writeFiles, readText, exists, readReceipt };
});

// e.g. {"hooks":{"Stop":[{"hooks":[{"command":"node \\"/x.js\\""}]}]}} → ['node "/x.js"']
const hookCommands = (settingsText: string): ReadonlyArray<string> =>
  [...settingsText.matchAll(/"command"\s*:\s*("(?:[^"\\]|\\.)*")/g)].flatMap((match) =>
    match[1] === undefined ? [] : [String(JSON.parse(match[1]))],
  );

const installRequest = (input: { root: string; preparedRoot: string }) => ({
  destination: { _tag: "project", root: input.root },
  host: { homeRoot: input.root },
  preparedPackage: { root: input.preparedRoot, version: "0.12.0" },
  features: { _tag: "selected", ids: ["context-guard"] },
  agents: { _tag: "selected", ids: ["claude-code"] },
  interaction: { _tag: "scripted" },
  configuration: { _tag: "selected", config: defaultConfig },
});

const decodeInstallRequest = Schema.decodeUnknownEither(installRequestSchema, { onExcessProperty: "error" });

layer(NodeContext.layer)("install", (it) => {
  it.scoped("installs one decoded prepared runtime, managed config, settings hook, and ownership receipt", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText, readReceipt } = yield* workspace;
      yield* writeFiles(preparedRoot, contextGuardRuntime);
      yield* writeFiles(root, {
        ".claude/settings.json":
          '{\n  "theme": "dark",\n  "hooks": {\n    "Stop": [{ "hooks": [{ "type": "command", "command": "user-command" }] }]\n  }\n}\n',
      });

      const installation = yield* install(installRequest({ root, preparedRoot }));

      expect(installation).toMatchObject({
        _tag: "installed",
        scope: "project",
        features: ["context-guard"],
        agents: ["claude-code"],
      });
      expect(installation.platformRequirements).toEqual([{ featureId: "context-guard", platform: "any" }]);
      expect(yield* readText(".claude/dufflebag/hooks/contextGuard/hooks/contextGuard.js")).toBe("export {};\n");
      expect(JSON.parse(yield* readText(".claude/dufflebag/config.json"))).toEqual(defaultConfig);

      const settings = yield* readText(".claude/settings.json");
      expect(settings).toContain('"theme": "dark"');
      expect(settings).toContain("user-command");
      expect(settings).toContain("contextGuard/hooks/contextGuard.js");

      const receipt = yield* readReceipt;
      expect(receipt.features).toEqual(["context-guard"]);
      expect(receipt.artifacts.map((file: { path: string }) => file.path)).toEqual([
        ".claude/dufflebag/hooks/contextGuard/hooks/autorunControl.js",
        ".claude/dufflebag/hooks/contextGuard/hooks/contextGuard.js",
        ".claude/dufflebag/hooks/contextGuard/hooks/idleCompactWatcher.js",
        ".claude/dufflebag/hooks/contextGuard/hooks/recordIdleCompactEvent.js",
        ".claude/dufflebag/hooks/contextGuard/hooks/startAutorunWatcher.js",
        ".claude/dufflebag/config.json",
        ".claude/settings.json",
      ]);
    }),
  );

  it.scoped("installs native hooks for detected Codex and Grok without replacing user hooks", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText, exists } = yield* workspace;
      yield* writeFiles(preparedRoot, contextGuardRuntime);
      yield* writeFiles(root, {
        ".codex/hooks.json":
          '{\n  "keep": true,\n  "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "user-stop" }] }] }\n}\n',
      });

      yield* install({
        ...installRequest({ root, preparedRoot }),
        agents: { _tag: "selected", ids: ["codex", "grok"] },
        configuration: { _tag: "selected", config: { ...defaultConfig, idleCompactAfter: "1m" } },
      });

      const codex = yield* readText(".codex/hooks.json");
      expect(codex).toContain('"keep": true');
      expect(codex).toContain("user-stop");
      // Hooks read config.json themselves, so a command carries at most the agent id.
      const commands = hookCommands(codex).filter((command) => command !== "user-stop");
      expect(commands.filter((command) => command.includes("recordIdleCompactEvent.js"))).not.toEqual([]);
      for (const command of commands) {
        const expectedPrefix = command.includes("recordIdleCompactEvent.js")
          ? 'DUFFLEBAG_AGENT_ID=codex node "'
          : 'node "';
        expect(command.startsWith(expectedPrefix)).toBe(true);
      }

      const grok = yield* readText(".grok/hooks/dufflebag.json");
      expect(grok).toContain("DUFFLEBAG_AGENT_ID=grok");
      expect(grok).toContain("recordIdleCompactEvent.js");
      expect(yield* exists(".claude/settings.json")).toBe(false);
    }),
  );

  it.scoped("passes the agent id to the voice hook for Claude, Codex, and Grok", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
      yield* writeFiles(preparedRoot, { "hooks/voice/hooks/speakReply.js": "export {};\n" });

      yield* install({
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["voice"] },
        agents: { _tag: "selected", ids: ["claude-code", "codex", "grok"] },
      });

      expect(yield* readText(".claude/settings.json")).toContain("DUFFLEBAG_AGENT_ID=claude-code node ");
      expect(yield* readText(".codex/hooks.json")).toContain("DUFFLEBAG_AGENT_ID=codex node ");
      expect(yield* readText(".grok/hooks/dufflebag.json")).toContain("DUFFLEBAG_AGENT_ID=grok node ");
    }),
  );

  it.scoped("returns unchanged without rewriting an identical installation", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
      const request = installRequest({ root, preparedRoot });
      yield* writeFiles(preparedRoot, contextGuardRuntime);

      yield* install(request);
      const before = yield* readText(".claude/dufflebag/receipt.json");
      const installation = yield* install(request);

      expect(installation._tag).toBe("unchanged");
      expect(yield* readText(".claude/dufflebag/receipt.json")).toBe(before);
    }),
  );

  it.scoped("adopts a receipted skill file an external sync rewrote with the exact desired bytes", () =>
    Effect.gen(function* () {
      const { fileSystem, path, root, preparedRoot, writeFiles, readText, readReceipt } = yield* workspace;
      const installedSkill = ".claude/skills/autorun/SKILL.md";
      const request = {
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["autorun"] },
        agents: { _tag: "selected", ids: ["claude-code"] },
      };
      yield* writeFiles(preparedRoot, { ...contextGuardRuntime, ...autorunSkill });
      yield* install(request);

      // Ship a newer skill, then let an external sync write that same rendered content first.
      yield* writeFiles(preparedRoot, {
        "skills/autorun/SKILL.md": "---\nname: autorun\n---\nRun @@AUTORUN_CONTROL@@ after every handoff.\n",
      });
      const synced = (yield* readText(installedSkill)).replace("when armed.", "after every handoff.");
      yield* writeFiles(root, { [installedSkill]: synced });

      const installation = yield* install(request);

      expect(installation._tag).toBe("installed");
      expect(yield* readText(installedSkill)).toBe(synced);

      // The refreshed receipt must describe the adopted bytes, so the next install stays clean.
      const entry = (yield* readReceipt).artifacts.find((file: { path: string }) => file.path === installedSkill);
      expect(entry.ownership.installedHash).toBe(sha256(yield* fileSystem.readFile(path.join(root, installedSkill))));
      expect((yield* Effect.exit(install(request)))._tag).toBe("Success");
    }),
  );

  it.scoped("still refuses a receipted skill file rewritten with content it would not write", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
      const installedSkill = ".claude/skills/autorun/SKILL.md";
      const handWritten = "---\nname: autorun\n---\nMy own hand-written notes.\n";
      const request = {
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["autorun"] },
        agents: { _tag: "selected", ids: ["claude-code"] },
      };
      yield* writeFiles(preparedRoot, { ...contextGuardRuntime, ...autorunSkill });
      yield* install(request);
      yield* writeFiles(root, { [installedSkill]: handWritten });

      const exit = yield* Effect.exit(install(request));

      expect(exit._tag).toBe("Failure");
      expect(yield* readText(installedSkill)).toBe(handWritten);
    }),
  );

  it.scoped("plans all four native agent formats without duplicate instruction destinations", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText, exists, readReceipt } = yield* workspace;
      yield* writeFiles(preparedRoot, { ...contextGuardRuntime, ...autorunSkill });

      yield* install({
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["autorun"] },
        agents: { _tag: "selected", ids: ["continue", "aider", "codex", "cursor", "claude-code"] },
      });

      expect(yield* readText(".claude/skills/autorun/SKILL.md")).toContain("Run");
      expect(yield* readText(".agents/skills/autorun/SKILL.md")).toContain("Run");
      expect(yield* exists(".codex/skills/autorun/SKILL.md")).toBe(false);
      expect(yield* readText(".cursor/rules/autorun.mdc")).toContain(
        ".claude/dufflebag/hooks/contextGuard/hooks/autorunControl.js",
      );

      const instructions = yield* readText("AGENTS.md");
      expect(instructions.match(/<!-- dufflebag:skills start -->/g)).toHaveLength(1);
      expect(instructions).toContain("## autorun");
      expect(yield* readText(".aider.conf.yml")).toContain("AGENTS.md");
      expect(JSON.parse(yield* readText(".continue/config.json")).rules).toEqual(["AGENTS.md"]);

      const instructionFiles = (yield* readReceipt).artifacts.filter(
        (file: { kind: { _tag: string }; path: string }) =>
          file.kind._tag === "instruction" && file.path === "AGENTS.md",
      );
      expect(instructionFiles).toHaveLength(1);
      expect(instructionFiles[0].owner.agentIds).toEqual(["aider", "continue"]);
    }),
  );

  it.scoped("installs a skill control runtime when Claude is not selected", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, readText } = yield* workspace;
      yield* writeFiles(preparedRoot, { ...contextGuardRuntime, ...autorunSkill });

      yield* install({
        ...installRequest({ root, preparedRoot }),
        features: { _tag: "selected", ids: ["autorun"] },
        agents: { _tag: "selected", ids: ["cursor"] },
      });

      expect(yield* readText(".claude/dufflebag/hooks/contextGuard/hooks/autorunControl.js")).toBe("export {};\n");
      expect(yield* readText(".cursor/rules/autorun.mdc")).toContain(
        ".claude/dufflebag/hooks/contextGuard/hooks/autorunControl.js",
      );
    }),
  );

  it.scoped("rejects an extra prepared skill file before writing host files", () =>
    Effect.gen(function* () {
      const { root, preparedRoot, writeFiles, exists } = yield* workspace;
      yield* writeFiles(preparedRoot, {
        ...contextGuardRuntime,
        ...autorunSkill,
        "skills/autorun/EXTRA.md": "not catalog-shipped\n",
      });

      const exit = yield* Effect.exit(
        install({ ...installRequest({ root, preparedRoot }), features: { _tag: "selected", ids: ["autorun"] } }),
      );

      expect(exit._tag).toBe("Failure");
      expect(yield* exists(".claude/dufflebag/receipt.json")).toBe(false);
      expect(yield* exists(".claude/dufflebag/config.json")).toBe(false);
    }),
  );

  it.scoped("copies a validated global config once into a first project installation", () =>
    Effect.gen(function* () {
      const { fileSystem, root: homeRoot, preparedRoot, writeFiles } = yield* workspace;
      const projectRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-install-project-" });
      const globalConfig = { ...defaultConfig, speechVoice: "Daniel" };
      const writeGlobalConfig = (config: object) =>
        writeFiles(homeRoot, { ".claude/dufflebag/config.json": `${JSON.stringify(config, null, 2)}\n` });
      const request = {
        ...installRequest({ root: projectRoot, preparedRoot }),
        host: { homeRoot },
        configuration: { _tag: "automatic" },
      };
      yield* writeFiles(preparedRoot, contextGuardRuntime);
      yield* writeGlobalConfig(globalConfig);

      yield* install(request);
      yield* writeGlobalConfig({ ...globalConfig, speechVoice: "Moira" });
      yield* install(request);

      expect(JSON.parse(yield* fileSystem.readFileString(`${projectRoot}/.claude/dufflebag/config.json`))).toEqual(
        globalConfig,
      );
    }),
  );

  it.scoped("uses one canonical root for inspection, writes, and generated commands", () =>
    Effect.gen(function* () {
      const { fileSystem, path, root: container, preparedRoot, writeFiles } = yield* workspace;
      const realRoot = path.join(container, "realRoot");
      const linkedRoot = path.join(container, "linkedRoot");
      yield* fileSystem.makeDirectory(realRoot);
      yield* fileSystem.symlink(realRoot, linkedRoot);
      yield* writeFiles(preparedRoot, contextGuardRuntime);

      yield* install(installRequest({ root: linkedRoot, preparedRoot }));

      const settings = yield* fileSystem.readFileString(path.join(realRoot, ".claude/settings.json"));
      expect(settings).toContain(realRoot);
      expect(settings).not.toContain(linkedRoot);
    }),
  );

  it.scoped("removes installer-created whole files even when they drifted or vanished", () =>
    Effect.gen(function* () {
      const { root, writeFiles } = yield* workspace;
      const driftedPath = ".claude/dufflebag/hooks/voice/hooks/speakReply.js";
      const exactPath = ".claude/dufflebag/hooks/voice/text_to_speech.py";
      yield* writeFiles(root, { [driftedPath]: "drifted after install\n", [exactPath]: "exact\n" });
      const wholeFile = (filePath: string, hash: string) => ({
        owner: { _tag: "application" as const },
        path: filePath,
        kind: { _tag: "runtime" as const },
        ownership: { _tag: "wholeFile" as const, installedHash: hash, previous: { _tag: "missing" as const } },
      });

      const restorations = yield* planRestores({
        root,
        files: [
          wholeFile(driftedPath, sha256("old\n")),
          wholeFile(".claude/dufflebag/hooks/voice/refine_prompt.py", sha256("old\n")),
          wholeFile(exactPath, sha256("exact\n")),
        ],
      });

      expect(restorations).toHaveLength(3);
      expect(restorations.every((operation) => operation._tag === "remove")).toBe(true);
    }),
  );

  it.scoped("still refuses to restore a prior host file that drifted after install", () =>
    Effect.gen(function* () {
      const { root, writeFiles } = yield* workspace;
      yield* writeFiles(root, { "owned.txt": "user edited\n" });

      const restorationPlan = yield* planRestores({
        root,
        files: [
          {
            owner: { _tag: "application" },
            path: "owned.txt",
            kind: { _tag: "runtime" },
            ownership: {
              _tag: "wholeFile",
              installedHash: sha256("installed\n"),
              previous: { _tag: "priorFile", bytes: textEncoder.encode("prior\n") },
            },
          },
        ],
      }).pipe(Effect.either);

      expect(restorationPlan._tag).toBe("Left");
      if (restorationPlan._tag === "Left") {
        expect(restorationPlan.left.message).toContain("changed after installation");
      }
    }),
  );

  it("strictly rejects unknown request properties", () => {
    const decoded = decodeInstallRequest({
      ...installRequest({ root: "/workspace", preparedRoot: "/package/dist" }),
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
    expect(decodeInstallRequest(installRequest({ root, preparedRoot: "/package/dist" }))._tag).toBe("Left");
  });
});
