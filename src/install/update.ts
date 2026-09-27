import { Path } from "@effect/platform";
import { Effect, Schema, ParseResult as SchemaParseIssue } from "effect";
import { syncInstall } from "./install.js";
import { installationLocationSchema, receiptPath } from "./installPaths.js";
import {
  agentChoiceSchema,
  configurationChoiceSchema,
  errorMessage,
  installRequestSchema,
  interactionSchema,
  platformRequirementSchema,
  preparedPackageSchema,
  selectedFeatureChoiceSchema,
} from "./installRequest.js";
import { readReceipt } from "./receipt.js";

const updateFeatureChoiceSchema = Schema.Union(
  Schema.TaggedStruct("preserve", {}).annotations({
    description: "Reuse the dependency-resolved features recorded by the current receipt.",
  }),
  selectedFeatureChoiceSchema,
).annotations({
  description: "Preserved or explicit feature selection for an existing installation.",
});

const updateRequestSchema = Schema.extend(
  installationLocationSchema,
  Schema.Struct({
    preparedPackage: preparedPackageSchema,
    features: updateFeatureChoiceSchema,
    agents: agentChoiceSchema,
    interaction: interactionSchema,
    configuration: configurationChoiceSchema,
  }),
).annotations({
  description: "Complete update capability request decoded before receipt inspection.",
});

const updateSummaryFieldsSchema = {
  scope: Schema.Literal("global", "project"),
  features: selectedFeatureChoiceSchema.fields.ids,
  agents: agentChoiceSchema.members[0].fields.ids,
  platformRequirements: Schema.Array(platformRequirementSchema),
  interaction: interactionSchema,
};

const updateSummarySchema = Schema.Union(
  Schema.TaggedStruct("updated", updateSummaryFieldsSchema),
  Schema.TaggedStruct("unchanged", updateSummaryFieldsSchema),
);

type UpdateSummary = Schema.Schema.Type<typeof updateSummarySchema>;

class UpdateError extends Schema.TaggedError<UpdateError>()("UpdateError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable update decode, receipt, sync, or application failure.",
  }),
}) {
  get message(): string {
    return `Cannot update dufflebag: ${this.issue}`;
  }
}

const decodeStrictly =
  <Decoded, Encoded>(schema: Schema.Schema<Decoded, Encoded>) =>
  (input: unknown) =>
    Schema.decodeUnknown(schema, { onExcessProperty: "error" })(input).pipe(
      Effect.mapError((error) => new UpdateError({ issue: SchemaParseIssue.TreeFormatter.formatErrorSync(error) })),
    );

export const update = (input: unknown) =>
  Effect.gen(function* () {
    const request = yield* decodeStrictly(updateRequestSchema)(input);
    const path = yield* Path.Path;
    const receiptSnapshot = yield* readReceipt(path.join(request.destination.root, receiptPath));
    if (receiptSnapshot._tag === "missing") {
      return yield* new UpdateError({ issue: "No ownership receipt exists at the requested scope." });
    }

    // A preserved selection reuses the receipt's features only; agents always come from the request.
    const featureIds = request.features._tag === "preserve" ? receiptSnapshot.receipt.features : request.features.ids;
    const installRequest = yield* decodeStrictly(installRequestSchema)({
      ...request,
      features: { _tag: "selected", ids: featureIds },
    });
    const installSummary = yield* syncInstall({ request: installRequest, receiptSnapshot });
    const updateSummary: UpdateSummary = {
      ...installSummary,
      _tag: installSummary._tag === "installed" ? "updated" : "unchanged",
    };

    return updateSummary;
  }).pipe(
    Effect.mapError((error) =>
      error instanceof UpdateError ? error : new UpdateError({ issue: errorMessage(error) }),
    ),
  );
