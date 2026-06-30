/**
 * Tests for legacy SKILLS_BAG_* → skillsBag* env migration.
 */

import { describe, expect, it } from "vitest";

import { hasLegacyEnvKeys, migrateEnv } from "../src/core/env-migrate.js";

describe("migrateEnv", () => {
  it("maps legacy keys to camelCase and removes legacy keys", () => {
    const next = migrateEnv({
      SKILLS_BAG_WARN_PCT: "0.15",
      SKILLS_BAG_TTS_VOICE: "Ava",
      MY_VAR: "keep",
    });
    expect(next).toEqual({
      skillsBagContextWarnFraction: "0.15",
      skillsBagSpeechVoice: "Ava",
      MY_VAR: "keep",
    });
  });

  it("does not overwrite an already-migrated key", () => {
    const next = migrateEnv({
      SKILLS_BAG_WARN_PCT: "0.15",
      skillsBagContextWarnFraction: "0.20",
    });
    expect(next.skillsBagContextWarnFraction).toBe("0.20");
    expect(next.SKILLS_BAG_WARN_PCT).toBeUndefined();
  });

  it("is idempotent when already migrated", () => {
    const env = { skillsBagContextWarnFraction: "0.18", MY_VAR: "keep" };
    expect(migrateEnv(env)).toEqual(env);
  });

  it("hasLegacyEnvKeys detects legacy prefix only", () => {
    expect(hasLegacyEnvKeys({ SKILLS_BAG_WARN_PCT: "0.18" })).toBe(true);
    expect(hasLegacyEnvKeys({ skillsBagContextWarnFraction: "0.18" })).toBe(false);
    expect(hasLegacyEnvKeys(undefined)).toBe(false);
  });
});
