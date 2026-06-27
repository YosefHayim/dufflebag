/**
 * Shared config contract between the CLI (which writes `SKILLS_BAG_*` into
 * settings.json) and the hooks (which read them from the environment).
 *
 * This module is the single source of truth for the key names and defaults, and
 * it is deliberately dependency-free and self-contained so it can be copied into
 * the install dir as part of the hook payload and run on bare Node. The CLI's
 * `core/env-config` imports these constants rather than re-declaring them, which
 * is what guarantees the written keys and the read keys can never drift.
 */

import type { BagConfig, DedupMode } from "../../core/types.js";

/** Prefix marking every key this tool owns in settings.json `env`. */
export const ENV_PREFIX = "SKILLS_BAG_";

/** Canonical env var name for each config field. */
export const ENV_KEYS = {
  warnPct: "SKILLS_BAG_WARN_PCT",
  blockPct: "SKILLS_BAG_BLOCK_PCT",
  defaultBudget: "SKILLS_BAG_DEFAULT_BUDGET",
  hardCap: "SKILLS_BAG_HARD_CAP",
  pollSeconds: "SKILLS_BAG_POLL_SECONDS",
  idleSeconds: "SKILLS_BAG_IDLE_SECONDS",
  ttsVoice: "SKILLS_BAG_TTS_VOICE",
  ttsRate: "SKILLS_BAG_TTS_RATE",
  dedupMode: "SKILLS_BAG_DEDUP_MODE",
  dedupSkip: "SKILLS_BAG_DEDUP_SKIP",
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
  warnPct: 0.18,
  blockPct: 0.2,
  defaultBudget: 10,
  hardCap: 50,
  pollSeconds: 5,
  idleSeconds: 8,
  ttsVoice: "Samantha",
  ttsRate: 230,
  dedupMode: "deny",
  dedupSkip: "",
};

/** Coerce a string env value to a finite number, or null if unparseable/empty. */
export function parseNumber(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Read the effective config from an environment map, falling back to defaults per key. */
export function readConfig(env: Record<string, string | undefined> = process.env): BagConfig {
  const num = (name: string, fallback: number): number => parseNumber(env[name]) ?? fallback;
  return {
    warnPct: num(ENV_KEYS.warnPct, DEFAULTS.warnPct),
    blockPct: num(ENV_KEYS.blockPct, DEFAULTS.blockPct),
    defaultBudget: num(ENV_KEYS.defaultBudget, DEFAULTS.defaultBudget),
    hardCap: num(ENV_KEYS.hardCap, DEFAULTS.hardCap),
    pollSeconds: num(ENV_KEYS.pollSeconds, DEFAULTS.pollSeconds),
    idleSeconds: num(ENV_KEYS.idleSeconds, DEFAULTS.idleSeconds),
    ttsVoice: env[ENV_KEYS.ttsVoice] ?? DEFAULTS.ttsVoice,
    ttsRate: num(ENV_KEYS.ttsRate, DEFAULTS.ttsRate),
    dedupMode: parseDedupMode(env[ENV_KEYS.dedupMode]),
    dedupSkip: env[ENV_KEYS.dedupSkip] ?? DEFAULTS.dedupSkip,
  };
}
