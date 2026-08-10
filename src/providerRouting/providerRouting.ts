import { DateTime, Effect, Option, Stream } from "effect";

import { freeProviderCatalog } from "./freeProviderCatalog.js";
import {
  type ChatRequest,
  type HealthRecord,
  type ModelId,
  NoEligibleProvider,
  type ProviderFailure,
  type ProviderId,
  type ProviderManifest,
  type RoutingRequest,
  type StreamEvent,
} from "./providerContract.js";
import {
  estimatedRemainingQuota,
  providerCircuitIsOpen,
  providerIsCoolingDown,
  providerRank,
} from "./providerHealth.js";

export { documentedFreePoolCount, freeProviderCatalog } from "./freeProviderCatalog.js";
export { connectOpenRouter } from "./openRouterOAuth.js";
export {
  type ChatRequest,
  capabilitySchema,
  chatRequestSchema,
  credentialIdSchema,
  freeTierWindowSchema,
  type HealthRecord,
  healthRecordSchema,
  type ModelId,
  modelCapabilitySchema,
  modelIdSchema,
  NoEligibleProvider,
  type OpenRouterCredential,
  OpenRouterOAuthFailure,
  type OpenRouterOAuthRequest,
  openRouterCredentialSchema,
  openRouterOAuthRequestSchema,
  ProviderFailure,
  type ProviderId,
  type ProviderManifest,
  providerIdSchema,
  providerManifestSchema,
  type RoutingRequest,
  routingRequestSchema,
  type StreamEvent,
  streamEventSchema,
  termsStatusSchema,
} from "./providerContract.js";
export {
  classifyUpstreamFailure,
  decodeAnthropicStreamChunk,
  decodeGoogleStreamChunk,
  decodeOpenAiStreamChunk,
  encodeAnthropicRequest,
  encodeGoogleGenerativeRequest,
  encodeOpenAiChatRequest,
  encodeOpenAiResponsesRequest,
} from "./providerHttp.js";

export type CredentialLookup = (credentialId: string) => Effect.Effect<Option.Option<string>>;
type RoutingState = {
  readHealth: (identity: { providerId: ProviderId; modelId: ModelId }) => Effect.Effect<Option.Option<HealthRecord>>;
  writeHealth: (healthRecord: HealthRecord) => Effect.Effect<void>;
};
export type ProviderExchange = (invocation: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  credential: Option.Option<string>;
  chatRequest: ChatRequest;
}) => Stream.Stream<StreamEvent, ProviderFailure>;

type ProviderRoutingDependencies = {
  providerManifests?: ReadonlyArray<ProviderManifest>;
  credentialLookup: CredentialLookup;
  routingState: RoutingState;
  providerExchange: ProviderExchange;
};

type EligibleProvider = {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  healthRecord: HealthRecord | undefined;
  credential: Option.Option<string>;
};

const manifestsFor = (dependencies: ProviderRoutingDependencies): ReadonlyArray<ProviderManifest> =>
  dependencies.providerManifests === undefined ? freeProviderCatalog : dependencies.providerManifests;

const requiresAcknowledgement = (providerManifest: ProviderManifest): boolean => providerManifest.termsStatus !== "ok";

const hasRequiredCapabilities = (request: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  chatRequest: ChatRequest;
}): boolean => {
  const modelCapability = request.providerManifest.models.find((candidate) => candidate.modelId === request.modelId);
  if (modelCapability === undefined) {
    return false;
  }
  return request.chatRequest.requiredCapabilities.every((requiredCapability) =>
    modelCapability.capabilities.includes(requiredCapability),
  );
};

const acknowledgedTerms = (routingRequest: RoutingRequest, providerManifest: ProviderManifest): boolean => {
  if (!requiresAcknowledgement(providerManifest)) {
    return true;
  }
  return routingRequest.acknowledgementVersion === providerManifest.acknowledgementVersion;
};

const credentialFor = (providerManifest: ProviderManifest, credentialLookup: CredentialLookup) => {
  if (providerManifest.authentication === "keyless") {
    return Effect.succeed(Option.none<string>());
  }
  if (providerManifest.credentialId === undefined) {
    return Effect.succeed(Option.none<string>());
  }
  return credentialLookup(providerManifest.credentialId);
};

const modelChoices = (routingRequest: RoutingRequest, providerManifest: ProviderManifest): ReadonlyArray<ModelId> => {
  if (routingRequest.target === "auto-free") {
    return providerManifest.models.map((modelCapability) => modelCapability.modelId);
  }
  return routingRequest.target.providerId === providerManifest.providerId ? [routingRequest.target.modelId] : [];
};

const selectEligibleProviders = (routingRequest: RoutingRequest, dependencies: ProviderRoutingDependencies) =>
  Effect.gen(function* () {
    const eligibleProviders = yield* Effect.forEach(
      manifestsFor(dependencies).flatMap((providerManifest) =>
        modelChoices(routingRequest, providerManifest).map((modelId) => ({ providerManifest, modelId })),
      ),
      ({ providerManifest, modelId }) =>
        Effect.gen(function* () {
          const credential = yield* credentialFor(providerManifest, dependencies.credentialLookup);
          const healthOption = yield* dependencies.routingState.readHealth({
            providerId: providerManifest.providerId,
            modelId,
          });
          const healthRecord = Option.getOrUndefined(healthOption);
          const eligible =
            providerManifest.activation === "active" &&
            acknowledgedTerms(routingRequest, providerManifest) &&
            hasRequiredCapabilities({ providerManifest, modelId, chatRequest: routingRequest.chatRequest }) &&
            !providerIsCoolingDown(healthRecord, routingRequest.observedAt) &&
            !providerCircuitIsOpen(healthRecord, routingRequest.observedAt) &&
            estimatedRemainingQuota(providerManifest, healthRecord) > 0 &&
            (providerManifest.authentication === "keyless" || Option.isSome(credential));
          return eligible
            ? Option.some({ providerManifest, modelId, healthRecord, credential })
            : Option.none<EligibleProvider>();
        }),
      { concurrency: 8 },
    );
    return eligibleProviders
      .filter(Option.isSome)
      .map((eligibleProvider) => eligibleProvider.value)
      .sort(
        (left, right) =>
          providerRank(right.providerManifest, right.healthRecord) -
          providerRank(left.providerManifest, left.healthRecord),
      );
  });

