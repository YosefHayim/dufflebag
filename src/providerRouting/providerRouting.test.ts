import { expect, it } from "@effect/vitest";
import { Effect, Either, Option, Schema, Stream } from "effect";
import { beforeEach, describe } from "vitest";

import {
  acknowledgementVersion,
  documentedFreePoolCount,
  documentedRecurringTokenEstimate,
  freePoolSnapshot,
  freeProviderCatalog,
} from "./freeProviderCatalog.js";
import { connectOpenRouter } from "./openRouterOAuth.js";
import {
  documentedFreePoolSchema,
  healthRecordSchema,
  openRouterKeyExchangeSchema,
  openRouterOAuthRequestSchema,
  ProviderFailure,
  providerManifestSchema,
  routingRequestSchema,
} from "./providerContract.js";
import {
  estimatedRemainingQuota,
  providerCircuitIsOpen,
  providerIsCoolingDown,
  quotaWindowIsExpired,
} from "./providerHealth.js";
import {
  classifyUpstreamFailure,
  decodeAnthropicStreamChunk,
  decodeGoogleStreamChunk,
  decodeOpenAiResponsesStreamChunk,
  decodeOpenAiStreamChunk,
  exchangeProviderChat,
} from "./providerHttp.js";
import { completeFreeChat, inspectProviderHealth, listFreeModels, listFreeProviders } from "./providerRouting.js";

const decodeRoutingRequest = Schema.decodeUnknownSync(routingRequestSchema);

