// Rewrites the marked README.md sections from the feature catalog, the SKILL.md files, the config schema and
// the environment variable list. `--check` fails instead of writing when README.md is stale.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type FeatureDefinition, featureCatalog } from "../catalog/featureCatalog.js";
import { configSettings, defaultConfig } from "../config/configSchema.js";
import { environmentVariables } from "../config/environmentVariables.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const README_PATH = path.join(ROOT, "README.md");
const SKILLS_ROOT = path.join(ROOT, "src/skills");

type CommunitySkill = { author: string; url: string; upstreamName: string };

// Skills bundled for convenience but written by others: credited in their own table, left out of the owned one.
const COMMUNITY_SKILLS: ReadonlyMap<string, CommunitySkill> = new Map([
  [
    "make-code-readable",
    { author: "Mike Cann", url: "https://github.com/mikecann/agent-skills", upstreamName: "deslop" },
  ],
  [
    "question-my-plan",
    { author: "Matt Pocock", url: "https://github.com/mattpocock/skills", upstreamName: "grill-me" },
  ],
  [
    "question-plan-with-docs",
    { author: "Matt Pocock", url: "https://github.com/mattpocock/skills", upstreamName: "grill-with-docs" },
  ],
]);

const PLATFORM_LABELS: Record<FeatureDefinition["platform"], string> = {
  any: "🟢 any OS",
  macos: "🟡 macOS",
  "macos+ghostty": "🔴 macOS + Ghostty",
};

// Keep table cells on one line.
const tableCell = (text: string): string => text.replaceAll("|", "\\|").replaceAll("\n", " ");

// Only single-line top-level values are needed, so this is not a YAML parser.
const frontmatterValue = (skill: string, key: string): string => {
  const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(skill)?.[1] || "";
  const line = frontmatter.split("\n").find((entry) => entry.startsWith(`${key}:`));
  return (line || "")
    .slice(key.length + 1)
    .trim()
    .replace(/^["']|["']$/gu, "");
};

const readSkillDescriptions = (): ReadonlyMap<string, string> =>
  new Map(
    readdirSync(SKILLS_ROOT)
      .map((directory) => path.join(SKILLS_ROOT, directory, "SKILL.md"))
      .filter((file) => existsSync(file))
      .flatMap((file) => {
        const skill = readFileSync(file, "utf8");
        const description = frontmatterValue(skill, "description");
        if (!description) {
          console.warn(`⚠️  Skipping ${file}: no description`);
          return [];
        }
        return [[frontmatterValue(skill, "name") || path.basename(path.dirname(file)), description] as const];
      }),
  );

const featuresTable = (): string =>
  [
    "| Feature | What it does | Runs on |",
    "| --- | --- | --- |",
    ...featureCatalog
      .filter((feature) => !COMMUNITY_SKILLS.has(feature.id))
      .map((feature) => `| **${feature.id}** | ${tableCell(feature.summary)} | ${PLATFORM_LABELS[feature.platform]} |`),
  ].join("\n");

const communitySection = (descriptions: ReadonlyMap<string, string>): string =>
  [
    "These skills ship with dufflebag for convenience — installable the same way (`npx ys-dufflebag install <id>`) — but they are **authored by others**, not by dufflebag. Full credit and upstream sources:",
    "",
    "| Skill | What it does | By |",
    "| --- | --- | --- |",
    ...[...COMMUNITY_SKILLS].flatMap(([id, credit]) => {
      const description = descriptions.get(id);
      return description
        ? [
            `| **${id}** | ${description} | [${credit.author}](${credit.url}) (upstream name: \`${credit.upstreamName}\`) |`,
          ]
        : [];
    }),
    "",
    "> `code-style-new-project` and `code-style-existing-project` are dufflebag-original skills that build on Matt Pocock's grilling pattern — they stay in the owned catalog above.",
  ].join("\n");

const defaultText = (value: unknown): string => (value === undefined ? "absent" : `\`${JSON.stringify(value)}\``);

const settingsSection = (): string =>
  [
    "dufflebag keeps one `config.json` in its install root: `~/.claude/dufflebag/config.json` for a global install, `.claude/dufflebag/config.json` for a project install. Change a setting with `dufflebag config set <setting> <value>`, show it with `dufflebag config show`, and reset it with `dufflebag config reset`. A file with an unknown key does not load; fix it or run `dufflebag config reset`.",
    "",
    "| Setting | config.json key | Default | What it does |",
    "| --- | --- | --- | --- |",
    ...configSettings.map(
      (setting) =>
        `| \`${setting.name}\` | \`${setting.key}\` | ${defaultText(defaultConfig[setting.key])} | ${tableCell(setting.description)} |`,
    ),
    "",
    "Lists (`duplicate-code-skip-folders`) take comma-separated values on the command line. An empty value clears a setting whose default is absent.",
    "",
    "### Environment variables",
    "",
    "Provider API keys (`GROQ_API_KEY`, `GEMINI_API_KEY`, …) keep their vendor names and are listed by `dufflebag free models`.",
    "",
    "| Variable | Default | What it does | Read by |",
    "| --- | --- | --- | --- |",
    ...environmentVariables.map(
      (variable) =>
        `| \`${variable.name}\` | ${tableCell(variable.defaultValue)} | ${tableCell(variable.purpose)} | ${variable.readBy.join(", ")} |`,
    ),
  ].join("\n");

const replaceSection = (readme: string, section: { marker: string; content: string }): string => {
  const start = `<!-- AUTO:${section.marker}:START -->`;
  const end = `<!-- AUTO:${section.marker}:END -->`;
  const startIndex = readme.indexOf(start);
  const endIndex = readme.indexOf(end);
  if (startIndex === -1 || endIndex === -1) {
    console.error(`Markers not found: ${start} / ${end}\nAdd them to README.md and re-run.`);
    process.exit(1);
  }

  return `${readme.slice(0, startIndex + start.length)}\n${section.content}\n${readme.slice(endIndex)}`;
};

const descriptions = readSkillDescriptions();
console.log(`Found ${featureCatalog.length} features, ${descriptions.size} skills, ${configSettings.length} settings`);

const currentReadme = readFileSync(README_PATH, "utf8");
const renderedReadme = [
  { marker: "FEATURES", content: featuresTable() },
  { marker: "SKILLS", content: communitySection(descriptions) },
  { marker: "SETTINGS", content: settingsSection() },
].reduce(replaceSection, currentReadme);

if (!process.argv.includes("--check")) {
  writeFileSync(README_PATH, renderedReadme);
  console.log("✅ README.md updated");
} else if (renderedReadme !== currentReadme) {
  console.error("README.md is stale. Run `pnpm generate-readme`.");
  process.exitCode = 1;
} else {
  console.log("README.md matches its sources");
}
