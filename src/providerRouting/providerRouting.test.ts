import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema, Stream } from "effect";
import { describe } from "vitest";

import { documentedFreePoolCount, freeProviderCatalog } from "./freeProviderCatalog.js";
import { connectOpenRouter } from "./openRouterOAuth.js";
import {
  openRouterOAuthRequestSchema,
  ProviderFailure,
  providerManifestSchema,
  routingRequestSchema,
} from "./providerContract.js";
import {
  classifyUpstreamFailure,
  decodeAnthropicStreamChunk,
  decodeGoogleStreamChunk,
  decodeOpenAiStreamChunk,
} from "./providerHttp.js";
import { completeFreeChat, listFreeModels, listFreeProviders } from "./providerRouting.js";

const decodeRoutingRequest = Schema.decodeUnknownSync(routingRequestSchema);

const routingRequest = decodeRoutingRequest({
  target: "auto-free",
  chatRequest: { turns: [{ role: "user", text: "Say hi" }], requiredCapabilities: ["text"] },
  acknowledgementVersion: "omniroute-2026-06-17",
  observedAt: "2026-08-10T00:00:00.000Z",
});

const storedHealth = new Map<string, Schema.Schema.Type<typeof import("./providerContract.js").healthRecordSchema>>();

const routingState = {
  readHealth: ({ providerId, modelId }: { providerId: string; modelId: string }) =>
    Effect.succeed(Option.fromNullable(storedHealth.get(`${providerId}/${modelId}`))),
  writeHealth: (healthRecord: Schema.Schema.Type<typeof import("./providerContract.js").healthRecordSchema>) =>
    Effect.sync(() => {
      storedHealth.set(`${healthRecord.providerId}/${healthRecord.modelId}`, healthRecord);
    }),
};

describe("provider routing", () => {
  it("keeps the attributed snapshot pool-deduped and identity-unique", () => {
    expect(documentedFreePoolCount).toBe(43);
    expect(new Set(freeProviderCatalog.map((providerManifest) => providerManifest.freeTierWindow.poolId)).size).toBe(
      43,
    );
    expect(
      new Set(
        freeProviderCatalog.flatMap((providerManifest) =>
          providerManifest.models.map((modelCapability) => `${providerManifest.providerId}/${modelCapability.modelId}`),
        ),
      ).size,
    ).toBe(freeProviderCatalog.length);
  });

  it("exposes only officially active free providers and models", () => {
    expect(listFreeProviders()).toHaveLength(5);
    expect(listFreeModels()).toHaveLength(5);
  });

  it("rejects malformed manifests and routing declarations at the boundary", () => {
    expect(() => Schema.decodeUnknownSync(providerManifestSchema)({ providerId: "", models: [] })).toThrow();
    expect(() => Schema.decodeUnknownSync(routingRequestSchema)({ target: "auto-free" })).toThrow();
    expect(() => Schema.decodeUnknownSync(openRouterOAuthRequestSchema)({ callbackPort: 80 })).toThrow();
  });

  it.effect(
    "completes a state-validated local OpenRouter callback without persisting transient authorization material",
    () => {
      let authorizationUrl: URL | undefined;
      let exchangedCode: string | undefined;
      let exchangedVerifier: string | undefined;
      const callbackPort = 49153;
      return connectOpenRouter({
        openRouterOAuthRequest: Schema.decodeUnknownSync(openRouterOAuthRequestSchema)({ callbackPort }),
        dependencies: {
          openBrowser: (openedAuthorizationUrl) =>
            Effect.tryPromise({
              try: async () => {
                authorizationUrl = openedAuthorizationUrl;
                const callbackText = openedAuthorizationUrl.searchParams.get("callback_url");
                if (callbackText === null) {
                  throw new Error("OpenRouter authorization URL did not include a callback URL.");
                }
                const callbackUrl = new URL(callbackText);
                if (!callbackUrl.pathname.startsWith("/openrouter/callback/")) {
                  throw new Error("OpenRouter callback URL did not include state.");
                }
                callbackUrl.searchParams.set("code", "authorization-code");
                await fetch(callbackUrl);
              },
              catch: (failure) => (failure instanceof Error ? failure : new Error("Could not complete test callback.")),
            }),
          exchangeAuthorizationCode: ({ code, codeVerifier }) =>
            Effect.sync(() => {
              exchangedCode = code;
              exchangedVerifier = codeVerifier;
              return { credential: "test-openrouter-key" };
            }),
        },
      }).pipe(
        Effect.tap((openRouterCredential) =>
          Effect.sync(() => {
            expect(openRouterCredential.credential).toBe("test-openrouter-key");
            expect(authorizationUrl?.hostname).toBe("openrouter.ai");
            expect(exchangedCode).toBe("authorization-code");
            expect(exchangedVerifier).toBeDefined();
          }),
        ),
      );
    },
  );

  it.effect("falls back only before the first streamed output", () => {
    const providerManifests = freeProviderCatalog.filter(
      (providerManifest) => providerManifest.providerId === "groq" || providerManifest.providerId === "cerebras",
    );
    return completeFreeChat({
      routingRequest,
      dependencies: {
        providerManifests,
        credentialLookup: () => Effect.succeed(Option.some("test-key")),
        routingState,
        providerExchange: ({ providerManifest, modelId }) =>
          providerManifest.providerId === "groq"
            ? Stream.fail(
                new ProviderFailure({ providerId: providerManifest.providerId, modelId, failureClass: "upstream" }),
              )
            : Stream.fromIterable([{ _tag: "text" as const, text: "hello" }, { _tag: "completed" as const }]),
      },
    }).pipe(
      Effect.tap((streamEvents) =>
        Effect.sync(() => expect([...streamEvents]).toEqual([{ _tag: "text", text: "hello" }, { _tag: "completed" }])),
      ),
    );
  });

  it("classifies status failures and decodes every supported chunk family", () => {
    expect(classifyUpstreamFailure(401)).toBe("authentication");
    expect(classifyUpstreamFailure(429)).toBe("quota");
    expect(decodeOpenAiStreamChunk({ choices: [{ delta: { content: "hi" } }] }).right).toEqual({
      _tag: "text",
      text: "hi",
    });
    expect(decodeAnthropicStreamChunk({ type: "content_block_delta", delta: { text: "hi" } }).right).toEqual({
      _tag: "text",
      text: "hi",
    });
    expect(decodeGoogleStreamChunk({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }).right).toEqual({
      _tag: "text",
      text: "hi",
    });
  });
});
