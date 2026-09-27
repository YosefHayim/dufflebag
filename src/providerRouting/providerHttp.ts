import { Effect, Option, Stream } from "effect";

import { decodeStreamLine, emptyStreamState, encodeChatRequest } from "./chatFormats.js";
import {
  type ChatRequest,
  type ModelId,
  ProviderError,
  type ProviderManifest,
  type StreamEvent,
} from "./providerContract.js";

type ChatInvocation = {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  credential: Option.Option<string>;
  chatRequest: ChatRequest;
};

// Classifies by status alone; provider error prose is never read.
export const classifyUpstreamFailure = (statusCode: number): "authentication" | "quota" | "upstream" => {
  if (statusCode === 401 || statusCode === 403) return "authentication";
  return statusCode === 429 ? "quota" : "upstream";
};

const providerEndpoint = (invocation: ChatInvocation): URL => {
  const endpoint = new URL(invocation.providerManifest.endpoint);
  if (invocation.providerManifest.protocolFamily !== "google-generative") return endpoint;
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/models/${encodeURIComponent(invocation.modelId)}:streamGenerateContent`;
  endpoint.searchParams.set("alt", "sse");
  return endpoint;
};

const openAiProviderHeaders = new Map<string, Record<string, string>>([
  ["github-models", { accept: "application/vnd.github+json", "x-github-api-version": "2026-03-10" }],
  ["api-airforce", { "http-referer": "https://github.com/YosefHayim/dufflebag", "x-title": "Dufflebag" }],
]);

const providerHeaders = (request: {
  providerManifest: ProviderManifest;
  credential: string | undefined;
}): HeadersInit => {
  const commonHeaders = { "content-type": "application/json", "user-agent": "ys-dufflebag/0.14" };
  const { providerId, protocolFamily } = request.providerManifest;
  switch (protocolFamily) {
    case "anthropic-messages":
      if (request.credential === undefined) return commonHeaders;
      return { ...commonHeaders, "anthropic-version": "2023-06-01", "x-api-key": request.credential };
    case "google-generative":
      if (request.credential === undefined) return commonHeaders;
      return { ...commonHeaders, "x-goog-api-key": request.credential };
    case "openai-chat":
    case "openai-responses": {
      // AI Horde documents ten zeros as its anonymous API key.
      const credential =
        request.credential === undefined && providerId === "aihorde" ? "0000000000" : request.credential;
      return {
        ...commonHeaders,
        ...(credential === undefined ? {} : { authorization: `Bearer ${credential}` }),
        ...openAiProviderHeaders.get(providerId),
      };
    }
  }
};

const streamProviderReply = (request: {
  protocolFamily: ProviderManifest["protocolFamily"];
  upstreamStream: ReadableStream<Uint8Array>;
  upstreamFailure: () => ProviderError;
}): Stream.Stream<StreamEvent, ProviderError> =>
  Stream.fromReadableStream(() => request.upstreamStream, request.upstreamFailure).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((streamLine) => streamLine.startsWith("data:")),
    Stream.map((streamLine) => streamLine.slice("data:".length).trim()),
    Stream.filter((streamLine) => streamLine !== ""),
    Stream.mapAccumEffect(emptyStreamState, (streamState, streamLine) =>
      Option.match(decodeStreamLine({ protocolFamily: request.protocolFamily, streamLine, streamState }), {
        onNone: () => Effect.fail(request.upstreamFailure()),
        onSome: Effect.succeed,
      }),
    ),
    Stream.mapConcat((streamEvents) => streamEvents),
  );

export const sendChat = (invocation: ChatInvocation): Stream.Stream<StreamEvent, ProviderError> => {
  const { providerManifest, modelId } = invocation;
  const failure = (failureClass: ProviderError["failureClass"], statusCode?: number) =>
    new ProviderError({ providerId: providerManifest.providerId, modelId, failureClass, statusCode });
  const credential = Option.getOrUndefined(invocation.credential);
  const requestTimeout = providerManifest.providerId === "aihorde" ? "120 seconds" : "60 seconds";
  if (providerManifest.authentication === "api-key" && credential === undefined) {
    return Stream.fail(failure("configuration"));
  }
  return Stream.unwrap(
    Effect.tryPromise({
      try: (abortSignal) =>
        fetch(providerEndpoint(invocation), {
          method: "POST",
          headers: providerHeaders({ providerManifest, credential }),
          body: JSON.stringify(encodeChatRequest(invocation)),
          signal: abortSignal,
        }),
      catch: (fetchFailure) =>
        failure(fetchFailure instanceof DOMException && fetchFailure.name === "AbortError" ? "cancelled" : "upstream"),
    }).pipe(
      Effect.timeoutFail({ duration: requestTimeout, onTimeout: () => failure("cancelled") }),
      Effect.flatMap((upstreamReply) => {
        if (!upstreamReply.ok) {
          return Effect.fail(failure(classifyUpstreamFailure(upstreamReply.status), upstreamReply.status));
        }
        if (upstreamReply.body === null) return Effect.fail(failure("upstream", upstreamReply.status));
        return Effect.succeed(
          streamProviderReply({
            protocolFamily: providerManifest.protocolFamily,
            upstreamStream: upstreamReply.body,
            upstreamFailure: () => failure("upstream"),
          }).pipe(Stream.timeoutFail(() => failure("cancelled"), requestTimeout)),
        );
      }),
    ),
  );
};
