/**
 * Skill writer — handles writing skill content into any supported agent based
 * on its {@link SkillInstallMode}.
 *
 * The source of truth for all agents is the same `src/skills/<name>/SKILL.md`.
 * For skills-dir agents the entire folder is copied (SKILL.md + ships). For all
 * other modes the YAML frontmatter is stripped and the body is used as plain
 * markdown — appended, written as a rule file, or referenced from a config.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { FeatureId } from "../catalog/types.js";
import { bundledSkillsDir, copyDir, ensureDir, removeSymlink } from "../fs.js";
import { AGENT_CONFIGS, type AgentId, type AgentInstallConfig } from "./agents.js";

// Re-export for the install command's convenience.
export { AGENT_CONFIGS };

// --- Frontmatter stripping --------------------------------------------------

/** Dufflebag-managed block markers for single-file agents. */
const BLOCK_START = "<!-- dufflebag:skills start -->";
const BLOCK_END = "<!-- dufflebag:skills end -->";

/**
 * Strip YAML frontmatter (leading `---`…`---` block) from a SKILL.md file and
 * return the body. If no frontmatter is present, returns the content as-is.
 */
export function stripFrontmatter(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return content;
  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) return content;
  // Skip past the closing `---` and the newline after it.
  return trimmed.slice(endIdx + 4).trimStart();
}

/**
 * Collect the plain-markdown body for each skill of the given features. Returns
 * an array of `{ name, body }` pairs. Performs the `@@CTL@@` template replacement.
 */
function collectSkillBodies(
  features: FeatureId[],
  featureCatalog: Record<string, { skills: string[] }>,
  ctl: string,
): { name: string; body: string }[] {
  const seen = new Set<string>();
  const results: { name: string; body: string }[] = [];
  for (const id of features) {
    const feature = featureCatalog[id];
    if (!feature) continue;
    for (const name of feature.skills) {
      if (seen.has(name)) continue;
      seen.add(name);
      const skillMd = path.join(bundledSkillsDir(), name, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      const raw = readFileSync(skillMd, "utf8").replaceAll("@@CTL@@", ctl);
      results.push({ name, body: stripFrontmatter(raw) });
    }
  }
  return results;
}

// --- Install modes ----------------------------------------------------------

/**
 * Install skills into a skills-dir agent (Claude, Kiro, Kimi). Each skill is a
 * folder containing SKILL.md and any declared ship files.
 */
function installSkillsDir(
  config: AgentInstallConfig,
  scopeRoot: string,
  features: FeatureId[],
  featureCatalog: Record<string, { skills: string[]; ships: string[] }>,
  ctl: string,
): void {
  if (!config.skillsDir) return;
  const targetDir = path.join(scopeRoot, config.skillsDir);
  ensureDir(targetDir);
  for (const id of features) {
    const feature = featureCatalog[id];
    if (!feature) continue;
    for (const name of feature.skills) {
      const src = path.join(bundledSkillsDir(), name);
      const dest = path.join(targetDir, name);
      // Replace pre-existing symlinks with real directories so we don't follow
      // the link and corrupt the symlink target during the copy.
      removeSymlink(dest);
      for (const rel of feature.ships) copyDir(path.join(src, rel), path.join(dest, rel));
      const skillMd = path.join(dest, "SKILL.md");
      if (existsSync(skillMd)) {
        writeFileSync(skillMd, readFileSync(skillMd, "utf8").replaceAll("@@CTL@@", ctl), "utf8");
      }
    }
  }
}

/**
 * Install skills into a rules-file agent (Cursor). Each skill becomes a
 * separate file in the rules directory.
 */
function installRulesFile(
  config: AgentInstallConfig,
  scopeRoot: string,
  features: FeatureId[],
  featureCatalog: Record<string, { skills: string[] }>,
  ctl: string,
): void {
  if (!config.rulesDir) return;
  const rulesDir = path.join(scopeRoot, config.rulesDir);
  ensureDir(rulesDir);
  const bodies = collectSkillBodies(features, featureCatalog, ctl);
  const ext = config.ruleExt ?? ".md";
  for (const { name, body } of bodies) {
    writeFileSync(path.join(rulesDir, `${name}${ext}`), body, "utf8");
  }
}

/**
 * Install skills into a single-file agent (Windsurf, Cline, Codex, Gemini,
 * Cody, Junie). All skill bodies are merged into one managed block within the
 * target file.
 */
function installSingleFile(
  config: AgentInstallConfig,
  scopeRoot: string,
  features: FeatureId[],
  featureCatalog: Record<string, { skills: string[] }>,
  ctl: string,
): void {
  if (!config.targetFile) return;
  const targetPath = path.join(scopeRoot, config.targetFile);
  ensureDir(path.dirname(targetPath));
  const bodies = collectSkillBodies(features, featureCatalog, ctl);
  if (bodies.length === 0) return;

  const merged = bodies.map((b) => `## ${b.name}\n\n${b.body}`).join("\n\n---\n\n");
  const block = `${BLOCK_START}\n${merged}\n${BLOCK_END}`;

  // Read existing content (if any), replace or append managed block.
  const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  const startIdx = existing.indexOf(BLOCK_START);
  const endIdx = existing.indexOf(BLOCK_END);

  let result: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing managed block.
    result = existing.slice(0, startIdx) + block + existing.slice(endIdx + BLOCK_END.length);
  } else {
    // Append.
    const base = existing.trimEnd();
    result = base.length > 0 ? `${base}\n\n${block}\n` : `${block}\n`;
  }
  writeFileSync(targetPath, result, "utf8");
}

