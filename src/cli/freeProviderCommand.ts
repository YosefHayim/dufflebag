import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { Args, Command as CliCommand, Options } from "@effect/cli";
import { Clock, type Context, Effect, Option, Schema, Stream } from "effect";

import { acknowledgementVersion, freeProviderCatalog } from "../providerRouting/freeProviderCatalog.js";
import {
  type HealthRecord,
  healthRecordSchema,
  type ProviderManifest,
  providerManifestSchema,
  RoutingStateFailure,
  routingRequestSchema,
  routingTargetSchema,
  type StreamEvent,
} from "../providerRouting/providerContract.js";
import {
  type CredentialLookup,
  listFreeModels,
  type RoutingState,
  routeFreeChat,
} from "../providerRouting/providerRouting.js";
import { CliUsageError } from "./scopeOptions.js";
import * as TerminalUI from "./TerminalUI.js";

const openRouterKeychainService = "ys-dufflebag.openrouter";
const providerRoutingStateFileSchema = Schema.Struct({
  acknowledgementVersion: Schema.optional(Schema.NonEmptyTrimmedString),
  healthRecords: Schema.Array(healthRecordSchema),
});

type ProviderRoutingStateFile = Schema.Schema.Type<typeof providerRoutingStateFileSchema>;

const emptyProviderRoutingState: ProviderRoutingStateFile = { healthRecords: [] };
const decodeProviderManifest = Schema.decodeUnknownSync(providerManifestSchema);
const decodeProviderRoutingStateFile = Schema.decodeUnknown(providerRoutingStateFileSchema);
const decodeRoutingRequest = Schema.decodeUnknown(routingRequestSchema);
const decodeRoutingTarget = Schema.decodeUnknown(routingTargetSchema);

