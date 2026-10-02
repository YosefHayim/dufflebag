import { Args, Command as CliCommand, Options } from "@effect/cli";
import { Clock, Effect, Option, Schema, Stream } from "effect";

import {
  type CredentialReadiness,
  credentialReadiness,
  lookUpCredential,
  manifestsForEnvironment,
} from "../providerRouting/credentials.js";
import { acknowledgementVersion } from "../providerRouting/freeProviderCatalog.js";
import { healthFileStore, readAcknowledgement, saveAcknowledgement } from "../providerRouting/healthFile.js";
import {
  type ProviderManifest,
  routingRequestSchema,
  routingTargetSchema,
  type StreamEvent,
} from "../providerRouting/providerContract.js";
import { listFreeModels, streamFreeChat } from "../providerRouting/providerRouting.js";
import { CliUsageError } from "./cliOptions.js";
import * as TerminalUI from "./TerminalUI.js";

const decodeRoutingRequest = Schema.decodeUnknown(routingRequestSchema);
const decodeRoutingTarget = Schema.decodeUnknown(routingTargetSchema);

const promptArgument = Args.text({ name: "prompt" }).pipe(
  Args.withDescription("Text to send directly to eligible free providers"),
);

const modelOption = Options.text("model").pipe(
  Options.withDefault("auto-free"),
  Options.withDescription("auto-free or an explicit provider/model identity"),
);

const modelUsageError = new CliUsageError({ issue: "--model must be auto-free or provider/model." });

const routingTargetFrom = (modelIdentity: string) => {
  if (modelIdentity === "auto-free") return decodeRoutingTarget("auto-free");
  const separatorIndex = modelIdentity.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === modelIdentity.length - 1) {
    return Effect.fail(modelUsageError);
  }
  return decodeRoutingTarget({
    providerId: modelIdentity.slice(0, separatorIndex),
    modelId: modelIdentity.slice(separatorIndex + 1),
  }).pipe(Effect.mapError(() => modelUsageError));
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

const readinessLabel = (readiness: CredentialReadiness): string => {
  switch (readiness._tag) {
    case "unavailable":
      return `unavailable: ${readiness.reason || "policy"}`;
    case "keyless":
      return "ready: keyless";
    case "found":
      return "ready: credential found";
    case "undeclared":
      return "missing credential declaration";
    case "needsConnect":
      return "needs: dufflebag openrouter connect";
    case "needsVariables":
      return `needs: export ${readiness.environmentVariables.join(" or ")}`;
    case "needsCredential":
      return `needs: ${readiness.credentialId}`;
  }
};

const credentialStatus = (providerManifest: ProviderManifest) =>
  credentialReadiness(providerManifest).pipe(Effect.map(readinessLabel));

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
  saveAcknowledgement(acknowledgementVersion).pipe(
    Effect.zipRight(TerminalUI.success(`Acknowledged free-provider snapshot ${acknowledgementVersion}.`)),
  ),
).pipe(CliCommand.withDescription("Acknowledge the pinned terms classifications required for cautionary pools"));

const chatCommand = CliCommand.make("chat", { prompt: promptArgument, model: modelOption }, (args) =>
  Effect.gen(function* () {
    const target = yield* routingTargetFrom(args.model);
    const acknowledgedVersion = yield* readAcknowledgement();
    const observedAtMilliseconds = yield* Clock.currentTimeMillis;
    const routingRequest = yield* decodeRoutingRequest({
      target,
      chatRequest: { turns: [{ role: "user", text: args.prompt }], requiredCapabilities: ["text"] },
      acknowledgementVersion: Option.getOrUndefined(
        Option.filter(acknowledgedVersion, (storedVersion) => storedVersion === acknowledgementVersion),
      ),
      observedAt: new Date(observedAtMilliseconds).toISOString(),
    });
    yield* streamFreeChat({
      routingRequest,
      dependencies: {
        providerManifests: manifestsForEnvironment(),
        credentialLookup: lookUpCredential,
        healthStore: healthFileStore,
      },
    }).pipe(Stream.runForEach(renderStreamEvent));
    yield* TerminalUI.appendChatText("\n");
  }),
).pipe(CliCommand.withDescription("Chat directly through auto-free or an explicit provider/model route"));

export const freeProviderCommand = CliCommand.make("free").pipe(
  CliCommand.withDescription("Route directly across official free-provider APIs without an external gateway"),
  CliCommand.withSubcommands([modelsCommand, credentialsCommand, acknowledgeCommand, chatCommand]),
);
