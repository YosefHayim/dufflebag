/**
 * Shared config contract between the CLI (which writes `dufflebag*` keys into
 * settings.json) and the hooks (which read them from the environment).
 *
 * This module is the single source of truth for the key names and defaults, and
 * it is deliberately dependency-free and self-contained so it can be copied into
 * the install dir as part of the hook payload and run on bare Node. The CLI's
 * `core/config` imports these constants rather than re-declaring them, which
 * is what guarantees the written keys and the read keys can never drift.
 */

import type { BagConfig, DedupMode } from "../core/catalog/types.js";

/** Prefix marking every key this tool owns in settings.json `env`. */
export const ENV_PREFIX = "dufflebag";

/** Canonical env var name for each config field. */
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
} as const satisfies Record<keyof BagConfig, string>;

/** Valid dedup-guard enforcement levels; anything else coerces to the `deny` default. */
export const DEDUP_MODES: readonly DedupMode[] = ["deny", "warn", "off"];

/** Type guard: is `value` a valid {@link DedupMode}? (cast-free narrowing via `.some`). */
export function isDedupMode(value: string): value is DedupMode {
  return DEDUP_MODES.some((mode) => mode === value);
}

/** Narrow an arbitrary env string to a {@link DedupMode}, defaulting to `deny`. */
export function parseDedupMode(raw: string | undefined): DedupMode {
  const value = (raw ?? "").trim().toLowerCase();
  return isDedupMode(value) ? value : "deny";
}

/**
 * Built-in defaults, carried over verbatim from the original Python hooks so
 * behavior is identical out of the box (warn at 18% of the model window, hard
 * block at 20%, 10-cycle autorun budget, 50-cycle anti-runaway cap).
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

/** Coerce a string env value to a finite number, or null if unparseable/empty. */
export function parseNumber(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  return fallback;
}

/** Read the effective config from an environment map, falling back to defaults per key. */
export function readConfig(env: Record<string, string | undefined> = process.env): BagConfig {
  const num = (name: string, fallback: number): number => parseNumber(env[name]) ?? fallback;
  return {
    contextWarnFraction: num(ENV_KEYS.contextWarnFraction, DEFAULTS.contextWarnFraction),
    contextBlockFraction: num(ENV_KEYS.contextBlockFraction, DEFAULTS.contextBlockFraction),
    autorunDefaultCycleCount: num(ENV_KEYS.autorunDefaultCycleCount, DEFAULTS.autorunDefaultCycleCount),
    autorunMaxCycleCount: num(ENV_KEYS.autorunMaxCycleCount, DEFAULTS.autorunMaxCycleCount),
    autorunPollIntervalSeconds: num(ENV_KEYS.autorunPollIntervalSeconds, DEFAULTS.autorunPollIntervalSeconds),
    autorunIdleThresholdSeconds: num(ENV_KEYS.autorunIdleThresholdSeconds, DEFAULTS.autorunIdleThresholdSeconds),
    speechVoice: env[ENV_KEYS.speechVoice] ?? DEFAULTS.speechVoice,
    speechWordsPerMinute: num(ENV_KEYS.speechWordsPerMinute, DEFAULTS.speechWordsPerMinute),
    dedupEnforcement: parseDedupMode(env[ENV_KEYS.dedupEnforcement]),
    dedupSkipDirectories: env[ENV_KEYS.dedupSkipDirectories] ?? DEFAULTS.dedupSkipDirectories,
    debugEnabled: parseBoolean(env[ENV_KEYS.debugEnabled], DEFAULTS.debugEnabled),
  };
}
