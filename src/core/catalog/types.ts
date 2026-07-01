/**
 * Shared domain types for the dufflebag installer.
 *
 * These describe the three moving parts the CLI reconciles: the **feature
 * catalog** (what a user can install), the **Claude Code settings.json** shape
 * we surgically merge into, and the **tunable config** we expose as
 * `dufflebag*` environment variables. Keeping them in one place means the
 * install/uninstall/config/doctor commands all agree on the same vocabulary.
 */

/** Where an install is rooted. `global` = ~/.claude (all sessions); `project` = ./.claude (one repo, committable). */
export type Scope = "global" | "project";

/** A Claude Code hook event we register against. */
export type HookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "SessionStart" | "Stop";

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
  /** Compiled hook file under the bag's `hooks/` payload dir, e.g. "contextGuard.js". */
  file: string;
}

/**
 * One installable unit. Features compose: `autonomous-loop` depends on
 * `context-guard` (they must share context thresholds), so installing the former pulls
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
  /** Skill directories under the package `src/skills/` to copy into <claudeDir>/skills/. */
  skills: string[];
  /**
   * Ship allowlist: paths (relative to each of this feature's `skills` dirs) the
   * installer copies into <claudeDir>/skills/. The installer copies **only** these,
   * so a build-only source (a hook `.ts`, a lib) can never leak into a user's
   * install — an unlisted path ships *nothing*, not everything (fail-safe, ADR 0008).
   */
  ships: string[];
  /** Platform constraint; `doctor`/install warn (not hard-fail) when unmet. */
  platform: "any" | "macos" | "macos+ghostty";
}

export type FeatureId = "context-guard" | "autonomous-loop" | "speak-response" | "dedup-guard" | "png-to-code";

/**
 * dedup-guard enforcement level (`dufflebagDedupEnforcement`):
 * - `deny` — block the write (Claude/Cursor-compat) — the default.
 * - `warn` — allow the write but surface the collision to the agent.
 * - `off`  — inert (the hook allows everything through).
 */
export type DedupMode = "deny" | "warn" | "off";

/**
 * Tunable runtime config, surfaced to the hooks as `dufflebag*` env vars in
 * settings.json. Values are strings on disk (settings.json env is string→string);
 * the hooks parse + clamp them. `undefined` here means "use the hook's built-in
 * default" — the installer only writes keys it is asked to.
 */
export interface BagConfig {
  /** Context fill ratio at which to nudge `/handoff`. */
  contextWarnFraction: number;
  /** Context fill ratio at which to hard-deny code edits. */
  contextBlockFraction: number;
  /** Default `/autorun` cycle count. */
  autorunDefaultCycleCount: number;
  /** Absolute anti-runaway autorun cycle cap. */
  autorunMaxCycleCount: number;
  /** Daemon poll interval in seconds. */
  autorunPollIntervalSeconds: number;
  /** Idle seconds before the daemon counts a turn as done. */
  autorunIdleThresholdSeconds: number;
  /** macOS `say` voice name. */
  speechVoice: string;
  /** TTS rate in words per minute. */
  speechWordsPerMinute: number;
  /** dedup-guard enforcement level; see {@link DedupMode}. */
  dedupEnforcement: DedupMode;
  /** Extra directory names dedup-guard excludes from its index (comma/space list). */
  dedupSkipDirectories: string;
  /** Verbose hook stderr logging. */
  debugEnabled: boolean;
}
