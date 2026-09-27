import { DateTime } from "effect";

import type { HealthRecord, ProviderManifest } from "./providerContract.js";

const reliabilityRankWeight = 1_000_000;
const quotaRankWeight = 100_000;

type ObservedAt = HealthRecord["observedAt"];

type ProviderObservation = {
  providerManifest: ProviderManifest;
  healthRecord: HealthRecord | undefined;
  observedAt: ObservedAt;
};

const isLaterThan = (until: ObservedAt | undefined, observedAt: ObservedAt): boolean =>
  until !== undefined && DateTime.greaterThan(until, observedAt);

export const providerIsCoolingDown = (healthRecord: HealthRecord | undefined, observedAt: ObservedAt): boolean =>
  isLaterThan(healthRecord?.cooldownUntil, observedAt);

// Paused after repeated upstream failures.
export const providerIsPaused = (healthRecord: HealthRecord | undefined, observedAt: ObservedAt): boolean =>
  isLaterThan(healthRecord?.circuitUntil, observedAt);

// ISO text is in UTC, so its prefix is the UTC calendar day or month.
const utcDay = (dateTime: ObservedAt): string => DateTime.formatIso(dateTime).slice(0, "yyyy-mm-dd".length);

const utcMonth = (dateTime: ObservedAt): string => DateTime.formatIso(dateTime).slice(0, "yyyy-mm".length);

export const quotaWindowIsExpired = (request: {
  providerManifest: ProviderManifest;
  healthRecord: HealthRecord;
  observedAt: ObservedAt;
}): boolean => {
  const windowStartedAt = request.healthRecord.quotaWindowStartedAt;
  switch (request.providerManifest.freeTierWindow.reset) {
    case "daily":
      return utcDay(request.observedAt) !== utcDay(windowStartedAt);
    case "monthly":
      return utcMonth(request.observedAt) !== utcMonth(windowStartedAt);
    case "never":
    case "unquantified":
      return false;
  }
};

// Unquantified pools get a fixed score so they stay rankable next to measured ones.
export const estimatedRemainingQuota = (observation: ProviderObservation): number => {
  const { reset, estimatedTokens } = observation.providerManifest.freeTierWindow;
  if (reset === "unquantified") return quotaRankWeight;
  const healthRecord = observation.healthRecord;
  if (healthRecord === undefined || quotaWindowIsExpired({ ...observation, healthRecord })) return estimatedTokens;
  return Math.max(0, estimatedTokens - healthRecord.quotaUsedTokens);
};

const reliabilityScore = (healthRecord: HealthRecord | undefined): number => {
  if (healthRecord === undefined) return 1;
  const attempts = healthRecord.successfulCalls + healthRecord.failedCalls;
  return attempts === 0 ? 1 : healthRecord.successfulCalls / attempts;
};

const quotaRank = (observation: ProviderObservation): number => {
  const { reset, estimatedTokens } = observation.providerManifest.freeTierWindow;
  if (reset === "unquantified") return quotaRankWeight;
  if (estimatedTokens === 0) return 0;
  return (estimatedRemainingQuota(observation) / estimatedTokens) * quotaRankWeight;
};

// Higher is better: reliability dominates, then remaining quota, then latency.
export const providerRank = (observation: ProviderObservation): number => {
  const latencyPenalty =
    observation.healthRecord === undefined ? 0 : observation.healthRecord.latencyMilliseconds / 1000;
  return reliabilityScore(observation.healthRecord) * reliabilityRankWeight + quotaRank(observation) - latencyPenalty;
};