const recordFailure = (request: {
  eligibleProvider: EligibleProvider;
  routingRequest: RoutingRequest;
  failure: ProviderFailure;
  routingState: RoutingState;
}) => {
  const prior = request.eligibleProvider.healthRecord;
  const priorFailedCalls = prior === undefined ? 0 : prior.failedCalls;
  const cooldownUntil =
    request.failure.failureClass === "quota"
      ? DateTime.unsafeMake(DateTime.toEpochMillis(request.routingRequest.observedAt) + 60_000)
      : undefined;
  const circuitUntil =
    request.failure.failureClass === "upstream" && priorFailedCalls >= 2
      ? DateTime.unsafeMake(DateTime.toEpochMillis(request.routingRequest.observedAt) + 300_000)
      : undefined;
  return request.routingState.writeHealth({
    providerId: request.eligibleProvider.providerManifest.providerId,
    modelId: request.eligibleProvider.modelId,
    observedAt: request.routingRequest.observedAt,
    cooldownUntil,
    circuitUntil,
    quotaUsedTokens: prior === undefined ? 0 : prior.quotaUsedTokens,
    quotaWindowStartedAt: prior === undefined ? request.routingRequest.observedAt : prior.quotaWindowStartedAt,
    successfulCalls: prior === undefined ? 0 : prior.successfulCalls,
    failedCalls: priorFailedCalls + 1,
    latencyMilliseconds: prior === undefined ? 0 : prior.latencyMilliseconds,
    failureClass: request.failure.failureClass === "configuration" ? "upstream" : request.failure.failureClass,
  });
};

const streamFromEligibleProviders = (request: {
  eligibleProviders: ReadonlyArray<EligibleProvider>;
  routingRequest: RoutingRequest;
  dependencies: ProviderRoutingDependencies;
}): Stream.Stream<StreamEvent, ProviderFailure | NoEligibleProvider> => {
  const tryProvider = (providerIndex: number): Stream.Stream<StreamEvent, ProviderFailure | NoEligibleProvider> => {
    const eligibleProvider = request.eligibleProviders[providerIndex];
    if (eligibleProvider === undefined) {
      return Stream.fail(
        new NoEligibleProvider({ requiredCapabilities: request.routingRequest.chatRequest.requiredCapabilities }),
      );
    }
    let emittedOutput = false;
    return request.dependencies
      .providerExchange({
        providerManifest: eligibleProvider.providerManifest,
        modelId: eligibleProvider.modelId,
        credential: eligibleProvider.credential,
        chatRequest: request.routingRequest.chatRequest,
      })
      .pipe(
        Stream.map((streamEvent) => {
          if (streamEvent._tag === "text" || streamEvent._tag === "reasoning" || streamEvent._tag === "tool") {
            emittedOutput = true;
          }
          return streamEvent;
        }),
        Stream.catchAll((failure) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* recordFailure({
                eligibleProvider,
                routingRequest: request.routingRequest,
                failure,
                routingState: request.dependencies.routingState,
              });
              return emittedOutput ? Stream.fail(failure) : tryProvider(providerIndex + 1);
            }),
          ),
        ),
      );
  };
  return tryProvider(0);
};

export const listFreeProviders = (
  request: { providerManifests?: ReadonlyArray<ProviderManifest> } = {},
): ReadonlyArray<ProviderManifest> =>
  (request.providerManifests === undefined ? freeProviderCatalog : request.providerManifests).filter(
    (providerManifest) => providerManifest.activation === "active",
  );

export const listFreeModels = (request: { providerManifests?: ReadonlyArray<ProviderManifest> } = {}) =>
  listFreeProviders(request).flatMap((providerManifest) =>
    providerManifest.models.map((modelCapability) => ({ providerId: providerManifest.providerId, ...modelCapability })),
  );

export const inspectProviderHealth = (request: {
  providerId: ProviderId;
  modelId: ModelId;
  routingState: RoutingState;
}) => request.routingState.readHealth({ providerId: request.providerId, modelId: request.modelId });

export const routeFreeChat = (request: {
  routingRequest: RoutingRequest;
  dependencies: ProviderRoutingDependencies;
}): Stream.Stream<StreamEvent, ProviderFailure | NoEligibleProvider> =>
  Stream.unwrap(
    selectEligibleProviders(request.routingRequest, request.dependencies).pipe(
      Effect.map((eligibleProviders) =>
        streamFromEligibleProviders({
          eligibleProviders,
          routingRequest: request.routingRequest,
          dependencies: request.dependencies,
        }),
      ),
    ),
  );

export const completeFreeChat = (request: {
  routingRequest: RoutingRequest;
  dependencies: ProviderRoutingDependencies;
}) => Stream.runCollect(routeFreeChat(request));