const credentialSources: ReadonlyArray<{
  credentialId: string;
  environmentVariables: ReadonlyArray<string>;
}> = [
  { credentialId: "api-airforce", environmentVariables: ["API_AIRFORCE_API_KEY"] },
  { credentialId: "bazaarlink", environmentVariables: ["BAZAARLINK_API_KEY"] },
  { credentialId: "blackbox", environmentVariables: ["BLACKBOX_API_KEY"] },
  { credentialId: "bluesminds", environmentVariables: ["BLUESMINDS_API_KEY"] },
  { credentialId: "cerebras", environmentVariables: ["CEREBRAS_API_KEY"] },
  { credentialId: "cloudflare-ai", environmentVariables: ["CLOUDFLARE_API_TOKEN"] },
  { credentialId: "cohere", environmentVariables: ["COHERE_API_KEY"] },
  { credentialId: "friendliai", environmentVariables: ["FRIENDLI_API_KEY"] },
  { credentialId: "google-ai-studio", environmentVariables: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
  { credentialId: "groq", environmentVariables: ["GROQ_API_KEY"] },
  { credentialId: "hackclub", environmentVariables: ["HACKCLUB_API_KEY"] },
  { credentialId: "huggingface", environmentVariables: ["HF_TOKEN", "HUGGINGFACE_API_KEY"] },
  { credentialId: "iflytek", environmentVariables: ["IFLYTEK_API_KEY"] },
  { credentialId: "inference-net", environmentVariables: ["INFERENCE_NET_API_KEY"] },
  { credentialId: "liquid", environmentVariables: ["LIQUID_API_KEY"] },
  { credentialId: "llm7", environmentVariables: ["LLM7_API_KEY"] },
  { credentialId: "mistral", environmentVariables: ["MISTRAL_API_KEY"] },
  { credentialId: "morph", environmentVariables: ["MORPH_API_KEY"] },
  { credentialId: "nara", environmentVariables: ["NARA_API_KEY"] },
  { credentialId: "navy", environmentVariables: ["NAVY_API_KEY"] },
  { credentialId: "ollama-cloud", environmentVariables: ["OLLAMA_API_KEY"] },
  { credentialId: "pollinations", environmentVariables: ["POLLINATIONS_API_KEY"] },
  { credentialId: "puter", environmentVariables: ["PUTER_AUTH_TOKEN"] },
  { credentialId: "reka", environmentVariables: ["REKA_API_KEY"] },
  { credentialId: "sambanova", environmentVariables: ["SAMBANOVA_API_KEY"] },
  { credentialId: "sparkdesk", environmentVariables: ["SPARKDESK_API_KEY"] },
];

const promptArgument = Args.text({ name: "prompt" }).pipe(
  Args.withDescription("Text to send directly to eligible free providers"),
);

const modelOption = Options.text("model").pipe(
  Options.withDefault("auto-free"),
  Options.withDescription("auto-free or an explicit provider/model identity"),
);

const providerRoutingStatePath = (): string => {
  const configuredPath = process.env.DUFFLEBAG_PROVIDER_STATE_PATH?.trim();
  return configuredPath === undefined || configuredPath === ""
    ? join(homedir(), ".dufflebag", "provider-routing.json")
    : configuredPath;
};

const readProviderRoutingState = (): Effect.Effect<ProviderRoutingStateFile, RoutingStateFailure> => {
  const statePath = providerRoutingStatePath();
  if (!existsSync(statePath)) return Effect.succeed(emptyProviderRoutingState);
  return Effect.tryPromise({
    try: () => readFile(statePath, "utf8"),
    catch: () => new RoutingStateFailure({ issue: `Could not read provider routing state at ${statePath}.` }),
  }).pipe(
    Effect.flatMap((stateText) =>
      Effect.try({
        try: () => {
          const stateDocument: unknown = JSON.parse(stateText);
          return stateDocument;
        },
        catch: () => new RoutingStateFailure({ issue: `Provider routing state at ${statePath} is not valid JSON.` }),
      }),
    ),
    Effect.flatMap((stateDocument) =>
      decodeProviderRoutingStateFile(stateDocument).pipe(
        Effect.mapError(
          () => new RoutingStateFailure({ issue: `Provider routing state at ${statePath} is malformed.` }),
        ),
      ),
    ),
  );
};

const writeProviderRoutingState = (
  providerRoutingState: ProviderRoutingStateFile,
): Effect.Effect<void, RoutingStateFailure> => {
  const statePath = providerRoutingStatePath();
  const temporaryPath = `${statePath}.${String(process.pid)}.tmp`;
  return Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(providerRoutingState, undefined, 2)}\n`, { mode: 0o600 });
      await rename(temporaryPath, statePath);
    },
    catch: () => new RoutingStateFailure({ issue: `Could not write provider routing state at ${statePath}.` }),
  });
};

const providerRoutingState: Context.Tag.Service<typeof RoutingState> = {
  readHealth: ({ providerId, modelId }) =>
    readProviderRoutingState().pipe(
      Effect.map((stateFile) =>
        Option.fromNullable(
          stateFile.healthRecords.find(
            (healthRecord) => healthRecord.providerId === providerId && healthRecord.modelId === modelId,
          ),
        ),
      ),
    ),
  writeHealth: (healthRecord: HealthRecord) =>
    readProviderRoutingState().pipe(
      Effect.flatMap((stateFile) =>
        writeProviderRoutingState({
          ...stateFile,
          healthRecords: [
            ...stateFile.healthRecords.filter(
              (storedRecord) =>
                storedRecord.providerId !== healthRecord.providerId || storedRecord.modelId !== healthRecord.modelId,
            ),
            healthRecord,
          ],
        }),
      ),
    ),
};

const readOptionalOpenRouterCredential = (): Effect.Effect<Option.Option<string>> => {
  if (process.platform !== "darwin") return Effect.succeed(Option.none());
  return Effect.async<Option.Option<string>>((resume) => {
    execFile(
      "security",
      ["find-generic-password", "-a", "dufflebag", "-s", openRouterKeychainService, "-w"],
      (failure, stdout) => {
        if (failure !== null) {
          resume(Effect.succeed(Option.none()));
          return;
        }
        const credential = stdout.trim();
        resume(Effect.succeed(credential === "" ? Option.none() : Option.some(credential)));
      },
    );
  });
};

const credentialSourceFor = (credentialId: string) =>
  credentialSources.find((credentialSource) => credentialSource.credentialId === credentialId);

const credentialFromEnvironment = (credentialId: string): Option.Option<string> => {
  const credentialSource = credentialSourceFor(credentialId);
  if (credentialSource === undefined) return Option.none();
  for (const environmentVariable of credentialSource.environmentVariables) {
    const credential = process.env[environmentVariable]?.trim();
    if (credential !== undefined && credential !== "") return Option.some(credential);
  }
  return Option.none();
};

const directCredentialLookup: CredentialLookup = (credentialId) => {
  if (credentialId === "openrouter-oauth") return readOptionalOpenRouterCredential();
  if (credentialId === "cloudflare-ai") {
    const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (cloudflareAccountId === undefined || cloudflareAccountId === "") return Effect.succeed(Option.none());
  }
  return Effect.succeed(credentialFromEnvironment(credentialId));
};

const manifestsForEnvironment = (): ReadonlyArray<ProviderManifest> => {
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (cloudflareAccountId === undefined || cloudflareAccountId === "") return freeProviderCatalog;
  return freeProviderCatalog.map((providerManifest) => {
    if (providerManifest.providerId !== "cloudflare-ai") return providerManifest;
    return decodeProviderManifest({
      ...providerManifest,
      endpoint: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/ai/v1/chat/completions`,
    });
  });
};

