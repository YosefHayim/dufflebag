import { expect, it } from "@effect/vitest";
import { Effect, Either, Option, Schema, Stream } from "effect";
import { afterEach, describe, vi } from "vitest";

import { freeProviderCatalog } from "./freeProviderCatalog.js";
import { chatRequestSchema, type ProviderManifest, providerManifestSchema } from "./providerContract.js";
import { sendChat } from "./providerHttp.js";

const chatRequest = Schema.decodeUnknownSync(chatRequestSchema)({
  turns: [{ role: "user", text: "Say hi" }],
  requiredCapabilities: ["text"],
});

const testManifest = (declaration: { providerId: string; protocolFamily: string; endpoint: string; modelId: string }) =>
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
  });

const sendTo = (providerManifest: ProviderManifest, credential: Option.Option<string>) =>
  Stream.runCollect(
    sendChat({ providerManifest, modelId: providerManifest.models[0].modelId, credential, chatRequest }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider HTTP", () => {
  it.effect("uses the official AI Horde anonymous credential and GitHub API headers", () => {
    const observedHeaders: Array<Headers> = [];
    vi.stubGlobal("fetch", async (_endpoint: string, requestInit?: RequestInit) => {
      observedHeaders.push(new Headers(requestInit?.headers));
      return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    });
    const providerManifests = freeProviderCatalog.filter(
      (providerManifest) =>
        providerManifest.providerId === "aihorde" || providerManifest.providerId === "github-models",
    );
    return Effect.forEach(providerManifests, (providerManifest) =>
      sendTo(
        providerManifest,
        providerManifest.providerId === "github-models" ? Option.some("github-model-key") : Option.none(),
      ),
    ).pipe(
      Effect.tap(() => {
        const withAuthorization = (authorization: string) =>
          observedHeaders.find((providerHeaders) => providerHeaders.get("authorization") === authorization);
        const githubHeaders = withAuthorization("Bearer github-model-key");
        expect(withAuthorization("Bearer 0000000000")).toBeDefined();
        expect(githubHeaders?.get("accept")).toBe("application/vnd.github+json");
        expect(githubHeaders?.get("x-github-api-version")).toBe("2026-03-10");
      }),
    );
  });

  it.effect("streams text, reasoning, tools, usage, and completion across every wire family", () => {
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
    vi.stubGlobal("fetch", async (endpoint: string | URL, requestInit?: RequestInit) => {
      const endpointUrl = new URL(endpoint.toString());
      const streamText = streamTextByPath.get(endpointUrl.pathname);
      if (streamText === undefined) return new Response(null, { status: 404 });
      invocations.push({
        endpoint: endpointUrl.toString(),
        headers: new Headers(requestInit?.headers),
        requestText: typeof requestInit?.body === "string" ? requestInit.body : "",
        abortSignal: requestInit?.signal,
      });
      return new Response(streamText, { headers: { "content-type": "text/event-stream" } });
    });
    const declaredManifests = [
      ["chat-test", "openai-chat", "https://chat.example/chat/completions", "chat-model"],
      ["responses-test", "openai-responses", "https://responses.example/responses", "responses-model"],
      ["anthropic-test", "anthropic-messages", "https://anthropic.example/messages", "claude-test"],
      ["google-test", "google-generative", "https://google.example/v1beta", "gemini-test"],
    ].map(([providerId, protocolFamily, endpoint, modelId]) =>
      testManifest({ providerId, protocolFamily, endpoint, modelId }),
    );

    return Effect.forEach(declaredManifests, (providerManifest) =>
      sendTo(providerManifest, Option.some("wire-family-key")),
    ).pipe(
      Effect.tap((wireFamilyEvents) => {
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
    );
  });

  it.effect("maps authentication, quota, and upstream HTTP failures into tagged provider errors", () => {
    const providerManifest = testManifest({
      providerId: "failure-test",
      protocolFamily: "openai-chat",
      endpoint: "https://failure.example/chat/completions",
      modelId: "failure-model",
    });
    return Effect.forEach([401, 403, 429, 503], (statusCode) =>
      Effect.sync(() => vi.stubGlobal("fetch", async () => new Response(null, { status: statusCode }))).pipe(
        Effect.flatMap(() => sendTo(providerManifest, Option.some("failure-key"))),
        Effect.either,
      ),
    ).pipe(
      Effect.tap((failures) => {
        expect(failures.map((failure) => (Either.isLeft(failure) ? failure.left.failureClass : "success"))).toEqual([
          "authentication",
          "authentication",
          "quota",
          "upstream",
        ]);
      }),
    );
  });

  it.effect("classifies an aborted provider request as cancelled", () => {
    const providerManifest = freeProviderCatalog.find((candidate) => candidate.providerId === "openrouter");
    if (providerManifest === undefined) return Effect.die("The OpenRouter manifest is required for cancellation.");
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The request was aborted.", "AbortError");
    });
    return sendTo(providerManifest, Option.some("failure-key")).pipe(
      Effect.either,
      Effect.tap((cancelledAttempt) => {
        expect(Either.isLeft(cancelledAttempt) && cancelledAttempt.left.failureClass).toBe("cancelled");
      }),
    );
  });
});
