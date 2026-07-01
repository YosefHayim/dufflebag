/**
 * settings.json surgery — the single riskiest operation in the tool.
 *
 * We edit a file the user hand-maintains, so every mutation here is built to be
 * **surgical and idempotent**: bag-owned hooks are identified by the
 * `/dufflebag/` path marker in their command, and bag-owned config by the
 * `dufflebag` env prefix. That means uninstall removes exactly what we added
 * and re-installs never duplicate. All functions are pure (clone in, clone out)
 * so the merge logic can be exhaustively unit-tested without touching disk; the
 * thin IO wrappers at the bottom add read/parse/backup/write.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { HookEvent } from "../catalog/types.js";
import { ENV_PREFIX } from "../config.js";
import { backupPath, isBagCommand } from "./paths.js";

/** A `{ type: "command", command }` leaf inside a matcher group. */
export interface HookCommand {
  type: string;
  command: string;
  [key: string]: unknown;
}

/** One matcher group: an optional tool matcher plus the commands it triggers. */
export interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
  [key: string]: unknown;
}

/**
 * The slice of Claude Code settings.json we touch. Unknown keys are carried
 * through untouched via the index signature so we never drop user config.
 */
export interface ClaudeSettings {
  env?: Record<string, string>;
  hooks?: Partial<Record<HookEvent, HookGroup[]>>;
  [key: string]: unknown;
}

/** A resolved hook to write: which event, optional matcher, fully-rendered command string. */
export interface RenderedHook {
  event: HookEvent;
  matcher?: string;
  command: string;
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Strip every bag-owned hook from a settings object: drop marker commands, then
 * collapse any group/event left empty. Safe to call when nothing is installed.
 */
export function removeManagedHooks(input: ClaudeSettings): ClaudeSettings {
  const settings = clone(input);
  if (!settings.hooks) return settings;
  for (const event of Object.keys(settings.hooks) as HookEvent[]) {
    const groups = settings.hooks[event];
    if (!groups) continue;
    const kept = groups
      .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((h) => !isBagCommand(h.command ?? "")) }))
      .filter((group) => group.hooks.length > 0);
    if (kept.length > 0) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return settings;
}

/**
 * Idempotently install the given hooks: first remove any prior bag hooks, then
 * append each as its own matcher group alongside the user's existing groups.
 * One group per rendered hook keeps removal trivial and never mutates a user
 * group in place.
 */
export function mergeManagedHooks(input: ClaudeSettings, hooks: RenderedHook[]): ClaudeSettings {
  const settings = removeManagedHooks(input);
  if (hooks.length === 0) return settings;
  settings.hooks ??= {};
  for (const hook of hooks) {
    const group: HookGroup = {
      ...(hook.matcher ? { matcher: hook.matcher } : {}),
      hooks: [{ type: "command", command: hook.command }],
    };
    const existing = settings.hooks[hook.event];
    if (existing) existing.push(group);
    else settings.hooks[hook.event] = [group];
  }
  return settings;
}

/**
 * Merge `dufflebag*` config into `env`. By default existing keys are
 * preserved (the upgrade rule: fill new gaps, never clobber a user's tuning);
 * pass `overwrite: true` for the `config` command, which intentionally sets the
 * keys the user just specified.
 */
export function mergeEnv(
  input: ClaudeSettings,
  envMap: Record<string, string>,
  { overwrite = false }: { overwrite?: boolean } = {},
): ClaudeSettings {
  const settings = clone(input);
  settings.env ??= {};
  for (const [key, value] of Object.entries(envMap)) {
    if (overwrite || settings.env[key] == null) settings.env[key] = value;
  }
  return settings;
}

/** Remove every `dufflebag*` key from `env`, dropping `env` if it ends up empty. */
export function removeManagedEnv(input: ClaudeSettings): ClaudeSettings {
  const settings = clone(input);
  if (!settings.env) return settings;
  for (const key of Object.keys(settings.env)) {
    if (key.startsWith(ENV_PREFIX)) delete settings.env[key];
  }
  if (Object.keys(settings.env).length === 0) delete settings.env;
  return settings;
}

/** List the bag-owned hook commands currently present (for `doctor`). */
export function listManagedHooks(settings: ClaudeSettings): { event: HookEvent; command: string }[] {
  const out: { event: HookEvent; command: string }[] = [];
  for (const event of Object.keys(settings.hooks ?? {}) as HookEvent[]) {
    for (const group of settings.hooks?.[event] ?? []) {
      for (const h of group.hooks ?? []) {
        if (isBagCommand(h.command ?? "")) out.push({ event, command: h.command });
      }
    }
  }
  return out;
}

// --- IO layer ---------------------------------------------------------------

/** Read + parse a settings.json, returning an empty object if it is missing or unreadable. */
export function readSettings(file: string): ClaudeSettings {
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as ClaudeSettings) : {};
  } catch {
    throw new Error(`settings.json at ${file} is not valid JSON — fix or remove it, then retry.`);
  }
}

/** Copy settings.json to a timestamped `.bak.<stamp>` next to it; no-op if the file doesn't exist yet. */
export function backupSettings(file: string, stamp: string): string | null {
  if (!existsSync(file)) return null;
  const dest = backupPath(file, stamp);
  copyFileSync(file, dest);
  return dest;
}

/** Write settings.json with a trailing newline and 2-space indent (matches Claude Code's own formatting). */
export function writeSettings(file: string, settings: ClaudeSettings): void {
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}