const routingTargetFrom = (modelIdentity: string) => {
  if (modelIdentity === "auto-free") return decodeRoutingTarget("auto-free");
  const separatorIndex = modelIdentity.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === modelIdentity.length - 1) {
    return Effect.fail(new CliUsageError({ issue: "--model must be auto-free or provider/model." }));
  }
  return decodeRoutingTarget({
    providerId: modelIdentity.slice(0, separatorIndex),
    modelId: modelIdentity.slice(separatorIndex + 1),
  }).pipe(Effect.mapError(() => new CliUsageError({ issue: "--model must be auto-free or provider/model." })));
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

const credentialStatus = (providerManifest: ProviderManifest) =>
  Effect.gen(function* () {
    if (providerManifest.activation === "unavailable") {
      return `unavailable: ${providerManifest.unavailableReason === undefined ? "policy" : providerManifest.unavailableReason}`;
    }
    if (providerManifest.authentication === "keyless") return "ready: keyless";
    if (providerManifest.credentialId === undefined) return "missing credential declaration";
    if (providerManifest.providerId === "cloudflare-ai") {
      const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
      if (cloudflareAccountId === undefined || cloudflareAccountId === "") {
        return "needs: export CLOUDFLARE_ACCOUNT_ID";
      }
    }
    const credential = yield* directCredentialLookup(providerManifest.credentialId);
    if (Option.isSome(credential)) return "ready: credential found";
    const credentialSource = credentialSourceFor(providerManifest.credentialId);
    if (providerManifest.credentialId === "openrouter-oauth") return "needs: dufflebag openrouter connect";
    return credentialSource === undefined
      ? `needs: ${providerManifest.credentialId}`
      : `needs: export ${credentialSource.environmentVariables.join(" or ")}`;
  });

