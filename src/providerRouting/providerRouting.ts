import { DateTime, Effect, Option, Stream } from "effect";

import { freeProviderCatalog } from "./freeProviderCatalog.js";
import {
  type ChatRequest,
  type HealthRecord,
  type HealthStoreError,
  type ModelId,
  NoProviderError,
  type ProviderError,
  type ProviderId,
  type ProviderManifest,
  type RoutingRequest,
  type StreamEvent,
} from "./providerContract.js";
import {
  estimatedRemainingQuota,
  providerIsCoolingDown,
  providerIsPaused,
  providerRank,
  quotaWindowIsExpired,
} from "./providerHealth.js";
import { sendChat } from "./providerHttp.js";

export {
  acknowledgementVersion,
  documentedRecurringTokenEstimate,
  freePoolSnapshot,
  freeProviderCatalog,
} from "./freeProviderCatalog.js";
export { connectOpenRouter } from "./openRouterOAuth.js";
export {
  type ChatRequest,
  capabilitySchema,
  chatRequestSchema,
  credentialIdSchema,
  type DocumentedFreePool,
  documentedFreePoolSchema,
  freeTierWindowSchema,
  type HealthRecord,
  HealthStoreError,
  healthRecordSchema,
  type ModelId,
  modelCapabilitySchema,
  modelIdSchema,
  NoProviderError,
  type OpenRouterCredential,
  OpenRouterOAuthError,
  type OpenRouterOAuthRequest,
  openRouterCredentialSchema,
  openRouterOAuthRequestSchema,
  ProviderError,
  type ProviderId,
  type ProviderManifest,
  providerIdSchema,
  providerManifestSchema,
  providerUnavailabilitySchema,
  type RoutingRequest,
  routingRequestSchema,
  routingTargetSchema,
  type StreamEvent,
  streamEventSchema,
  termsStatusSchema,
} from "./providerContract.js";
export { sendChat } from "./providerHttp.js";

// The caller owns credentials; routing never persists them.
export type CredentialLookup = (credentialId: string) => Effect.Effect<Option.Option<string>>;

// Caller-owned per-provider/model health; routing never stores conversation content in it.
export type HealthStore = {
  readHealth: (identity: {
    providerId: ProviderId;
    modelId: ModelId;
  }) => Effect.Effect<Option.Option<HealthRecord>, HealthStoreError>;
  writeHealth: (healthRecord: HealthRecord) => Effect.Effect<void, HealthStoreError>;
};

export type SendChat = (invocation: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  credential: Option.Option<string>;
  chatRequest: ChatRequest;
}) => Stream.Stream<StreamEvent, ProviderError>;

type ProviderRoutingDependencies = {
  providerManifests?: ReadonlyArray<ProviderManifest>;
  credentialLookup: CredentialLookup;
  healthStore: HealthStore;
  sendChat?: SendChat;
};

type FreeChatRequest = { routingRequest: RoutingRequest; dependencies: ProviderRoutingDependencies };

type FreeChatStream = Stream.Stream<StreamEvent, ProviderError | NoProviderError | HealthStoreError>;

type EligibleProvider = {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  healthRecord: HealthRecord | undefined;
  credential: Option.Option<string>;
};

const quotaCooldown = { minutes: 1 };
const repeatedFailurePause = { minutes: 5 };

const manifestsOrCatalog = (providerManifests: ReadonlyArray<ProviderManifest> | undefined) =>
  providerManifests === undefined ? freeProviderCatalog : providerManifests;

const hasRequiredCapabilities = (request: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  chatRequest: ChatRequest;
}): boolean => {
  const modelCapability = request.providerManifest.models.find((candidate) => candidate.modelId === request.modelId);
  return (
    modelCapability !== undefined &&
    request.chatRequest.requiredCapabilities.every((capability) => modelCapability.capabilities.includes(capability))
  );
};

const acknowledgedTerms = (routingRequest: RoutingRequest, providerManifest: ProviderManifest): boolean =>
  providerManifest.termsStatus === "ok" ||
  routingRequest.acknowledgementVersion === providerManifest.acknowledgementVersion;

const credentialFor = (providerManifest: ProviderManifest, credentialLookup: CredentialLookup) =>
  providerManifest.authentication === "keyless" || providerManifest.credentialId === undefined
    ? Effect.succeed(Option.none<string>())
    : credentialLookup(providerManifest.credentialId);

