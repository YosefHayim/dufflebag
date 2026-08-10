import { Args, Command as CliCommand, Options } from "@effect/cli";
import { Effect, Option, Schema, Stream } from "effect";

import { providerManifestSchema, routingRequestSchema, type StreamEvent } from "../providerRouting/providerContract.js";
import { routeFreeChat } from "../providerRouting/providerRouting.js";
import { CliUsageError } from "./scopeOptions.js";
import * as TerminalUI from "./TerminalUI.js";

const acknowledgementVersion = "omniroute-local-3.8.50";
const promptArgument = Args.text({ name: "prompt" }).pipe(
  Args.withDescription("Text to send through the local OmniRoute gateway"),
);

const modelOption = Options.text("model").pipe(
  Options.withDefault("auto"),
  Options.withDescription("OmniRoute model or combo ID"),
);

const baseUrlOption = Options.text("base-url").pipe(
  Options.withDefault("http://localhost:20128/v1"),
  Options.withDescription("OmniRoute OpenAI-compatible base URL"),
);

const chatEndpoint = (baseUrl: string) =>
  Effect.try({
    try: () => {
      const endpoint = new URL(baseUrl);
      if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
        throw new Error("Unsupported OmniRoute protocol.");
      }
      endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/chat/completions`;
      return endpoint;
    },
    catch: () => new CliUsageError({ issue: "--base-url must be an absolute HTTP or HTTPS URL." }),
  });

const omniRouteCredential = (): Option.Option<string> => {
  const configuredCredential = process.env.OMNIROUTE_API_KEY?.trim();
  return configuredCredential === undefined || configuredCredential === ""
    ? Option.none()
    : Option.some(configuredCredential);
};

const omniRouteRoutingState = {
  readHealth: () => Effect.succeed(Option.none()),
  writeHealth: () => Effect.void,
};

const renderStreamEvent = (streamEvent: StreamEvent) => {
  switch (streamEvent._tag) {
    case "text":
    case "reasoning":
      return TerminalUI.appendChatText(streamEvent.text);
    case "tool":
    case "usage":
    case "completed":
      return Effect.void;
  }
};

const chatCommand = CliCommand.make(
  "chat",
  { prompt: promptArgument, model: modelOption, baseUrl: baseUrlOption },
  (arguments_) =>
    Effect.gen(function* () {
      const endpoint = yield* chatEndpoint(arguments_.baseUrl);
      const credential = omniRouteCredential();
      const providerManifest = yield* Schema.decodeUnknown(providerManifestSchema)({
        providerId: "omniroute",
        displayName: "Local OmniRoute gateway",
        protocolFamily: "openai-chat",
        endpoint: endpoint.toString(),
        authentication: Option.isSome(credential) ? "api-key" : "keyless",
        credentialId: Option.isSome(credential) ? "omniroute-local" : undefined,
        termsStatus: "caution",
        acknowledgementVersion,
        activation: "active",
        freeTierWindow: { poolId: "omniroute-configured-pools", reset: "unquantified", estimatedTokens: 0 },
        models: [{ modelId: arguments_.model, capabilities: ["text", "reasoning", "tools"] }],
        source: "https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.50/docs/getting-started/QUICK-START.md",
      });
      const routingRequest = yield* Schema.decodeUnknown(routingRequestSchema)({
        target: { providerId: "omniroute", modelId: arguments_.model },
        chatRequest: { turns: [{ role: "user", text: arguments_.prompt }], requiredCapabilities: ["text"] },
        acknowledgementVersion,
        observedAt: new Date().toISOString(),
      });
      yield* routeFreeChat({
        routingRequest,
        dependencies: {
          providerManifests: [providerManifest],
          credentialLookup: () => Effect.succeed(credential),
          routingState: omniRouteRoutingState,
        },
      }).pipe(Stream.runForEach(renderStreamEvent));
      yield* TerminalUI.appendChatText("\n");
    }),
).pipe(CliCommand.withDescription("Chat through OmniRoute auto-routing or an explicit configured model"));

export const omniRouteCommand = CliCommand.make("omniroute").pipe(
  CliCommand.withDescription("Use a local OmniRoute gateway and its configured provider adapters"),
  CliCommand.withSubcommands([chatCommand]),
);
