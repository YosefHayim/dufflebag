import { DateTime } from "effect";

import type { HealthRecord, ProviderManifest } from "./providerContract.js";

export const providerIsCoolingDown = (
  healthRecord: HealthRecord | undefined,
  observedAt: HealthRecord["observedAt"],
): boolean => {
  if (healthRecord === undefined) {
    return false;
  }
  return (
    healthRecord.cooldownUntil !== undefined &&
    DateTime.toEpochMillis(healthRecord.cooldownUntil) > DateTime.toEpochMillis(observedAt)
  );
};

export const providerCircuitIsOpen = (
  healthRecord: HealthRecord | undefined,
  observedAt: HealthRecord["observedAt"],
): boolean => {
  if (healthRecord === undefined) {
    return false;
  }
  return (
    healthRecord.circuitUntil !== undefined &&
    DateTime.toEpochMillis(healthRecord.circuitUntil) > DateTime.toEpochMillis(observedAt)
  );
};

export const estimatedRemainingQuota = (
  providerManifest: ProviderManifest,
  healthRecord: HealthRecord | undefined,
): number => {
  if (healthRecord === undefined) {
    return providerManifest.freeTierWindow.estimatedTokens;
  }
  return Math.max(0, providerManifest.freeTierWindow.estimatedTokens - healthRecord.quotaUsedTokens);
};

export const providerReliabilityScore = (healthRecord: HealthRecord | undefined): number => {
  if (healthRecord === undefined) {
    return 1;
  }
  const attempts = healthRecord.successfulCalls + healthRecord.failedCalls;
  return attempts === 0 ? 1 : healthRecord.successfulCalls / attempts;
};

export const providerRank = (providerManifest: ProviderManifest, healthRecord: HealthRecord | undefined): number => {
  const latencyPenalty = healthRecord === undefined ? 0 : healthRecord.latencyMilliseconds / 1000;
  return (
    providerReliabilityScore(healthRecord) * 1000000 +
    estimatedRemainingQuota(providerManifest, healthRecord) -
    latencyPenalty
  );
};
