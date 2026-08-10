import { Effect, Either, Option, Schema, type ParseResult as SchemaParseIssue, Stream } from "effect";

import {
  type ChatRequest,
  type ModelId,
  ProviderFailure,
  type ProviderManifest,
  type StreamEvent,
} from "./providerContract.js";

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

const encodeOpenAiTurns = (chatRequest: ChatRequest) =>
  chatRequest.turns.map((chatTurn) => ({ role: chatTurn.role, content: chatTurn.text }));

const encodeAnthropicTurns = (chatRequest: ChatRequest) =>
  chatRequest.turns
    .filter((chatTurn) => chatTurn.role !== "system")
    .map((chatTurn) => ({
      role: chatTurn.role === "assistant" ? "assistant" : "user",
      content: chatTurn.text,
    }));

const joinSystemText = (chatRequest: ChatRequest): string | undefined => {
  const systemText = chatRequest.turns
    .filter((chatTurn) => chatTurn.role === "system")
    .map((chatTurn) => chatTurn.text)
    .join("\n\n");
  return systemText === "" ? undefined : systemText;
};

const encodeGoogleRole = (role: ChatRequest["turns"][number]["role"]): "user" | "model" =>
  role === "assistant" ? "model" : "user";

/**
 * Encodes a provider-neutral chat request for the OpenAI Chat wire family.
 * @param chatRequest - Validated conversation turns and output constraints.
 * @param modelId - Upstream model identity.
 * @returns The OpenAI Chat request object.
 */
export const encodeOpenAiChatRequest = (chatRequest: ChatRequest, modelId: string) => ({
  model: modelId,
  stream: true,
  stream_options: { include_usage: true },
  max_tokens: chatRequest.maximumOutputTokens,
  messages: encodeOpenAiTurns(chatRequest),
});

/**
 * Encodes a provider-neutral chat request for the OpenAI Responses wire family.
 * @param chatRequest - Validated conversation turns and output constraints.
 * @param modelId - Upstream model identity.
 * @returns The OpenAI Responses request object.
 */
export const encodeOpenAiResponsesRequest = (chatRequest: ChatRequest, modelId: string) => ({
  model: modelId,
  stream: true,
  max_output_tokens: chatRequest.maximumOutputTokens,
  input: encodeOpenAiTurns(chatRequest),
});

/**
 * Encodes a provider-neutral chat request for Anthropic Messages.
 * @param chatRequest - Validated conversation turns and output constraints.
 * @param modelId - Upstream model identity.
 * @returns The Anthropic Messages request object.
 */
export const encodeAnthropicRequest = (chatRequest: ChatRequest, modelId: string) => ({
  model: modelId,
  stream: true,
  max_tokens: chatRequest.maximumOutputTokens === undefined ? 1024 : chatRequest.maximumOutputTokens,
  system: joinSystemText(chatRequest),
  messages: encodeAnthropicTurns(chatRequest),
});

/**
 * Encodes a provider-neutral chat request for Google Generative AI.
 * @param chatRequest - Validated conversation turns and output constraints.
 * @returns The Google GenerateContent request object.
 */
export const encodeGoogleGenerativeRequest = (chatRequest: ChatRequest) => {
  const systemText = joinSystemText(chatRequest);
  return {
    systemInstruction: systemText === undefined ? undefined : { parts: [{ text: systemText }] },
    generationConfig: {
      maxOutputTokens: chatRequest.maximumOutputTokens,
    },
    contents: chatRequest.turns
      .filter((chatTurn) => chatTurn.role !== "system")
      .map((chatTurn) => ({ role: encodeGoogleRole(chatTurn.role), parts: [{ text: chatTurn.text }] })),
  };
};

