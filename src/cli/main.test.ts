import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Schema } from "effect";

import { defaultConfig } from "../config/configSchema.js";
import { installRequestSchema } from "../install/installRequest.js";
import { isBareArgv } from "./main.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageVersion = String(JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version);
const CLI_ENTRY = path.join(REPO_ROOT, "src/cli/main.ts");
const CLI_TEST_TIMEOUT = 75_000;

// Async on purpose: a synchronous spawn blocks the vitest worker long enough for its RPC calls to time out.
const runCli = (args: ReadonlyArray<string>, env: NodeJS.ProcessEnv = {}) =>
  new Promise<{ readonly stdout: string; readonly exitCode: number }>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI_ENTRY, ...args], {
      cwd: REPO_ROOT,
      timeout: 60_000,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, FORCE_COLOR: "0", ...env },
    });
    const chunks: Array<string> = [];
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => chunks.push(chunk));
    child.on("close", (code) => resolve({ stdout: chunks.join(""), exitCode: code === null ? 1 : code }));
  });

// A throwaway directory, used as HOME so the global scope never touches the machine's real install.
const withFreshDirectory = async (run: (directory: string) => Promise<void>) => {
  const directory = mkdtempSync(path.join(tmpdir(), "dufflebag-cli-"));
  try {
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe("isBareArgv", () => {
  it("detects bare invocations that should route to the menu or help", () => {
    expect(isBareArgv(["node", "dufflebag"])).toBe(true);
    expect(isBareArgv(["node", "dufflebag", "install"])).toBe(false);
    expect(isBareArgv(["node", "dufflebag", "--help"])).toBe(false);
  });
});

describe("CLI help", () => {
  it.each([
    {
      args: ["--help"],
      shows: ["dufflebag", "install", "catalog", "workflow scaffold", "voice speak", "stt", "tts"],
      hides: ["voice example", "--wizard", "--log-level", "--completions"],
    },
    {
      args: ["voice", "--help"],
      shows: ["speak", "--source claude-code | codex | grok | devin | manual"],
      hides: ["--example"],
    },
    { args: ["stt", "--help"], shows: ["on", "off", "keep-listening", "lang", "hold Shift"], hides: [] },
    { args: ["tts", "--help"], shows: ["on", "off", "narration", "speech-mode"], hides: [] },
    { args: ["openrouter", "--help"], shows: ["connect", "smoke", "chat", "OAuth"], hides: [] },
    {
      args: ["free", "--help"],
      shows: ["models", "credentials", "acknowledge", "chat"],
      hides: ["base-url", "OmniRoute"],
    },
    {
      args: ["install", "--help"],
      shows: ["<feature-id>...", "--scope global | project", "global home installation root (default)"],
      hides: ["--features", "--global", "--project"],
    },
  ])(
    "documents `$args`",
    async ({ args, shows, hides }) => {
      const execution = await runCli(args);

      expect(execution.exitCode).toBe(0);
      for (const text of shows) expect(execution.stdout).toContain(text);
      for (const text of hides) expect(execution.stdout).not.toContain(text);
    },
    CLI_TEST_TIMEOUT,
  );

  it(
    "prints help, not a prompt, for a bare non-TTY invocation",
    async () => {
      const execution = await runCli([]);

      expect(execution.exitCode).toBe(0);
      expect(execution.stdout).toContain("dufflebag");
    },
    CLI_TEST_TIMEOUT,
  );

  it(
    "prints version",
    async () => {
      const execution = await runCli(["-V"]);

      expect(execution.exitCode).toBe(0);
      expect(execution.stdout).toContain(packageVersion);
    },
    CLI_TEST_TIMEOUT,
  );
});

describe("free providers", () => {
  it(
    "lists direct model identities, keyless readiness, credential variables, and unavailable pools",
    async () => {
      const execution = await runCli(["free", "models"], { GROQ_API_KEY: "" });

      expect(execution.exitCode).toBe(0);
      expect(execution.stdout).toContain("groq/meta-llama/llama-4-scout-17b-16e-instruct");
      expect(execution.stdout).toContain("needs: export GROQ_API_KEY");
      expect(execution.stdout).toContain("needs: export CLOUDFLARE_ACCOUNT_ID");
      expect(execution.stdout).toContain("pollinations/openai");
      expect(execution.stdout).toContain("needs: export POLLINATIONS_API_KEY");
      expect(execution.stdout).toContain("ovhcloud/gpt-oss-120b");
      expect(execution.stdout).toContain("ready: keyless");
      expect(execution.stdout).toContain("huggingchat/baidu/ERNIE-4.5-VL-424B-A47B-Base-PT");
      expect(execution.stdout).toContain("unavailable: browser-cookie");
    },
    CLI_TEST_TIMEOUT,
  );

  it(
    "persists only the current terms acknowledgement and rejects malformed explicit model identities",
    () =>
      withFreshDirectory(async (stateDirectory) => {
        const statePath = path.join(stateDirectory, "provider-health.json");
        const acknowledgement = await runCli(["free", "acknowledge"], { DUFFLEBAG_PROVIDER_HEALTH_FILE: statePath });
        const malformedModel = await runCli(["free", "chat", "say hi", "--model", "missing-separator"], {
          DUFFLEBAG_PROVIDER_HEALTH_FILE: statePath,
        });

        expect(acknowledgement.exitCode).toBe(0);
        expect(readFileSync(statePath, "utf8")).toContain("omniroute-3.8.50-2026-06-17");
        expect(readFileSync(statePath, "utf8")).not.toContain("say hi");
        expect(malformedModel.exitCode).toBe(2);
        expect(malformedModel.stdout).toContain("--model must be auto-free or provider/model");
      }),
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
    () =>
      withFreshDirectory(async (homeRoot) => {
        expect((await runCli(["config", "set", "debug-logs", "sometimes"], { HOME: homeRoot })).exitCode).toBe(2);
      }),
    CLI_TEST_TIMEOUT,
  );
});

describe("config reset", () => {
  it(
    "replaces a config.json that no longer decodes without reading it first",
    () =>
      withFreshDirectory(async (homeRoot) => {
        const configPath = path.join(homeRoot, ".claude/dufflebag/config.json");
        mkdirSync(path.dirname(configPath), { recursive: true });
        writeFileSync(configPath, '{ "unknownSetting": true,\n');
        const refusedSet = await runCli(["config", "set", "debug-logs", "true"], { HOME: homeRoot });
        const execution = await runCli(["config", "reset", "--yes", "--format", "json"], { HOME: homeRoot });

        expect(refusedSet.exitCode).not.toBe(0);
        expect(execution.exitCode).toBe(0);
        expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual(defaultConfig);
      }),
    CLI_TEST_TIMEOUT,
  );
});

describe("tts off", () => {
  it(
    "saves speech-mode off and stops only the narration worker",
    () =>
      withFreshDirectory(async (homeRoot) => {
        const workerLog = path.join(homeRoot, "worker.log");
        const worker = path.join(homeRoot, ".claude/dufflebag/hooks/voice/dufflebag-voice");
        mkdirSync(path.dirname(worker), { recursive: true });
        writeFileSync(worker, `#!/bin/sh\necho "$*" >> "${workerLog}"\n`, { mode: 0o755 });

        const execution = await runCli(["tts", "off"], { HOME: homeRoot });
        const config = JSON.parse(readFileSync(path.join(homeRoot, ".claude/dufflebag/config.json"), "utf8"));

        expect(execution.exitCode).toBe(0);
        expect(readFileSync(workerLog, "utf8")).toBe("stop-narration\n");
        expect(execution.stdout).toContain(
          "Stopped the narration worker and TTS server; dictation worker left running.",
        );
        expect(config.speechMode).toBe("off");
      }),
    CLI_TEST_TIMEOUT,
  );
});

describe("install request schema decoding smoke", () => {
  it.effect("decodes a complete scripted install request", () =>
    Effect.gen(function* () {
      const request = {
        destination: { _tag: "project", root: REPO_ROOT },
        host: { homeRoot: REPO_ROOT },
        preparedPackage: { root: path.join(REPO_ROOT, "dist", "prepared"), version: "0.11.0" },
        features: { _tag: "defaults" },
        agents: { _tag: "selected", ids: ["claude-code"] },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "selected", config: defaultConfig },
      };

      const decoded = yield* Schema.decodeUnknown(installRequestSchema, { onExcessProperty: "error" })(request).pipe(
        Effect.either,
      );

      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        expect(decoded.right.destination._tag).toBe("project");
        expect(decoded.right.features._tag).toBe("defaults");
      }
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});
