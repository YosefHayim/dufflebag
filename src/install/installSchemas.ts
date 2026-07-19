import { Schema } from "effect";

import { agentEvidenceSchema, agentIdSchema } from "../catalog/agentCatalog.js";
import { featureIdSchema, featurePlatformSchema } from "../catalog/featureCatalog.js";
import { managedConfigFileSchema } from "../config/configFile.js";
import { absoluteRootSchema } from "./artifactPlan.js";
import { versionSchema } from "./artifactReceipt.js";

export const receiptPath = ".claude/dufflebag/receipt.json";
export const runtimePath = ".claude/dufflebag/runtime";

const hasUnsafeInstallationPathCharacter = (root: string): boolean =>
  Array.from(root).some((character) => {
    const codePoint = character.codePointAt(0);

    return (
      character === '"' ||
      character === "`" ||
      character === "$" ||
      character === "\\" ||
      codePoint === undefined ||
      codePoint < 32 ||
      codePoint === 127
    );
  });

const installationRootSchema = absoluteRootSchema.pipe(
  Schema.filter((root) => !hasUnsafeInstallationPathCharacter(root), {
    message: () => "Installation roots must not contain shell-expanding or control characters.",
  }),
);

export const installationDestinationSchema = Schema.Union(
  Schema.TaggedStruct("global", {
    root: installationRootSchema.annotations({
      description: "Absolute home root that receives one global installation.",
    }),
  }),
  Schema.TaggedStruct("project", {
    root: installationRootSchema.annotations({
      description: "Absolute project root that receives one project installation.",
    }),
  }),
).annotations({
  description: "Exactly one installation scope and its corresponding filesystem root.",
});

export const installationHostSchema = Schema.Struct({
  homeRoot: installationRootSchema.annotations({
    description: "Canonicalizable home root used only for the global installation/config scope.",
  }),
}).annotations({
  description: "Host path evidence captured by the CLI edge before capability reconciliation.",
});

export const installationLocationSchema = Schema.Struct({
  destination: installationDestinationSchema,
  host: installationHostSchema,
}).pipe(
  Schema.filter((location) =>
    location.destination._tag === "global" && location.destination.root !== location.host.homeRoot
      ? {
          path: ["host", "homeRoot"],
          message: "A global installation destination must equal the captured home root.",
        }
      : undefined,
  ),
);

export const selectedFeatureChoiceSchema = Schema.TaggedStruct("selected", {
  ids: Schema.Array(featureIdSchema).annotations({
    description: "Explicit public feature IDs expanded through catalog dependencies.",
  }),
});

const featureChoiceSchema = Schema.Union(
  Schema.TaggedStruct("defaults", {}).annotations({
    description: "Catalog features selected by default.",
  }),
  selectedFeatureChoiceSchema,
).annotations({
  description: "Default or explicit feature selection without behavior flags.",
});

const selectedAgentChoiceSchema = Schema.TaggedStruct("selected", {
  ids: Schema.Array(agentIdSchema).annotations({
    description: "Explicit public agent IDs receiving native artifacts.",
  }),
});

export const agentChoiceSchema = Schema.Union(
  selectedAgentChoiceSchema,
  Schema.TaggedStruct("detected", {
    evidence: agentEvidenceSchema.annotations({
      description: "Observed evidence classified against the decoded agent catalog.",
    }),
  }),
).annotations({
  description: "Explicit or evidence-derived agent selection.",
});

export const interactionSchema = Schema.Union(Schema.TaggedStruct("interactive", {}), Schema.TaggedStruct("scripted", {})).annotations({
  description: "Caller interaction mode retained for presentation at the CLI edge.",
});

export const configurationChoiceSchema = Schema.Union(
  Schema.TaggedStruct("automatic", {}).annotations({
    description: "Reuse this scope's config, inherit once for a project, or use schema defaults.",
  }),
  Schema.TaggedStruct("selected", {
    config: managedConfigFileSchema.annotations({
      description: "Complete validated configuration explicitly selected by the caller.",
    }),
  }),
).annotations({
  description: "Automatic or explicit complete configuration selection.",
});

export const stagedPackageSchema = Schema.Struct({
  root: absoluteRootSchema.annotations({
    description: "Absolute staged dist root containing only verified skills and runtime files.",
  }),
  version: versionSchema.annotations({
    description: "Semantic package version published in the ownership receipt.",
  }),
}).annotations({
  description: "Verified staged package consumed by installation.",
});

export const installRequestSchema = Schema.extend(
  installationLocationSchema,
  Schema.Struct({
    stagedPackage: stagedPackageSchema,
    features: featureChoiceSchema,
    agents: agentChoiceSchema,
    interaction: interactionSchema,
    configuration: configurationChoiceSchema,
  }),
).pipe(
  Schema.annotations({
    description: "Complete install capability request decoded before filesystem inspection.",
  }),
);

export type InstallRequest = Schema.Schema.Type<typeof installRequestSchema>;

export const platformRequirementSchema = Schema.Struct({
  featureId: featureIdSchema.annotations({
    description: "Selected feature that declared this host requirement.",
  }),
  platform: featurePlatformSchema,
}).annotations({
  description: "Catalog-correlated host requirement surfaced without hidden environment probing.",
});

const installResultFieldsSchema = {
  scope: Schema.Literal("global", "project").annotations({
    description: "Scope reconciled by this capability call.",
  }),
  features: Schema.Array(featureIdSchema).annotations({
    description: "Dependency-resolved features in catalog order.",
  }),
  agents: Schema.Array(agentIdSchema).annotations({
    description: "Selected agents in catalog order.",
  }),
  platformRequirements: Schema.Array(platformRequirementSchema).annotations({
    description: "Platform requirement for every dependency-resolved selected feature.",
  }),
  interaction: interactionSchema,
};

export const installResultSchema = Schema.Union(
  Schema.TaggedStruct("installed", installResultFieldsSchema),
  Schema.TaggedStruct("unchanged", installResultFieldsSchema),
).annotations({
  description: "Applied or already-current installation result.",
});

export type InstallResult = Schema.Schema.Type<typeof installResultSchema>;

export class InstallError extends Schema.TaggedError<InstallError>()("InstallError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable decode, inspection, planning, or application failure.",
  }),
}) {
  get message(): string {
    return `Cannot install dufflebag: ${this.issue}`;
  }
}
