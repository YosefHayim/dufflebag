#!/usr/bin/env node
/**
 * generateReadme.mjs — auto-generates two README tables from the source of truth
 * (features.ts + SKILL.md files):
 *   - the OWNED feature catalog ("What it installs"), and
 *   - the third-party "Recommended community skills" table.
 *
 * Skills are discovered from dufflebag's source tree only:
 *   - src/skills/              (dufflebag-owned skills)
 *
 * Ownership routing: ids listed in COMMUNITY_SKILLS are filtered OUT of the owned
 * catalog and rendered (credited + linked upstream) in the community table instead.
 *
 * Sections between marker comments are replaced on every run; everything else
 * in the README is preserved verbatim.
 *
 * Markers:
 *   <!-- AUTO:FEATURES:START --> … <!-- AUTO:FEATURES:END -->  (owned catalog)
 *   <!-- AUTO:SKILLS:START -->  … <!-- AUTO:SKILLS:END -->     (community skills)
 *
 * Run: `node scripts/generateReadme.mjs`
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SKILL_ROOTS = [{ root: path.join(ROOT, "src/skills"), label: "dufflebag source" }];

/**
 * Shipped skills that are NOT dufflebag-original — bundled for convenience but
 * authored by others. This is the SSOT for third-party attribution: these ids are
 * filtered out of the owned catalog and listed (credited + linked) in a separate
 * "Recommended community skills" table. The typed feature catalog (features.ts)
 * and the vendored skill folders are deliberately left untouched.
 *
 * @type {Record<string, { author: string; url: string }>}
 */
const COMMUNITY_SKILLS = {
  deslop: { author: "Mike Cann", url: "https://github.com/mikecann/agent-skills" },
  "grill-me": { author: "Matt Pocock", url: "https://github.com/mattpocock/skills" },
  "grill-with-docs": { author: "Matt Pocock", url: "https://github.com/mattpocock/skills" },
};

// ─── Extract features from featureCatalog.ts ────────────────────────────────

const featuresPath = path.join(ROOT, "src/catalog/featureCatalog.ts");
const featuresSource = readFileSync(featuresPath, "utf8");

/**
 * Parse the decoded feature catalog from TypeScript source (regex, no eval).
 * Entries are array objects that open with `id: "…"` immediately followed by
 * `sourceDirectory:` — that pairing uniquely identifies top-level features
 * (installed-skill nested ids never carry a sourceDirectory).
 */
const parseFeatures = () => {
  const starts = [];
  // e.g. `id: "context-guard",\n  sourceDirectory:` → capture "context-guard"
  const startRegex = /id:\s*"([a-z][a-z0-9-]*)",\s*\n\s*sourceDirectory:/g;
  let match = startRegex.exec(featuresSource);

  // Drive the global regex to exhaustion so every entry's start offset is recorded.
  while (match !== null) {
    starts.push({ id: match[1], index: match.index });
    match = startRegex.exec(featuresSource);
  }

  return starts.map((start, index) => {
    const nextFeature = starts.at(index + 1);
    const end = nextFeature === undefined ? featuresSource.length : nextFeature.index;
    const block = featuresSource.slice(start.index, end);

    // e.g. `title: "Context guard"` → "Context guard"
    const title = block.match(/title:\s*"((?:\\.|[^"\\])*)"/)?.[1] || start.id;
    const summaryMatch = block.match(/summary:\s*\n?\s*"((?:\\.|[^"\\])*)"/s)?.[1];
    const summary = summaryMatch === undefined ? "" : summaryMatch.replace(/\\n/g, " ").replace(/"\s*\+\s*"/g, "");
    // e.g. `platform: "macos"` → "macos"
    const platform = block.match(/platform:\s*"([^"]+)"/)?.[1] || "any";
    const platformLabels = {
      any: "🟢 any OS",
      macos: "🟡 macOS",
      "macos+ghostty": "🔴 macOS + Ghostty",
    };
    const platformEmoji = platformLabels[platform] || platform;

    return { id: start.id, title, summary, platform: platformEmoji };
  });
};

// ─── Extract skills from SKILL.md frontmatter ───────────────────────────────

/**
 * Parse a minimal YAML frontmatter block into a key/value map.
 * Only handles single-line scalar values; that is all this generator needs.
 */
