/**
 * Tests for the settings.json surgery — the riskiest code in the tool. These
 * cover the invariants that protect a user's hand-maintained config: merges are
 * idempotent, removal is surgical (never touches non-bag entries), and env is
 * preserved on install but overwritten on explicit config.
 */

import { describe, expect, it } from "vitest";

import {
  type ClaudeSettings,
  listManagedHooks,
  mergeEnv,
  mergeManagedHooks,
  type RenderedHook,
  removeManagedEnv,
  removeManagedHooks,
} from "./settings.js";

const bagHook = (event: RenderedHook["event"], file: string, matcher?: string): RenderedHook => ({
  event,
  matcher,
  command: `node "/home/u/.claude/dufflebag/hooks/${file}"`,
});

/** A settings.json holding a user's own hook + env that the tool must never disturb. */
const userSettings = (): ClaudeSettings => ({
  env: { MY_VAR: "keep" },
  hooks: {
    PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "python3 /home/u/my-own-hook.py" }] }],
  },
  statusLine: { type: "command", command: "my-statusline" },
});

describe("mergeManagedHooks", () => {
  it("adds bag hooks alongside the user's existing hooks", () => {
    const next = mergeManagedHooks(userSettings(), [bagHook("PreToolUse", "contextGuard.js", "Write|Edit")]);
    expect(next.hooks?.PreToolUse).toHaveLength(2);
    expect(next.statusLine).toEqual({ type: "command", command: "my-statusline" });
  });

  it("is idempotent — re-merging does not duplicate bag hooks", () => {
    const hooks = [bagHook("PreToolUse", "contextGuard.js"), bagHook("Stop", "speakResponse.js")];
    const once = mergeManagedHooks(userSettings(), hooks);
    const twice = mergeManagedHooks(once, hooks);
    expect(twice).toEqual(once);
    expect(listManagedHooks(twice)).toHaveLength(2);
  });
});

describe("removeManagedHooks", () => {
  it("removes only bag hooks, leaving user hooks and dropping emptied events", () => {
    const merged = mergeManagedHooks(userSettings(), [bagHook("Stop", "speakResponse.js")]);
    const cleaned = removeManagedHooks(merged);
    expect(cleaned.hooks?.Stop).toBeUndefined();
    expect(cleaned.hooks?.PreToolUse).toHaveLength(1);
    expect(cleaned.hooks?.PreToolUse?.[0]?.hooks[0]?.command).toContain("my-own-hook.py");
  });

  it("returns settings without a hooks key when nothing remains", () => {
    const onlyBag: ClaudeSettings = {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "node /x/dufflebag/hooks/speakResponse.js" }] }] },
    };
    expect(removeManagedHooks(onlyBag).hooks).toBeUndefined();
  });
});

describe("env merge", () => {
  it("preserves existing values by default (the update rule)", () => {
    const start = mergeEnv(userSettings(), { dufflebagContextWarnFraction: "0.18" });
    const next = mergeEnv(start, { dufflebagContextWarnFraction: "0.18", dufflebagAutorunMaxCycleCount: "50" });
    const tuned = mergeEnv(next, { dufflebagContextWarnFraction: "0.99" });
    expect(tuned.env?.dufflebagContextWarnFraction).toBe("0.18");
    expect(tuned.env?.dufflebagAutorunMaxCycleCount).toBe("50");
    expect(tuned.env?.MY_VAR).toBe("keep");
  });

  it("overwrites when explicitly told to (the config command)", () => {
    const start = mergeEnv(userSettings(), { dufflebagContextWarnFraction: "0.18" });
    const next = mergeEnv(start, { dufflebagContextWarnFraction: "0.15" }, { overwrite: true });
    expect(next.env?.dufflebagContextWarnFraction).toBe("0.15");
  });

  it("removeManagedEnv strips every dufflebag* key, keeping user env", () => {
    const withBag = mergeEnv(userSettings(), {
      dufflebagContextWarnFraction: "0.18",
      dufflebagAutorunMaxCycleCount: "50",
    });
    const cleaned = removeManagedEnv(withBag);
    expect(cleaned.env).toEqual({ MY_VAR: "keep" });
  });
});
