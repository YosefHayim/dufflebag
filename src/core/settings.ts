/**
 * settings.json surgery — the single riskiest operation in the tool.
 *
 * We edit a file the user hand-maintains, so every mutation here is built to be
 * **surgical and idempotent**: bag-owned hooks are identified by the
 * `/skills-bag/` path marker in their command, and bag-owned config by the
 * `SKILLS_BAG_` env prefix. That means uninstall removes exactly what we added
 * and re-installs never duplicate. All functions are pure (clone in, clone out)
 * so the merge logic can be exhaustively unit-tested without touching disk; the
 * thin IO wrappers at the bottom add read/parse/backup/write.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";

import { ENV_PREFIX } from "./env-config.js";
import { PATH_MARKER, backupPath } from "./paths.js";
import type { HookEvent } from "./types.js";

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

const isBagCommand = (command: string): boolean => command.includes(PATH_MARKER);

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
    (settings.hooks[hook.event] ??= []).push(group);
  }
  return settings;
}

/**
 * Merge `SKILLS_BAG_*` config into `env`. By default existing keys are
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

/** Remove every `SKILLS_BAG_*` key from `env`, dropping `env` if it ends up empty. */
export function removeManagedEnv(input: ClaudeSettings): ClaudeSettings {
  const settings = clone(input);
  if (!settings.env) return settings;
  for (const key of Object.keys(settings.env)) {
    if (key.startsWith(ENV_PREFIX)) delete settings.env[key];
  }
  if (Object.keys(settings.env).length === 0) delete settings.env;
  return settings;
}

/** Basenames of the original hand-rolled (pre-skills-bag) scripts a manual install would reference. */
const LEGACY_SCRIPTS = ["context-guard.py", "ctx-watch.py", "ctx-watch-spawn.sh", "ctx-loop-ctl.py", "speak-response.sh"];

/** A pre-existing manual hook the migration step offers to remove. */
export interface LegacyHook {
  event: HookEvent;
  command: string;
  script: string;
}

/**
 * Find hook commands that point at the original manual scripts but are NOT
 * under the bag's managed dir. These would double-fire alongside the bag's own
 * hooks, so install offers to remove them.
 */
export function detectLegacyHooks(settings: ClaudeSettings): LegacyHook[] {
  const found: LegacyHook[] = [];
  if (!settings.hooks) return found;
  for (const event of Object.keys(settings.hooks) as HookEvent[]) {
    for (const group of settings.hooks[event] ?? []) {
      for (const h of group.hooks ?? []) {
        const command = h.command ?? "";
        if (isBagCommand(command)) continue;
        const script = LEGACY_SCRIPTS.find((name) => command.includes(name));
        if (script) found.push({ event, command, script });
      }
    }
  }
  return found;
}

/** Remove the exact legacy hook commands found by {@link detectLegacyHooks}. */
export function removeLegacyHooks(input: ClaudeSettings): ClaudeSettings {
  const settings = clone(input);
  if (!settings.hooks) return settings;
  const isLegacy = (command: string): boolean =>
    !isBagCommand(command) && LEGACY_SCRIPTS.some((name) => command.includes(name));
  for (const event of Object.keys(settings.hooks) as HookEvent[]) {
    const groups = settings.hooks[event];
    if (!groups) continue;
    const kept = groups
      .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((h) => !isLegacy(h.command ?? "")) }))
      .filter((group) => group.hooks.length > 0);
    if (kept.length > 0) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
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
