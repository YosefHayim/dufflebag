/**
 * CLI-side config helpers layered on the shared contract in
 * `hooks/lib/config.ts`.
 *
 * The key names, defaults, and the env reader live in the hook payload module
 * (so they ship self-contained and the read/write sides can't drift); this file
 * adds the things only the CLI needs — validation/clamping of user input and
 * rendering a config patch back to the `skillsBag*` string map.
 */

import { DEDUP_MODES, DEFAULTS, ENV_KEYS, ENV_PREFIX, LEGACY_ENV_PREFIX, isDedupMode, parseNumber, readConfig } from "../hooks/lib/config.js";
import type { BagConfig } from "./types.js";

export { DEDUP_MODES, DEFAULTS, ENV_KEYS, ENV_PREFIX, LEGACY_ENV_PREFIX, isDedupMode, parseNumber };

/** Read the effective config out of a settings.json `env` map, falling back to defaults. */
export const fromEnvMap = (env: Record<string, string> | undefined): BagConfig => readConfig(env ?? {});

/** Inclusive bounds enforced on user input so a typo can't disable the guardrail. */
const BOUNDS = {
  contextWarnFraction: [0.01, 0.95],
  contextBlockFraction: [0.01, 0.99],
  autorunDefaultCycleCount: [1, 1000],
  autorunMaxCycleCount: [1, 1000],
  autorunPollIntervalSeconds: [1, 600],
  autorunIdleThresholdSeconds: [1, 600],
  speechWordsPerMinute: [80, 720],
} as const;

const clamp = (value: number, [min, max]: readonly [number, number]): number => Math.min(max, Math.max(min, value));

/**
 * Validate and clamp a partial config from the user (e.g. CLI flags). Throws on
 * a value that parses but is nonsensical (NaN, or warn >= block) so the CLI can
 * surface a precise error; out-of-range numbers are clamped into the safe band.
 */
export function validateConfig(patch: Partial<BagConfig>): Partial<BagConfig> {
  const out: Partial<BagConfig> = {};
  for (const [key, value] of Object.entries(patch) as [keyof BagConfig, BagConfig[keyof BagConfig]][]) {
    if (value == null) continue;
    if (key === "speechVoice") {
      out.speechVoice = String(value);
      continue;
    }
    if (key === "dedupEnforcement") {
      const mode = String(value).trim().toLowerCase();
      if (!isDedupMode(mode)) {
        throw new Error(`Invalid dedup mode: ${String(value)} (expected one of ${DEDUP_MODES.join(", ")})`);
      }
      out.dedupEnforcement = mode;
      continue;
    }
    if (key === "dedupSkipDirectories") {
      out.dedupSkipDirectories = String(value);
      continue;
    }
    if (key === "debugEnabled") {
      out.debugEnabled = Boolean(value);
      continue;
    }
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) throw new Error(`Invalid value for ${key}: ${String(value)} (expected a number)`);
    const bound = BOUNDS[key as keyof typeof BOUNDS];
    (out[key] as number) = bound ? clamp(num, bound) : num;
  }
  if (
    out.contextWarnFraction != null &&
    out.contextBlockFraction != null &&
    out.contextWarnFraction >= out.contextBlockFraction
  ) {
    throw new Error(
      `contextWarnFraction (${out.contextWarnFraction}) must be below contextBlockFraction (${out.contextBlockFraction})`,
    );
  }
  return out;
}

/** Render a config patch to the `skillsBag*` string→string map written into settings.json `env`. */
export function toEnvMap(patch: Partial<BagConfig>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, name] of Object.entries(ENV_KEYS) as [keyof BagConfig, string][]) {
    const value = patch[key];
    if (key === "debugEnabled") {
      if (value === true) env[name] = "true";
      continue;
    }
    // Skip empty strings (e.g. the default empty dedupSkipDirectories) so we don't write noise keys.
    if (value != null && value !== "") env[name] = String(value);
  }
  return env;
}
