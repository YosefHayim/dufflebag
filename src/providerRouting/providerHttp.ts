import { Effect, Either, Option, Schema, type ParseResult as SchemaParseIssue, Stream } from "effect";

import {
  type ChatRequest,
  type ModelId,
  ProviderFailure,
  type ProviderManifest,
  type StreamEvent,
} from "./providerContract.js";

const openAiStreamChunkSchema = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      delta: Schema.Struct({
        content: Schema.optional(Schema.String),
        reasoning_content: Schema.optional(Schema.String),
      }),
    }),
  ),
});

const anthropicStreamChunkSchema = Schema.Struct({
  type: Schema.String,
  delta: Schema.optional(
    Schema.Struct({ text: Schema.optional(Schema.String), thinking: Schema.optional(Schema.String) }),
  ),
});

const googleStreamChunkSchema = Schema.Struct({
  candidates: Schema.Array(
    Schema.Struct({
      content: Schema.Struct({ parts: Schema.Array(Schema.Struct({ text: Schema.optional(Schema.String) })) }),
    }),
  ),
});

const encodeTurns = (chatRequest: ChatRequest) =>
  chatRequest.turns.map((chatTurn) => ({ role: chatTurn.role, content: chatTurn.text }));

export const encodeOpenAiChatRequest = (chatRequest: ChatRequest, modelId: string) => ({
  model: modelId,
  stream: true,
  messages: encodeTurns(chatRequest),
});

export const encodeOpenAiResponsesRequest = (chatRequest: ChatRequest, modelId: string) => ({
  model: modelId,
  stream: true,
  input: encodeTurns(chatRequest),
});

export const encodeAnthropicRequest = (chatRequest: ChatRequest, modelId: string) => ({
  model: modelId,
  stream: true,
  max_tokens: chatRequest.maximumOutputTokens,
  messages: encodeTurns(chatRequest),
});

export const encodeGoogleGenerativeRequest = (chatRequest: ChatRequest) => ({
  contents: chatRequest.turns.map((chatTurn) => ({ role: chatTurn.role, parts: [{ text: chatTurn.text }] })),
});

const openRouterFailure = (request: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  failureClass: ProviderFailure["failureClass"];
  statusCode?: number;
}) =>
  new ProviderFailure({
    providerId: request.providerManifest.providerId,
    modelId: request.modelId,
    failureClass: request.failureClass,
    statusCode: request.statusCode,
  });

export const decodeOpenAiStreamChunk = (wireChunk: unknown): Either.Either<StreamEvent, SchemaParseIssue.ParseError> =>
  Either.map(Schema.decodeUnknownEither(openAiStreamChunkSchema)(wireChunk), (openAiChunk) => {
    const firstChoice = openAiChunk.choices[0];
    if (firstChoice === undefined || firstChoice.delta.content === undefined) {
      return firstChoice?.delta.reasoning_content === undefined
        ? { _tag: "completed" as const }
        : { _tag: "reasoning" as const, text: firstChoice.delta.reasoning_content };
    }
    return { _tag: "text" as const, text: firstChoice.delta.content };
  });

export const decodeAnthropicStreamChunk = (
  wireChunk: unknown,
): Either.Either<StreamEvent, SchemaParseIssue.ParseError> =>
  Either.map(Schema.decodeUnknownEither(anthropicStreamChunkSchema)(wireChunk), (anthropicChunk) => {
    if (anthropicChunk.delta?.text !== undefined) {
      return { _tag: "text" as const, text: anthropicChunk.delta.text };
    }
    return anthropicChunk.delta?.thinking === undefined
      ? { _tag: "completed" as const }
      : { _tag: "reasoning" as const, text: anthropicChunk.delta.thinking };
  });

export const decodeGoogleStreamChunk = (wireChunk: unknown): Either.Either<StreamEvent, SchemaParseIssue.ParseError> =>
  Either.map(Schema.decodeUnknownEither(googleStreamChunkSchema)(wireChunk), (googleChunk) => {
    const firstCandidate = googleChunk.candidates[0];
    const firstPart = firstCandidate?.content.parts[0];
    return firstPart?.text === undefined
      ? { _tag: "completed" as const }
      : { _tag: "text" as const, text: firstPart.text };
  });

