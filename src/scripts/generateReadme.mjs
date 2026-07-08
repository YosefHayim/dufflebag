#!/usr/bin/env node
/**
 * generateReadme.mjs — auto-generates the feature table and agent skills
 * section of README.md from the source of truth (features.ts + SKILL.md files).
 *
 * Skills are discovered from dufflebag's source tree only:
 *   - src/skills/              (dufflebag-owned skills)
 *
 * Sections between marker comments are replaced on every run; everything else
 * in the README is preserved verbatim.
 *
 * Markers:
 *   <!-- AUTO:FEATURES:START --> … <!-- AUTO:FEATURES:END -->
 *   <!-- AUTO:SKILLS:START -->  … <!-- AUTO:SKILLS:END -->
 *
 * Run: `node src/scripts/generateReadme.mjs`
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const SKILL_ROOTS = [
  { root: path.join(ROOT, "src/skills"), label: "dufflebag source" },
];

// ─── Extract features from features.ts ──────────────────────────────────────

const featuresPath = path.join(ROOT, "src/core/catalog/features.ts");
const featuresSource = readFileSync(featuresPath, "utf8");

/** Parse the FEATURES record from TypeScript source (regex, no eval). */
function parseFeatures() {
  const features = [];
  // Match each feature block: `"feature-id": { ... }` or `feature-id: { ... }`
  // (biome unquotes single-word keys, so accept both quoted and bare keys).
  const featureRegex = /"?([a-z][a-z0-9-]*)"?:\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
  let match;

  while ((match = featureRegex.exec(featuresSource)) !== null) {
    const id = match[1];
    const block = match[2];

    const title = block.match(/title:\s*"([^"]+)"/)?.[1] ?? id;
    const summary = block.match(/summary:\s*\n?\s*"([^"]+(?:"\s*\+\s*"[^"]+)*)"/s)?.[1]?.replace(/"\s*\+\s*"/g, "") ?? "";
    const platform = block.match(/platform:\s*"([^"]+)"/)?.[1] ?? "any";

    const platformEmoji =
      platform === "any"
        ? "🟢 any OS"
        : platform === "macos"
          ? "🟡 macOS"
          : platform === "macos+ghostty"
            ? "🔴 macOS + Ghostty"
            : platform;

    features.push({ id, title, summary, platform: platformEmoji });
  }
  return features;
}

// ─── Extract skills from SKILL.md frontmatter ───────────────────────────────

/**
 * Parse a minimal YAML frontmatter block into a key/value map.
 * Only handles single-line scalar values; that is all this generator needs.
 */
function parseFrontmatter(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};

  const map = {};
  for (const line of fmMatch[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    value = value.replace(/^["']|["']$/g, "");
    if (key && value) map[key] = value;
  }
  return map;
}

/**
 * Fallback description for SKILL.md files without frontmatter.
 * Strips the optional frontmatter and the H1 title, then returns the first
 * non-empty prose line (truncated if it runs long).
 */
function fallbackDescription(content) {
  const body = content.replace(/^---\n[\s\S]*?\n---/, "").replace(/^#\s+.*$/m, "");
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("```")) continue;
    const plain = trimmed.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    if (plain.length > 240) return `${plain.slice(0, 237)}…`;
    return plain;
  }
  return "";
}

function scanSkillRoot(root, label) {
  if (!existsSync(root)) return [];

  const skills = [];
  // Zero-dep scan (no `glob`) so this runs in CI without `pnpm install`:
  // every `<root>/<dir>/SKILL.md` that exists, sorted for stable output.
  const skillFiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "SKILL.md"))
    .filter((file) => existsSync(file))
    .sort();
  for (const skillMd of skillFiles) {
    const dirName = path.basename(path.dirname(skillMd));
    const content = readFileSync(skillMd, "utf8");
    const fm = parseFrontmatter(content);
    const description = fm.description || fallbackDescription(content);

    skills.push({
      dirName,
      name: fm.name ?? dirName,
      description,
      trigger: fm.trigger ?? "",
      label,
    });
  }
  return skills;
}

function parseSkills() {
  const byName = new Map();

  for (const { root, label } of SKILL_ROOTS) {
    for (const skill of scanSkillRoot(root, label)) {
      if (!skill.description) {
        console.warn(`⚠️  Skipping ${skill.name}: no description or fallback prose in ${path.join(root, skill.dirName, "SKILL.md")}`);
        continue;
      }

      const existing = byName.get(skill.name);
      if (!existing) {
        byName.set(skill.name, {
          name: skill.name,
          description: skill.description,
          trigger: skill.trigger,
          labels: [label],
        });
      } else {
        existing.labels.push(label);
        if (skill.trigger && !existing.trigger) existing.trigger = skill.trigger;
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Generate the sections ──────────────────────────────────────────────────

function generateFeaturesTable(features) {
  const lines = [
    "| Feature | What it does | Runs on |",
    "| --- | --- | --- |",
  ];
  for (const f of features) {
    lines.push(`| **${f.id}** | ${f.summary} | ${f.platform} |`);
  }
  return lines.join("\n");
}

function generateSkillsSection(skills) {
  const hasTrigger = skills.some((s) => s.trigger);

  const header = hasTrigger
    ? ["| Skill | Description | Where | Trigger |", "| --- | --- | --- | --- |"]
    : ["| Skill | Description | Where |", "| --- | --- | --- |"];

  const lines = [
    "Beyond the installable hooks, dufflebag ships **agent skills** — instruction sets that coding agents (Claude Code, Kiro, Cursor) follow when triggered by natural language:",
    "",
    ...header,
  ];

  for (const s of skills) {
    const where = s.labels.join(" · ");
    if (hasTrigger) {
      lines.push(`| **${s.name}** | ${s.description} | ${where} | ${s.trigger || "—"} |`);
    } else {
      lines.push(`| **${s.name}** | ${s.description} | ${where} |`);
    }
  }

  lines.push("");
  lines.push(
    `Skills are installed alongside hooks into your agent's skills directory. They require no configuration — just ask your agent to do the thing (e.g. "deslop this", "grill me", "convert this PNG to code").`,
  );
  return lines.join("\n");
}

// ─── Replace between markers ────────────────────────────────────────────────

function replaceSection(readme, startMarker, endMarker, content) {
  const startIdx = readme.indexOf(startMarker);
  const endIdx = readme.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    console.error(`Markers not found: ${startMarker} / ${endMarker}`);
    console.error("Add them to README.md and re-run.");
    process.exit(1);
  }

  const before = readme.slice(0, startIdx + startMarker.length);
  const after = readme.slice(endIdx);
  return `${before}\n${content}\n${after}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const features = parseFeatures();
const skills = parseSkills();

console.log(`Found ${features.length} features, ${skills.length} skills`);

let readme = readFileSync(path.join(ROOT, "README.md"), "utf8");

// Replace features table
readme = replaceSection(
  readme,
  "<!-- AUTO:FEATURES:START -->",
  "<!-- AUTO:FEATURES:END -->",
  generateFeaturesTable(features),
);

// Replace skills section
readme = replaceSection(
  readme,
  "<!-- AUTO:SKILLS:START -->",
  "<!-- AUTO:SKILLS:END -->",
  generateSkillsSection(skills),
);

writeFileSync(path.join(ROOT, "README.md"), readme);
console.log("✅ README.md updated");
