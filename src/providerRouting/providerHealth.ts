import { DateTime } from "effect";

import type { HealthRecord, ProviderManifest } from "./providerContract.js";

const reliabilityRankWeight = 1_000_000;
const quotaRankWeight = 100_000;

/**
 * Checks whether a provider cooldown extends beyond the observation time.
 * @param healthRecord - Previously persisted health, when present.
 * @param observedAt - Current routing observation time.
 * @returns Whether the provider remains in cooldown.
 */
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

/**
 * Checks whether a provider circuit extends beyond the observation time.
 * @param healthRecord - Previously persisted health, when present.
 * @param observedAt - Current routing observation time.
 * @returns Whether the provider circuit remains open.
 */
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

/**
 * Checks whether a daily or estimated monthly quota window has rolled over.
 * @param request - Manifest, persisted health, and optional observation time.
 * @returns Whether a fresh quota window applies.
 */
export const quotaWindowIsExpired = (request: {
  providerManifest: ProviderManifest;
  healthRecord: HealthRecord;
  observedAt: HealthRecord["observedAt"] | undefined;
}): boolean => {
  if (request.observedAt === undefined) {
    return false;
  }
  const observedAt = DateTime.toDateUtc(request.observedAt);
  const quotaWindowStartedAt = DateTime.toDateUtc(request.healthRecord.quotaWindowStartedAt);
  if (request.providerManifest.freeTierWindow.reset === "daily") {
    return (
      observedAt.getUTCFullYear() !== quotaWindowStartedAt.getUTCFullYear() ||
      observedAt.getUTCMonth() !== quotaWindowStartedAt.getUTCMonth() ||
      observedAt.getUTCDate() !== quotaWindowStartedAt.getUTCDate()
    );
  }
  if (request.providerManifest.freeTierWindow.reset === "monthly") {
    return (
      observedAt.getUTCFullYear() !== quotaWindowStartedAt.getUTCFullYear() ||
      observedAt.getUTCMonth() !== quotaWindowStartedAt.getUTCMonth()
    );
  }
  return false;
};

/**
 * Estimates remaining tokens while keeping unquantified pools rankable.
 * @param request - Manifest, persisted health, and optional observation time.
 * @returns The routing quota score available to the model.
 */
export const estimatedRemainingQuota = (request: {
  providerManifest: ProviderManifest;
  healthRecord: HealthRecord | undefined;
  observedAt?: HealthRecord["observedAt"];
}): number => {
  if (request.providerManifest.freeTierWindow.reset === "unquantified") {
    return quotaRankWeight;
  }
  if (request.healthRecord === undefined) {
    return request.providerManifest.freeTierWindow.estimatedTokens;
  }
  if (
    quotaWindowIsExpired({
      providerManifest: request.providerManifest,
      healthRecord: request.healthRecord,
      observedAt: request.observedAt,
    })
  ) {
    return request.providerManifest.freeTierWindow.estimatedTokens;
  }
  return Math.max(0, request.providerManifest.freeTierWindow.estimatedTokens - request.healthRecord.quotaUsedTokens);
};

/**
 * Calculates observed provider reliability from persisted call counters.
 * @param healthRecord - Previously persisted health, when present.
 * @returns A score from zero to one.
 */
export const providerReliabilityScore = (healthRecord: HealthRecord | undefined): number => {
  if (healthRecord === undefined) {
    return 1;
  }
  const attempts = healthRecord.successfulCalls + healthRecord.failedCalls;
  return attempts === 0 ? 1 : healthRecord.successfulCalls / attempts;
};

const providerQuotaRank = (request: {
  providerManifest: ProviderManifest;
  healthRecord: HealthRecord | undefined;
  observedAt?: HealthRecord["observedAt"];
}): number => {
  if (request.providerManifest.freeTierWindow.reset === "unquantified") return quotaRankWeight;
  const estimatedTokens = request.providerManifest.freeTierWindow.estimatedTokens;
  if (estimatedTokens === 0) return 0;
  return (estimatedRemainingQuota(request) / estimatedTokens) * quotaRankWeight;
};

/**
 * Ranks a provider by reliability, quota availability, and latency.
 * @param request - Manifest, persisted health, and optional observation time.
 * @returns A descending routing score.
 */
export const providerRank = (request: {
  providerManifest: ProviderManifest;
  healthRecord: HealthRecord | undefined;
  observedAt?: HealthRecord["observedAt"];
}): number => {
  const latencyPenalty = request.healthRecord === undefined ? 0 : request.healthRecord.latencyMilliseconds / 1000;
  return (
    providerReliabilityScore(request.healthRecord) * reliabilityRankWeight + providerQuotaRank(request) - latencyPenalty
  );
};
