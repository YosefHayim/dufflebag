#!/usr/bin/env node
/**
 * generateReadme.mjs — auto-generates the feature table and agent skills
 * section of README.md from the source of truth (features.ts + SKILL.md files).
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

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// ─── Extract features from features.ts ──────────────────────────────────────

const featuresPath = path.join(ROOT, "src/core/catalog/features.ts");
const featuresSource = readFileSync(featuresPath, "utf8");

/** Parse the FEATURES record from TypeScript source (regex, no eval). */
function parseFeatures() {
  const features = [];
  // Match each feature block: "feature-id": { ... }
  const featureRegex = /"([^"]+)":\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
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

function parseSkills() {
  const skillsDir = path.join(ROOT, "src/skills");
  const skills = [];

  for (const name of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const skillMd = path.join(skillsDir, name.name, "SKILL.md");
    if (!existsSync(skillMd)) continue;

    const content = readFileSync(skillMd, "utf8");
    // Parse YAML frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    const fm = fmMatch[1];
    const desc =
      fm.match(/description:\s*"([^"]+)"/)?.[1] ??
      fm.match(/description:\s*'([^']+)'/)?.[1] ??
      fm.match(/description:\s*(.+)/)?.[1]?.replace(/^["']|["']$/g, "") ??
      "";
    const trigger =
      fm.match(/trigger:\s*"([^"]+)"/)?.[1] ??
      fm.match(/trigger:\s*'([^']+)'/)?.[1] ??
      fm.match(/trigger:\s*(.+)/)?.[1]?.replace(/^["']|["']$/g, "") ??
      "";

    if (desc) {
      skills.push({ name: name.name, description: desc, trigger });
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
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
  const lines = [
    "Beyond the installable hooks, dufflebag ships **agent skills** — instruction sets that coding agents (Claude Code, Kiro, Cursor) follow when triggered by natural language:",
    "",
    "| Skill | Description |",
    "| --- | --- |",
  ];
  for (const s of skills) {
    lines.push(`| **${s.name}** | ${s.description} |`);
  }
  lines.push("");
  lines.push(`Skills are installed alongside hooks into your agent's skills directory. They require no configuration — just ask your agent to do the thing (e.g. "deslop this", "grill me", "convert this PNG to code").`);
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
