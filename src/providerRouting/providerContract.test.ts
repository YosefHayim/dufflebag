import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  documentedFreePoolSchema,
  openRouterKeyExchangeSchema,
  openRouterOAuthRequestSchema,
  providerManifestSchema,
  routingRequestSchema,
} from "./providerContract.js";

const manifestFields = {
  providerId: "boundary-provider",
  displayName: "Boundary provider",
  protocolFamily: "openai-chat",
  endpoint: "https://boundary.example/chat/completions",
  termsStatus: "ok",
  freeTierWindow: { poolId: "boundary-pool", reset: "unquantified", estimatedTokens: 0 },
  models: [{ modelId: "boundary-model", capabilities: ["text"] }],
  source: "https://boundary.example/docs",
};

const freePoolFields = {
  poolId: "pool",
  providerId: "provider",
  modelId: "model",
  freeType: "recurring-daily",
  termsStatus: "ok",
};

describe("provider contract", () => {
  it.each<{ scenario: string; schema: Schema.Schema.AnyNoContext; candidate: unknown }>([
    { scenario: "an empty manifest", schema: providerManifestSchema, candidate: { providerId: "", models: [] } },
    {
      scenario: "an API-key manifest without a credential",
      schema: providerManifestSchema,
      candidate: { ...manifestFields, authentication: "api-key", activation: "active" },
    },
    {
      scenario: "an unavailable manifest without a reason",
      schema: providerManifestSchema,
      candidate: { ...manifestFields, authentication: "keyless", activation: "unavailable" },
    },
    {
      scenario: "a negative pool estimate",
      schema: documentedFreePoolSchema,
      candidate: { ...freePoolFields, estimatedMonthlyTokens: -1 },
    },
    {
      scenario: "a fractional pool estimate",
      schema: documentedFreePoolSchema,
      candidate: { ...freePoolFields, estimatedMonthlyTokens: 1.5 },
    },
    { scenario: "a routing request without a chat", schema: routingRequestSchema, candidate: { target: "auto-free" } },
    { scenario: "a privileged callback port", schema: openRouterOAuthRequestSchema, candidate: { callbackPort: 80 } },
    {
      scenario: "a key exchange without a key",
      schema: openRouterKeyExchangeSchema,
      candidate: { credential: "not-an-openrouter-key" },
    },
  ])("rejects $scenario at the boundary", ({ schema, candidate }) => {
    expect(() => Schema.decodeUnknownSync(schema)(candidate)).toThrow();
  });
});
