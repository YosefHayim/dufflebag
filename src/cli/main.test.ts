import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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

describe("isBareArgv", () => {
  it("detects bare invocations that should route to the menu or help", () => {
    expect(isBareArgv(["node", "dufflebag"])).toBe(true);
    expect(isBareArgv(["node", "dufflebag", "install"])).toBe(false);
    expect(isBareArgv(["node", "dufflebag", "--help"])).toBe(false);
  });
});

describe("CLI help", () => {
  it("prints help for --help without hanging", () => {
    const output = execFileSync("pnpm", ["exec", "tsx", CLI_ENTRY, "--help"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    expect(output.toLowerCase()).toContain("dufflebag");
    expect(output.toLowerCase()).toMatch(/install|usage|commands/);
  }, 45_000);

  it("prints version", () => {
    const output = execFileSync("pnpm", ["exec", "tsx", CLI_ENTRY, "--version"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    expect(output).toContain(VERSION);
  }, 45_000);
});

describe("non-TTY bare invocation", () => {
  it("exits without hanging when stdin is not a TTY", () => {
    const output = execFileSync("pnpm", ["exec", "tsx", CLI_ENTRY], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    expect(output.toLowerCase()).toMatch(/dufflebag|usage|help|commands/);
  }, 45_000);
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
