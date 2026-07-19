/**
 * Dependency-free bag config reader for installed hooks.
 *
 * This module is the hook-island transport: bare Node, no Effect, no app imports.
 * Application config SSOT is `src/config/bagConfigSchema.ts`. Keep env key names
 * aligned with that schema's legacy environment map so read/write never drift.
 */

export type DedupMode = "deny" | "warn" | "off";

export type BagConfig = {
  readonly contextWarnFraction: number;
  readonly contextBlockFraction: number;
  readonly autorunDefaultCycleCount: number;
  readonly autorunMaxCycleCount: number;
  readonly autorunPollIntervalSeconds: number;
  readonly autorunIdleThresholdSeconds: number;
  readonly speechVoice: string;
  readonly speechWordsPerMinute: number;
  readonly dedupEnforcement: DedupMode;
  readonly dedupSkipDirectories: string;
  readonly debugEnabled: boolean;
};

/** Prefix marking every key this tool owns in settings.json `env`. */
export const ENV_PREFIX = "dufflebag";

/** Canonical env var name for each config field (must match application legacy keys). */
export const ENV_KEYS = {
  contextWarnFraction: "dufflebagContextWarnFraction",
  contextBlockFraction: "dufflebagContextBlockFraction",
  autorunDefaultCycleCount: "dufflebagAutorunDefaultCycleCount",
  autorunMaxCycleCount: "dufflebagAutorunMaxCycleCount",
  autorunPollIntervalSeconds: "dufflebagAutorunPollIntervalSeconds",
  autorunIdleThresholdSeconds: "dufflebagAutorunIdleThresholdSeconds",
  speechVoice: "dufflebagSpeechVoice",
  speechWordsPerMinute: "dufflebagSpeechWordsPerMinute",
  dedupEnforcement: "dufflebagDedupEnforcement",
  dedupSkipDirectories: "dufflebagDedupSkipDirectories",
  debugEnabled: "dufflebagDebugEnabled",
} satisfies Record<keyof BagConfig, string>;

/** Modes listed by interactive pickers; defaults to deny when env is missing or unknown. */
export const DEDUP_MODES: ReadonlyArray<DedupMode> = ["deny", "warn", "off"];

/**
 * Built-in defaults (warn at 18% of the model window, hard block at 20%,
 * 10-cycle autorun budget, 50-cycle anti-runaway cap).
 */
export const DEFAULTS: BagConfig = {
  contextWarnFraction: 0.18,
  contextBlockFraction: 0.2,
  autorunDefaultCycleCount: 10,
  autorunMaxCycleCount: 50,
  autorunPollIntervalSeconds: 5,
  autorunIdleThresholdSeconds: 8,
  speechVoice: "Samantha",
  speechWordsPerMinute: 230,
  dedupEnforcement: "deny",
  dedupSkipDirectories: "",
  debugEnabled: false,
};

const numberFromEnv = (raw: string | undefined, fallback: number): number => {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const booleanFromEnv = (raw: string | undefined, fallback: boolean): boolean => {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
      return true;
    case "0":
    case "false":
    case "no":
      return false;
    default:
      return fallback;
  }
};

const dedupModeFromEnv = (raw: string | undefined): DedupMode => {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "warn":
      return "warn";
    case "off":
      return "off";
    default:
      return "deny";
  }
};

/** Read effective config from an environment map; unknown or empty values fall back to defaults. */
export const readConfig = (env: NodeJS.Dict<string> = process.env): BagConfig => ({
  contextWarnFraction: numberFromEnv(env[ENV_KEYS.contextWarnFraction], DEFAULTS.contextWarnFraction),
  contextBlockFraction: numberFromEnv(env[ENV_KEYS.contextBlockFraction], DEFAULTS.contextBlockFraction),
  autorunDefaultCycleCount: numberFromEnv(env[ENV_KEYS.autorunDefaultCycleCount], DEFAULTS.autorunDefaultCycleCount),
  autorunMaxCycleCount: numberFromEnv(env[ENV_KEYS.autorunMaxCycleCount], DEFAULTS.autorunMaxCycleCount),
  autorunPollIntervalSeconds: numberFromEnv(env[ENV_KEYS.autorunPollIntervalSeconds], DEFAULTS.autorunPollIntervalSeconds),
  autorunIdleThresholdSeconds: numberFromEnv(env[ENV_KEYS.autorunIdleThresholdSeconds], DEFAULTS.autorunIdleThresholdSeconds),
  speechVoice: env[ENV_KEYS.speechVoice] ?? DEFAULTS.speechVoice,
  speechWordsPerMinute: numberFromEnv(env[ENV_KEYS.speechWordsPerMinute], DEFAULTS.speechWordsPerMinute),
  dedupEnforcement: dedupModeFromEnv(env[ENV_KEYS.dedupEnforcement]),
  dedupSkipDirectories: env[ENV_KEYS.dedupSkipDirectories] ?? DEFAULTS.dedupSkipDirectories,
  debugEnabled: booleanFromEnv(env[ENV_KEYS.debugEnabled], DEFAULTS.debugEnabled),
});