const modelChoices = (routingRequest: RoutingRequest, providerManifest: ProviderManifest): ReadonlyArray<ModelId> => {
  if (routingRequest.target === "auto-free") {
    return providerManifest.models.map((modelCapability) => modelCapability.modelId);
  }
  return routingRequest.target.providerId === providerManifest.providerId ? [routingRequest.target.modelId] : [];
};

const isEligible = (routingRequest: RoutingRequest, candidate: EligibleProvider): boolean => {
  const { providerManifest, modelId, healthRecord } = candidate;
  const observedAt = routingRequest.observedAt;
  return (
    providerManifest.activation === "active" &&
    acknowledgedTerms(routingRequest, providerManifest) &&
    hasRequiredCapabilities({ providerManifest, modelId, chatRequest: routingRequest.chatRequest }) &&
    !providerIsCoolingDown(healthRecord, observedAt) &&
    !providerIsPaused(healthRecord, observedAt) &&
    estimatedRemainingQuota({ providerManifest, healthRecord, observedAt }) > 0 &&
    (providerManifest.authentication === "keyless" || Option.isSome(candidate.credential))
  );
};

const selectEligibleProviders = ({ routingRequest, dependencies }: FreeChatRequest) =>
  Effect.forEach(
    manifestsOrCatalog(dependencies.providerManifests).flatMap((providerManifest) =>
      modelChoices(routingRequest, providerManifest).map((modelId) => ({ providerManifest, modelId })),
    ),
    ({ providerManifest, modelId }) =>
      Effect.gen(function* () {
        const credential = yield* credentialFor(providerManifest, dependencies.credentialLookup);
        const healthOption = yield* dependencies.healthStore.readHealth({
          providerId: providerManifest.providerId,
          modelId,
        });
        const candidate = { providerManifest, modelId, healthRecord: Option.getOrUndefined(healthOption), credential };
        return isEligible(routingRequest, candidate) ? Option.some(candidate) : Option.none<EligibleProvider>();
      }),
    { concurrency: 8 },
  ).pipe(
    Effect.map((candidates) =>
      candidates
        .flatMap(Option.toArray)
        .map((eligibleProvider) => ({
          eligibleProvider,
          rank: providerRank({ ...eligibleProvider, observedAt: routingRequest.observedAt }),
        }))
        .sort((left, right) => right.rank - left.rank)
        .map((rankedProvider) => rankedProvider.eligibleProvider),
    ),
  );

const freshCounters = (observedAt: HealthRecord["observedAt"]) => ({
  quotaUsedTokens: 0,
  quotaWindowStartedAt: observedAt,
  successfulCalls: 0,
  failedCalls: 0,
  latencyMilliseconds: 0,
});

const recordFailure = (request: {
  eligibleProvider: EligibleProvider;
  observedAt: HealthRecord["observedAt"];
  failure: ProviderError;
  healthStore: HealthStore;
}) => {
  const { providerManifest, modelId, healthRecord } = request.eligibleProvider;
  const { observedAt, failure } = request;
  const prior = healthRecord === undefined ? freshCounters(observedAt) : healthRecord;
  return request.healthStore.writeHealth({
    providerId: providerManifest.providerId,
    modelId,
    observedAt,
    cooldownUntil: failure.failureClass === "quota" ? DateTime.add(observedAt, quotaCooldown) : undefined,
    circuitUntil:
      failure.failureClass === "upstream" && prior.failedCalls >= 2
        ? DateTime.add(observedAt, repeatedFailurePause)
        : undefined,
    quotaUsedTokens: prior.quotaUsedTokens,
    quotaWindowStartedAt: prior.quotaWindowStartedAt,
    successfulCalls: prior.successfulCalls,
    failedCalls: prior.failedCalls + 1,
    latencyMilliseconds: prior.latencyMilliseconds,
    failureClass: failure.failureClass === "configuration" ? "upstream" : failure.failureClass,
  });
};

