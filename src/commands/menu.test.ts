/**
 * The interactive menu. Its deep branches are prompt-driven and exercised by
 * hand; here we lock the two things that must not silently break: the config
 * editor covers every tunable, and a non-TTY invocation exits at once rather
 * than hanging (the same fail-safe every ui wrapper relies on).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromEnvMap } from "../core/index.js";
import { CONFIG_FIELDS, menu } from "./index.js";

describe("CONFIG_FIELDS covers BagConfig", () => {
  it("has exactly one editor row per tunable (drift guard: a new config key must be added here)", () => {
    // fromEnvMap({}) yields a complete BagConfig, so its keys are the full set the editor must expose.
    expect(CONFIG_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(fromEnvMap({})).sort());
  });
});

describe("menu without a TTY", () => {
  const originalIsTTY = process.stdin.isTTY;
  beforeEach(() => Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true }));
  afterEach(() => Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true }));

  it("exits immediately (the main select falls back to Exit) without throwing", async () => {
    await expect(menu()).resolves.toBeUndefined();
  });
});
