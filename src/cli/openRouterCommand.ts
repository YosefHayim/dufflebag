import { execFile, spawn } from "node:child_process";

import { Args, Command as CliCommand, Options } from "@effect/cli";
import { Effect, Option, Schema } from "effect";
import { openRouterOAuthRequestSchema, routingRequestSchema } from "../providerRouting/providerContract.js";
import { completeFreeChat, connectOpenRouter } from "../providerRouting/providerRouting.js";
import * as TerminalUI from "./TerminalUI.js";

const keychainService = "ys-dufflebag.openrouter";

const callbackPortOption = Options.integer("port").pipe(
  Options.withDefault(49152),
  Options.withDescription("Localhost callback port for OpenRouter consent"),
);

const decodeOpenRouterOAuthRequest = Schema.decodeUnknownSync(openRouterOAuthRequestSchema);
const decodeRoutingRequest = Schema.decodeUnknownSync(routingRequestSchema);

const chatPromptArgument = Args.text({ name: "prompt" }).pipe(
  Args.withDescription("Text to send through the unified free route"),
);

const requireMacOs = () =>
  process.platform === "darwin"
    ? Effect.void
    : Effect.fail(new Error("OpenRouter Keychain consent is currently available on macOS only."));

const executeMacOsCommand = (request: {
  executable: string;
  arguments_: ReadonlyArray<string>;
  failureMessage: string;
}) =>
  Effect.async<void, Error>((resume) => {
    execFile(request.executable, [...request.arguments_], (error) => {
      resume(error === null ? Effect.void : Effect.fail(new Error(request.failureMessage)));
    });
  });

const openConsentScreen = (authorizationUrl: URL) =>
  executeMacOsCommand({
    executable: "open",
    arguments_: [authorizationUrl.toString()],
    failureMessage: "macOS could not open the OpenRouter consent screen.",
  });

const persistOpenRouterCredential = (credential: string) =>
  Effect.async<void, Error>((resume) => {
    const keychainPrompt = [
      `spawn security add-generic-password -a dufflebag -s ${keychainService} -U -w`,
      'expect "password data for new item:"',
      "gets stdin credential",
      'send -- "$credential\\r"',
      'expect "retype password for new item:"',
      'send -- "$credential\\r"',
      "expect eof",
    ].join("\n");
    const keychainWriter = spawn("expect", ["-c", keychainPrompt], { stdio: ["pipe", "ignore", "ignore"] });
    keychainWriter.once("error", () =>
      resume(Effect.fail(new Error("macOS Keychain could not save the OpenRouter credential."))),
    );
    keychainWriter.once("close", (exitCode) =>
      resume(
        exitCode === 0
          ? Effect.void
          : Effect.fail(new Error("macOS Keychain could not save the OpenRouter credential.")),
      ),
    );
    keychainWriter.stdin.write(`${credential}\n`);
    keychainWriter.stdin.end();
  });

const readOpenRouterCredential = () =>
  Effect.async<string, Error>((resume) => {
    execFile("security", ["find-generic-password", "-a", "dufflebag", "-s", keychainService, "-w"], (error, stdout) => {
      if (error !== null) {
        resume(
          Effect.fail(
            new Error("No OpenRouter credential is saved in macOS Keychain. Run `dufflebag openrouter connect`."),
          ),
        );
        return;
      }
      const credential = stdout.trim();
      resume(
        credential === ""
          ? Effect.fail(new Error("macOS Keychain returned an empty OpenRouter credential."))
          : Effect.succeed(credential),
      );
    });
  });

const verifyOpenRouterFreeChat = (credential: string) =>
  Effect.tryPromise({
    try: async () => {
      const upstreamReply = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [{ role: "user", content: "Reply exactly: OK" }],
          max_tokens: 4,
        }),
      });
      if (!upstreamReply.ok) {
        throw new Error("OpenRouter free-model smoke check was declined.");
      }
    },
    catch: () => new Error("OpenRouter free-model smoke check was declined."),
  });

const openRouterRoutingState = {
  readHealth: () => Effect.succeed(Option.none()),
  writeHealth: () => Effect.void,
};

const textFromStreamEvents = (streamEvents: ReadonlyArray<{ _tag: string; text?: string }>) =>
  streamEvents
    .filter((streamEvent) => streamEvent._tag === "text" || streamEvent._tag === "reasoning")
    .map((streamEvent) => streamEvent.text)
    .filter((streamText): streamText is string => streamText !== undefined)
    .join("");

const connectCommand = CliCommand.make("connect", { port: callbackPortOption }, (arguments_) =>
  Effect.gen(function* () {
    yield* requireMacOs();
    yield* TerminalUI.intro("OpenRouter consent");
    yield* TerminalUI.step("Opening OpenRouter in your browser");
    const openRouterCredential = yield* connectOpenRouter({
      openRouterOAuthRequest: decodeOpenRouterOAuthRequest({ callbackPort: arguments_.port }),
      dependencies: { openBrowser: openConsentScreen },
    });
    yield* persistOpenRouterCredential(openRouterCredential.credential);
    yield* TerminalUI.success("OpenRouter connected; its credential is saved in your macOS Keychain.");
  }),
).pipe(CliCommand.withDescription("Connect OpenRouter with browser consent and save its credential in macOS Keychain"));

const smokeCommand = CliCommand.make("smoke", {}, () =>
  Effect.gen(function* () {
    yield* requireMacOs();
    yield* TerminalUI.intro("OpenRouter free-model smoke check");
    const credential = yield* readOpenRouterCredential();
    yield* verifyOpenRouterFreeChat(credential);
    yield* TerminalUI.success("OpenRouter accepted a free-model chat request.");
  }),
).pipe(CliCommand.withDescription("Run one credential-gated chat check against OpenRouter's free-model route"));

const chatCommand = CliCommand.make("chat", { prompt: chatPromptArgument }, (arguments_) =>
  Effect.gen(function* () {
    yield* requireMacOs();
    const credential = yield* readOpenRouterCredential();
    const streamEvents = yield* completeFreeChat({
      routingRequest: decodeRoutingRequest({
        target: "auto-free",
        chatRequest: { turns: [{ role: "user", text: arguments_.prompt }], requiredCapabilities: ["text"] },
        acknowledgementVersion: "omniroute-2026-06-17",
        observedAt: new Date().toISOString(),
      }),
      dependencies: {
        credentialLookup: (credentialId) =>
          credentialId === "openrouter-oauth" ? Effect.succeed(Option.some(credential)) : Effect.succeed(Option.none()),
        routingState: openRouterRoutingState,
      },
    });
    yield* TerminalUI.note(textFromStreamEvents(Array.from(streamEvents)));
  }),
).pipe(CliCommand.withDescription("Send text through Dufflebag's unified OpenRouter free route"));

export const openRouterCommand = CliCommand.make("openrouter").pipe(
  CliCommand.withDescription("Use OpenRouter's unified OAuth credential"),
  CliCommand.withSubcommands([connectCommand, smokeCommand, chatCommand]),
);
