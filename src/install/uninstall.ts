import { createHash } from "node:crypto";

import { FileSystem, Path } from "@effect/platform";
import { Effect, Either, ParseResult, Schema } from "effect";

import { applyArtifactPlan } from "./applyArtifactPlan.js";
import { createUninstallPlan } from "./artifactPlan.js";
import { readArtifactReceiptSnapshot, scopeSchema } from "./artifactReceipt.js";
import { InstallError, installationLocationSchema, interactionSchema, materializeArtifactRestorations, receiptPath } from "./install.js";

export const uninstallRequestSchema = Schema.extend(
  installationLocationSchema,
  Schema.Struct({
    interaction: interactionSchema,
  }),
).annotations({
  description: "Complete uninstall capability request without agent detection or staged-package evidence.",
});

export type UninstallRequest = Schema.Schema.Type<typeof uninstallRequestSchema>;

const uninstallResultFieldsSchema = {
  scope: scopeSchema.annotations({
    description: "Installation scope inspected or removed by this capability call.",
  }),
  interaction: interactionSchema,
};

export const uninstallResultSchema = Schema.Union(
  Schema.TaggedStruct("uninstalled", uninstallResultFieldsSchema),
  Schema.TaggedStruct("absent", uninstallResultFieldsSchema),
).annotations({
  description: "Removed or already-absent receipt-authoritative installation result.",
});

export type UninstallResult = Schema.Schema.Type<typeof uninstallResultSchema>;

export class UninstallError extends Schema.TaggedError<UninstallError>()("UninstallError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable uninstall decode, receipt, restoration, planning, or application failure.",
  }),
}) {
  get message(): string {
    return `Cannot uninstall dufflebag: ${this.issue}`;
  }
}

const formatParseError = (error: ParseResult.ParseError): string => ParseResult.TreeFormatter.formatErrorSync(error);

const formatUnknownError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const toUninstallError = (error: unknown): UninstallError => {
  if (error instanceof UninstallError) {
    return error;
  }

  return new UninstallError({ issue: error instanceof InstallError ? error.issue : formatUnknownError(error) });
};

const decodeUninstallRequest = (input: unknown) =>
  Schema.decodeUnknown(uninstallRequestSchema, {
    onExcessProperty: "error",
  })(input).pipe(Effect.mapError((error) => new UninstallError({ issue: formatParseError(error) })));

const createUninstallResult = (input: { tag: "uninstalled" | "absent"; request: UninstallRequest }): UninstallResult =>
  Schema.validateSync(uninstallResultSchema, {
    onExcessProperty: "error",
  })({
    _tag: input.tag,
    scope: input.request.destination._tag,
    interaction: input.request.interaction,
  });

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

// Remove one receipt-authorized installation through a visible decode, inspect, materialize, plan, and apply pipeline.
export const uninstall = (input: unknown) =>
  Effect.gen(function* () {
    // 1. Decode and canonicalize every host path before receipt inspection.
    const decodedRequest = yield* decodeUninstallRequest(input);
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const canonicalRoot = yield* fileSystem.realPath(decodedRequest.destination.root);
    const canonicalHomeRoot = yield* fileSystem.realPath(decodedRequest.host.homeRoot);
    const request = yield* decodeUninstallRequest({
      ...decodedRequest,
      destination: { ...decodedRequest.destination, root: canonicalRoot },
      host: { homeRoot: canonicalHomeRoot },
    });

    // 2. Inspect the sole receipt that can authorize artifact removal.
    const receiptSnapshot = yield* readArtifactReceiptSnapshot(path.join(request.destination.root, receiptPath));
    if (receiptSnapshot._tag === "missing") {
      return createUninstallResult({ tag: "absent", request });
    }
    if (receiptSnapshot.receipt.scope !== request.destination._tag) {
      return yield* new UninstallError({ issue: "Existing receipt scope does not match the requested destination." });
    }

    // 3. Materialize exact restoration operations from receipt entries only.
    const restorations = yield* materializeArtifactRestorations({
      root: request.destination.root,
      artifacts: receiptSnapshot.receipt.artifacts,
    });

    // 4. Validate one complete uninstall plan with the inspected receipt precondition.
    const planResult = createUninstallPlan({
      root: request.destination.root,
      receipt: receiptSnapshot.receipt,
      restorations,
      receiptTarget: {
        path: receiptPath,
        kind: { _tag: "receipt" },
        owner: { _tag: "application" },
      },
      receiptExpectedCurrent: { _tag: "file", sha256: hashBytes(receiptSnapshot.bytes) },
    });
    if (Either.isLeft(planResult)) {
      return yield* new UninstallError({ issue: `Generated uninstall plan is invalid: ${formatParseError(planResult.left)}` });
    }

    // 5. Apply restorations atomically and remove the receipt last.
    yield* applyArtifactPlan(planResult.right);

    // 6. Return one schema-validated presentation value.
    return createUninstallResult({ tag: "uninstalled", request });
  }).pipe(Effect.mapError(toUninstallError));
