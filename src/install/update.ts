import { Path } from "@effect/platform";
import { Effect, Schema, ParseResult as SchemaParseIssue } from "effect";
import { readArtifactReceiptSnapshot } from "./artifactReceipt.js";
import {
  agentChoiceSchema,
  configurationChoiceSchema,
  type InstallSummary,
  installationLocationSchema,
  installRequestSchema,
  interactionSchema,
  platformRequirementSchema,
  receiptPath,
  reconcileInstallation,
  selectedFeatureChoiceSchema,
  stagedPackageSchema,
} from "./install.js";

const updateFeatureChoiceSchema = Schema.Union(
  Schema.TaggedStruct("preserve", {}).annotations({
    description: "Reuse the dependency-resolved features recorded by the current receipt.",
  }),
  selectedFeatureChoiceSchema,
).annotations({
  description: "Preserved or explicit feature selection for an existing installation.",
});

export const updateRequestSchema = Schema.extend(
  installationLocationSchema,
  Schema.Struct({
    stagedPackage: stagedPackageSchema,
    features: updateFeatureChoiceSchema,
    agents: agentChoiceSchema,
    interaction: interactionSchema,
    configuration: configurationChoiceSchema,
  }),
).annotations({
  description: "Complete update capability request decoded before receipt inspection.",
});

export type UpdateRequest = Schema.Schema.Type<typeof updateRequestSchema>;

const updateSummaryFieldsSchema = {
  scope: Schema.Literal("global", "project"),
  features: selectedFeatureChoiceSchema.fields.ids,
  agents: agentChoiceSchema.members[0].fields.ids,
  platformRequirements: Schema.Array(platformRequirementSchema),
  interaction: interactionSchema,
};

export const updateSummarySchema = Schema.Union(
  Schema.TaggedStruct("updated", updateSummaryFieldsSchema),
  Schema.TaggedStruct("unchanged", updateSummaryFieldsSchema),
).annotations({
  description: "Applied or already-current update result.",
});

export type UpdateSummary = Schema.Schema.Type<typeof updateSummarySchema>;

export class UpdateError extends Schema.TaggedError<UpdateError>()("UpdateError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable update decode, receipt, reconciliation, or application failure.",
  }),
}) {
  get message(): string {
    return `Cannot update dufflebag: ${this.issue}`;
  }
}

const formatParseError = (error: SchemaParseIssue.ParseError): string =>
  SchemaParseIssue.TreeFormatter.formatErrorSync(error);

const formatUnknownError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const toUpdateError = (error: unknown): UpdateError =>
  error instanceof UpdateError ? error : new UpdateError({ issue: formatUnknownError(error) });

const decodeUpdateRequest = (input: unknown) =>
  Schema.decodeUnknown(updateRequestSchema, {
    onExcessProperty: "error",
  })(input).pipe(Effect.mapError((error) => new UpdateError({ issue: formatParseError(error) })));

const decodeInstallRequest = (input: unknown) =>
  Schema.decodeUnknown(installRequestSchema, {
    onExcessProperty: "error",
  })(input).pipe(Effect.mapError((error) => new UpdateError({ issue: formatParseError(error) })));

const createUpdateSummary = (updateExecution: InstallSummary): UpdateSummary =>
  Schema.validateSync(updateSummarySchema, {
    onExcessProperty: "error",
  })({
    _tag: updateExecution._tag === "installed" ? "updated" : "unchanged",
    scope: updateExecution.scope,
    features: updateExecution.features,
    agents: updateExecution.agents,
    platformRequirements: updateExecution.platformRequirements,
    interaction: updateExecution.interaction,
  });

// Update one existing receipt through a visible decode, inspect, resolve, reconcile, and result pipeline.
export const update = (input: unknown) =>
  Effect.gen(function* () {
    // 1. Decode the complete update request before reading installation state.
    const request = yield* decodeUpdateRequest(input);
    const path = yield* Path.Path;

    // 2. Inspect and strictly decode the sole receipt that authorizes reconciliation.
    const receiptSnapshot = yield* readArtifactReceiptSnapshot(path.join(request.destination.root, receiptPath));
    if (receiptSnapshot._tag === "missing") {
      return yield* new UpdateError({ issue: "No ownership receipt exists at the requested scope." });
    }

    // 3. Resolve preserved feature choice from the receipt without inferring agent deletion authority.
    const featureIds = request.features._tag === "preserve" ? receiptSnapshot.receipt.features : request.features.ids;

    // 4. Validate one install-shaped reconciliation request from the resolved update policy.
    const installRequest = yield* decodeInstallRequest({
      ...request,
      features: { _tag: "selected", ids: featureIds },
    });

    // 5. Reconcile through the shared planner with the already-inspected receipt snapshot.
    const updateExecution = yield* reconcileInstallation({ request: installRequest, receiptSnapshot });

    // 6. Return one schema-validated update presentation value.
    return createUpdateSummary(updateExecution);
  }).pipe(Effect.mapError(toUpdateError));
