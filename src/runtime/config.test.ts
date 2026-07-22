/**
 * Spawn-env contract for the detached ctx-watch daemon: effective dufflebag*
 * keys must be fully materialised into the child env, and doctor must be able
 * to rehydrate the snapshot written at spawn.
 */

import { describe, expect, it } from "vitest";

import {
  configFromSnapshot,
  configToEnvMap,
  DEFAULTS,
  daemonConfigDiff,
  daemonSpawnEnv,
  ENV_KEYS,
  planDaemonSpawn,
  readConfig,
  resolveAutoCompactSeconds,
} from "./config.js";

describe("daemon spawn env", () => {
  it("configToEnvMap emits every dufflebag key for a full BagConfig", () => {
    const env = configToEnvMap(DEFAULTS);
    expect(env[ENV_KEYS.contextWarnFraction]).toBe("0.18");
    expect(env[ENV_KEYS.autorunMaxCycleCount]).toBe("50");
    expect(env[ENV_KEYS.debugEnabled]).toBe("false");
    expect(env[ENV_KEYS.idleAutoCompact]).toBe("off");
    expect(Object.keys(env).sort()).toEqual(Object.values(ENV_KEYS).sort());
  });

  it("uses a provider override before persistent idle auto-compact", () => {
    expect(resolveAutoCompactSeconds("codex", { DUFFLEBAG_CODEX_AUTO_COMPACT: "45s" }, "2m")).toBe(45);
    expect(resolveAutoCompactSeconds("codex", { DUFFLEBAG_CODEX_AUTO_COMPACT: "off" }, "2m")).toBeNull();
    expect(resolveAutoCompactSeconds("codex", {}, "2m")).toBe(120);
  });

  it("fails closed for an invalid provider override", () => {
    expect(resolveAutoCompactSeconds("claude-code", { DUFFLEBAG_CLAUDE_CODE_AUTO_COMPACT: "soon" }, "2m")).toBeNull();
  });

  it("configToEnvMap round-trips through readConfig", () => {
    const original = readConfig({
      [ENV_KEYS.contextWarnFraction]: "0.12",
      [ENV_KEYS.autorunDefaultCycleCount]: "7",
      [ENV_KEYS.speechVoice]: "Ava",
      [ENV_KEYS.debugEnabled]: "true",
    });
    expect(readConfig(configToEnvMap(original))).toEqual(original);
  });

  it("daemonSpawnEnv freezes effective config over the parent env and keeps unrelated keys", () => {
    const parent = {
      PATH: "/usr/bin",
      [ENV_KEYS.contextWarnFraction]: "0.15",
      [ENV_KEYS.autorunDefaultCycleCount]: "3",
    };
    const env = daemonSpawnEnv(parent);
    expect(env.PATH).toBe("/usr/bin");
    expect(env[ENV_KEYS.contextWarnFraction]).toBe("0.15");
    expect(env[ENV_KEYS.autorunDefaultCycleCount]).toBe("3");
    // Defaults fill keys the parent never set so the daemon never sees a partial map.
    expect(env[ENV_KEYS.contextBlockFraction]).toBe(String(DEFAULTS.contextBlockFraction));
    expect(env[ENV_KEYS.autorunMaxCycleCount]).toBe(String(DEFAULTS.autorunMaxCycleCount));
  });

  it("planDaemonSpawn attaches the effective env and a BagConfig snapshot", () => {
    const plan = planDaemonSpawn({
      sessionId: "sess-1",
      daemonPath: "/tmp/ctxWatch.js",
      env: { [ENV_KEYS.contextWarnFraction]: "0.11", HOME: "/home/me" },
    });
    expect(plan.command).toBe("node");
    expect(plan.args).toEqual(["/tmp/ctxWatch.js", "sess-1"]);
    expect(plan.options.detached).toBe(true);
    expect(plan.options.stdio).toBe("ignore");
    expect(plan.options.env[ENV_KEYS.contextWarnFraction]).toBe("0.11");
    expect(plan.options.env.HOME).toBe("/home/me");
    expect(plan.configSnapshot.contextWarnFraction).toBe(0.11);
    expect(plan.configSnapshot.autorunMaxCycleCount).toBe(DEFAULTS.autorunMaxCycleCount);
  });

  it("configFromSnapshot accepts BagConfig JSON written at spawn", () => {
    const plan = planDaemonSpawn({
      sessionId: "s",
      daemonPath: "/tmp/d.js",
      env: { [ENV_KEYS.contextWarnFraction]: "0.14" },
    });
    expect(configFromSnapshot(plan.configSnapshot).contextWarnFraction).toBe(0.14);
    expect(configFromSnapshot(configToEnvMap(plan.configSnapshot)).contextWarnFraction).toBe(0.14);
  });

  it("daemonConfigDiff lists only autorun-relevant mismatches", () => {
    const settings = readConfig({
      [ENV_KEYS.contextWarnFraction]: "0.15",
      [ENV_KEYS.autorunDefaultCycleCount]: "5",
    });
    const daemon = readConfig({
      [ENV_KEYS.contextWarnFraction]: "0.18",
      [ENV_KEYS.autorunDefaultCycleCount]: "5",
    });
    expect(daemonConfigDiff(settings, daemon)).toEqual([{ key: "contextWarnFraction", expected: 0.15, daemon: 0.18 }]);
    expect(daemonConfigDiff(settings, settings)).toEqual([]);
  });
});
