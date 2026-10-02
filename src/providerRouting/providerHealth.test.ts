import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { freeProviderCatalog } from "./freeProviderCatalog.js";
import { healthRecordSchema } from "./providerContract.js";
import {
  estimatedRemainingQuota,
  providerIsCoolingDown,
  providerIsPaused,
  quotaWindowIsExpired,
} from "./providerHealth.js";

const decodeDateTime = Schema.decodeUnknownSync(Schema.DateTimeUtc);

const catalogManifest = (providerId: string) => {
  const providerManifest = freeProviderCatalog.find((candidate) => candidate.providerId === providerId);
  if (providerManifest === undefined) throw new Error(`The ${providerId} declaration is required for quota tests.`);
  return providerManifest;
};

const exhaustedHealth = Schema.decodeUnknownSync(healthRecordSchema)({
  providerId: "cerebras",
  modelId: "zai-glm-4.7",
  observedAt: "2026-08-10T00:00:00.000Z",
  cooldownUntil: "2026-08-10T00:01:00.000Z",
  circuitUntil: "2026-08-10T00:05:00.000Z",
  quotaUsedTokens: 30_000_000,
  quotaWindowStartedAt: "2026-08-09T00:00:00.000Z",
  successfulCalls: 1,
  failedCalls: 3,
  latencyMilliseconds: 120,
});

describe("provider health", () => {
  it("resets daily quota and expires cooldown and pause windows", () => {
    const providerManifest = catalogManifest("cerebras");
    const observedAt = decodeDateTime("2026-08-10T00:05:01.000Z");

    expect(quotaWindowIsExpired({ providerManifest, healthRecord: exhaustedHealth, observedAt })).toBe(true);
    expect(estimatedRemainingQuota({ providerManifest, healthRecord: exhaustedHealth, observedAt })).toBe(1_000_000);
    expect(providerIsCoolingDown(exhaustedHealth, observedAt)).toBe(false);
    expect(providerIsPaused(exhaustedHealth, observedAt)).toBe(false);
  });

  it("resets a monthly quota at the UTC month boundary", () => {
    const providerManifest = catalogManifest("mistral");
    const healthRecord = {
      ...exhaustedHealth,
      providerId: providerManifest.providerId,
      modelId: providerManifest.models[0].modelId,
      quotaWindowStartedAt: decodeDateTime("2026-01-31T23:59:00.000Z"),
    };
    const observedAt = decodeDateTime("2026-02-01T00:00:00.000Z");
    expect(quotaWindowIsExpired({ providerManifest, healthRecord, observedAt })).toBe(true);
  });
});
