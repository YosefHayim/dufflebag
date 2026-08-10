import { Schema } from "effect";

import { type ProviderManifest, providerManifestSchema } from "./providerContract.js";

const source = "https://github.com/OmniRoute/OmniRoute/blob/main/docs/reference/FREE_TIERS.md";

const decodeProviderManifest = Schema.decodeUnknownSync(providerManifestSchema);

const createUnavailableManifest = (providerId: string, poolId: string): ProviderManifest =>
  decodeProviderManifest({
    providerId,
    displayName: providerId,
    protocolFamily: "openai-chat",
    endpoint: `https://${providerId}.invalid/v1/chat/completions`,
    authentication: "api-key",
    termsStatus: "caution",
    activation: "unavailable",
    freeTierWindow: { poolId, reset: "monthly", estimatedTokens: 0 },
    models: [{ modelId: `${providerId}-free`, capabilities: ["text"] }],
    source,
  });

const documentedPoolIds = [
  "mistral",
  "llm7",
  "gemini",
  "cerebras",
  "cloudflare-ai",
  "api-airforce",
  "ollama-cloud",
  "github-models",
  "groq",
  "bluesminds",
  "sambanova",
  "arcee-ai",
  "bazaarlink",
  "openrouter",
  "cohere",
  "huggingchat",
  "morph",
  "huggingface",
  "kiro",
  "glm-cn",
  "baidu",
  "kilo-gateway",
  "opencode-zen",
  "siliconflow",
  "tencent",
  "vertex",
  "agentrouter",
  "predibase",
  "together",
  "doubao",
  "ai21",
  "deepseek",
  "hyperbolic",
  "nscale",
  "bytez",
  "deepinfra",
  "fireworks",
  "nebius",
  "qoder",
  "scaleway",
  "novita",
  "agy",
  "baichuan",
] as const;

const documentedUnavailableProviders = documentedPoolIds.map((providerId) =>
  createUnavailableManifest(providerId, `${providerId}-free`),
);

const activeProviders: ReadonlyArray<ProviderManifest> = [
  decodeProviderManifest({
    providerId: "openrouter",
    displayName: "OpenRouter free models",
    protocolFamily: "openai-chat",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    authentication: "api-key",
    credentialId: "openrouter-oauth",
    termsStatus: "caution",
    acknowledgementVersion: "openrouter-2026-08-10",
    activation: "active",
    freeTierWindow: { poolId: "openrouter-free", reset: "unquantified", estimatedTokens: 100000 },
    models: [{ modelId: "openrouter/free", capabilities: ["text", "reasoning", "tools"] }],
    source: "https://openrouter.ai/docs/guides/overview/auth/oauth",
  }),
  decodeProviderManifest({
    providerId: "gemini",
    displayName: "Google Gemini",
    protocolFamily: "google-generative",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    authentication: "api-key",
    credentialId: "google-ai-studio",
    termsStatus: "caution",
    acknowledgementVersion: "omniroute-2026-06-17",
    activation: "active",
    freeTierWindow: { poolId: "gemini-free", reset: "daily", estimatedTokens: 2000000 },
    models: [{ modelId: "gemini-2.5-flash", capabilities: ["text", "reasoning", "tools"] }],
    source: "https://ai.google.dev/gemini-api/docs/rate-limits",
  }),
  decodeProviderManifest({
    providerId: "groq",
    displayName: "Groq",
    protocolFamily: "openai-chat",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    authentication: "api-key",
    credentialId: "groq",
    termsStatus: "caution",
    acknowledgementVersion: "omniroute-2026-06-17",
    activation: "active",
    freeTierWindow: { poolId: "groq-free", reset: "daily", estimatedTokens: 500000 },
    models: [{ modelId: "llama-3.3-70b-versatile", capabilities: ["text", "tools"] }],
    source: "https://console.groq.com/docs/rate-limits",
  }),
  decodeProviderManifest({
    providerId: "mistral",
    displayName: "Mistral AI",
    protocolFamily: "openai-chat",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    authentication: "api-key",
    credentialId: "mistral",
    termsStatus: "caution",
    acknowledgementVersion: "omniroute-2026-06-17",
    activation: "active",
    freeTierWindow: { poolId: "mistral-free", reset: "monthly", estimatedTokens: 1000000000 },
    models: [{ modelId: "mistral-small-latest", capabilities: ["text", "reasoning", "tools"] }],
    source: "https://docs.mistral.ai/deployment/laplateforme/tier/",
  }),
  decodeProviderManifest({
    providerId: "cerebras",
    displayName: "Cerebras",
    protocolFamily: "openai-chat",
    endpoint: "https://api.cerebras.ai/v1/chat/completions",
    authentication: "api-key",
    credentialId: "cerebras",
    termsStatus: "caution",
    acknowledgementVersion: "omniroute-2026-06-17",
    activation: "active",
    freeTierWindow: { poolId: "cerebras-free", reset: "daily", estimatedTokens: 1000000 },
    models: [{ modelId: "llama-3.3-70b", capabilities: ["text", "tools"] }],
    source: "https://inference-docs.cerebras.ai/support/rate-limits",
  }),
];

export const freeProviderCatalog: ReadonlyArray<ProviderManifest> = [
  ...documentedUnavailableProviders.filter((providerManifest) => providerManifest.activation === "unavailable"),
  ...activeProviders,
];

export const documentedFreePoolCount = documentedPoolIds.length;
