import { Either, Option, Schema, type ParseResult as SchemaParseIssue } from "effect";

import type { ChatRequest, ModelId, ProviderManifest, StreamEvent } from "./providerContract.js";

type ProtocolFamily = ProviderManifest["protocolFamily"];

const usageSchema = Schema.Struct({
  prompt_tokens: Schema.optional(Schema.NonNegative),
  completion_tokens: Schema.optional(Schema.NonNegative),
  input_tokens: Schema.optional(Schema.NonNegative),
  output_tokens: Schema.optional(Schema.NonNegative),
});

const openAiStreamChunkSchema = Schema.Struct({
  choices: Schema.optional(
    Schema.Array(
      Schema.Struct({
        delta: Schema.optional(
          Schema.Struct({
            content: Schema.optional(Schema.String),
            reasoning_content: Schema.optional(Schema.String),
            tool_calls: Schema.optional(
              Schema.Array(
                Schema.Struct({
                  index: Schema.NonNegativeInt,
                  function: Schema.optional(
                    Schema.Struct({
                      name: Schema.optional(Schema.String),
                      arguments: Schema.optional(Schema.String),
                    }),
                  ),
                }),
              ),
            ),
          }),
        ),
        finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  usage: Schema.optional(usageSchema),
});

const openAiResponsesStreamChunkSchema = Schema.Struct({
  type: Schema.String,
  delta: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  arguments: Schema.optional(Schema.String),
  response: Schema.optional(Schema.Struct({ usage: Schema.optional(usageSchema) })),
});

const anthropicStreamChunkSchema = Schema.Struct({
  type: Schema.String,
  index: Schema.optional(Schema.NonNegativeInt),
  content_block: Schema.optional(
    Schema.Struct({
      type: Schema.String,
      name: Schema.optional(Schema.String),
      input: Schema.optional(Schema.Unknown),
    }),
  ),
  delta: Schema.optional(
    Schema.Struct({
      type: Schema.optional(Schema.String),
      text: Schema.optional(Schema.String),
      thinking: Schema.optional(Schema.String),
      partial_json: Schema.optional(Schema.String),
    }),
  ),
  message: Schema.optional(Schema.Struct({ usage: Schema.optional(usageSchema) })),
  usage: Schema.optional(usageSchema),
});

const googleStreamChunkSchema = Schema.Struct({
  candidates: Schema.optional(
    Schema.Array(
      Schema.Struct({
        content: Schema.Struct({
          parts: Schema.Array(
            Schema.Struct({
              text: Schema.optional(Schema.String),
              thought: Schema.optional(Schema.Boolean),
              functionCall: Schema.optional(
                Schema.Struct({ name: Schema.NonEmptyTrimmedString, args: Schema.optional(Schema.Unknown) }),
              ),
            }),
          ),
        }),
        finishReason: Schema.optional(Schema.String),
      }),
    ),
  ),
  usageMetadata: Schema.optional(
    Schema.Struct({
      promptTokenCount: Schema.optional(Schema.NonNegative),
      candidatesTokenCount: Schema.optional(Schema.NonNegative),
    }),
  ),
});

type OpenAiStreamChunk = Schema.Schema.Type<typeof openAiStreamChunkSchema>;
type OpenAiResponsesStreamChunk = Schema.Schema.Type<typeof openAiResponsesStreamChunkSchema>;
type AnthropicStreamChunk = Schema.Schema.Type<typeof anthropicStreamChunkSchema>;
type GoogleStreamChunk = Schema.Schema.Type<typeof googleStreamChunkSchema>;

const decodeOpenAiChunk = Schema.decodeUnknownEither(openAiStreamChunkSchema);
const decodeOpenAiResponsesChunk = Schema.decodeUnknownEither(openAiResponsesStreamChunkSchema);
const decodeAnthropicChunk = Schema.decodeUnknownEither(anthropicStreamChunkSchema);
const decodeGoogleChunk = Schema.decodeUnknownEither(googleStreamChunkSchema);

const openAiTurns = (chatRequest: ChatRequest) =>
  chatRequest.turns.map((chatTurn) => ({ role: chatTurn.role, content: chatTurn.text }));

const conversationTurns = (chatRequest: ChatRequest) =>
  chatRequest.turns.filter((chatTurn) => chatTurn.role !== "system");

const joinSystemText = (chatRequest: ChatRequest): string | undefined => {
  const systemText = chatRequest.turns
    .filter((chatTurn) => chatTurn.role === "system")
    .map((chatTurn) => chatTurn.text)
    .join("\n\n");
  return systemText === "" ? undefined : systemText;
};

export const encodeOpenAiChatRequest = (chatRequest: ChatRequest, modelId: string) => ({
  model: modelId,
  stream: true,
  stream_options: { include_usage: true },
  max_tokens: chatRequest.maximumOutputTokens,
  messages: openAiTurns(chatRequest),
});

export const encodeOpenAiResponsesRequest = (chatRequest: ChatRequest, modelId: string) => ({
  model: modelId,
  stream: true,
  max_output_tokens: chatRequest.maximumOutputTokens,
  input: openAiTurns(chatRequest),
});

export const encodeAnthropicRequest = (chatRequest: ChatRequest, modelId: string) => ({
  model: modelId,
  stream: true,
  max_tokens: chatRequest.maximumOutputTokens === undefined ? 1024 : chatRequest.maximumOutputTokens,
  system: joinSystemText(chatRequest),
  messages: conversationTurns(chatRequest).map((chatTurn) => ({
    role: chatTurn.role === "assistant" ? "assistant" : "user",
    content: chatTurn.text,
  })),
});

// Google names the model in the URL path, not the request.
export const encodeGoogleGenerativeRequest = (chatRequest: ChatRequest) => {
  const systemText = joinSystemText(chatRequest);
  return {
    systemInstruction: systemText === undefined ? undefined : { parts: [{ text: systemText }] },
    generationConfig: { maxOutputTokens: chatRequest.maximumOutputTokens },
    contents: conversationTurns(chatRequest).map((chatTurn) => ({
      role: chatTurn.role === "assistant" ? "model" : "user",
      parts: [{ text: chatTurn.text }],
    })),
  };
};

export const encodeChatRequest = (invocation: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  chatRequest: ChatRequest;
}) => {
  switch (invocation.providerManifest.protocolFamily) {
    case "openai-chat":
      return encodeOpenAiChatRequest(invocation.chatRequest, invocation.modelId);
    case "openai-responses":
      return encodeOpenAiResponsesRequest(invocation.chatRequest, invocation.modelId);
    case "anthropic-messages":
      return encodeAnthropicRequest(invocation.chatRequest, invocation.modelId);
    case "google-generative":
      return encodeGoogleGenerativeRequest(invocation.chatRequest);
  }
};

const completedEvent: StreamEvent = { _tag: "completed" };

const usageEvents = (usage: { inputTokens: number | undefined; outputTokens: number | undefined } | undefined) =>
  usage === undefined
    ? []
    : [
        {
          _tag: "usage" as const,
          inputTokens: usage.inputTokens === undefined ? 0 : usage.inputTokens,
          outputTokens: usage.outputTokens === undefined ? 0 : usage.outputTokens,
        },
      ];

const stringifyToolArguments = (toolArguments: unknown): string => {
  const encodedArguments = JSON.stringify(toolArguments);
  return encodedArguments === undefined ? "" : encodedArguments;
};

const openAiChunkEvents = (chunk: OpenAiStreamChunk): ReadonlyArray<StreamEvent> => {
  const usage = chunk.usage;
  return [
    ...(chunk.choices === undefined ? [] : chunk.choices).flatMap((choice): ReadonlyArray<StreamEvent> => {
      const delta = choice.delta;
      if (delta?.content !== undefined) return [{ _tag: "text", text: delta.content }];
      if (delta?.reasoning_content !== undefined) return [{ _tag: "reasoning", text: delta.reasoning_content }];
      return [];
    }),
    ...usageEvents(usage && { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }),
  ];
};

const openAiResponsesChunkEvents = (chunk: OpenAiResponsesStreamChunk): ReadonlyArray<StreamEvent> => {
  if (chunk.type === "response.output_text.delta" && chunk.delta !== undefined) {
    return [{ _tag: "text", text: chunk.delta }];
  }
  if (chunk.type === "response.reasoning_summary_text.delta" && chunk.delta !== undefined) {
    return [{ _tag: "reasoning", text: chunk.delta }];
  }
  if (chunk.type === "response.function_call_arguments.done" && chunk.name !== undefined) {
    return [{ _tag: "tool", name: chunk.name, argumentsText: chunk.arguments === undefined ? "" : chunk.arguments }];
  }
  if (chunk.type !== "response.completed") return [];
  const usage = chunk.response?.usage;
  return [
    ...usageEvents(usage && { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }),
    completedEvent,
  ];
};

const anthropicChunkEvents = (chunk: AnthropicStreamChunk): ReadonlyArray<StreamEvent> => {
  if (chunk.delta?.text !== undefined) return [{ _tag: "text", text: chunk.delta.text }];
  if (chunk.delta?.thinking !== undefined) return [{ _tag: "reasoning", text: chunk.delta.thinking }];
  // message_start carries usage inside the message; message_delta carries it at the top level.
  const usage = chunk.message?.usage === undefined ? chunk.usage : chunk.message.usage;
  if (usage !== undefined) return usageEvents({ inputTokens: usage.input_tokens, outputTokens: usage.output_tokens });
  return chunk.type === "message_stop" ? [completedEvent] : [];
};

const googleChunkEvents = (chunk: GoogleStreamChunk): ReadonlyArray<StreamEvent> => {
  const candidates = chunk.candidates === undefined ? [] : chunk.candidates;
  const usage = chunk.usageMetadata;
  return [
    ...candidates.flatMap((candidate) =>
      candidate.content.parts.flatMap((part): ReadonlyArray<StreamEvent> => {
        if (part.functionCall !== undefined) {
          return [
            {
              _tag: "tool",
              name: part.functionCall.name,
              argumentsText: stringifyToolArguments(part.functionCall.args),
            },
          ];
        }
        if (part.text === undefined) return [];
        return [{ _tag: part.thought === true ? "reasoning" : "text", text: part.text }];
      }),
    ),
    ...usageEvents(usage && { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount }),
    ...(candidates.some((candidate) => candidate.finishReason !== undefined) ? [completedEvent] : []),
  ];
};

export const decodeOpenAiStreamChunk = (wireChunk: unknown) =>
  Either.map(decodeOpenAiChunk(wireChunk), openAiChunkEvents);

export const decodeOpenAiResponsesStreamChunk = (wireChunk: unknown) =>
  Either.map(decodeOpenAiResponsesChunk(wireChunk), openAiResponsesChunkEvents);

export const decodeAnthropicStreamChunk = (wireChunk: unknown) =>
  Either.map(decodeAnthropicChunk(wireChunk), anthropicChunkEvents);

export const decodeGoogleStreamChunk = (wireChunk: unknown) =>
  Either.map(decodeGoogleChunk(wireChunk), googleChunkEvents);

// OpenAI and Anthropic stream a tool call in fragments; they are buffered until the call is finished.
type PendingToolCall = {
  index: number;
  name: string | undefined;
  argumentsText: string;
};

type StreamState = ReadonlyArray<PendingToolCall>;

type StreamStep = readonly [StreamState, ReadonlyArray<StreamEvent>];

export const emptyStreamState: StreamState = [];

const mergeToolCall = (pendingToolCalls: StreamState, fragment: PendingToolCall): StreamState => {
  const prior = pendingToolCalls.find((toolCall) => toolCall.index === fragment.index);
  return [
    ...pendingToolCalls.filter((toolCall) => toolCall.index !== fragment.index),
    {
      index: fragment.index,
      name: fragment.name === undefined ? prior?.name : fragment.name,
      argumentsText: `${prior === undefined ? "" : prior.argumentsText}${fragment.argumentsText}`,
    },
  ];
};

const toolEvents = (pendingToolCalls: StreamState): ReadonlyArray<StreamEvent> =>
  pendingToolCalls.flatMap(
    (toolCall): ReadonlyArray<StreamEvent> =>
      toolCall.name === undefined ? [] : [{ _tag: "tool", name: toolCall.name, argumentsText: toolCall.argumentsText }],
  );

const openAiStep = (pendingToolCalls: StreamState, chunk: OpenAiStreamChunk): StreamStep => {
  const choices = chunk.choices === undefined ? [] : chunk.choices;
  const streamEvents = openAiChunkEvents(chunk);
  const bufferedToolCalls = choices
    .flatMap((choice) => (choice.delta?.tool_calls === undefined ? [] : choice.delta.tool_calls))
    .map((toolCall) => ({
      index: toolCall.index,
      name: toolCall.function?.name,
      argumentsText: toolCall.function?.arguments === undefined ? "" : toolCall.function.arguments,
    }))
    .reduce(mergeToolCall, pendingToolCalls);
  const finished = choices.some((choice) => choice.finish_reason !== undefined && choice.finish_reason !== null);
  if (!finished) return [bufferedToolCalls, streamEvents];
  return [emptyStreamState, [...streamEvents, ...toolEvents(bufferedToolCalls)]];
};

const initialAnthropicArguments = (toolInput: unknown): string => {
  const encodedArguments = stringifyToolArguments(toolInput);
  return encodedArguments === "{}" ? "" : encodedArguments;
};

const anthropicStep = (pendingToolCalls: StreamState, chunk: AnthropicStreamChunk): StreamStep => {
  const streamEvents = anthropicChunkEvents(chunk);
  const index = chunk.index === undefined ? 0 : chunk.index;
  const contentBlock = chunk.content_block;
  if (contentBlock?.type === "tool_use" && contentBlock.name !== undefined) {
    const fragment = { index, name: contentBlock.name, argumentsText: initialAnthropicArguments(contentBlock.input) };
    return [mergeToolCall(pendingToolCalls, fragment), streamEvents];
  }
  if (chunk.delta?.partial_json !== undefined) {
    const fragment = { index, name: undefined, argumentsText: chunk.delta.partial_json };
    return [mergeToolCall(pendingToolCalls, fragment), streamEvents];
  }
  const stoppedToolCall = pendingToolCalls.filter((toolCall) => toolCall.index === index);
  if (chunk.type === "content_block_stop" && stoppedToolCall.length > 0) {
    return [
      pendingToolCalls.filter((toolCall) => toolCall.index !== index),
      [...streamEvents, ...toolEvents(stoppedToolCall)],
    ];
  }
  if (chunk.type !== "message_stop") return [pendingToolCalls, streamEvents];
  return [
    emptyStreamState,
    [
      ...streamEvents.filter((streamEvent) => streamEvent._tag !== "completed"),
      ...toolEvents(pendingToolCalls),
      completedEvent,
    ],
  ];
};

const decodeWireChunk = (request: {
  protocolFamily: ProtocolFamily;
  streamState: StreamState;
  wireChunk: unknown;
}): Either.Either<StreamStep, SchemaParseIssue.ParseError> => {
  const withState = (streamEvents: ReadonlyArray<StreamEvent>): StreamStep => [request.streamState, streamEvents];
  switch (request.protocolFamily) {
    case "openai-chat":
      return Either.map(decodeOpenAiChunk(request.wireChunk), (chunk) => openAiStep(request.streamState, chunk));
    case "openai-responses":
      return Either.map(decodeOpenAiResponsesStreamChunk(request.wireChunk), withState);
    case "anthropic-messages":
      return Either.map(decodeAnthropicChunk(request.wireChunk), (chunk) => anthropicStep(request.streamState, chunk));
    case "google-generative":
      return Either.map(decodeGoogleStreamChunk(request.wireChunk), withState);
  }
};

const parseWireChunk = Option.liftThrowable((streamLine: string): unknown => JSON.parse(streamLine));

// Decodes one SSE `data:` line (prefix already removed); none means the line is not valid for the family.
export const decodeStreamLine = (request: {
  protocolFamily: ProtocolFamily;
  streamLine: string;
  streamState: StreamState;
}): Option.Option<StreamStep> => {
  if (request.streamLine === "[DONE]") {
    return Option.some([emptyStreamState, [...toolEvents(request.streamState), completedEvent]]);
  }
  return parseWireChunk(request.streamLine).pipe(
    Option.flatMap((wireChunk) => Either.getRight(decodeWireChunk({ ...request, wireChunk }))),
  );
};
