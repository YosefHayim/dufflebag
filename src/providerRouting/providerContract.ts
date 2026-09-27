import { Schema } from "effect";

export const providerIdSchema = Schema.NonEmptyTrimmedString.pipe(Schema.brand("ProviderId"));
export const modelIdSchema = Schema.NonEmptyTrimmedString.pipe(Schema.brand("ModelId"));
const poolIdSchema = Schema.NonEmptyTrimmedString.pipe(Schema.brand("PoolId"));
export const credentialIdSchema = Schema.NonEmptyTrimmedString.pipe(Schema.brand("CredentialId"));
export const termsStatusSchema = Schema.Literal("ok", "caution", "ambiguous", "unknown", "avoid");
export const providerUnavailabilitySchema = Schema.Literal(
  "browser-cookie",
  "retired-contract",
  "synthetic-identity",
  "unsupported-protocol",
  "unverified-contract",
);
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
  protocolFamily: Schema.Literal("openai-chat", "openai-responses", "anthropic-messages", "google-generative"),
  endpoint: Schema.URL,
  authentication: Schema.Literal("api-key", "keyless"),
  credentialId: Schema.optional(credentialIdSchema),
  termsStatus: termsStatusSchema,
  acknowledgementVersion: Schema.optional(Schema.NonEmptyTrimmedString),
  activation: Schema.Literal("active", "unavailable"),
  unavailableReason: Schema.optional(providerUnavailabilitySchema),
  freeTierWindow: freeTierWindowSchema,
  models: Schema.NonEmptyArray(modelCapabilitySchema),
  source: Schema.URL,
}).pipe(
  Schema.filter(
    (providerManifest) =>
      (providerManifest.authentication === "api-key" && providerManifest.credentialId !== undefined) ||
      (providerManifest.authentication === "keyless" && providerManifest.credentialId === undefined),
    { message: () => "API-key providers require a credential identity and keyless providers must omit one." },
  ),
  Schema.filter(
    (providerManifest) =>
      (providerManifest.activation === "unavailable" && providerManifest.unavailableReason !== undefined) ||
      (providerManifest.activation === "active" && providerManifest.unavailableReason === undefined),
    { message: () => "Unavailable providers require one policy reason and active providers must omit it." },
  ),
);

export const chatRequestSchema = Schema.Struct({
  turns: Schema.NonEmptyArray(
    Schema.Struct({ role: Schema.Literal("system", "user", "assistant", "tool"), text: Schema.String }),
  ),
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
  // End of the pause that providerIsPaused checks; the health file format fixes this field name.
  circuitUntil: Schema.optional(Schema.DateTimeUtc),
  quotaUsedTokens: Schema.NonNegative,
  quotaWindowStartedAt: Schema.DateTimeUtc,
  successfulCalls: Schema.NonNegative,
  failedCalls: Schema.NonNegative,
  latencyMilliseconds: Schema.NonNegative,
  failureClass: Schema.optional(Schema.Literal("authentication", "quota", "upstream", "cancelled")),
});

export class ProviderError extends Schema.TaggedError<ProviderError>()("ProviderError", {
  providerId: providerIdSchema,
  modelId: modelIdSchema,
  failureClass: Schema.Literal("authentication", "quota", "upstream", "cancelled", "configuration"),
  statusCode: Schema.optional(Schema.Int),
}) {}

export class NoProviderError extends Schema.TaggedError<NoProviderError>()("NoProviderError", {
  requiredCapabilities: Schema.Array(capabilitySchema),
}) {}

export class HealthStoreError extends Schema.TaggedError<HealthStoreError>()("HealthStoreError", {
  issue: Schema.NonEmptyTrimmedString,
}) {}

export class OpenRouterOAuthError extends Schema.TaggedError<OpenRouterOAuthError>()("OpenRouterOAuthError", {
  failureClass: Schema.Literal("callback", "exchange", "state"),
}) {}

export type ProviderManifest = Schema.Schema.Type<typeof providerManifestSchema>;
export type DocumentedFreePool = Schema.Schema.Type<typeof documentedFreePoolSchema>;
export type ChatRequest = Schema.Schema.Type<typeof chatRequestSchema>;
export type RoutingRequest = Schema.Schema.Type<typeof routingRequestSchema>;
export type StreamEvent = Schema.Schema.Type<typeof streamEventSchema>;
export type HealthRecord = Schema.Schema.Type<typeof healthRecordSchema>;
export type ProviderId = Schema.Schema.Type<typeof providerIdSchema>;
export type ModelId = Schema.Schema.Type<typeof modelIdSchema>;
export type OpenRouterOAuthRequest = Schema.Schema.Type<typeof openRouterOAuthRequestSchema>;
export type OpenRouterCredential = Schema.Schema.Type<typeof openRouterCredentialSchema>;