const modelsCommand = CliCommand.make("models", {}, () =>
  Effect.gen(function* () {
    const providerManifests = manifestsForEnvironment();
    const statusByProvider = yield* Effect.forEach(
      providerManifests,
      (providerManifest) =>
        credentialStatus(providerManifest).pipe(
          Effect.map((status) => ({ providerId: providerManifest.providerId, status })),
        ),
      { concurrency: 8 },
    );
    const statusFor = (providerId: string) =>
      statusByProvider.find((providerStatus) => providerStatus.providerId === providerId)?.status;
    const freeModels = yield* listFreeModels({ providerManifests });
    const activeLines = freeModels.map((freeModel) => {
      const status = statusFor(freeModel.providerId);
      return `${freeModel.providerId}/${freeModel.modelId}\t${status === undefined ? "unknown" : status}`;
    });
    const unavailableLines = providerManifests
      .filter((providerManifest) => providerManifest.activation === "unavailable")
      .map((providerManifest) => {
        const modelCapability = providerManifest.models.at(0);
        const modelId = modelCapability === undefined ? "unknown" : modelCapability.modelId;
        const status = statusFor(providerManifest.providerId);
        return `${providerManifest.providerId}/${modelId}\t${status === undefined ? "unavailable" : status}`;
      });
    yield* TerminalUI.note([...activeLines, ...unavailableLines].join("\n"), "Direct free-provider models");
  }),
).pipe(CliCommand.withDescription("List direct models, credential readiness, and policy-unavailable pools"));

const credentialsCommand = CliCommand.make("credentials", {}, () =>
  Effect.gen(function* () {
    const providerManifests = manifestsForEnvironment().filter(
      (providerManifest) => providerManifest.activation === "active" && providerManifest.authentication === "api-key",
    );
    const credentialLines = yield* Effect.forEach(
      providerManifests,
      (providerManifest) =>
        credentialStatus(providerManifest).pipe(Effect.map((status) => `${providerManifest.providerId}\t${status}`)),
      { concurrency: 8 },
    );
    yield* TerminalUI.note(credentialLines.join("\n"), "Direct provider credentials");
  }),
).pipe(CliCommand.withDescription("Show which direct providers are ready and which credential variables are missing"));

const acknowledgeCommand = CliCommand.make("acknowledge", {}, () =>
  readProviderRoutingState().pipe(
    Effect.flatMap((stateFile) => writeProviderRoutingState({ ...stateFile, acknowledgementVersion })),
    Effect.zipRight(TerminalUI.success(`Acknowledged free-provider snapshot ${acknowledgementVersion}.`)),
  ),
).pipe(CliCommand.withDescription("Acknowledge the pinned terms classifications required for cautionary pools"));

const chatCommand = CliCommand.make("chat", { prompt: promptArgument, model: modelOption }, (arguments_) =>
  Effect.gen(function* () {
    const target = yield* routingTargetFrom(arguments_.model);
    const stateFile = yield* readProviderRoutingState();
    const observedAtMilliseconds = yield* Clock.currentTimeMillis;
    const acknowledgedVersion =
      stateFile.acknowledgementVersion === acknowledgementVersion ? acknowledgementVersion : undefined;
    const routingRequest = yield* decodeRoutingRequest({
      target,
      chatRequest: { turns: [{ role: "user", text: arguments_.prompt }], requiredCapabilities: ["text"] },
      acknowledgementVersion: acknowledgedVersion,
      observedAt: new Date(observedAtMilliseconds).toISOString(),
    });
    yield* routeFreeChat({
      routingRequest,
      dependencies: {
        providerManifests: manifestsForEnvironment(),
        credentialLookup: directCredentialLookup,
        routingState: providerRoutingState,
      },
    }).pipe(Stream.runForEach(renderStreamEvent));
    yield* TerminalUI.appendChatText("\n");
  }),
).pipe(CliCommand.withDescription("Chat directly through auto-free or an explicit provider/model route"));

export const freeProviderCommand = CliCommand.make("free").pipe(
  CliCommand.withDescription("Route directly across official free-provider APIs without an external gateway"),
  CliCommand.withSubcommands([modelsCommand, credentialsCommand, acknowledgeCommand, chatCommand]),
);
