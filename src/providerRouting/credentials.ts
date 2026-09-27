import { Effect, Option, Schema } from "effect";

import { freeProviderCatalog } from "./freeProviderCatalog.js";
import { readOpenRouterCredential } from "./openRouterKeychain.js";
import { credentialIdSchema, type ProviderManifest, providerUnavailabilitySchema } from "./providerContract.js";
import type { CredentialLookup } from "./providerRouting.js";

const credentialVariables = new Map<string, ReadonlyArray<string>>([
  ["api-airforce", ["API_AIRFORCE_API_KEY"]],
  ["bazaarlink", ["BAZAARLINK_API_KEY"]],
  ["blackbox", ["BLACKBOX_API_KEY"]],
  ["bluesminds", ["BLUESMINDS_API_KEY"]],
  ["cerebras", ["CEREBRAS_API_KEY"]],
  ["cloudflare-ai", ["CLOUDFLARE_API_TOKEN"]],
  ["cohere", ["COHERE_API_KEY"]],
  ["friendliai", ["FRIENDLI_API_KEY"]],
  ["google-ai-studio", ["GEMINI_API_KEY", "GOOGLE_API_KEY"]],
  ["groq", ["GROQ_API_KEY"]],
  ["hackclub", ["HACKCLUB_API_KEY"]],
  ["huggingface", ["HF_TOKEN", "HUGGINGFACE_API_KEY"]],
  ["iflytek", ["IFLYTEK_API_KEY"]],
  ["inference-net", ["INFERENCE_NET_API_KEY"]],
  ["liquid", ["LIQUID_API_KEY"]],
  ["llm7", ["LLM7_API_KEY"]],
  ["mistral", ["MISTRAL_API_KEY"]],
  ["morph", ["MORPH_API_KEY"]],
  ["nara", ["NARA_API_KEY"]],
  ["navy", ["NAVY_API_KEY"]],
  ["ollama-cloud", ["OLLAMA_API_KEY"]],
  ["pollinations", ["POLLINATIONS_API_KEY"]],
  ["puter", ["PUTER_AUTH_TOKEN"]],
  ["reka", ["REKA_API_KEY"]],
  ["sambanova", ["SAMBANOVA_API_KEY"]],
  ["sparkdesk", ["SPARKDESK_API_KEY"]],
]);

const credentialReadinessSchema = Schema.Union(
  Schema.TaggedStruct("unavailable", { reason: Schema.optional(providerUnavailabilitySchema) }),
  Schema.TaggedStruct("keyless", {}),
  Schema.TaggedStruct("found", {}),
  Schema.TaggedStruct("undeclared", {}),
  Schema.TaggedStruct("needsConnect", {}),
  Schema.TaggedStruct("needsVariables", { environmentVariables: Schema.Array(Schema.NonEmptyTrimmedString) }),
  Schema.TaggedStruct("needsCredential", { credentialId: credentialIdSchema }),
);

export type CredentialReadiness = Schema.Schema.Type<typeof credentialReadinessSchema>;

const cloudflareAccountId = (): string | undefined => process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || undefined;

const environmentVariablesFor = (credentialId: string): ReadonlyArray<string> =>
  credentialVariables.get(credentialId) || [];

const credentialFromEnvironment = (credentialId: string): Option.Option<string> =>
  Option.fromNullable(
    environmentVariablesFor(credentialId)
      .map((environmentVariable) => process.env[environmentVariable]?.trim())
      .find((credential) => credential !== undefined && credential !== ""),
  );

// OpenRouter's credential lives in macOS Keychain; every other credential comes from the environment.
export const lookUpCredential: CredentialLookup = (credentialId) => {
  if (credentialId === "openrouter-oauth") return readOpenRouterCredential();
  // A Cloudflare token cannot be used until CLOUDFLARE_ACCOUNT_ID names the account its endpoint belongs to.
  if (credentialId === "cloudflare-ai" && cloudflareAccountId() === undefined) return Effect.succeed(Option.none());
  return Effect.succeed(credentialFromEnvironment(credentialId));
};

export const credentialReadiness = (providerManifest: ProviderManifest): Effect.Effect<CredentialReadiness> =>
  Effect.gen(function* () {
    if (providerManifest.activation === "unavailable") {
      return { _tag: "unavailable" as const, reason: providerManifest.unavailableReason };
    }
    if (providerManifest.authentication === "keyless") return { _tag: "keyless" as const };
    const credentialId = providerManifest.credentialId;
    if (credentialId === undefined) return { _tag: "undeclared" as const };
    if (providerManifest.providerId === "cloudflare-ai" && cloudflareAccountId() === undefined) {
      return { _tag: "needsVariables" as const, environmentVariables: ["CLOUDFLARE_ACCOUNT_ID"] };
    }
    const credential = yield* lookUpCredential(credentialId);
    if (Option.isSome(credential)) return { _tag: "found" as const };
    if (credentialId === "openrouter-oauth") return { _tag: "needsConnect" as const };
    const environmentVariables = environmentVariablesFor(credentialId);
    if (environmentVariables.length === 0) return { _tag: "needsCredential" as const, credentialId };
    return { _tag: "needsVariables" as const, environmentVariables };
  });

// Cloudflare's endpoint path names the account, so the catalog placeholder is replaced when CLOUDFLARE_ACCOUNT_ID is set.
export const manifestsForEnvironment = (): ReadonlyArray<ProviderManifest> => {
  const accountId = cloudflareAccountId();
  if (accountId === undefined) return freeProviderCatalog;
  const cloudflareEndpoint = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`,
  );
  return freeProviderCatalog.map((providerManifest) =>
    providerManifest.providerId === "cloudflare-ai"
      ? { ...providerManifest, endpoint: cloudflareEndpoint }
      : providerManifest,
  );
};
