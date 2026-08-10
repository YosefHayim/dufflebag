import { Either, Schema, type ParseResult as SchemaParseIssue } from "effect";

import type { ChatRequest, StreamEvent } from "./providerContract.js";

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