const parseFrontmatter = (content) => {
  // e.g. "---\nname: foo\n---\n# body" → capture "name: foo"
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};

  const map = {};
  // Fold the scalar lines into one lookup so callers can read fields by name.
  for (const line of fmMatch[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // e.g. `"quoted"` or `'quoted'` → quoted
    value = value.replace(/^["']|["']$/g, "");
    if (key && value) map[key] = value;
  }
  return map;
};

/**
 * Fallback description for SKILL.md files without frontmatter.
 * Strips the optional frontmatter and the H1 title, then returns the first
 * non-empty prose line (truncated if it runs long).
 */
const fallbackDescription = (content) => {
  // e.g. strip YAML frontmatter then the first "# Title" heading line
  const readmeSection = content.replace(/^---\n[\s\S]*?\n---/, "").replace(/^#\s+.*$/m, "");
  // Stop at the first prose line; blanks, headings, and fences are not descriptions.
  for (const line of readmeSection.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("```")) continue;
    // e.g. "**Bold** [link](url)" → "Bold link"
    const plain = trimmed.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    if (plain.length > 240) return `${plain.slice(0, 237)}…`;
    return plain;
  }
  return "";
};

const scanSkillRoot = (root, label) => {
  if (!existsSync(root)) return [];

  const skills = [];
  // Zero-dep scan (no `glob`) so this runs in CI without `pnpm install`:
  // every `<root>/<dir>/SKILL.md` that exists, sorted for stable output.
  const skillFiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "SKILL.md"))
    .filter((file) => existsSync(file))
    .sort();
  // Read each SKILL.md in the sorted order above so the generated tables stay stable.
  for (const skillMd of skillFiles) {
    const dirName = path.basename(path.dirname(skillMd));
    const content = readFileSync(skillMd, "utf8");
    const fm = parseFrontmatter(content);
    const description = fm.description || fallbackDescription(content);

    skills.push({
      dirName,
      root,
      name: fm.name || dirName,
      description,
      trigger: fm.trigger || "",
      label,
    });
  }
  return skills;
};

/** Keep only skills that carry prose, naming the file of each one dropped. */
const keepDescribedSkill = (skill) => {
  if (skill.description) return true;

  console.warn(
    `⚠️  Skipping ${skill.name}: no description or fallback prose in ${path.join(skill.root, skill.dirName, "SKILL.md")}`,
  );
  return false;
};

/** The catalog row contributed by the first root that supplies a skill. */
const firstSkillRow = (skill) => ({
  name: skill.name,
  description: skill.description,
  trigger: skill.trigger,
  labels: [skill.label],
});

/** A later root only adds its label and fills a trigger the first root lacked. */
const mergedSkillRow = (existing, skill) => ({
  ...existing,
  trigger: skill.trigger && !existing.trigger ? skill.trigger : existing.trigger,
  labels: [...existing.labels, skill.label],
});

const parseSkills = () => {
  const described = SKILL_ROOTS.flatMap(({ root, label }) => scanSkillRoot(root, label)).filter(keepDescribedSkill);
  const byName = new Map();

  // Merge duplicates across roots: the first root's prose wins, later roots only add labels.
  for (const skill of described) {
    const existing = byName.get(skill.name);
    byName.set(skill.name, existing ? mergedSkillRow(existing, skill) : firstSkillRow(skill));
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
};

// ─── Generate the sections ──────────────────────────────────────────────────

const generateFeaturesTable = (features) => {
  const lines = ["| Feature | What it does | Runs on |", "| --- | --- | --- |"];
  // Preserve catalog order in the rendered table; community skills are credited elsewhere.
  for (const f of features) {
    if (COMMUNITY_SKILLS[f.id]) continue; // credited in the community table instead
    lines.push(`| **${f.id}** | ${f.summary} | ${f.platform} |`);
  }
  return lines.join("\n");
};

const generateCommunitySection = (skills) => {
  const community = skills.filter((s) => COMMUNITY_SKILLS[s.name]);

  const lines = [
    "These skills ship in the bag for convenience — installable the same way (`npx ys-dufflebag install <id>`) — but they are **authored by others**, not by dufflebag. Full credit and upstream sources:",
    "",
    "| Skill | What it does | By |",
    "| --- | --- | --- |",
  ];

  // One credited row per community skill, in the same sorted order as the scan.
  for (const s of community) {
    const { author, url } = COMMUNITY_SKILLS[s.name];
    lines.push(`| **${s.name}** | ${s.description} | [${author}](${url}) |`);
  }

  lines.push("");
  lines.push(
    "> `grill-me-code-style` and `grill-me-code-style-with-docs` are dufflebag-original skills that build on Matt Pocock's grilling pattern — they stay in the owned catalog above.",
  );
  return lines.join("\n");
};

// ─── Replace between markers ────────────────────────────────────────────────

const replaceSection = ({ readme, startMarker, endMarker, content }) => {
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
};

// ─── Main ───────────────────────────────────────────────────────────────────

const features = parseFeatures();
const skills = parseSkills();
const checkOnly = process.argv.includes("--check");

console.log(`Found ${features.length} features, ${skills.length} skills`);

const readmePath = path.join(ROOT, "README.md");
const currentReadme = readFileSync(readmePath, "utf8");
let renderedReadme = currentReadme;

// Replace features table
renderedReadme = replaceSection({
  readme: renderedReadme,
  startMarker: "<!-- AUTO:FEATURES:START -->",
  endMarker: "<!-- AUTO:FEATURES:END -->",
  content: generateFeaturesTable(features),
});

// Replace community-skills section
renderedReadme = replaceSection({
  readme: renderedReadme,
  startMarker: "<!-- AUTO:SKILLS:START -->",
  endMarker: "<!-- AUTO:SKILLS:END -->",
  content: generateCommunitySection(skills),
});

if (checkOnly) {
  if (renderedReadme !== currentReadme) {
    console.error("README.md is stale. Run `pnpm generate-readme`.");
    process.exitCode = 1;
  } else {
    console.log("README.md matches its generated sections");
  }
} else {
  writeFileSync(readmePath, renderedReadme);
  console.log("✅ README.md updated");
}