const providerFailure = (request: {
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

const usageEvent = (request: { inputTokens: number | undefined; outputTokens: number | undefined }): StreamEvent => ({
  _tag: "usage",
  inputTokens: request.inputTokens === undefined ? 0 : request.inputTokens,
  outputTokens: request.outputTokens === undefined ? 0 : request.outputTokens,
});

const stringifyToolArguments = (toolArguments: unknown): string => {
  const encodedArguments = JSON.stringify(toolArguments);
  return encodedArguments === undefined ? "" : encodedArguments;
};

const decodeOpenAiStreamEvents = (
  wireChunk: unknown,
): Either.Either<ReadonlyArray<StreamEvent>, SchemaParseIssue.ParseError> =>
  Either.map(
    Schema.decodeUnknownEither(openAiStreamChunkSchema)(wireChunk),
    (openAiChunk): ReadonlyArray<StreamEvent> => {
      const choiceEvents = (openAiChunk.choices === undefined ? [] : openAiChunk.choices).flatMap(
        (choice): ReadonlyArray<StreamEvent> => {
          if (choice.delta?.content !== undefined) {
            return [{ _tag: "text" as const, text: choice.delta.content }];
          }
          if (choice.delta?.reasoning_content !== undefined) {
            return [{ _tag: "reasoning" as const, text: choice.delta.reasoning_content }];
          }
          return [];
        },
      );
      const usageEvents =
        openAiChunk.usage === undefined
          ? []
          : [
              usageEvent({
                inputTokens: openAiChunk.usage.prompt_tokens,
                outputTokens: openAiChunk.usage.completion_tokens,
              }),
            ];
      return [...choiceEvents, ...usageEvents];
    },
  );

const decodeOpenAiResponsesStreamEvents = (
  wireChunk: unknown,
): Either.Either<ReadonlyArray<StreamEvent>, SchemaParseIssue.ParseError> =>
  Either.map(
    Schema.decodeUnknownEither(openAiResponsesStreamChunkSchema)(wireChunk),
    (openAiChunk): ReadonlyArray<StreamEvent> => {
      if (openAiChunk.type === "response.output_text.delta" && openAiChunk.delta !== undefined) {
        return [{ _tag: "text" as const, text: openAiChunk.delta }];
      }
      if (openAiChunk.type === "response.reasoning_summary_text.delta" && openAiChunk.delta !== undefined) {
        return [{ _tag: "reasoning" as const, text: openAiChunk.delta }];
      }
      if (openAiChunk.type === "response.function_call_arguments.done" && openAiChunk.name !== undefined) {
        return [
          {
            _tag: "tool" as const,
            name: openAiChunk.name,
            argumentsText: openAiChunk.arguments === undefined ? "" : openAiChunk.arguments,
          },
        ];
      }
      if (openAiChunk.type !== "response.completed") {
        return [];
      }
      const completedUsage = openAiChunk.response?.usage;
      if (completedUsage === undefined) {
        return [{ _tag: "completed" as const }];
      }
      return [
        usageEvent({ inputTokens: completedUsage.input_tokens, outputTokens: completedUsage.output_tokens }),
        { _tag: "completed" as const },
      ];
    },
  );

const decodeAnthropicStreamEvents = (
  wireChunk: unknown,
): Either.Either<ReadonlyArray<StreamEvent>, SchemaParseIssue.ParseError> =>
  Either.map(
    Schema.decodeUnknownEither(anthropicStreamChunkSchema)(wireChunk),
    (anthropicChunk): ReadonlyArray<StreamEvent> => {
      if (anthropicChunk.delta?.text !== undefined) {
        return [{ _tag: "text" as const, text: anthropicChunk.delta.text }];
      }
      if (anthropicChunk.delta?.thinking !== undefined) {
        return [{ _tag: "reasoning" as const, text: anthropicChunk.delta.thinking }];
      }
      const messageUsage = anthropicChunk.message?.usage;
      if (messageUsage !== undefined) {
        return [usageEvent({ inputTokens: messageUsage.input_tokens, outputTokens: messageUsage.output_tokens })];
      }
      if (anthropicChunk.usage !== undefined) {
        return [
          usageEvent({
            inputTokens: anthropicChunk.usage.input_tokens,
            outputTokens: anthropicChunk.usage.output_tokens,
          }),
        ];
      }
      return anthropicChunk.type === "message_stop" ? [{ _tag: "completed" as const }] : [];
    },
  );

const decodeGoogleStreamEvents = (
  wireChunk: unknown,
): Either.Either<ReadonlyArray<StreamEvent>, SchemaParseIssue.ParseError> =>
  Either.map(
    Schema.decodeUnknownEither(googleStreamChunkSchema)(wireChunk),
    (googleChunk): ReadonlyArray<StreamEvent> => {
      const candidates = googleChunk.candidates === undefined ? [] : googleChunk.candidates;
      const contentEvents = candidates.flatMap((candidate) =>
        candidate.content.parts.flatMap((part): ReadonlyArray<StreamEvent> => {
          if (part.functionCall !== undefined) {
            return [
              {
                _tag: "tool" as const,
                name: part.functionCall.name,
                argumentsText: stringifyToolArguments(part.functionCall.args),
              },
            ];
          }
          if (part.text !== undefined && part.thought === true) {
            return [{ _tag: "reasoning" as const, text: part.text }];
          }
          return part.text === undefined ? [] : [{ _tag: "text" as const, text: part.text }];
        }),
      );
      const usageEvents =
        googleChunk.usageMetadata === undefined
          ? []
          : [
              usageEvent({
                inputTokens: googleChunk.usageMetadata.promptTokenCount,
                outputTokens: googleChunk.usageMetadata.candidatesTokenCount,
              }),
            ];
      const completionEvents = candidates.some((candidate) => candidate.finishReason !== undefined)
        ? [{ _tag: "completed" as const }]
        : [];
      return [...contentEvents, ...usageEvents, ...completionEvents];
    },
  );

type ToolCallBuffer = {
  index: number;
  name: string | undefined;
  argumentsText: string;
};

type ProviderStreamState = {
  openAiToolCalls: ReadonlyArray<ToolCallBuffer>;
  anthropicToolCalls: ReadonlyArray<ToolCallBuffer>;
};

const emptyProviderStreamState: ProviderStreamState = {
  openAiToolCalls: [],
  anthropicToolCalls: [],
};

const mergeToolCallBuffer = (
  toolCalls: ReadonlyArray<ToolCallBuffer>,
  fragment: ToolCallBuffer,
): ReadonlyArray<ToolCallBuffer> => {
  const priorToolCall = toolCalls.find((toolCall) => toolCall.index === fragment.index);
  const name = fragment.name === undefined ? priorToolCall?.name : fragment.name;
  const argumentsText = `${priorToolCall === undefined ? "" : priorToolCall.argumentsText}${fragment.argumentsText}`;
  return [...toolCalls.filter((toolCall) => toolCall.index !== fragment.index), { ...fragment, name, argumentsText }];
};

const toolEvents = (toolCalls: ReadonlyArray<ToolCallBuffer>): ReadonlyArray<StreamEvent> =>
  toolCalls.flatMap((toolCall): ReadonlyArray<StreamEvent> => {
    if (toolCall.name === undefined) return [];
    return [{ _tag: "tool", name: toolCall.name, argumentsText: toolCall.argumentsText }];
  });

const withoutCompleted = (streamEvents: ReadonlyArray<StreamEvent>): ReadonlyArray<StreamEvent> =>
  streamEvents.filter((streamEvent) => streamEvent._tag !== "completed");

const decodeOpenAiStatefulEvents = (
  state: ProviderStreamState,
  wireChunk: unknown,
): Either.Either<readonly [ProviderStreamState, ReadonlyArray<StreamEvent>], SchemaParseIssue.ParseError> =>
  Either.flatMap(Schema.decodeUnknownEither(openAiStreamChunkSchema)(wireChunk), (openAiChunk) =>
    Either.map(decodeOpenAiStreamEvents(wireChunk), (streamEvents) => {
      const bufferedToolCalls = (openAiChunk.choices === undefined ? [] : openAiChunk.choices).reduce(
        (knownToolCalls, choice) =>
          (choice.delta?.tool_calls === undefined ? [] : choice.delta.tool_calls).reduce(
            (updatedToolCalls, toolCall) => {
              return mergeToolCallBuffer(updatedToolCalls, {
                index: toolCall.index,
                name: toolCall.function?.name,
                argumentsText: toolCall.function?.arguments === undefined ? "" : toolCall.function.arguments,
              });
            },
            knownToolCalls,
          ),
        state.openAiToolCalls,
      );
      const toolCallsFinished = (openAiChunk.choices === undefined ? [] : openAiChunk.choices).some(
        (choice) => choice.finish_reason !== undefined && choice.finish_reason !== null,
      );
      if (!toolCallsFinished) {
        return [{ ...state, openAiToolCalls: bufferedToolCalls }, streamEvents];
      }
      return [{ ...state, openAiToolCalls: [] }, [...streamEvents, ...toolEvents(bufferedToolCalls)]];
    }),
  );

const initialAnthropicArguments = (toolInput: unknown): string => {
  const encodedArguments = stringifyToolArguments(toolInput);
  return encodedArguments === "{}" ? "" : encodedArguments;
};

const decodeAnthropicStatefulEvents = (
  state: ProviderStreamState,
  wireChunk: unknown,
): Either.Either<readonly [ProviderStreamState, ReadonlyArray<StreamEvent>], SchemaParseIssue.ParseError> =>
  Either.flatMap(Schema.decodeUnknownEither(anthropicStreamChunkSchema)(wireChunk), (anthropicChunk) =>
    Either.map(decodeAnthropicStreamEvents(wireChunk), (streamEvents) => {
      const index = anthropicChunk.index === undefined ? 0 : anthropicChunk.index;
      const contentBlock = anthropicChunk.content_block;
      if (contentBlock?.type === "tool_use" && contentBlock.name !== undefined) {
        const anthropicToolCalls = mergeToolCallBuffer(state.anthropicToolCalls, {
          index,
          name: contentBlock.name,
          argumentsText: initialAnthropicArguments(contentBlock.input),
        });
        return [{ ...state, anthropicToolCalls }, streamEvents];
      }
      if (anthropicChunk.delta?.partial_json !== undefined) {
        const anthropicToolCalls = mergeToolCallBuffer(state.anthropicToolCalls, {
          index,
          name: undefined,
          argumentsText: anthropicChunk.delta.partial_json,
        });
        return [{ ...state, anthropicToolCalls }, streamEvents];
      }
      const stoppedToolCall = state.anthropicToolCalls.filter((toolCall) => toolCall.index === index);
      if (anthropicChunk.type === "content_block_stop" && stoppedToolCall.length > 0) {
        return [
          {
            ...state,
            anthropicToolCalls: state.anthropicToolCalls.filter((toolCall) => toolCall.index !== index),
          },
          [...streamEvents, ...toolEvents(stoppedToolCall)],
        ];
      }
      if (anthropicChunk.type !== "message_stop") return [state, streamEvents];
      return [
        { ...state, anthropicToolCalls: [] },
        [...withoutCompleted(streamEvents), ...toolEvents(state.anthropicToolCalls), { _tag: "completed" }],
      ];
    }),
  );

const decodeStatelessProviderEvents = (
  state: ProviderStreamState,
  decodedEvents: Either.Either<ReadonlyArray<StreamEvent>, SchemaParseIssue.ParseError>,
): Either.Either<readonly [ProviderStreamState, ReadonlyArray<StreamEvent>], SchemaParseIssue.ParseError> =>
  Either.map(decodedEvents, (streamEvents) => [state, streamEvents]);

/**
 * Decodes one OpenAI Chat SSE chunk into provider-neutral vocabulary.
 * @param wireChunk - Untrusted JSON parsed from an SSE line.
 * @returns Either zero or more stream events, or a Schema parse failure.
 */
export const decodeOpenAiStreamChunk = decodeOpenAiStreamEvents;

/**
 * Decodes one OpenAI Responses SSE chunk into provider-neutral vocabulary.
 * @param wireChunk - Untrusted JSON parsed from an SSE line.
 * @returns Either zero or more stream events, or a Schema parse failure.
 */
export const decodeOpenAiResponsesStreamChunk = (
  wireChunk: unknown,
): Either.Either<ReadonlyArray<StreamEvent>, SchemaParseIssue.ParseError> =>
  decodeOpenAiResponsesStreamEvents(wireChunk);

/**
 * Decodes one Anthropic Messages SSE chunk into provider-neutral vocabulary.
 * @param wireChunk - Untrusted JSON parsed from an SSE line.
 * @returns Either zero or more stream events, or a Schema parse failure.
 */
export const decodeAnthropicStreamChunk = (
  wireChunk: unknown,
): Either.Either<ReadonlyArray<StreamEvent>, SchemaParseIssue.ParseError> => decodeAnthropicStreamEvents(wireChunk);

/**
 * Decodes one Google Generative AI SSE chunk into provider-neutral vocabulary.
 * @param wireChunk - Untrusted JSON parsed from an SSE line.
 * @returns Either zero or more stream events, or a Schema parse failure.
 */
export const decodeGoogleStreamChunk = (
  wireChunk: unknown,
): Either.Either<ReadonlyArray<StreamEvent>, SchemaParseIssue.ParseError> => decodeGoogleStreamEvents(wireChunk);

/**
 * Classifies an upstream HTTP status without reading provider-specific prose.
 * @param statusCode - Upstream HTTP status.
 * @returns The provider-neutral failure class.
 */
export const classifyUpstreamFailure = (statusCode: number): "authentication" | "quota" | "upstream" => {
  if (statusCode === 401 || statusCode === 403) {
    return "authentication";
  }
  return statusCode === 429 ? "quota" : "upstream";
};

const decodeProviderStreamChunk = (request: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  streamLine: string;
  streamState: ProviderStreamState;
}): Effect.Effect<readonly [ProviderStreamState, ReadonlyArray<StreamEvent>], ProviderFailure> => {
  if (request.streamLine === "[DONE]") {
    return Effect.succeed([
      emptyProviderStreamState,
      [
        ...toolEvents(request.streamState.openAiToolCalls),
        ...toolEvents(request.streamState.anthropicToolCalls),
        { _tag: "completed" },
      ],
    ]);
  }
  return Effect.try({
    try: () => {
      const upstreamChunk: unknown = JSON.parse(request.streamLine);
      return upstreamChunk;
    },
    catch: () =>
      providerFailure({
        providerManifest: request.providerManifest,
        modelId: request.modelId,
        failureClass: "upstream",
      }),
  }).pipe(
    Effect.flatMap((upstreamChunk) => {
      const parseFailure = () =>
        providerFailure({
          providerManifest: request.providerManifest,
          modelId: request.modelId,
          failureClass: "upstream",
        });
      switch (request.providerManifest.protocolFamily) {
        case "openai-chat":
          return Either.match(decodeOpenAiStatefulEvents(request.streamState, upstreamChunk), {
            onLeft: () => Effect.fail(parseFailure()),
            onRight: Effect.succeed,
          });
        case "openai-responses":
          return Either.match(
            decodeStatelessProviderEvents(request.streamState, decodeOpenAiResponsesStreamEvents(upstreamChunk)),
            {
              onLeft: () => Effect.fail(parseFailure()),
              onRight: Effect.succeed,
            },
          );
        case "anthropic-messages":
          return Either.match(decodeAnthropicStatefulEvents(request.streamState, upstreamChunk), {
            onLeft: () => Effect.fail(parseFailure()),
            onRight: Effect.succeed,
          });
        case "google-generative":
          return Either.match(
            decodeStatelessProviderEvents(request.streamState, decodeGoogleStreamEvents(upstreamChunk)),
            {
              onLeft: () => Effect.fail(parseFailure()),
              onRight: Effect.succeed,
            },
          );
      }
      return Effect.fail(
        providerFailure({
          providerManifest: request.providerManifest,
          modelId: request.modelId,
          failureClass: "configuration",
        }),
      );
    }),
  );
};

const streamProviderReply = (request: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  upstreamStream: ReadableStream<Uint8Array>;
}): Stream.Stream<StreamEvent, ProviderFailure> =>
  Stream.fromReadableStream(
    () => request.upstreamStream,
    () =>
      providerFailure({
        providerManifest: request.providerManifest,
        modelId: request.modelId,
        failureClass: "upstream",
      }),
  ).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((streamLine) => streamLine.startsWith("data:")),
    Stream.map((streamLine) => streamLine.slice("data:".length).trim()),
    Stream.filter((streamLine) => streamLine !== ""),
    Stream.mapAccumEffect(emptyProviderStreamState, (streamState, streamLine) =>
      decodeProviderStreamChunk({
        providerManifest: request.providerManifest,
        modelId: request.modelId,
        streamLine,
        streamState,
      }),
    ),
    Stream.mapConcat((streamEvents) => streamEvents),
  );

