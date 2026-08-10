import { execFile } from "node:child_process";

import { Command as CliCommand, Options } from "@effect/cli";
import { Effect, Schema } from "effect";
import { openRouterOAuthRequestSchema } from "../providerRouting/providerContract.js";
import { connectOpenRouter } from "../providerRouting/providerRouting.js";
import * as TerminalUI from "./TerminalUI.js";

const keychainService = "ys-dufflebag.openrouter";

const callbackPortOption = Options.integer("port").pipe(
  Options.withDefault(49152),
  Options.withDescription("Localhost callback port for OpenRouter consent"),
);

const decodeOpenRouterOAuthRequest = Schema.decodeUnknownSync(openRouterOAuthRequestSchema);

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
  executeMacOsCommand({
    executable: "security",
    arguments_: ["add-generic-password", "-a", "dufflebag", "-s", keychainService, "-w", credential, "-U"],
    failureMessage: "macOS Keychain could not save the OpenRouter credential.",
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

const connectCommand = CliCommand.make("connect", { port: callbackPortOption }, (arguments_) =>
  Effect.gen(function* () {
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
    yield* TerminalUI.intro("OpenRouter free-model smoke check");
    const credential = yield* readOpenRouterCredential();
    yield* verifyOpenRouterFreeChat(credential);
    yield* TerminalUI.success("OpenRouter accepted a free-model chat request.");
  }),
).pipe(CliCommand.withDescription("Run one credential-gated chat check against OpenRouter's free-model route"));

export const openRouterCommand = CliCommand.make("openrouter").pipe(
  CliCommand.withDescription("Use OpenRouter's unified OAuth credential"),
  CliCommand.withSubcommands([connectCommand, smokeCommand]),
);
