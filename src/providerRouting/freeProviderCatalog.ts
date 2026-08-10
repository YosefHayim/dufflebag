import { Schema } from "effect";

import {
  type DocumentedFreePool,
  documentedFreePoolSchema,
  type ProviderManifest,
  providerManifestSchema,
} from "./providerContract.js";

const omniRouteSnapshotSource =
  "https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.50/docs/reference/FREE_TIERS.md";
const acknowledgementVersion = "omniroute-3.8.50-2026-06-17";
const decodeDocumentedFreePool = Schema.decodeUnknownSync(documentedFreePoolSchema);
const decodeProviderManifest = Schema.decodeUnknownSync(providerManifestSchema);

export const freePoolSnapshot: ReadonlyArray<DocumentedFreePool> = [
  ["agy", "agy", "claude-opus-4-6-thinking", "keyless", 0, "avoid"],
  ["api-airforce", "api-airforce", "x-ai/grok-3", "recurring-daily", 24_000_000, "caution"],
  ["arcee-free", "arcee-ai", "arcee-ai/trinity-large-preview:free", "recurring-daily", 4_800_000, "caution"],
  ["bazaarlink", "bazaarlink", "auto:free", "recurring-daily", 3_600_000, "caution"],
  ["blackbox", "blackbox", "gpt-4o", "keyless", 0, "avoid"],
  ["bluesminds", "bluesminds", "gpt-4o", "recurring-daily", 7_200_000, "ambiguous"],
  ["cerebras", "cerebras", "zai-glm-4.7", "recurring-daily", 30_000_000, "caution"],
  ["cloudflare-ai", "cloudflare-ai", "@cf/meta/llama-3.3-70b-instruct", "recurring-daily", 30_000_000, "caution"],
  ["cohere", "cohere", "command-a-reasoning-08-2025", "recurring-monthly", 800_000, "caution"],
  ["coze", "coze", "claude-3-7-sonnet-20250514", "recurring-daily", 0, "avoid"],
  ["duckduckgo-web", "duckduckgo-web", "gpt-5.4-mini", "keyless", 0, "avoid"],
  ["felo-web", "felo-web", "felo-chat", "keyless", 0, "avoid"],
  ["friendliai", "friendliai", "meta-llama-3.1-70b-instruct", "keyless", 0, "avoid"],
  ["gemini-free", "gemini", "gemini-2.5-flash", "recurring-daily", 60_000_000, "caution"],
  ["github-models", "github-models", "cohere/cohere-command-a", "recurring-daily", 18_000_000, "caution"],
  ["groq", "groq", "meta-llama/llama-4-scout-17b-16e-instruct", "recurring-daily", 15_000_000, "caution"],
  ["hackclub", "hackclub", "meta-llama/llama-3.3-70b-instruct", "keyless", 0, "caution"],
  ["huggingchat", "huggingchat", "baidu/ERNIE-4.5-VL-424B-A47B-Base-PT", "recurring-monthly", 500_000, "caution"],
  ["huggingface", "huggingface", "meta-llama/llama-3.1-8b-instruct", "recurring-monthly", 200_000, "caution"],
  ["iflytek", "iflytek", "generalv3.5", "keyless", 0, "avoid"],
  ["inference-net", "inference-net", "meta-llama/Llama-3.3-70B-Instruct", "recurring-monthly", 0, "caution"],
  ["kiro", "kiro", "claude-sonnet-4.5", "recurring-monthly", 25_000, "avoid"],
  ["liquid", "liquid", "liquid-lfm-40b", "keyless", 0, "unknown"],
  ["llm7-free", "llm7", "gpt-4o-mini-2024-07-18", "recurring-daily", 150_000_000, "caution"],
  ["mistral", "mistral", "mistral-large-latest", "recurring-monthly", 1_000_000_000, "caution"],
  ["morph", "morph", "morph-v3-large", "recurring-monthly", 400_000, "ok"],
  ["muse-spark-web", "muse-spark-web", "muse-spark", "keyless", 0, "avoid"],
  ["nlpcloud", "nlpcloud", "llama-3-8b-instruct", "recurring-monthly", 0, "avoid"],
  ["ollama-cloud", "ollama-cloud", "deepseek-v4-pro", "recurring-monthly", 20_000_000, "ambiguous"],
  ["opencode", "opencode", "big-pickle", "keyless", 0, "avoid"],
  ["openrouter-free", "openrouter", "auto", "recurring-daily", 1_200_000, "caution"],
  ["pollinations", "pollinations", "openai", "keyless", 0, "caution"],
  ["puter", "puter", "gpt-5.5", "keyless", 0, "caution"],
  ["qwen-web", "qwen-web", "qwen3.8-max-preview", "keyless", 0, "avoid"],
  ["reka", "reka", "reka-flash-3", "recurring-monthly", 0, "caution"],
  ["sambanova", "sambanova", "MiniMax-M2.7", "recurring-daily", 6_000_000, "caution"],
  ["sparkdesk", "sparkdesk", "lite", "keyless", 0, "caution"],
  ["t3-web", "t3-web", "claude-opus-4", "recurring-daily", 0, "avoid"],
  ["uncloseai", "uncloseai", "adamo1139/Hermes-3-Llama-3.1-8B-FP8-Dynamic", "keyless", 0, "caution"],
  ["ovhcloud-anon", "ovhcloud", "gpt-oss-120b", "keyless", 0, "ok"],
  ["navy-free", "navy", "shared-pool", "recurring-daily", 4_500_000, "ok"],
  ["aihorde-anon", "aihorde", "aphrodite/TheDrummer/Cydonia-24B-v4.3", "keyless", 0, "ok"],
  ["nara-free", "nara", "tencent-hy3", "recurring-daily", 150_000_000, "caution"],
].map(([poolId, providerId, modelId, freeType, estimatedMonthlyTokens, termsStatus]) =>
  decodeDocumentedFreePool({ poolId, providerId, modelId, freeType, estimatedMonthlyTokens, termsStatus }),
);

