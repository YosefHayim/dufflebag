/**
 * Tests for the multi-agent wiring mutators (the pure half). Both must be
 * surgical + idempotent like the settings.json surgery: the AGENTS.md managed
 * block round-trips cleanly and re-applying it never duplicates, and the Cursor
 * hooks merge adds exactly one bag entry while leaving the user's own hooks
 * untouched.
 */

import { describe, expect, it } from "vitest";

import { DEDUP_AGENTS_RULE, mergeCursorHook, removeCursorBagHooks, stripManagedBlock, upsertManagedBlock } from "./agentWiring.js";

const BAG_CMD = 'node "/home/.claude/dufflebag/hooks/dedupCursor.js"';

describe("AGENTS.md managed block", () => {
  it("appends the block after existing content, preserving it", () => {
    const out = upsertManagedBlock("# My Repo\n\nHello.\n", DEDUP_AGENTS_RULE);
    expect(out).toContain("# My Repo");
    expect(out).toContain("dufflebag:dedup-guard start");
    expect(out).toContain(DEDUP_AGENTS_RULE);
  });

  it("is idempotent — applying twice equals applying once", () => {
    const once = upsertManagedBlock("# Repo\n", DEDUP_AGENTS_RULE);
    const twice = upsertManagedBlock(once, DEDUP_AGENTS_RULE);
    expect(twice).toBe(once);
    expect(twice.match(/dufflebag:dedup-guard start/g)).toHaveLength(1);
  });

  it("replaces the body in place when the block already exists", () => {
    const first = upsertManagedBlock("# Repo\n", "OLD BODY");
    const second = upsertManagedBlock(first, "NEW BODY");
    expect(second).toContain("NEW BODY");
    expect(second).not.toContain("OLD BODY");
    expect(second.match(/dufflebag:dedup-guard start/g)).toHaveLength(1);
  });

  it("strips the block back out, keeping the user's content", () => {
    const withBlock = upsertManagedBlock("# Repo\n\nKeep me.\n", DEDUP_AGENTS_RULE);
    const stripped = stripManagedBlock(withBlock);
    expect(stripped).toContain("# Repo");
    expect(stripped).toContain("Keep me.");
    expect(stripped).not.toContain("dufflebag:dedup-guard");
  });

  it("leaves text without the block untouched", () => {
    const text = "# Repo\n\nNothing here.\n";
    expect(stripManagedBlock(text)).toBe(text);
  });
});

describe("Cursor hooks.json merge", () => {
  it("registers the dedup afterFileEdit command from an empty file", () => {
    const out = mergeCursorHook({}, BAG_CMD);
    expect(out.version).toBe(1);
    expect(out.hooks?.afterFileEdit).toHaveLength(1);
    expect(out.hooks?.afterFileEdit?.[0].command).toBe(BAG_CMD);
  });

  it("preserves a user's own hooks alongside the bag entry", () => {
    const input = { version: 1, hooks: { afterFileEdit: [{ command: "node user-formatter.js" }] } };
    const out = mergeCursorHook(input, BAG_CMD);
    const commands = out.hooks?.afterFileEdit?.map((h) => h.command);
    expect(commands).toContain("node user-formatter.js");
    expect(commands).toContain(BAG_CMD);
  });

  it("is idempotent — re-merging keeps exactly one bag entry", () => {
    const once = mergeCursorHook({}, BAG_CMD);
    const twice = mergeCursorHook(once, BAG_CMD);
    expect(twice.hooks?.afterFileEdit?.filter((h) => h.command === BAG_CMD)).toHaveLength(1);
  });

  it("removeCursorBagHooks strips only bag entries", () => {
    const merged = mergeCursorHook({ version: 1, hooks: { afterFileEdit: [{ command: "node user.js" }] } }, BAG_CMD);
    const cleaned = removeCursorBagHooks(merged);
    expect(cleaned.hooks?.afterFileEdit).toHaveLength(1);
    expect(cleaned.hooks?.afterFileEdit?.[0].command).toBe("node user.js");
  });
});