const providerEndpoint = (invocation: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  credential: string | undefined;
}): URL => {
  const endpoint = new URL(invocation.providerManifest.endpoint);
  if (invocation.providerManifest.protocolFamily !== "google-generative") {
    return endpoint;
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/models/${encodeURIComponent(invocation.modelId)}:streamGenerateContent`;
  endpoint.searchParams.set("alt", "sse");
  return endpoint;
};

const providerHeaders = (invocation: {
  providerManifest: ProviderManifest;
  credential: string | undefined;
}): HeadersInit => {
  if (invocation.credential === undefined) {
    return { "content-type": "application/json" };
  }
  switch (invocation.providerManifest.protocolFamily) {
    case "anthropic-messages":
      return {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": invocation.credential,
      };
    case "google-generative":
      return { "content-type": "application/json", "x-goog-api-key": invocation.credential };
    case "openai-chat":
    case "openai-responses":
      return { authorization: `Bearer ${invocation.credential}`, "content-type": "application/json" };
  }
};

const encodeProviderRequest = (invocation: {
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

/**
 * Executes one provider declaration through its official streaming wire family.
 * @param invocation - Manifest, model, credential option, and chat request.
 * @returns A lazy Effect Stream of provider-neutral events.
 */
export const exchangeProviderChat = (invocation: {
  providerManifest: ProviderManifest;
  modelId: ModelId;
  credential: Option.Option<string>;
  chatRequest: ChatRequest;
}): Stream.Stream<StreamEvent, ProviderFailure> => {
  const credential = Option.getOrUndefined(invocation.credential);
  if (invocation.providerManifest.authentication === "api-key" && credential === undefined) {
    return Stream.fail(
      providerFailure({
        providerManifest: invocation.providerManifest,
        modelId: invocation.modelId,
        failureClass: "configuration",
      }),
    );
  }
  return Stream.unwrap(
    Effect.tryPromise({
      try: (abortSignal) =>
        fetch(providerEndpoint({ ...invocation, credential }), {
          method: "POST",
          headers: providerHeaders({ providerManifest: invocation.providerManifest, credential }),
          body: JSON.stringify(encodeProviderRequest(invocation)),
          signal: abortSignal,
        }),
      catch: (fetchFailure) =>
        providerFailure({
          providerManifest: invocation.providerManifest,
          modelId: invocation.modelId,
          failureClass:
            fetchFailure instanceof DOMException && fetchFailure.name === "AbortError" ? "cancelled" : "upstream",
        }),
    }).pipe(
      Effect.timeoutFail({
        duration: "60 seconds",
        onTimeout: () =>
          providerFailure({
            providerManifest: invocation.providerManifest,
            modelId: invocation.modelId,
            failureClass: "cancelled",
          }),
      }),
      Effect.flatMap((upstreamReply) => {
        if (!upstreamReply.ok) {
          return Effect.fail(
            providerFailure({
              providerManifest: invocation.providerManifest,
              modelId: invocation.modelId,
              failureClass: classifyUpstreamFailure(upstreamReply.status),
              statusCode: upstreamReply.status,
            }),
          );
        }
        if (upstreamReply.body === null) {
          return Effect.fail(
            providerFailure({
              providerManifest: invocation.providerManifest,
              modelId: invocation.modelId,
              failureClass: "upstream",
              statusCode: upstreamReply.status,
            }),
          );
        }
        return Effect.succeed(
          streamProviderReply({
            providerManifest: invocation.providerManifest,
            modelId: invocation.modelId,
            upstreamStream: upstreamReply.body,
          }).pipe(
            Stream.timeoutFail(
              () =>
                providerFailure({
                  providerManifest: invocation.providerManifest,
                  modelId: invocation.modelId,
                  failureClass: "cancelled",
                }),
              "60 seconds",
            ),
          ),
        );
      }),
    ),
  );
};

/**
 * Preserves the original OpenRouter exchange name for library callers.
 * @param invocation - Manifest, model, credential option, and chat request.
 * @returns A lazy Effect Stream of provider-neutral events.
 */
export const exchangeOpenRouterChat = exchangeProviderChat;
