import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Schema } from "effect";

import { defaultBagConfig } from "../config/bagConfigSchema.js";
import { installRequestSchema } from "../install/install.js";
import { isBareArgv, VERSION } from "./main.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_ENTRY = path.join(REPO_ROOT, "src/cli/main.ts");
const CLI_TEST_TIMEOUT = 75_000;

type CliExecution = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

const runCli = (args: ReadonlyArray<string>, env: NodeJS.ProcessEnv = {}): CliExecution => {
  const invocation = spawnSync(process.execPath, ["--import", "tsx", CLI_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, FORCE_COLOR: "0", ...env },
  });
  return {
    stdout: invocation.stdout,
    stderr: invocation.stderr,
    exitCode: invocation.status === null ? 1 : invocation.status,
  };
};

describe("isBareArgv", () => {
  it("detects bare invocations that should route to the menu or help", () => {
    expect(isBareArgv(["node", "dufflebag"])).toBe(true);
    expect(isBareArgv(["node", "dufflebag", "install"])).toBe(false);
    expect(isBareArgv(["node", "dufflebag", "--help"])).toBe(false);
  });
});

describe("CLI help", () => {
  it(
    "prints help for --help without hanging",
    async () => {
      const execution = await runCli(["--help"]);

      expect(execution.exitCode).toBe(0);
      expect(execution.stdout.toLowerCase()).toContain("dufflebag");
      expect(execution.stdout.toLowerCase()).toMatch(/install|usage|commands/);
      expect(execution.stdout).toContain("catalog");
      expect(execution.stdout).toContain("workflow scaffold");
      expect(execution.stdout).toContain("voice speak");
      expect(execution.stdout).toContain("stt");
      expect(execution.stdout).toContain("tts");
      expect(execution.stdout).not.toContain("voice example");
      expect(execution.stdout).not.toContain("--wizard");
      expect(execution.stdout).not.toContain("--log-level");
      expect(execution.stdout).not.toContain("--completions");
    },
    CLI_TEST_TIMEOUT,
  );

  it(
    "documents the command-first voice surface without the retired example option",
    async () => {
      const execution = await runCli(["voice", "--help"]);

      expect(execution.exitCode).toBe(0);
      expect(execution.stdout).toContain("speak");
      expect(execution.stdout).toContain("--source claude-code | codex | grok | devin | manual");
      expect(execution.stdout).not.toContain("--example");
    },
    CLI_TEST_TIMEOUT,
  );

  it(
    "documents stt and tts on/off toggles",
    async () => {
      const stt = await runCli(["stt", "--help"]);
      const tts = await runCli(["tts", "--help"]);

      expect(stt.exitCode).toBe(0);
      expect(stt.stdout).toContain("on");
      expect(stt.stdout).toContain("off");
      expect(stt.stdout).toContain("mic-off-delay");
      expect(stt.stdout).toContain("lang");
      expect(stt.stdout.toLowerCase()).toMatch(/dictation|speech-to-text|hold control/);

      expect(tts.exitCode).toBe(0);
      expect(tts.stdout).toContain("on");
      expect(tts.stdout).toContain("off");
      expect(tts.stdout.toLowerCase()).toMatch(/narration|text-to-speech|speech-response-mode/);
    },
    CLI_TEST_TIMEOUT,
  );

  it(
    "prints version",
    async () => {
      const execution = await runCli(["-V"]);

      expect(execution.exitCode).toBe(0);
      expect(execution.stdout).toContain(VERSION);
    },
    CLI_TEST_TIMEOUT,
  );

  it(
    "documents positional feature IDs and global scope as the default",
    async () => {
      const execution = await runCli(["install", "--help"]);

      expect(execution.exitCode).toBe(0);
      expect(execution.stdout).toContain("<feature-id>...");
      expect(execution.stdout).toContain("--scope global | project");
      expect(execution.stdout).toContain("global home installation root (default)");
      expect(execution.stdout).not.toContain("--features");
      expect(execution.stdout).not.toContain("--global");
      expect(execution.stdout).not.toContain("--project");
    },
    CLI_TEST_TIMEOUT,
  );
});

describe("non-TTY bare invocation", () => {
  it(
    "exits without hanging when stdin is not a TTY",
    async () => {
      const execution = await runCli([]);

      expect(execution.exitCode).toBe(0);
      expect(execution.stdout.toLowerCase()).toMatch(/dufflebag|usage|help|commands/);
    },
    CLI_TEST_TIMEOUT,
  );
});

describe("CLI exit codes", () => {
  it(
    "uses exit 2 when a non-interactive destructive command lacks --yes",
    async () => {
      const execution = await runCli(["uninstall"]);

      expect(execution.exitCode).toBe(2);
      expect(execution.stdout).toContain("Non-interactive uninstall requires --yes.");
    },
    CLI_TEST_TIMEOUT,
  );

  it(
    "uses exit 2 for an invalid managed setting value",
    async () => {
      // Isolate HOME so a machine-local managed config cannot change the parse path.
      const homeRoot = mkdtempSync(path.join(tmpdir(), "dufflebag-cli-home-"));
      try {
        const execution = await runCli(["config", "set", "speech-read-along", "sometimes"], {
          HOME: homeRoot,
        });

        expect(execution.exitCode).toBe(2);
      } finally {
        rmSync(homeRoot, { recursive: true, force: true });
      }
    },
    CLI_TEST_TIMEOUT,
  );
});

describe("install request schema decoding smoke", () => {
  it.effect("decodes a complete scripted install request", () =>
    Effect.gen(function* () {
      const request = {
        destination: { _tag: "project", root: REPO_ROOT },
        host: { homeRoot: REPO_ROOT },
        stagedPackage: { root: path.join(REPO_ROOT, "dist", "staged"), version: "0.11.0" },
        features: { _tag: "defaults" },
        agents: { _tag: "selected", ids: ["claude-code"] },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "selected", config: defaultBagConfig },
      };

      const decoded = yield* Schema.decodeUnknown(installRequestSchema, {
        onExcessProperty: "error",
      })(request).pipe(Effect.either);

      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        expect(decoded.right.destination._tag).toBe("project");
        expect(decoded.right.features._tag).toBe("defaults");
      }
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});

describe("CLI entry present", () => {
  it("keeps the Effect CLI entry on disk", () => {
    expect(existsSync(CLI_ENTRY)).toBe(true);
  });
});
