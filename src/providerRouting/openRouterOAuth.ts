import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

import { Effect, Schema } from "effect";

import {
  type OpenRouterCredential,
  OpenRouterOAuthError,
  type OpenRouterOAuthRequest,
  openRouterCredentialSchema,
  openRouterKeyExchangeSchema,
} from "./providerContract.js";

const openRouterAuthorizationEndpoint = "https://openrouter.ai/auth";
const openRouterKeyExchangeEndpoint = "https://openrouter.ai/api/v1/auth/keys";
const openRouterChatEndpoint = "https://openrouter.ai/api/v1/chat/completions";

type OpenRouterOAuthDependencies = {
  openBrowser: (authorizationUrl: URL) => Effect.Effect<void, Error>;
  exchangeAuthorizationCode?: (request: { code: string; codeVerifier: string }) => Effect.Effect<OpenRouterCredential>;
};

const createPkceChallenge = (codeVerifier: string): string =>
  createHash("sha256").update(codeVerifier).digest("base64url");

const authorizationUrlFor = (request: { callbackUrl: URL; codeChallenge: string }): URL => {
  const authorizationUrl = new URL(openRouterAuthorizationEndpoint);
  authorizationUrl.searchParams.set("callback_url", request.callbackUrl.toString());
  authorizationUrl.searchParams.set("code_challenge", request.codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  return authorizationUrl;
};

// The callback path carries the state, so a request on any other path is rejected.
const waitForAuthorizationCode = (callbackUrl: URL) =>
  Effect.async<string, OpenRouterOAuthError>((resume) => {
    const closeCallbackServers = () => {
      callbackServers.forEach((callbackServer) => {
        callbackServer.close();
      });
    };

    const createCallbackServer = () =>
      createServer((incomingRequest, callbackWriter) => {
        const requestUrl = new URL(incomingRequest.url || "/", callbackUrl);
        const code = requestUrl.searchParams.get("code");
        const stateMatches = requestUrl.pathname === callbackUrl.pathname;
        const validCallback = stateMatches && code !== null;
        callbackWriter.writeHead(validCallback ? 200 : 400, { "content-type": "text/plain; charset=utf-8" });
        callbackWriter.end(
          validCallback ? "Dufflebag connected. You can close this tab." : "Dufflebag could not connect this account.",
        );
        closeCallbackServers();
        if (validCallback) {
          resume(Effect.succeed(code));
          return;
        }
        resume(Effect.fail(new OpenRouterOAuthError({ failureClass: stateMatches ? "callback" : "state" })));
      });
    // `localhost` can resolve to either loopback address, so listen on both.
    const callbackServers = ["127.0.0.1", "::1"].map((loopbackHost) => {
      const callbackServer = createCallbackServer();
      callbackServer.once("error", () => {
        closeCallbackServers();
        resume(Effect.fail(new OpenRouterOAuthError({ failureClass: "callback" })));
      });
      return callbackServer.listen(Number(callbackUrl.port), loopbackHost);
    });
    return Effect.sync(closeCallbackServers);
  });

const exchangeAuthorizationCode = (request: { code: string; codeVerifier: string }) =>
  Effect.tryPromise({
    try: async () => {
      const upstreamReply = await fetch(openRouterKeyExchangeEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: request.code,
          code_verifier: request.codeVerifier,
          code_challenge_method: "S256",
        }),
      });
      if (!upstreamReply.ok) {
        throw new Error("OpenRouter declined the authorization code.");
      }
      const openRouterKeyExchange = Schema.decodeUnknownSync(openRouterKeyExchangeSchema)(await upstreamReply.json());
      return Schema.decodeUnknownSync(openRouterCredentialSchema)({ credential: openRouterKeyExchange.key });
    },
    catch: () => new OpenRouterOAuthError({ failureClass: "exchange" }),
  });

// Runs PKCE browser consent and returns the credential without persisting it.
export const connectOpenRouter = (request: {
  openRouterOAuthRequest: OpenRouterOAuthRequest;
  dependencies: OpenRouterOAuthDependencies;
}): Effect.Effect<OpenRouterCredential, OpenRouterOAuthError> => {
  const codeVerifier = randomBytes(32).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const callbackUrl = new URL(
    `http://localhost:${String(request.openRouterOAuthRequest.callbackPort)}/openrouter/callback/${state}`,
  );
  const authorizationUrl = authorizationUrlFor({ callbackUrl, codeChallenge: createPkceChallenge(codeVerifier) });
  const exchange =
    request.dependencies.exchangeAuthorizationCode === undefined
      ? exchangeAuthorizationCode
      : request.dependencies.exchangeAuthorizationCode;
  return Effect.gen(function* () {
    const openBrowser = request.dependencies
      .openBrowser(authorizationUrl)
      .pipe(Effect.mapError(() => new OpenRouterOAuthError({ failureClass: "callback" })));
    const [authorizationCode] = yield* Effect.all([waitForAuthorizationCode(callbackUrl), openBrowser], {
      concurrency: "unbounded",
    });
    return yield* exchange({ code: authorizationCode, codeVerifier });
  });
};

export const openConsentScreen = (authorizationUrl: URL) =>
  Effect.async<void, Error>((resume) => {
    execFile("open", [authorizationUrl.toString()], (failure) => {
      resume(
        failure === null ? Effect.void : Effect.fail(new Error("macOS could not open the OpenRouter consent screen.")),
      );
    });
  });

// One tiny chat on the free-model route proves OpenRouter accepts the credential.
export const checkOpenRouterCredential = (credential: string) => {
  const declined = () => new Error("OpenRouter free-model smoke check was declined.");
  return Effect.tryPromise({
    try: () =>
      fetch(openRouterChatEndpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [{ role: "user", content: "Reply exactly: OK" }],
          max_tokens: 4,
        }),
      }),
    catch: declined,
  }).pipe(
    Effect.filterOrFail((upstreamReply) => upstreamReply.ok, declined),
    Effect.asVoid,
  );
};
