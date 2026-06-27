/**
 * Tests for the settings.json surgery — the riskiest code in the tool. These
 * cover the invariants that protect a user's hand-maintained config: merges are
 * idempotent, removal is surgical (never touches non-bag entries), env is
 * preserved on install but overwritten on explicit config, and legacy manual
 * hooks are detected/removed precisely.
 */

import { describe, expect, it } from "vitest";

import {
  detectLegacyHooks,
  listManagedHooks,
  mergeEnv,
  mergeManagedHooks,
  removeLegacyHooks,
  removeManagedEnv,
  removeManagedHooks,
  type ClaudeSettings,
  type RenderedHook,
} from "../src/core/settings.js";

const bagHook = (event: RenderedHook["event"], file: string, matcher?: string): RenderedHook => ({
  event,
  matcher,
  command: `node "/home/u/.claude/skills-bag/hooks/${file}"`,
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
    const next = mergeManagedHooks(userSettings(), [bagHook("PreToolUse", "context-guard.js", "Write|Edit")]);
    expect(next.hooks?.PreToolUse).toHaveLength(2); // user's + bag's
    expect(next.statusLine).toEqual({ type: "command", command: "my-statusline" }); // untouched
  });

  it("is idempotent — re-merging does not duplicate bag hooks", () => {
    const hooks = [bagHook("PreToolUse", "context-guard.js"), bagHook("Stop", "speak-response.js")];
    const once = mergeManagedHooks(userSettings(), hooks);
    const twice = mergeManagedHooks(once, hooks);
    expect(twice).toEqual(once);
    expect(listManagedHooks(twice)).toHaveLength(2);
  });
});

describe("removeManagedHooks", () => {
  it("removes only bag hooks, leaving user hooks and dropping emptied events", () => {
    const merged = mergeManagedHooks(userSettings(), [bagHook("Stop", "speak-response.js")]);
    const cleaned = removeManagedHooks(merged);
    expect(cleaned.hooks?.Stop).toBeUndefined(); // bag-only event dropped entirely
    expect(cleaned.hooks?.PreToolUse).toHaveLength(1); // user's hook survives
    expect(cleaned.hooks?.PreToolUse?.[0]?.hooks[0]?.command).toContain("my-own-hook.py");
  });

  it("returns settings without a hooks key when nothing remains", () => {
    const onlyBag: ClaudeSettings = {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "node /x/skills-bag/hooks/speak-response.js" }] }] },
    };
    expect(removeManagedHooks(onlyBag).hooks).toBeUndefined();
  });
});

describe("env merge", () => {
  it("preserves existing values by default (the update rule)", () => {
    const start = mergeEnv(userSettings(), { SKILLS_BAG_WARN_PCT: "0.18" });
    const next = mergeEnv(start, { SKILLS_BAG_WARN_PCT: "0.18", SKILLS_BAG_HARD_CAP: "50" });
    // simulate a user-tuned value, then a re-install that must not clobber it
    const tuned = mergeEnv(next, { SKILLS_BAG_WARN_PCT: "0.99" });
    expect(tuned.env?.SKILLS_BAG_WARN_PCT).toBe("0.18");
    expect(tuned.env?.SKILLS_BAG_HARD_CAP).toBe("50");
    expect(tuned.env?.MY_VAR).toBe("keep");
  });

  it("overwrites when explicitly told to (the config command)", () => {
    const start = mergeEnv(userSettings(), { SKILLS_BAG_WARN_PCT: "0.18" });
    const next = mergeEnv(start, { SKILLS_BAG_WARN_PCT: "0.15" }, { overwrite: true });
    expect(next.env?.SKILLS_BAG_WARN_PCT).toBe("0.15");
  });

  it("removeManagedEnv strips only SKILLS_BAG_* keys", () => {
    const withBag = mergeEnv(userSettings(), { SKILLS_BAG_WARN_PCT: "0.18" });
    const cleaned = removeManagedEnv(withBag);
    expect(cleaned.env).toEqual({ MY_VAR: "keep" });
  });
});

describe("legacy detection", () => {
  it("finds manual hooks not under the bag dir and removes them surgically", () => {
    const settings: ClaudeSettings = {
      hooks: {
        PreToolUse: [
          { matcher: "Write", hooks: [{ type: "command", command: "python3 /home/u/.claude/hooks/context-guard.py" }] },
          { matcher: "Write", hooks: [{ type: "command", command: "node /home/u/.claude/skills-bag/hooks/context-guard.js" }] },
        ],
      },
    };
    const legacy = detectLegacyHooks(settings);
    expect(legacy).toHaveLength(1);
    expect(legacy[0]?.script).toBe("context-guard.py");

    const cleaned = removeLegacyHooks(settings);
    const remaining = cleaned.hooks?.PreToolUse ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.hooks[0]?.command).toContain("skills-bag"); // the bag hook stays
  });
});