const routingRequest = decodeRoutingRequest({
  target: "auto-free",
  chatRequest: { turns: [{ role: "user", text: "Say hi" }], requiredCapabilities: ["text"] },
  acknowledgementVersion,
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

beforeEach(() => {
  storedHealth.clear();
});

describe("provider routing", () => {
  it("keeps the attributed snapshot pool-deduped and identity-unique", () => {
    expect(documentedFreePoolCount).toBe(43);
    expect(documentedRecurringTokenEstimate).toBe(1_526_225_000);
    expect(new Set(freePoolSnapshot.map((freePool) => freePool.poolId)).size).toBe(43);
    expect(new Set(freePoolSnapshot.map((freePool) => freePool.providerId)).size).toBe(43);
    expect(new Set(freePoolSnapshot.map((freePool) => `${freePool.providerId}/${freePool.modelId}`)).size).toBe(43);
  });

  it("exposes only officially active free providers and models", () => {
    expect(listFreeProviders()).toHaveLength(5);
    expect(listFreeModels()).toHaveLength(5);
  });

  it("rejects malformed manifests and routing declarations at the boundary", () => {
    expect(() => Schema.decodeUnknownSync(providerManifestSchema)({ providerId: "", models: [] })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(documentedFreePoolSchema)({
        poolId: "pool",
        providerId: "provider",
        modelId: "model",
        freeType: "recurring-daily",
        estimatedMonthlyTokens: -1,
        termsStatus: "ok",
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(documentedFreePoolSchema)({
        poolId: "pool",
        providerId: "provider",
        modelId: "model",
        freeType: "recurring-daily",
        estimatedMonthlyTokens: 1.5,
        termsStatus: "ok",
      }),
    ).toThrow();
    expect(() => Schema.decodeUnknownSync(routingRequestSchema)({ target: "auto-free" })).toThrow();
    expect(() => Schema.decodeUnknownSync(openRouterOAuthRequestSchema)({ callbackPort: 80 })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(openRouterKeyExchangeSchema)({ credential: "not-an-openrouter-key" }),
    ).toThrow();
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

  it.effect("uses the built-in OpenRouter exchange when auto-free has its saved credential", () => {
    const openRouterManifest = freeProviderCatalog.filter(
      (providerManifest) => providerManifest.providerId === "openrouter",
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('data: {"choices":[{"delta":{"content":"unified"}}]}\n\ndata: [DONE]\n\n', {
        headers: { "content-type": "text/event-stream" },
      });
    return completeFreeChat({
      routingRequest,
      dependencies: {
        providerManifests: openRouterManifest,
        credentialLookup: () => Effect.succeed(Option.some("saved-openrouter-key")),
        routingState,
      },
    }).pipe(
      Effect.tap((streamEvents) =>
        Effect.sync(() =>
          expect([...streamEvents]).toEqual([{ _tag: "text", text: "unified" }, { _tag: "completed" }]),
        ),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          globalThis.fetch = originalFetch;
        }),
      ),
    );
  });

  it("classifies status failures and decodes every supported chunk family", () => {
    expect(classifyUpstreamFailure(401)).toBe("authentication");
    expect(classifyUpstreamFailure(429)).toBe("quota");
    expect(decodeOpenAiStreamChunk({ choices: [{ delta: { content: "hi" } }] }).right).toEqual([
      { _tag: "text", text: "hi" },
    ]);
    expect(decodeAnthropicStreamChunk({ type: "content_block_delta", delta: { text: "hi" } }).right).toEqual([
      { _tag: "text", text: "hi" },
    ]);
    expect(decodeGoogleStreamChunk({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }).right).toEqual([
      { _tag: "text", text: "hi" },
    ]);
    expect(decodeOpenAiResponsesStreamChunk({ type: "response.output_text.delta", delta: "hi" }).right).toEqual([
      { _tag: "text", text: "hi" },
    ]);
    expect(decodeOpenAiResponsesStreamChunk({ type: "response.created" }).right).toEqual([]);
    expect(Either.isLeft(decodeOpenAiStreamChunk({ choices: "malformed" }))).toBe(true);
    expect(Either.isLeft(decodeAnthropicStreamChunk({ type: 42 }))).toBe(true);
    expect(Either.isLeft(decodeGoogleStreamChunk({ candidates: [{ content: {} }] }))).toBe(true);
  });

  it.effect("streams text, reasoning, tools, usage, and completion across every wire family", () => {
    const originalFetch = globalThis.fetch;
    const invocations: Array<{
      endpoint: string;
      headers: Headers;
      requestText: string;
      abortSignal: AbortSignal | null | undefined;
    }> = [];
    const streamTextByPath = new Map([
      [
        "/chat/completions",
        [
          'data: {"choices":[{"delta":{"content":"chat"}}]}',
          'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"lookup","arguments":"{\\"city\\":"}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Haifa\\"}"}}]}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          'data: {"usage":{"prompt_tokens":3,"completion_tokens":4}}',
          "data: [DONE]",
        ].join("\n\n"),
      ],
      [
        "/responses",
        [
          'data: {"type":"response.output_text.delta","delta":"responses"}',
          'data: {"type":"response.reasoning_summary_text.delta","delta":"reason"}',
          'data: {"type":"response.function_call_arguments.done","name":"search","arguments":"{}"}',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":6}}}',
        ].join("\n\n"),
      ],
      [
        "/messages",
        [
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"anthropic"}}',
          'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"reason"}}',
          'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
          'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","name":"weather","input":{}}}',
          'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"Haifa\\"}"}}',
          'data: {"type":"content_block_stop","index":1}',
          'data: {"type":"message_delta","usage":{"output_tokens":7}}',
          'data: {"type":"message_stop"}',
        ].join("\n\n"),
      ],
      [
        "/v1beta/models/gemini-test:streamGenerateContent",
        [
          'data: {"candidates":[{"content":{"parts":[{"text":"google"}]}}]}',
          'data: {"candidates":[{"content":{"parts":[{"text":"reason","thought":true}]}}]}',
          'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"maps","args":{"city":"Tel Aviv"}}}]}}]}',
          'data: {"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":9}}',
          'data: {"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}',
        ].join("\n\n"),
      ],
    ]);
    globalThis.fetch = async (endpoint, requestInit) => {
      const endpointUrl = new URL(endpoint.toString());
      const streamText = streamTextByPath.get(endpointUrl.pathname);
      if (streamText === undefined) {
        return new Response(null, { status: 404 });
      }
      invocations.push({
        endpoint: endpointUrl.toString(),
        headers: new Headers(requestInit?.headers),
        requestText: typeof requestInit?.body === "string" ? requestInit.body : "",
        abortSignal: requestInit?.signal,
      });
      return new Response(streamText, { headers: { "content-type": "text/event-stream" } });
    };

    const declaredManifests = [
      {
        providerId: "chat-test",
        protocolFamily: "openai-chat",
        endpoint: "https://chat.example/chat/completions",
        modelId: "chat-model",
      },
      {
        providerId: "responses-test",
        protocolFamily: "openai-responses",
        endpoint: "https://responses.example/responses",
        modelId: "responses-model",
      },
      {
        providerId: "anthropic-test",
        protocolFamily: "anthropic-messages",
        endpoint: "https://anthropic.example/messages",
        modelId: "claude-test",
      },
      {
        providerId: "google-test",
        protocolFamily: "google-generative",
        endpoint: "https://google.example/v1beta",
        modelId: "gemini-test",
      },
    ].map((declaration) =>
      Schema.decodeUnknownSync(providerManifestSchema)({
        providerId: declaration.providerId,
        displayName: declaration.providerId,
        protocolFamily: declaration.protocolFamily,
        endpoint: declaration.endpoint,
        authentication: "api-key",
        credentialId: `${declaration.providerId}-credential`,
        termsStatus: "ok",
        activation: "active",
        freeTierWindow: { poolId: `${declaration.providerId}-pool`, reset: "unquantified", estimatedTokens: 0 },
        models: [{ modelId: declaration.modelId, capabilities: ["text", "reasoning", "tools"] }],
        source: "https://example.com/provider-contract",
      }),
    );

    return Effect.forEach(declaredManifests, (providerManifest) => {
      const modelCapability = providerManifest.models.find(() => true);
      if (modelCapability === undefined) {
        return Effect.die("Decoded provider manifest had no model capability.");
      }
      return Stream.runCollect(
        exchangeProviderChat({
          providerManifest,
          modelId: modelCapability.modelId,
          credential: Option.some("wire-family-key"),
          chatRequest: routingRequest.chatRequest,
        }),
      );
    }).pipe(
      Effect.tap((wireFamilyEvents) =>
        Effect.sync(() => {
          expect(wireFamilyEvents.map((streamEvents) => Array.from(streamEvents).map((event) => event._tag))).toEqual([
            ["text", "reasoning", "tool", "usage", "completed"],
            ["text", "reasoning", "tool", "usage", "completed"],
            ["text", "reasoning", "usage", "tool", "usage", "completed"],
            ["text", "reasoning", "tool", "usage", "completed"],
          ]);
          const openAiTool = Array.from(wireFamilyEvents[0]).find((streamEvent) => streamEvent._tag === "tool");
          const anthropicTool = Array.from(wireFamilyEvents[2]).find((streamEvent) => streamEvent._tag === "tool");
          expect(openAiTool).toEqual({ _tag: "tool", name: "lookup", argumentsText: '{"city":"Haifa"}' });
          expect(anthropicTool).toEqual({ _tag: "tool", name: "weather", argumentsText: '{"city":"Haifa"}' });
          expect(invocations[0]?.headers.get("authorization")).toBe("Bearer wire-family-key");
          expect(invocations[2]?.headers.get("x-api-key")).toBe("wire-family-key");
          expect(invocations[2]?.headers.get("anthropic-version")).toBe("2023-06-01");
          expect(invocations[3]?.headers.get("x-goog-api-key")).toBe("wire-family-key");
          expect(invocations[3]?.endpoint).toContain("alt=sse");
          expect(invocations.every((invocation) => invocation.abortSignal instanceof AbortSignal)).toBe(true);
          expect(invocations[0]?.requestText).toContain('"model":"chat-model"');
          expect(invocations[3]?.requestText).not.toContain('"model"');
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          globalThis.fetch = originalFetch;
        }),
      ),
    );
  });

  it.effect("maps authentication, quota, and upstream HTTP failures into tagged provider failures", () => {
    const originalFetch = globalThis.fetch;
    const providerManifest = Schema.decodeUnknownSync(providerManifestSchema)({
      providerId: "failure-test",
      displayName: "Failure test",
      protocolFamily: "openai-chat",
      endpoint: "https://failure.example/chat/completions",
      authentication: "api-key",
      credentialId: "failure-test-key",
      termsStatus: "ok",
      activation: "active",
      freeTierWindow: { poolId: "failure-test-pool", reset: "unquantified", estimatedTokens: 0 },
      models: [{ modelId: "failure-model", capabilities: ["text"] }],
      source: "https://example.com/provider-contract",
    });
    const statusCodes = [401, 429, 503];
    const failureModel = providerManifest.models.find(() => true);
    if (failureModel === undefined) {
      return Effect.die("Decoded failure manifest had no model capability.");
    }
    return Effect.forEach(statusCodes, (statusCode) => {
      return Effect.sync(() => {
        globalThis.fetch = async () => new Response(null, { status: statusCode });
      }).pipe(
        Effect.flatMap(() =>
          Stream.runCollect(
            exchangeProviderChat({
              providerManifest,
              modelId: failureModel.modelId,
              credential: Option.some("failure-key"),
              chatRequest: routingRequest.chatRequest,
            }),
          ),
        ),
        Effect.either,
      );
    }).pipe(
      Effect.tap((failures) =>
        Effect.sync(() => {
          expect(failures.map((failure) => (Either.isLeft(failure) ? failure.left.failureClass : "success"))).toEqual([
            "authentication",
            "quota",
            "upstream",
          ]);
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          globalThis.fetch = originalFetch;
        }),
      ),
    );
  });

  it.effect("classifies an aborted provider request as cancelled", () => {
    const originalFetch = globalThis.fetch;
    const providerManifest = freeProviderCatalog.find(
      (candidateManifest) => candidateManifest.providerId === "openrouter",
    );
    if (providerManifest === undefined) return Effect.die("The OpenRouter manifest is required for cancellation.");
    const modelCapability = providerManifest.models.find(() => true);
    if (modelCapability === undefined) return Effect.die("The OpenRouter model is required for cancellation.");
    return Effect.sync(() => {
      globalThis.fetch = async () => {
        throw new DOMException("The request was aborted.", "AbortError");
      };
    }).pipe(
      Effect.flatMap(() =>
        Stream.runCollect(
          exchangeProviderChat({
            providerManifest,
            modelId: modelCapability.modelId,
            credential: Option.some("failure-key"),
            chatRequest: routingRequest.chatRequest,
          }),
        ),
      ),
      Effect.either,
      Effect.tap((cancelledAttempt) =>
        Effect.sync(() => {
          expect(Either.isLeft(cancelledAttempt)).toBe(true);
          if (Either.isLeft(cancelledAttempt)) expect(cancelledAttempt.left.failureClass).toBe("cancelled");
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          globalThis.fetch = originalFetch;
        }),
      ),
    );
  });

  it("resets daily quota and expires cooldown and circuit windows", () => {
    const providerManifest = freeProviderCatalog.find(
      (candidateManifest) => candidateManifest.providerId === "cerebras",
    );
    if (providerManifest === undefined) {
      throw new Error("The active Cerebras declaration is required for quota policy tests.");
    }
    const exhaustedHealth = Schema.decodeUnknownSync(healthRecordSchema)({
      providerId: "cerebras",
      modelId: "zai-glm-4.7",
      observedAt: "2026-08-10T00:00:00.000Z",
      cooldownUntil: "2026-08-10T00:01:00.000Z",
      circuitUntil: "2026-08-10T00:05:00.000Z",
      quotaUsedTokens: 30_000_000,
      quotaWindowStartedAt: "2026-08-09T00:00:00.000Z",
      successfulCalls: 1,
      failedCalls: 3,
      latencyMilliseconds: 120,
    });
    const observedAt = Schema.decodeUnknownSync(Schema.DateTimeUtc)("2026-08-10T00:05:01.000Z");

    expect(quotaWindowIsExpired({ providerManifest, healthRecord: exhaustedHealth, observedAt })).toBe(true);
    expect(estimatedRemainingQuota({ providerManifest, healthRecord: exhaustedHealth, observedAt })).toBe(1_000_000);
    expect(providerIsCoolingDown(exhaustedHealth, observedAt)).toBe(false);
    expect(providerCircuitIsOpen(exhaustedHealth, observedAt)).toBe(false);

    const monthlyManifest = freeProviderCatalog.find((candidateManifest) => candidateManifest.providerId === "mistral");
    if (monthlyManifest === undefined) throw new Error("The active Mistral declaration is required for quota tests.");
    const monthlyModel = monthlyManifest.models.find(() => true);
    if (monthlyModel === undefined) throw new Error("The active Mistral model is required for quota tests.");
    const januaryHealth = {
      ...exhaustedHealth,
      providerId: monthlyManifest.providerId,
      modelId: monthlyModel.modelId,
      quotaWindowStartedAt: Schema.decodeUnknownSync(Schema.DateTimeUtc)("2026-01-31T23:59:00.000Z"),
    };
    const february = Schema.decodeUnknownSync(Schema.DateTimeUtc)("2026-02-01T00:00:00.000Z");
    expect(
      quotaWindowIsExpired({ providerManifest: monthlyManifest, healthRecord: januaryHealth, observedAt: february }),
    ).toBe(true);
  });

  it.effect("persists only restart-safe health counters after a completed stream", () => {
    const providerManifests = freeProviderCatalog.filter((providerManifest) => providerManifest.providerId === "groq");
    const credential = "credential-must-not-persist";
    const privatePrompt = "prompt-must-not-persist";
    const privateRoutingRequest = decodeRoutingRequest({
      target: "auto-free",
      chatRequest: { turns: [{ role: "user", text: privatePrompt }], requiredCapabilities: ["text"] },
      acknowledgementVersion,
      observedAt: "2026-08-10T00:00:00.000Z",
    });
    return completeFreeChat({
      routingRequest: privateRoutingRequest,
      dependencies: {
        providerManifests,
        credentialLookup: () => Effect.succeed(Option.some(credential)),
        routingState,
        providerExchange: () =>
          Stream.fromIterable([
            { _tag: "text" as const, text: "reply-must-not-persist" },
            { _tag: "usage" as const, inputTokens: 11, outputTokens: 0 },
            { _tag: "usage" as const, inputTokens: 0, outputTokens: 7 },
            { _tag: "completed" as const },
          ]),
      },
    }).pipe(
      Effect.flatMap(() => {
        const persistedHealth = [...storedHealth.values()].find(() => true);
        if (persistedHealth === undefined) {
          return Effect.die("A completed provider stream did not persist health.");
        }
        const persistedText = JSON.stringify(persistedHealth);
        const restartedHealth = new Map([
          [`${persistedHealth.providerId}/${persistedHealth.modelId}`, persistedHealth],
        ]);
        return inspectProviderHealth({
          providerId: persistedHealth.providerId,
          modelId: persistedHealth.modelId,
          routingState: {
            readHealth: ({ providerId, modelId }) =>
              Effect.succeed(Option.fromNullable(restartedHealth.get(`${providerId}/${modelId}`))),
            writeHealth: () => Effect.void,
          },
        }).pipe(
          Effect.tap((healthOption) =>
            Effect.sync(() => {
              expect(persistedText).not.toContain(privatePrompt);
              expect(persistedText).not.toContain("reply-must-not-persist");
              expect(persistedText).not.toContain(credential);
              expect(Option.getOrUndefined(healthOption)?.quotaUsedTokens).toBe(18);
              expect(Option.getOrUndefined(healthOption)?.successfulCalls).toBe(1);
            }),
          ),
        );
      }),
    );
  });
});