export const classifyUpstreamFailure = (statusCode: number): "authentication" | "quota" | "upstream" => {
  if (statusCode === 401 || statusCode === 403) {
    return "authentication";
  }
  return statusCode === 429 ? "quota" : "upstream";
};

const decodeOpenRouterStreamLine = (request: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  streamLine: string;
}): Effect.Effect<StreamEvent, ProviderFailure> => {
  if (request.streamLine === "[DONE]") {
    return Effect.succeed({ _tag: "completed" });
  }
  return Effect.try({
    try: () => {
      const upstreamChunk: unknown = JSON.parse(request.streamLine);
      return upstreamChunk;
    },
    catch: () =>
      openRouterFailure({
        providerManifest: request.providerManifest,
        modelId: request.modelId,
        failureClass: "upstream",
      }),
  }).pipe(
    Effect.flatMap((upstreamChunk) =>
      Either.match(decodeOpenAiStreamChunk(upstreamChunk), {
        onLeft: () =>
          Effect.fail(
            openRouterFailure({
              providerManifest: request.providerManifest,
              modelId: request.modelId,
              failureClass: "upstream",
            }),
          ),
        onRight: Effect.succeed,
      }),
    ),
  );
};

const streamOpenRouterReply = (request: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  upstreamStream: ReadableStream<Uint8Array>;
}): Stream.Stream<StreamEvent, ProviderFailure> =>
  Stream.fromAsyncIterable(request.upstreamStream, () =>
    openRouterFailure({
      providerManifest: request.providerManifest,
      modelId: request.modelId,
      failureClass: "upstream",
    }),
  ).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((streamLine) => streamLine.startsWith("data: ")),
    Stream.map((streamLine) => streamLine.slice("data: ".length).trim()),
    Stream.filter((streamLine) => streamLine !== ""),
    Stream.mapEffect((streamLine) =>
      decodeOpenRouterStreamLine({
        providerManifest: request.providerManifest,
        modelId: request.modelId,
        streamLine,
      }),
    ),
  );

export const exchangeOpenRouterChat = (invocation: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  credential: Option.Option<string>;
  chatRequest: ChatRequest;
}): Stream.Stream<StreamEvent, ProviderFailure> => {
  const credential = Option.getOrUndefined(invocation.credential);
  if (invocation.providerManifest.providerId !== "openrouter" || credential === undefined) {
    return Stream.fail(
      openRouterFailure({
        providerManifest: invocation.providerManifest,
        modelId: invocation.modelId,
        failureClass: "configuration",
      }),
    );
  }
  return Stream.unwrap(
    Effect.tryPromise({
      try: () =>
        fetch(invocation.providerManifest.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(encodeOpenAiChatRequest(invocation.chatRequest, invocation.modelId)),
        }),
      catch: () =>
        openRouterFailure({
          providerManifest: invocation.providerManifest,
          modelId: invocation.modelId,
          failureClass: "upstream",
        }),
    }).pipe(
      Effect.flatMap((upstreamReply) => {
        if (!upstreamReply.ok) {
          return Effect.fail(
            openRouterFailure({
              providerManifest: invocation.providerManifest,
              modelId: invocation.modelId,
              failureClass: classifyUpstreamFailure(upstreamReply.status),
              statusCode: upstreamReply.status,
            }),
          );
        }
        if (upstreamReply.body === null) {
          return Effect.fail(
            openRouterFailure({
              providerManifest: invocation.providerManifest,
              modelId: invocation.modelId,
              failureClass: "upstream",
              statusCode: upstreamReply.status,
            }),
          );
        }
        return Effect.succeed(
          streamOpenRouterReply({
            providerManifest: invocation.providerManifest,
            modelId: invocation.modelId,
            upstreamStream: upstreamReply.body,
          }),
        );
      }),
    ),
  );
};
