/**
 * CLI-side config helpers layered on the shared contract in
 * `hooks/lib/config.ts`.
 *
 * The key names, defaults, and the env reader live in the hook payload module
 * (so they ship self-contained and the read/write sides can't drift); this file
 * adds the things only the CLI needs — validation/clamping of user input and
 * rendering a config patch back to the `SKILLS_BAG_*` string map.
 */

import { DEFAULTS, ENV_KEYS, ENV_PREFIX, parseNumber, readConfig } from "../hooks/lib/config.js";
import type { BagConfig } from "./types.js";

export { DEFAULTS, ENV_KEYS, ENV_PREFIX, parseNumber };

/** Read the effective config out of a settings.json `env` map, falling back to defaults. */
export const fromEnvMap = (env: Record<string, string> | undefined): BagConfig => readConfig(env ?? {});

/** Inclusive bounds enforced on user input so a typo can't disable the guardrail. */
const BOUNDS = {
  warnPct: [0.01, 0.95],
  blockPct: [0.01, 0.99],
  defaultBudget: [1, 1000],
  hardCap: [1, 1000],
  pollSeconds: [1, 600],
  idleSeconds: [1, 600],
  ttsRate: [80, 720],
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
    if (key === "ttsVoice") {
      out.ttsVoice = String(value);
      continue;
    }
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) throw new Error(`Invalid value for ${key}: ${String(value)} (expected a number)`);
    const bound = BOUNDS[key as keyof typeof BOUNDS];
    (out[key] as number) = bound ? clamp(num, bound) : num;
  }
  if (out.warnPct != null && out.blockPct != null && out.warnPct >= out.blockPct) {
    throw new Error(`warnPct (${out.warnPct}) must be below blockPct (${out.blockPct})`);
  }
  return out;
}

/** Render a config patch to the `SKILLS_BAG_*` string→string map written into settings.json `env`. */
export function toEnvMap(patch: Partial<BagConfig>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, name] of Object.entries(ENV_KEYS) as [keyof BagConfig, string][]) {
    const value = patch[key];
    if (value != null) env[name] = String(value);
  }
  return env;
}
