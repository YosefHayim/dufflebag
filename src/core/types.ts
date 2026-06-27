/**
 * Shared domain types for the skills-bag installer.
 *
 * These describe the three moving parts the CLI reconciles: the **feature
 * catalog** (what a user can install), the **Claude Code settings.json** shape
 * we surgically merge into, and the **tunable config** we expose as
 * `SKILLS_BAG_*` environment variables. Keeping them in one place means the
 * install/uninstall/config/doctor commands all agree on the same vocabulary.
 */

/** Where an install is rooted. `global` = ~/.claude (all sessions); `project` = ./.claude (one repo, committable). */
export type Scope = "global" | "project";

/** A Claude Code hook event we register against. */
export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "Stop";

/**
 * A single hook registration the installer owns inside settings.json.
 * `command` is rendered at install time to an absolute `node <installDir>/hooks/<file>`
 * so it is self-identifying for surgical uninstall (the path contains the bag marker).
 */
export interface ManagedHook {
  /** Event bucket in settings.json `hooks`. */
  event: HookEvent;
  /** Tool matcher (omit for events like UserPromptSubmit/SessionStart that take none). */
  matcher?: string;
  /** Compiled hook file under the bag's `hooks/` payload dir, e.g. "context-guard.js". */
  file: string;
}

/**
 * One installable unit. Features compose: `autonomous-loop` depends on
 * `context-guard` (they must share WARN_PCT), so installing the former pulls
 * the latter. `platform` gates features the daemon can't satisfy elsewhere.
 */
export interface Feature {
  id: FeatureId;
  /** Human label shown in the CLI. */
  title: string;
  /** One-line description for `doctor` / prompts. */
  summary: string;
  /** Other features that must be installed alongside this one. */
  requires: FeatureId[];
  /** Hook files (TS-compiled) this feature wires into settings.json. */
  hooks: ManagedHook[];
  /** Skill directories under the package `skills/` to copy into <claudeDir>/skills/. */
  skills: string[];
  /** Platform constraint; `doctor`/install warn (not hard-fail) when unmet. */
  platform: "any" | "macos" | "macos+ghostty";
}

export type FeatureId = "context-guard" | "autonomous-loop" | "speak-response" | "dedup-guard";

/**
 * dedup-guard enforcement level (`SKILLS_BAG_DEDUP_MODE`):
 * - `deny` — block the write (Claude/Cursor-compat) — the default.
 * - `warn` — allow the write but surface the collision to the agent.
 * - `off`  — inert (the hook allows everything through).
 */
export type DedupMode = "deny" | "warn" | "off";

/**
 * Tunable runtime config, surfaced to the hooks as `SKILLS_BAG_*` env vars in
 * settings.json. Values are strings on disk (settings.json env is string→string);
 * the hooks parse + clamp them. `undefined` here means "use the hook's built-in
 * default" — the installer only writes keys it is asked to.
 */
export interface BagConfig {
  warnPct: number;
  blockPct: number;
  defaultBudget: number;
  hardCap: number;
  pollSeconds: number;
  idleSeconds: number;
  ttsVoice: string;
  ttsRate: number;
  /** dedup-guard enforcement level; see {@link DedupMode}. */
  dedupMode: DedupMode;
  /** Extra directory names dedup-guard excludes from its index (comma/space list, e.g. `templates`). */
  dedupSkip: string;
}