export const documentedFreePoolCount = freePoolSnapshot.length;

export const documentedRecurringTokenEstimate = freePoolSnapshot.reduce(
  (estimatedTokens, freePool) => estimatedTokens + freePool.estimatedMonthlyTokens,
  0,
);

export const freeProviderCatalog: ReadonlyArray<ProviderManifest> = [
  decodeProviderManifest({
    providerId: "openrouter",
    displayName: "OpenRouter free models",
    protocolFamily: "openai-chat",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    authentication: "api-key",
    credentialId: "openrouter-oauth",
    termsStatus: "caution",
    acknowledgementVersion,
    activation: "active",
    freeTierWindow: { poolId: "openrouter-free", reset: "daily", estimatedTokens: 1_200_000 },
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
    acknowledgementVersion,
    activation: "active",
    freeTierWindow: { poolId: "gemini-free", reset: "daily", estimatedTokens: 60_000_000 },
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
    acknowledgementVersion,
    activation: "active",
    freeTierWindow: { poolId: "groq", reset: "daily", estimatedTokens: 15_000_000 },
    models: [{ modelId: "meta-llama/llama-4-scout-17b-16e-instruct", capabilities: ["text", "tools"] }],
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
    acknowledgementVersion,
    activation: "active",
    freeTierWindow: { poolId: "mistral", reset: "monthly", estimatedTokens: 1_000_000_000 },
    models: [{ modelId: "mistral-large-latest", capabilities: ["text", "reasoning", "tools"] }],
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
    acknowledgementVersion,
    activation: "active",
    freeTierWindow: { poolId: "cerebras", reset: "daily", estimatedTokens: 30_000_000 },
    models: [{ modelId: "zai-glm-4.7", capabilities: ["text", "tools"] }],
    source: "https://inference-docs.cerebras.ai/support/rate-limits",
  }),
];

export const freePoolSnapshotSource = omniRouteSnapshotSource;
