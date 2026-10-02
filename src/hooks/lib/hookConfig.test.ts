import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { managedConfigPath } from "../../config/configFile.js";
import { defaultConfig } from "../../config/configSchema.js";
import { hooksPath } from "../../install/installPaths.js";
import { decodeHookConfig, resolveIdleCompactSeconds } from "./hookConfig.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const configModuleSource = fileURLToPath(new URL("./hookConfig.ts", import.meta.url));

describe("hook config resolution", () => {
  it("keeps the dependency-free hook defaults aligned with application defaults", () => {
    const hookDefaults = decodeHookConfig({});
    for (const [field, value] of Object.entries(hookDefaults)) {
      expect(value).toEqual(Object.getOwnPropertyDescriptor(defaultConfig, field)?.value);
    }
  });

  it("reads the install-root config.json from the installed hook layout", () => {
    // realpath: the module resolves its own real path, and macOS temp folders sit behind a /var symlink.
    const installRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "dufflebag-hook-config-")));
    try {
      // Install copies src/hooks/lib into each feature's lib/ under hooksPath.
      const installedModule = path.join(installRoot, hooksPath, "contextGuard", "lib", "hookConfig.ts");
      const installedConfig = path.join(installRoot, managedConfigPath);
      mkdirSync(path.dirname(installedModule), { recursive: true });
      copyFileSync(configModuleSource, installedModule);
      // Installed hooks are .js that Node detects as ES modules. On Node 22, tsx loads a .ts copy outside any
      // package as CommonJS and drops its named exports, so mark the temp tree as ESM.
      writeFileSync(path.join(installRoot, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
      writeFileSync(
        installedConfig,
        `${JSON.stringify({ contextWarnPercent: 31, duplicateCodeMode: "warn", duplicateCodeSkipFolders: ["vendor"] })}\n`,
      );

      const printConfig = [
        `const { installRoot, readConfig } = await import(${JSON.stringify(pathToFileURL(installedModule).href)});`,
        "process.stdout.write(JSON.stringify({ installRoot, config: readConfig() }));",
      ].join("\n");
      const execution = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", printConfig], {
        cwd: packageRoot,
        encoding: "utf8",
      });

      expect(execution.stderr).toBe("");
      expect(execution.status).toBe(0);
      const printed = JSON.parse(execution.stdout);
      expect(printed.installRoot).toBe(path.join(installRoot, ".claude", "dufflebag"));
      expect(printed.config.contextWarnPercent).toBe(31);
      expect(printed.config.duplicateCodeMode).toBe("warn");
      expect(printed.config.duplicateCodeSkipFolders).toEqual(["vendor"]);
      expect(printed.config.contextBlockPercent).toBe(defaultConfig.contextBlockPercent);
    } finally {
      rmSync(installRoot, { recursive: true, force: true });
    }
  });

  it("keeps the default for a field whose value has the wrong shape", () => {
    const config = decodeHookConfig({ contextWarnPercent: "15", duplicateCodeMode: "strict", debugLogs: "yes" });
    expect(config.contextWarnPercent).toBe(defaultConfig.contextWarnPercent);
    expect(config.duplicateCodeMode).toBe(defaultConfig.duplicateCodeMode);
    expect(config.debugLogs).toBe(defaultConfig.debugLogs);
  });

  it("drops blank session-rehome roots, which would scan the whole home folder", () => {
    expect(decodeHookConfig({ sessionRehomeRoots: ["", "  ", "Desktop/Code", 7] }).sessionRehomeRoots).toEqual([
      "Desktop/Code",
    ]);
  });

  it.each([
    [{ DUFFLEBAG_IDLE_COMPACT_AFTER: "45s" }, 45],
    [{ DUFFLEBAG_IDLE_COMPACT_AFTER: "1h" }, 3_600],
    [{ DUFFLEBAG_IDLE_COMPACT_AFTER: "off" }, null],
    [{ DUFFLEBAG_IDLE_COMPACT_AFTER: "soon" }, null],
    [{ DUFFLEBAG_IDLE_COMPACT_AFTER: "2d" }, null],
    [{}, 120],
  ])("resolves idle compact seconds from %o over a 2m config value", (env, seconds) => {
    expect(resolveIdleCompactSeconds({ env, configValue: "2m" })).toBe(seconds);
  });
});
