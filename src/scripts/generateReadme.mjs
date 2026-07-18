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
function parseFeatures() {
  const starts = [];
  // e.g. `id: "context-guard",\n  sourceDirectory:` → capture "context-guard"
  const startRegex = /id:\s*"([a-z][a-z0-9-]*)",\s*\n\s*sourceDirectory:/g;
  let match;

  while ((match = startRegex.exec(featuresSource)) !== null) {
    starts.push({ id: match[1], index: match.index });
  }

  return starts.map((start, index) => {
    const end = starts[index + 1]?.index ?? featuresSource.length;
    const block = featuresSource.slice(start.index, end);

    // e.g. `title: "Context guard"` → "Context guard"
    const title = block.match(/title:\s*"((?:\\.|[^"\\])*)"/)?.[1] ?? start.id;
    const summary =
      block
        // e.g. `summary: "One-line…"` or multiline string concat
        .match(/summary:\s*\n?\s*"((?:\\.|[^"\\])*)"/s)?.[1]
        ?.replace(/\\n/g, " ") // e.g. "line1\\nline2" → "line1 line2"
        ?.replace(/"\s*\+\s*"/g, "") ?? // e.g. `"a" + "b"` fragments → "ab"
        "";
    // e.g. `platform: "macos"` → "macos"
    const platform = block.match(/platform:\s*"([^"]+)"/)?.[1] ?? "any";

    const platformEmoji =
      platform === "any"
        ? "🟢 any OS"
        : platform === "macos"
          ? "🟡 macOS"
          : platform === "macos+ghostty"
            ? "🔴 macOS + Ghostty"
            : platform;

    return { id: start.id, title, summary, platform: platformEmoji };
  });
}

// ─── Extract skills from SKILL.md frontmatter ───────────────────────────────

/**
 * Parse a minimal YAML frontmatter block into a key/value map.
 * Only handles single-line scalar values; that is all this generator needs.
 */
function parseFrontmatter(content) {
  // e.g. "---\nname: foo\n---\n# body" → capture "name: foo"
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};

  const map = {};
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
}

/**
 * Fallback description for SKILL.md files without frontmatter.
 * Strips the optional frontmatter and the H1 title, then returns the first
 * non-empty prose line (truncated if it runs long).
 */
function fallbackDescription(content) {
  // e.g. strip YAML frontmatter then the first "# Title" heading line
  const body = content.replace(/^---\n[\s\S]*?\n---/, "").replace(/^#\s+.*$/m, "");
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("```")) continue;
    // e.g. "**Bold** [link](url)" → "Bold link"
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
    if (COMMUNITY_SKILLS[f.id]) continue; // credited in the community table instead
    lines.push(`| **${f.id}** | ${f.summary} | ${f.platform} |`);
  }
  return lines.join("\n");
}

function generateCommunitySection(skills) {
  const community = skills.filter((s) => COMMUNITY_SKILLS[s.name]);

  const lines = [
    "These skills ship in the bag for convenience — installable the same way (`npx ys-dufflebag install --features <id>`) — but they are **authored by others**, not by dufflebag. Full credit and upstream sources:",
    "",
    "| Skill | What it does | By |",
    "| --- | --- | --- |",
  ];

  for (const s of community) {
    const { author, url } = COMMUNITY_SKILLS[s.name];
    lines.push(`| **${s.name}** | ${s.description} | [${author}](${url}) |`);
  }

  lines.push("");
  lines.push(
    "> `grill-me-code-style` and `grill-me-code-style-with-docs` are dufflebag-original skills that build on Matt Pocock's grilling pattern — they stay in the owned catalog above.",
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

// Replace community-skills section
readme = replaceSection(
  readme,
  "<!-- AUTO:SKILLS:START -->",
  "<!-- AUTO:SKILLS:END -->",
  generateCommunitySection(skills),
);

writeFileSync(path.join(ROOT, "README.md"), readme);
console.log("✅ README.md updated");
