/**
 * Command-level integration tests: each command driven end-to-end against a
 * throwaway temp scope. The load-bearing one is the install/uninstall
 * round-trip — it asserts settings.json comes back **byte-for-byte**, proving
 * the surgery is an exact inverse and uninstall takes back only what it added.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";
import { bundledHooksDir, type ClaudeSettings, ENV_KEYS, readSettings, resolveLayout, writeSettings } from "../core/index.js";
import { config, dedupCheck, doctor, install, uninstall } from "./index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** A fresh project scope in its own temp dir. */
function scratchProject(): { dir: string; layout: ReturnType<typeof resolveLayout> } {
  const dir = mkdtempSync(path.join(tmpdir(), "dufflebag-it-"));
  const layout = resolveLayout("project", dir);
  mkdirSync(layout.claudeDir, { recursive: true });
  return { dir, layout };
}

// install copies the compiled payload from dist/hooks, so `npm test` must have a
// build to copy. Build it here if missing so the suite runs cold: tsc compiles
// the vertical sources, then the assembler flattens them into dist/hooks (the
// same two steps as `pnpm run build`). CI's separate build step rebuilds anyway.
beforeAll(() => {
  if (!existsSync(bundledHooksDir())) {
    execFileSync(process.execPath, [path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc")], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    execFileSync(process.execPath, [path.join(REPO_ROOT, "src", "scripts", "assembleHooks.mjs")], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
  }
}, 120_000);

describe("install / uninstall round-trip", () => {
  it("restores settings.json byte-for-byte and removes the payload + skills", async () => {
    const { dir, layout } = scratchProject();
    try {
      // Seed a realistic hand-maintained settings.json (own hook, own env, unrelated key).
      const userSettings: ClaudeSettings = {
        env: { MY_OWN_KEY: "keep-me" },
        hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "node /home/me/my-hook.js" }] }] },
        permissions: { allow: ["Bash"] },
      };
      writeSettings(layout.settingsFile, userSettings);
      const before = readFileSync(layout.settingsFile, "utf8");

      await install({
        scope: "project",
        projectRoot: dir,
        // autonomous-loop pulls context-guard; its skills are small (png-to-code's aren't).
        features: ["dedup-guard", "autonomous-loop"],
        assumeYes: true,
      });

      const mid = readSettings(layout.settingsFile);
      expect(Object.keys(mid.env ?? {}).some((k) => k.startsWith("dufflebag"))).toBe(true);
      expect(mid.env?.MY_OWN_KEY).toBe("keep-me"); // user env preserved
      expect(existsSync(layout.installDir)).toBe(true); // payload written
      expect(existsSync(path.join(layout.skillsDir, "autorun"))).toBe(true); // Claude skill copied
      expect(existsSync(path.join(layout.kimiSkillsDir, "autorun"))).toBe(true); // Kimi skill copied
      expect(existsSync(path.join(layout.kiroSkillsDir, "autorun"))).toBe(true); // Kiro skill copied

      uninstall({ scope: "project", projectRoot: dir });

      expect(readFileSync(layout.settingsFile, "utf8")).toBe(before); // exact inverse
      expect(existsSync(layout.installDir)).toBe(false);
      expect(existsSync(path.join(layout.skillsDir, "autorun"))).toBe(false);
      expect(existsSync(path.join(layout.kimiSkillsDir, "autorun"))).toBe(false);
      expect(existsSync(path.join(layout.kiroSkillsDir, "autorun"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("config", () => {
  it("writes only the tunable it was given, overwriting the prior value", () => {
    const { dir, layout } = scratchProject();
    try {
      writeSettings(layout.settingsFile, { env: { [ENV_KEYS.contextWarnFraction]: "0.18" } });
      config({ scope: "project", projectRoot: dir, patch: { contextWarnFraction: 0.15 } });
      expect(readSettings(layout.settingsFile).env?.[ENV_KEYS.contextWarnFraction]).toBe("0.15");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("doctor", () => {
  it("runs read-only across scopes without throwing", () => {
    expect(() => doctor()).not.toThrow();
  });
});

describe("dedup check", () => {
  it("skips a repo whose own TypeScript is unresolvable (exit 0, never fails CI)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dufflebag-dedup-"));
    try {
      writeFileSync(path.join(dir, "a.ts"), "export const x = 1;\n");
      process.exitCode = 0;
      dedupCheck({ path: dir });
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = 0;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails (exit 1) when a duplicate function body is present", () => {
    // Fixture lives under the repo so the guard resolves the repo's own typescript.
    const dir = mkdtempSync(path.join(REPO_ROOT, "tmp-dedup-"));
    try {
      writeFileSync(path.join(dir, "a.ts"), "export function add(x: number, y: number) { return x + y; }\n");
      writeFileSync(path.join(dir, "b.ts"), "export function sum(a: number, b: number) { return a + b; }\n");
      process.exitCode = 0;
      dedupCheck({ path: dir });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
