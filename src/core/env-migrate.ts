/**
 * One-time migration from legacy `SKILLS_BAG_*` env keys to camelCase `skillsBag*`
 * keys introduced in skills-bag 0.5.0.
 */

import { ENV_KEYS, LEGACY_ENV_KEYS, LEGACY_ENV_PREFIX } from "../hooks/lib/config.js";

/** True when `env` still contains any legacy `SKILLS_BAG_*` key. */
export function hasLegacyEnvKeys(env: Record<string, string> | undefined): boolean {
  if (!env) return false;
  return Object.keys(env).some((key) => key.startsWith(LEGACY_ENV_PREFIX));
}

/**
 * Copy legacy values into the new camelCase keys (only when the new key is unset),
 * then remove every `SKILLS_BAG_*` key. Idempotent when already migrated.
 */
export function migrateEnv(env: Record<string, string>): Record<string, string> {
  const next = { ...env };
  for (const [legacyKey, field] of Object.entries(LEGACY_ENV_KEYS)) {
    const value = next[legacyKey];
    const newKey = ENV_KEYS[field];
    if (value != null && next[newKey] == null) next[newKey] = value;
    delete next[legacyKey];
  }
  for (const key of Object.keys(next)) {
    if (key.startsWith(LEGACY_ENV_PREFIX)) delete next[key];
  }
  return next;
}
