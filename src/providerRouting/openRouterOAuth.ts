import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

import { Effect, Schema } from "effect";

import {
  type OpenRouterCredential,
  OpenRouterOAuthFailure,
  type OpenRouterOAuthRequest,
  openRouterCredentialSchema,
  openRouterKeyExchangeSchema,
} from "./providerContract.js";

const openRouterAuthorizationEndpoint = "https://openrouter.ai/auth";
const openRouterKeyExchangeEndpoint = "https://openrouter.ai/api/v1/auth/keys";

type OpenRouterOAuthDependencies = {
  openBrowser: (authorizationUrl: URL) => Effect.Effect<void, Error>;
  exchangeAuthorizationCode?: (request: { code: string; codeVerifier: string }) => Effect.Effect<OpenRouterCredential>;
};

const base64Url = (value: Buffer): string => value.toString("base64url");

const createPkceChallenge = (codeVerifier: string): string =>
  createHash("sha256").update(codeVerifier).digest("base64url");

const callbackUrlFor = (request: { callbackPort: number; state: string }): URL => {
  return new URL(`http://localhost:${String(request.callbackPort)}/openrouter/callback/${request.state}`);
};

const authorizationUrlFor = (request: { callbackUrl: URL; state: string; codeChallenge: string }): URL => {
  const authorizationUrl = new URL(openRouterAuthorizationEndpoint);
  authorizationUrl.searchParams.set("callback_url", request.callbackUrl.toString());
  authorizationUrl.searchParams.set("code_challenge", request.codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  return authorizationUrl;
};

const waitForAuthorizationCode = (request: { callbackUrl: URL; state: string }) =>
  Effect.async<string, OpenRouterOAuthFailure>((resume) => {
    const callbackServers: Array<ReturnType<typeof createServer>> = [];
    const closeCallbackServers = () => {
      callbackServers.forEach((callbackServer) => {
        callbackServer.close();
      });
    };

    const createCallbackServer = () =>
      createServer((incomingRequest, callbackWriter) => {
        const requestUrl = new URL(incomingRequest.url || "/", request.callbackUrl);
        const code = requestUrl.searchParams.get("code");
        const failure = requestUrl.searchParams.get("error");
        const validCallback = requestUrl.pathname === request.callbackUrl.pathname && code !== null;
        callbackWriter.writeHead(validCallback ? 200 : 400, { "content-type": "text/plain; charset=utf-8" });
        callbackWriter.end(
          validCallback ? "Dufflebag connected. You can close this tab." : "Dufflebag could not connect this account.",
        );
        closeCallbackServers();
        if (validCallback) {
          resume(Effect.succeed(code));
          return;
        }
        resume(Effect.fail(new OpenRouterOAuthFailure({ failureClass: failure === null ? "state" : "callback" })));
      });
    const loopbackHosts = ["127.0.0.1", "::1"];
    callbackServers.push(...loopbackHosts.map(createCallbackServer));
    callbackServers.forEach((callbackServer, index) => {
      const loopbackHost = loopbackHosts[index];
      if (loopbackHost === undefined) {
        return;
      }
      callbackServer.once("error", () => {
        closeCallbackServers();
        resume(Effect.fail(new OpenRouterOAuthFailure({ failureClass: "callback" })));
      });
      callbackServer.listen(Number(request.callbackUrl.port), loopbackHost);
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
    catch: () => new OpenRouterOAuthFailure({ failureClass: "exchange" }),
  });

/**
 * Runs OpenRouter PKCE browser consent and returns the exchanged credential to the caller.
 * @param request - Validated callback settings and optional browser/exchange mechanisms.
 * @returns An Effect containing the OpenRouter credential without persisting it.
 */
export const connectOpenRouter = (request: {
  openRouterOAuthRequest: OpenRouterOAuthRequest;
  dependencies: OpenRouterOAuthDependencies;
}): Effect.Effect<OpenRouterCredential, OpenRouterOAuthFailure> => {
  const codeVerifier = base64Url(randomBytes(32));
  const state = base64Url(randomBytes(24));
  const callbackUrl = callbackUrlFor({ callbackPort: request.openRouterOAuthRequest.callbackPort, state });
  const authorizationUrl = authorizationUrlFor({
    callbackUrl,
    state,
    codeChallenge: createPkceChallenge(codeVerifier),
  });
  const exchange =
    request.dependencies.exchangeAuthorizationCode === undefined
      ? exchangeAuthorizationCode
      : request.dependencies.exchangeAuthorizationCode;
  return Effect.gen(function* () {
    const [authorizationCode] = yield* Effect.all(
      [waitForAuthorizationCode({ callbackUrl, state }), request.dependencies.openBrowser(authorizationUrl)],
      { concurrency: "unbounded" },
    ).pipe(Effect.mapError(() => new OpenRouterOAuthFailure({ failureClass: "callback" })));
    return yield* exchange({ code: authorizationCode, codeVerifier });
  });
};
