import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { describe } from "vitest";

import { connectOpenRouter } from "./openRouterOAuth.js";
import { openRouterOAuthRequestSchema } from "./providerContract.js";

describe("OpenRouter OAuth", () => {
  it.effect(
    "completes a state-validated local OpenRouter callback without persisting transient authorization material",
    () => {
      let authorizationUrl: URL | undefined;
      let exchangedCode: string | undefined;
      let exchangedVerifier: string | undefined;
      const callbackPort = 49153;
      return connectOpenRouter({
        openRouterOAuthRequest: Schema.decodeUnknownSync(openRouterOAuthRequestSchema)({ callbackPort }),
        dependencies: {
          openBrowser: (openedAuthorizationUrl) =>
            Effect.tryPromise({
              try: async () => {
                authorizationUrl = openedAuthorizationUrl;
                const callbackText = openedAuthorizationUrl.searchParams.get("callback_url");
                if (callbackText === null) {
                  throw new Error("OpenRouter authorization URL did not include a callback URL.");
                }
                const callbackUrl = new URL(callbackText);
                if (!callbackUrl.pathname.startsWith("/openrouter/callback/")) {
                  throw new Error("OpenRouter callback URL did not include state.");
                }
                callbackUrl.searchParams.set("code", "authorization-code");
                await fetch(callbackUrl);
              },
              catch: (failure) => (failure instanceof Error ? failure : new Error("Could not complete test callback.")),
            }),
          exchangeAuthorizationCode: ({ code, codeVerifier }) =>
            Effect.sync(() => {
              exchangedCode = code;
              exchangedVerifier = codeVerifier;
              return { credential: "test-openrouter-key" };
            }),
        },
      }).pipe(
        Effect.tap((openRouterCredential) => {
          expect(openRouterCredential.credential).toBe("test-openrouter-key");
          expect(authorizationUrl?.hostname).toBe("openrouter.ai");
          expect(exchangedCode).toBe("authorization-code");
          expect(exchangedVerifier).toBeDefined();
        }),
      );
    },
  );

  it.effect("reports a callback with the wrong state as a state failure", () =>
    connectOpenRouter({
      openRouterOAuthRequest: Schema.decodeUnknownSync(openRouterOAuthRequestSchema)({ callbackPort: 49154 }),
      dependencies: {
        openBrowser: () =>
          Effect.tryPromise(() => fetch("http://localhost:49154/openrouter/callback/forged-state?code=stolen")),
        exchangeAuthorizationCode: () => Effect.die("A forged callback must not reach the key exchange."),
      },
    }).pipe(
      Effect.flip,
      Effect.tap((failure) => {
        expect(failure.failureClass).toBe("state");
      }),
    ),
  );
});
