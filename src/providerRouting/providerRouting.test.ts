import { expect, it } from "@effect/vitest";
import { Effect, Either, Option, Schema, Stream } from "effect";
import { afterEach, beforeEach, describe, vi } from "vitest";

import { acknowledgementVersion, freePoolSnapshot, freeProviderCatalog } from "./freeProviderCatalog.js";
import { type HealthRecord, ProviderError, routingRequestSchema } from "./providerContract.js";
import { askFreeChat, type HealthStore, listFreeModels, listFreeProviders } from "./providerRouting.js";

const routingRequestFor = (request: { target: unknown; prompt: string }) =>
  Schema.decodeUnknownSync(routingRequestSchema)({
    target: request.target,
    chatRequest: { turns: [{ role: "user", text: request.prompt }], requiredCapabilities: ["text"] },
    acknowledgementVersion,
    observedAt: "2026-08-10T00:00:00.000Z",
  });

const routingRequest = routingRequestFor({ target: "auto-free", prompt: "Say hi" });

const catalogManifest = (providerId: string) => {
  const providerManifest = freeProviderCatalog.find((candidate) => candidate.providerId === providerId);
  if (providerManifest === undefined) throw new Error(`The ${providerId} manifest is required for routing tests.`);
  return providerManifest;
};

const withTestKey = () => Effect.succeed(Option.some("test-key"));

const storedHealth = new Map<string, HealthRecord>();

const healthStore: HealthStore = {
  readHealth: ({ providerId, modelId }) =>
    Effect.succeed(Option.fromNullable(storedHealth.get(`${providerId}/${modelId}`))),
  writeHealth: (healthRecord) =>
    Effect.sync(() => {
      storedHealth.set(`${healthRecord.providerId}/${healthRecord.modelId}`, healthRecord);
    }),
};