const recordSuccess = (request: {
  eligibleProvider: EligibleProvider;
  observedAt: HealthRecord["observedAt"];
  usageTokens: number;
  latencyMilliseconds: number;
  healthStore: HealthStore;
}) => {
  const { providerManifest, modelId, healthRecord } = request.eligibleProvider;
  const observedAt = request.observedAt;
  const prior = healthRecord === undefined ? freshCounters(observedAt) : healthRecord;
  const quotaWindow =
    healthRecord === undefined || quotaWindowIsExpired({ providerManifest, healthRecord, observedAt })
      ? freshCounters(observedAt)
      : healthRecord;
  return request.healthStore.writeHealth({
    providerId: providerManifest.providerId,
    modelId,
    observedAt,
    quotaUsedTokens: quotaWindow.quotaUsedTokens + request.usageTokens,
    quotaWindowStartedAt: quotaWindow.quotaWindowStartedAt,
    successfulCalls: prior.successfulCalls + 1,
    failedCalls: prior.failedCalls,
    latencyMilliseconds: request.latencyMilliseconds,
  });
};

const streamFromEligibleProviders = (
  request: FreeChatRequest & { eligibleProviders: ReadonlyArray<EligibleProvider> },
): FreeChatStream => {
  const { routingRequest, dependencies } = request;
  const send = dependencies.sendChat === undefined ? sendChat : dependencies.sendChat;
  const tryProvider = (providerIndex: number): FreeChatStream => {
    const eligibleProvider = request.eligibleProviders[providerIndex];
    if (eligibleProvider === undefined) {
      return Stream.fail(
        new NoProviderError({ requiredCapabilities: routingRequest.chatRequest.requiredCapabilities }),
      );
    }
    let emittedOutput = false;
    let completed = false;
    let inputTokens = 0;
    let outputTokens = 0;
    const startedAt = Date.now();
    return send({
      providerManifest: eligibleProvider.providerManifest,
      modelId: eligibleProvider.modelId,
      credential: eligibleProvider.credential,
      chatRequest: routingRequest.chatRequest,
    }).pipe(
      Stream.map((streamEvent) => {
        emittedOutput = true;
        if (streamEvent._tag === "usage") {
          inputTokens = Math.max(inputTokens, streamEvent.inputTokens);
          outputTokens = Math.max(outputTokens, streamEvent.outputTokens);
        }
        if (streamEvent._tag === "completed") completed = true;
        return streamEvent;
      }),
      Stream.catchAll((failure) =>
        Stream.unwrap(
          recordFailure({
            eligibleProvider,
            observedAt: routingRequest.observedAt,
            failure,
            healthStore: dependencies.healthStore,
          }).pipe(
            // Lazy on purpose: the next provider's chat is built only after this failure is recorded.
            Effect.map(() =>
              emittedOutput || routingRequest.target !== "auto-free"
                ? Stream.fail(failure)
                : tryProvider(providerIndex + 1),
            ),
          ),
        ),
      ),
      Stream.concat(
        Stream.unwrap(
          Effect.suspend(() => {
            if (!completed) return Effect.succeed(Stream.empty);
            return recordSuccess({
              eligibleProvider,
              observedAt: routingRequest.observedAt,
              usageTokens: inputTokens + outputTokens,
              latencyMilliseconds: Date.now() - startedAt,
              healthStore: dependencies.healthStore,
            }).pipe(Effect.as(Stream.empty));
          }),
        ),
      ),
    );
  };
  return tryProvider(0);
};

export const listFreeProviders = (
  request: { providerManifests?: ReadonlyArray<ProviderManifest> } = {},
): Effect.Effect<ReadonlyArray<ProviderManifest>> =>
  Effect.succeed(
    manifestsOrCatalog(request.providerManifests).filter(
      (providerManifest) => providerManifest.activation === "active",
    ),
  );

export const listFreeModels = (request: { providerManifests?: ReadonlyArray<ProviderManifest> } = {}) =>
  listFreeProviders(request).pipe(
    Effect.map((providerManifests) =>
      providerManifests.flatMap((providerManifest) =>
        providerManifest.models.map((modelCapability) => ({
          providerId: providerManifest.providerId,
          ...modelCapability,
        })),
      ),
    ),
  );

// An explicit target never falls back; auto-free moves to the next ranked provider only before the first event streams.
export const streamFreeChat = (request: FreeChatRequest): FreeChatStream =>
  Stream.unwrap(
    selectEligibleProviders(request).pipe(
      Effect.map((eligibleProviders) => streamFromEligibleProviders({ ...request, eligibleProviders })),
    ),
  );

export const askFreeChat = (request: FreeChatRequest) => Stream.runCollect(streamFreeChat(request));
