/** Agent-format requests accept only agents and skills exactly as the decoded catalogs declare them. */

import { Schema } from "effect";

import { type AgentDefinition, agentCatalog, agentDefinitionSchema } from "../../catalog/agentCatalog.js";
import { featureCatalog, installedSkillSchema } from "../../catalog/featureCatalog.js";

const agentsEqual = Schema.equivalence(agentDefinitionSchema);
const skillsEqual = Schema.equivalence(installedSkillSchema);
const catalogSkills = featureCatalog.flatMap((feature) =>
  feature.installedSkill._tag === "skill" ? [feature.installedSkill] : [],
);

export const isCatalogAgent = (agent: AgentDefinition): boolean =>
  agentCatalog.some((candidate) => agentsEqual(candidate, agent));

export const isCatalogSkill = (skill: Schema.Schema.Type<typeof installedSkillSchema>): boolean =>
  catalogSkills.some((candidate) => skillsEqual(candidate, skill));