/**
 * Install skills into a config-ref agent (Aider, Continue). Writes AGENTS.md
 * as the single-file target AND updates the config to reference it.
 */
function installConfigRef(
  config: AgentInstallConfig,
  scopeRoot: string,
  features: FeatureId[],
  featureCatalog: Record<string, { skills: string[] }>,
  ctl: string,
): void {
  // First, write the target file (same as single-file mode).
  if (config.targetFile) {
    installSingleFile({ ...config, mode: "single-file" }, scopeRoot, features, featureCatalog, ctl);
  }

  // Then update the config file to reference the target.
  if (!config.configFile) return;
  const configPath = path.join(scopeRoot, config.configFile);
  ensureDir(path.dirname(configPath));

  if (config.id === "aider") {
    // .aider.conf.yml: ensure `read:` array includes AGENTS.md
    const targetRef = config.targetFile ?? "AGENTS.md";
    let content = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    if (!content.includes(targetRef)) {
      const line = `\nread:\n  - ${targetRef}\n`;
      // If `read:` already exists, append the entry.
      if (content.includes("read:")) {
        content = content.replace(/^(read:\s*\n)/m, `$1  - ${targetRef}\n`);
      } else {
        content = content.trimEnd() + (content.length > 0 ? "\n" : "") + line;
      }
      writeFileSync(configPath, content, "utf8");
    }
  } else if (config.id === "continue") {
    // .continue/config.json: add a rules entry pointing at AGENTS.md
    const targetRef = config.targetFile ?? "AGENTS.md";
    let configObj: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        configObj = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      } catch {
        // If unreadable, start fresh.
      }
    }
    const rules = (configObj.rules as string[] | undefined) ?? [];
    if (!rules.includes(targetRef)) {
      rules.push(targetRef);
      configObj.rules = rules;
    }
    writeFileSync(configPath, `${JSON.stringify(configObj, null, 2)}\n`, "utf8");
  }
}

// --- Public API -------------------------------------------------------------

/**
 * Install skills for a specific agent based on its install mode. This is the
 * single entry point the install command uses for every non-Claude-hooks agent.
 */
export function writeSkillsForAgent(
  agentId: AgentId,
  scopeRoot: string,
  features: FeatureId[],
  featureCatalog: Record<string, { skills: string[]; ships: string[] }>,
  ctl: string,
): void {
  const config = AGENT_CONFIGS[agentId];
  switch (config.mode) {
    case "skills-dir":
      installSkillsDir(config, scopeRoot, features, featureCatalog, ctl);
      break;
    case "rules-file":
      installRulesFile(config, scopeRoot, features, featureCatalog, ctl);
      break;
    case "single-file":
      installSingleFile(config, scopeRoot, features, featureCatalog, ctl);
      break;
    case "config-ref":
      installConfigRef(config, scopeRoot, features, featureCatalog, ctl);
      break;
  }
}

/**
 * Remove dufflebag-managed skill content for a single-file or config-ref agent.
 * Strips the managed block from the target file.
 */
export function removeSkillsForAgent(agentId: AgentId, scopeRoot: string): void {
  const config = AGENT_CONFIGS[agentId];
  if (config.mode === "single-file" || config.mode === "config-ref") {
    if (!config.targetFile) return;
    const targetPath = path.join(scopeRoot, config.targetFile);
    if (!existsSync(targetPath)) return;
    const content = readFileSync(targetPath, "utf8");
    const startIdx = content.indexOf(BLOCK_START);
    const endIdx = content.indexOf(BLOCK_END);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const before = content.slice(0, startIdx).replace(/\n+$/, "");
      const after = content.slice(endIdx + BLOCK_END.length).replace(/^\n+/, "");
      const result = [before, after].filter((p) => p.length > 0).join("\n\n") + (before.length > 0 || after.length > 0 ? "\n" : "");
      writeFileSync(targetPath, result, "utf8");
    }
  }
  // For rules-file: caller would remove the individual rule files.
  // For skills-dir: caller removes the skill folders directly (existing behavior).
}
