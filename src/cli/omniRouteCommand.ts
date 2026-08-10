import { Args, Command as CliCommand, Options } from "@effect/cli";
import { Effect, Option, Schema } from "effect";

import { providerManifestSchema, routingRequestSchema } from "../providerRouting/providerContract.js";
import { completeFreeChat } from "../providerRouting/providerRouting.js";
import * as TerminalUI from "./TerminalUI.js";

const acknowledgementVersion = "omniroute-local-3.8.50";
const decodeProviderManifest = Schema.decodeUnknownSync(providerManifestSchema);
const decodeRoutingRequest = Schema.decodeUnknownSync(routingRequestSchema);

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

const chatEndpoint = (baseUrl: string): URL => {
  const endpoint = new URL(baseUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/chat/completions`;
  return endpoint;
};

const omniRouteCredential = (): string => {
  const configuredCredential = process.env.OMNIROUTE_API_KEY?.trim();
  return configuredCredential === undefined || configuredCredential === "" ? "omniroute-no-auth" : configuredCredential;
};

const omniRouteRoutingState = {
  readHealth: () => Effect.succeed(Option.none()),
  writeHealth: () => Effect.void,
};

const renderStreamText = (streamEvents: ReadonlyArray<{ _tag: string; text?: string }>): string =>
  streamEvents
    .filter((streamEvent) => streamEvent._tag === "text" || streamEvent._tag === "reasoning")
    .map((streamEvent) => streamEvent.text)
    .filter((streamText): streamText is string => streamText !== undefined)
    .join("");

const chatCommand = CliCommand.make(
  "chat",
  { prompt: promptArgument, model: modelOption, baseUrl: baseUrlOption },
  (arguments_) =>
    Effect.gen(function* () {
      const endpoint = yield* Effect.try({
        try: () => chatEndpoint(arguments_.baseUrl),
        catch: () => new Error("--base-url must be an absolute HTTP or HTTPS URL."),
      });
      const providerManifest = decodeProviderManifest({
        providerId: "omniroute",
        displayName: "Local OmniRoute gateway",
        protocolFamily: "openai-chat",
        endpoint: endpoint.toString(),
        authentication: "api-key",
        credentialId: "omniroute-local",
        termsStatus: "caution",
        acknowledgementVersion,
        activation: "active",
        freeTierWindow: { poolId: "omniroute-configured-pools", reset: "unquantified", estimatedTokens: 0 },
        models: [{ modelId: arguments_.model, capabilities: ["text", "reasoning", "tools"] }],
        source: "https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.50/docs/getting-started/QUICK-START.md",
      });
      const streamEvents = yield* completeFreeChat({
        routingRequest: decodeRoutingRequest({
          target: { providerId: "omniroute", modelId: arguments_.model },
          chatRequest: { turns: [{ role: "user", text: arguments_.prompt }], requiredCapabilities: ["text"] },
          acknowledgementVersion,
          observedAt: new Date().toISOString(),
        }),
        dependencies: {
          providerManifests: [providerManifest],
          credentialLookup: () => Effect.succeed(Option.some(omniRouteCredential())),
          routingState: omniRouteRoutingState,
        },
      });
      yield* TerminalUI.note(renderStreamText(Array.from(streamEvents)));
    }),
).pipe(CliCommand.withDescription("Chat through OmniRoute auto-routing or an explicit configured model"));

export const omniRouteCommand = CliCommand.make("omniroute").pipe(
  CliCommand.withDescription("Use a local OmniRoute gateway and its configured provider adapters"),
  CliCommand.withSubcommands([chatCommand]),
);
