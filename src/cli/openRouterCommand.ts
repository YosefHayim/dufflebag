import { Args, Command as CliCommand, Options } from "@effect/cli";
import { Effect, Option, Schema } from "effect";

import { acknowledgementVersion } from "../providerRouting/freeProviderCatalog.js";
import {
  requireKeychain,
  requireOpenRouterCredential,
  saveOpenRouterCredential,
} from "../providerRouting/openRouterKeychain.js";
import { checkOpenRouterCredential, openConsentScreen } from "../providerRouting/openRouterOAuth.js";
import {
  openRouterOAuthRequestSchema,
  routingRequestSchema,
  type StreamEvent,
} from "../providerRouting/providerContract.js";
import { askFreeChat, connectOpenRouter, type HealthStore } from "../providerRouting/providerRouting.js";
import * as TerminalUI from "./TerminalUI.js";

const callbackPortOption = Options.integer("port").pipe(
  Options.withDefault(49152),
  Options.withDescription("Localhost callback port for OpenRouter consent"),
);

const decodeOpenRouterOAuthRequest = Schema.decodeUnknownSync(openRouterOAuthRequestSchema);
const decodeRoutingRequest = Schema.decodeUnknownSync(routingRequestSchema);

const chatPromptArgument = Args.text({ name: "prompt" }).pipe(
  Args.withDescription("Text to send through the unified free route"),
);

const unsavedHealthStore: HealthStore = {
  readHealth: () => Effect.succeed(Option.none()),
  writeHealth: () => Effect.void,
};

const textFromStreamEvents = (streamEvents: ReadonlyArray<StreamEvent>) =>
  streamEvents
    .flatMap((streamEvent) =>
      streamEvent._tag === "text" || streamEvent._tag === "reasoning" ? [streamEvent.text] : [],
    )
    .join("");

const connectCommand = CliCommand.make("connect", { port: callbackPortOption }, (args) =>
  Effect.gen(function* () {
    yield* requireKeychain();
    yield* TerminalUI.intro("OpenRouter consent");
    yield* TerminalUI.step("Opening OpenRouter in your browser");
    const openRouterCredential = yield* connectOpenRouter({
      openRouterOAuthRequest: decodeOpenRouterOAuthRequest({ callbackPort: args.port }),
      dependencies: { openBrowser: openConsentScreen },
    });
    yield* saveOpenRouterCredential(openRouterCredential.credential);
    yield* TerminalUI.success("OpenRouter connected; its credential is saved in your macOS Keychain.");
  }),
).pipe(CliCommand.withDescription("Connect OpenRouter with browser consent and save its credential in macOS Keychain"));

const smokeCommand = CliCommand.make("smoke", {}, () =>
  Effect.gen(function* () {
    yield* TerminalUI.intro("OpenRouter free-model smoke check");
    const credential = yield* requireOpenRouterCredential();
    yield* checkOpenRouterCredential(credential);
    yield* TerminalUI.success("OpenRouter accepted a free-model chat request.");
  }),
).pipe(CliCommand.withDescription("Run one credential-gated chat check against OpenRouter's free-model route"));

const chatCommand = CliCommand.make("chat", { prompt: chatPromptArgument }, (args) =>
  Effect.gen(function* () {
    const credential = yield* requireOpenRouterCredential();
    const streamEvents = yield* askFreeChat({
      routingRequest: decodeRoutingRequest({
        target: "auto-free",
        chatRequest: { turns: [{ role: "user", text: args.prompt }], requiredCapabilities: ["text"] },
        acknowledgementVersion,
        observedAt: new Date().toISOString(),
      }),
      dependencies: {
        credentialLookup: (credentialId) =>
          Effect.succeed(credentialId === "openrouter-oauth" ? Option.some(credential) : Option.none()),
        healthStore: unsavedHealthStore,
      },
    });
    yield* TerminalUI.note(textFromStreamEvents(Array.from(streamEvents)));
  }),
).pipe(CliCommand.withDescription("Send text through Dufflebag's unified OpenRouter free route"));

export const openRouterCommand = CliCommand.make("openrouter").pipe(
  CliCommand.withDescription("Use OpenRouter's unified OAuth credential"),
  CliCommand.withSubcommands([connectCommand, smokeCommand, chatCommand]),
);