beforeEach(() => {
  storedHealth.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider routing", () => {
  it.effect("exposes only officially active free providers and models", () =>
    Effect.gen(function* () {
      const providerManifests = yield* listFreeProviders();
      const freeModels = yield* listFreeModels();
      expect(freeProviderCatalog).toHaveLength(43);
      expect(providerManifests).toHaveLength(30);
      expect(freeModels).toHaveLength(30);
      expect(new Set(freeProviderCatalog.map((providerManifest) => providerManifest.providerId)).size).toBe(43);
      expect(new Set(freeProviderCatalog.map((providerManifest) => providerManifest.freeTierWindow.poolId)).size).toBe(
        43,
      );
      expect(new Set(freeProviderCatalog.map((providerManifest) => providerManifest.providerId))).toEqual(
        new Set(freePoolSnapshot.map((freePool) => freePool.providerId)),
      );
      expect(
        freeProviderCatalog
          .filter((providerManifest) => providerManifest.activation === "unavailable")
          .every((providerManifest) => providerManifest.unavailableReason !== undefined),
      ).toBe(true);
    }),
  );

  it.effect("falls back only before the first streamed output", () => {
    const invokedProviders: Array<string> = [];
    return askFreeChat({
      routingRequest,
      dependencies: {
        providerManifests: [catalogManifest("groq"), catalogManifest("cerebras")],
        credentialLookup: withTestKey,
        healthStore,
        sendChat: ({ providerManifest, modelId }) => {
          invokedProviders.push(providerManifest.providerId);
          return providerManifest.providerId === "groq"
            ? Stream.fail(
                new ProviderError({ providerId: providerManifest.providerId, modelId, failureClass: "upstream" }),
              )
            : Stream.fromIterable([{ _tag: "text" as const, text: "hello" }, { _tag: "completed" as const }]);
        },
      },
    }).pipe(
      Effect.tap((streamEvents) => {
        expect([...streamEvents]).toEqual([{ _tag: "text", text: "hello" }, { _tag: "completed" }]);
        expect(invokedProviders).toEqual(["groq", "cerebras"]);
      }),
    );
  });

  it.effect("does not cross providers after a usage event is streamed", () => {
    const invokedProviders: Array<string> = [];
    return askFreeChat({
      routingRequest,
      dependencies: {
        providerManifests: [catalogManifest("groq"), catalogManifest("cerebras")],
        credentialLookup: withTestKey,
        healthStore,
        sendChat: ({ providerManifest, modelId }) => {
          invokedProviders.push(providerManifest.providerId);
          return Stream.fromIterable([{ _tag: "usage" as const, inputTokens: 1, outputTokens: 0 }]).pipe(
            Stream.concat(
              Stream.fail(
                new ProviderError({ providerId: providerManifest.providerId, modelId, failureClass: "upstream" }),
              ),
            ),
          );
        },
      },
    }).pipe(
      Effect.either,
      Effect.tap((attempt) => {
        expect(Either.isLeft(attempt)).toBe(true);
        expect(invokedProviders).toEqual(["groq"]);
      }),
    );
  });

  it.effect("keeps explicit provider selection deterministic and surfaces its original failure", () => {
    const providerManifest = catalogManifest("groq");
    const explicitRequest = routingRequestFor({
      target: { providerId: providerManifest.providerId, modelId: providerManifest.models[0].modelId },
      prompt: "Say hi",
    });
    return askFreeChat({
      routingRequest: explicitRequest,
      dependencies: {
        providerManifests: [providerManifest],
        credentialLookup: withTestKey,
        healthStore,
        sendChat: ({ providerManifest: selectedManifest, modelId }) =>
          Stream.fail(
            new ProviderError({
              providerId: selectedManifest.providerId,
              modelId,
              failureClass: "upstream",
              statusCode: 503,
            }),
          ),
      },
    }).pipe(
      Effect.flip,
      Effect.tap((failure) => {
        expect(failure).toMatchObject({
          _tag: "ProviderError",
          providerId: "groq",
          failureClass: "upstream",
          statusCode: 503,
        });
      }),
    );
  });

  it.effect("sends through the built-in HTTP chat when auto-free has the saved OpenRouter credential", () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response('data: {"choices":[{"delta":{"content":"unified"}}]}\n\ndata: [DONE]\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    return askFreeChat({
      routingRequest,
      dependencies: {
        providerManifests: [catalogManifest("openrouter")],
        credentialLookup: () => Effect.succeed(Option.some("saved-openrouter-key")),
        healthStore,
      },
    }).pipe(
      Effect.tap((streamEvents) => {
        expect([...streamEvents]).toEqual([{ _tag: "text", text: "unified" }, { _tag: "completed" }]);
      }),
    );
  });

  it.effect("persists only restart-safe health counters after a completed stream", () => {
    const credential = "credential-must-not-persist";
    const privatePrompt = "prompt-must-not-persist";
    return askFreeChat({
      routingRequest: routingRequestFor({ target: "auto-free", prompt: privatePrompt }),
      dependencies: {
        providerManifests: [catalogManifest("groq")],
        credentialLookup: () => Effect.succeed(Option.some(credential)),
        healthStore,
        sendChat: () =>
          Stream.fromIterable([
            { _tag: "text" as const, text: "reply-must-not-persist" },
            { _tag: "usage" as const, inputTokens: 11, outputTokens: 0 },
            { _tag: "usage" as const, inputTokens: 0, outputTokens: 7 },
            { _tag: "completed" as const },
          ]),
      },
    }).pipe(
      Effect.tap(() => {
        const persistedHealth = [...storedHealth.values()].find(() => true);
        const persistedText = JSON.stringify(persistedHealth);
        expect(persistedText).not.toContain(privatePrompt);
        expect(persistedText).not.toContain("reply-must-not-persist");
        expect(persistedText).not.toContain(credential);
        expect(persistedHealth?.quotaUsedTokens).toBe(18);
        expect(persistedHealth?.successfulCalls).toBe(1);
      }),
    );
  });
});
