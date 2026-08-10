import { Schema } from "effect";

export const providerIdSchema = Schema.NonEmptyTrimmedString.pipe(Schema.brand("ProviderId"));
export const modelIdSchema = Schema.NonEmptyTrimmedString.pipe(Schema.brand("ModelId"));
export const poolIdSchema = Schema.NonEmptyTrimmedString.pipe(Schema.brand("PoolId"));
export const credentialIdSchema = Schema.NonEmptyTrimmedString.pipe(Schema.brand("CredentialId"));
export const oauthStateSchema = Schema.NonEmptyTrimmedString.pipe(Schema.brand("OAuthState"));
export const oauthCodeVerifierSchema = Schema.NonEmptyTrimmedString.pipe(Schema.brand("OAuthCodeVerifier"));
export const protocolFamilySchema = Schema.Literal(
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
  "google-generative",
);
export const termsStatusSchema = Schema.Literal("ok", "caution", "ambiguous", "unknown", "avoid");
export const authenticationRequirementSchema = Schema.Literal("api-key", "keyless");
export const providerActivationSchema = Schema.Literal("active", "unavailable");
export const capabilitySchema = Schema.Literal("text", "reasoning", "tools");

export const modelCapabilitySchema = Schema.Struct({
  modelId: modelIdSchema,
  capabilities: Schema.Array(capabilitySchema),
});

export const freeTierWindowSchema = Schema.Struct({
  poolId: poolIdSchema,
  reset: Schema.Literal("daily", "monthly", "never", "unquantified"),
  estimatedTokens: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export const documentedFreePoolSchema = Schema.Struct({
  poolId: poolIdSchema,
  providerId: providerIdSchema,
  modelId: modelIdSchema,
  freeType: Schema.Literal("recurring-daily", "recurring-monthly", "keyless"),
  estimatedMonthlyTokens: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  termsStatus: termsStatusSchema,
});

export const providerManifestSchema = Schema.Struct({
  providerId: providerIdSchema,
  displayName: Schema.NonEmptyTrimmedString,
  protocolFamily: protocolFamilySchema,
  endpoint: Schema.URL,
  authentication: authenticationRequirementSchema,
  credentialId: Schema.optional(credentialIdSchema),
  termsStatus: termsStatusSchema,
  acknowledgementVersion: Schema.optional(Schema.NonEmptyTrimmedString),
  activation: providerActivationSchema,
  freeTierWindow: freeTierWindowSchema,
  models: Schema.NonEmptyArray(modelCapabilitySchema),
  source: Schema.URL,
});

export const chatTurnSchema = Schema.Struct({
  role: Schema.Literal("system", "user", "assistant", "tool"),
  text: Schema.String,
});

export const chatRequestSchema = Schema.Struct({
  turns: Schema.NonEmptyArray(chatTurnSchema),
  requiredCapabilities: Schema.Array(capabilitySchema),
  maximumOutputTokens: Schema.optional(Schema.Positive),
});

export const routingTargetSchema = Schema.Union(
  Schema.Literal("auto-free"),
  Schema.Struct({ providerId: providerIdSchema, modelId: modelIdSchema }),
);

export const routingRequestSchema = Schema.Struct({
  target: routingTargetSchema,
  chatRequest: chatRequestSchema,
  acknowledgementVersion: Schema.optional(Schema.NonEmptyTrimmedString),
  observedAt: Schema.DateTimeUtc,
});

export const openRouterOAuthRequestSchema = Schema.Struct({
  callbackPort: Schema.Int.pipe(Schema.between(1024, 65535)),
});

export const openRouterCredentialSchema = Schema.Struct({
  credential: Schema.NonEmptyTrimmedString,
});

export const openRouterKeyExchangeSchema = Schema.Struct({
  key: Schema.NonEmptyTrimmedString,
});

export const streamEventSchema = Schema.Union(
  Schema.TaggedStruct("text", { text: Schema.String }),
  Schema.TaggedStruct("reasoning", { text: Schema.String }),
  Schema.TaggedStruct("tool", { name: Schema.NonEmptyTrimmedString, argumentsText: Schema.String }),
  Schema.TaggedStruct("usage", { inputTokens: Schema.NonNegative, outputTokens: Schema.NonNegative }),
  Schema.TaggedStruct("completed", {}),
);

export const healthRecordSchema = Schema.Struct({
  providerId: providerIdSchema,
  modelId: modelIdSchema,
  observedAt: Schema.DateTimeUtc,
  cooldownUntil: Schema.optional(Schema.DateTimeUtc),
  circuitUntil: Schema.optional(Schema.DateTimeUtc),
  quotaUsedTokens: Schema.NonNegative,
  quotaWindowStartedAt: Schema.DateTimeUtc,
  successfulCalls: Schema.NonNegative,
  failedCalls: Schema.NonNegative,
  latencyMilliseconds: Schema.NonNegative,
  failureClass: Schema.optional(Schema.Literal("authentication", "quota", "upstream", "cancelled")),
});

/** Describes one classified failure from an attempted provider/model route. */
export class ProviderFailure extends Schema.TaggedError<ProviderFailure>()("ProviderFailure", {
  providerId: providerIdSchema,
  modelId: modelIdSchema,
  failureClass: Schema.Literal("authentication", "quota", "upstream", "cancelled", "configuration"),
  statusCode: Schema.optional(Schema.Int),
}) {}

/** Reports that no declared provider satisfies a routing request. */
export class NoEligibleProvider extends Schema.TaggedError<NoEligibleProvider>()("NoEligibleProvider", {
  requiredCapabilities: Schema.Array(capabilitySchema),
}) {}

/** Describes a failed OpenRouter browser-consent operation. */
export class OpenRouterOAuthFailure extends Schema.TaggedError<OpenRouterOAuthFailure>()("OpenRouterOAuthFailure", {
  failureClass: Schema.Literal("callback", "exchange", "state"),
}) {}

/** A validated provider declaration used by routing and HTTP boundaries. */
export type ProviderManifest = Schema.Schema.Type<typeof providerManifestSchema>;
/** One pool-deduplicated entry from the attributed free-tier snapshot. */
export type DocumentedFreePool = Schema.Schema.Type<typeof documentedFreePoolSchema>;
/** Provider-neutral chat turns and required model capabilities. */
export type ChatRequest = Schema.Schema.Type<typeof chatRequestSchema>;
/** A validated target, chat request, acknowledgement, and observation time. */
export type RoutingRequest = Schema.Schema.Type<typeof routingRequestSchema>;
/** A provider-neutral streamed text, reasoning, tool, usage, or completion event. */
export type StreamEvent = Schema.Schema.Type<typeof streamEventSchema>;
/** Persistable provider health and quota counters without conversation content. */
export type HealthRecord = Schema.Schema.Type<typeof healthRecordSchema>;
/** A branded provider identity. */
export type ProviderId = Schema.Schema.Type<typeof providerIdSchema>;
/** A branded model identity. */
export type ModelId = Schema.Schema.Type<typeof modelIdSchema>;
/** Local callback settings for OpenRouter browser consent. */
export type OpenRouterOAuthRequest = Schema.Schema.Type<typeof openRouterOAuthRequestSchema>;
/** The credential returned by a successful OpenRouter key exchange. */
export type OpenRouterCredential = Schema.Schema.Type<typeof openRouterCredentialSchema>;
