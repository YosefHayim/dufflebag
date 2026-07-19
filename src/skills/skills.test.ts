/**
 * Validation for every shipped skill referenced by the feature catalog. These
 * checks are cheap and catch the frontmatter mistakes that make Kimi or Kiro
 * silently skip a skill.
 *
 * Authored directories are camelCase (`sourceDirectory`). Public installed
 * skill IDs (and SKILL.md `name`) remain kebab-case data.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { featureCatalog, installedSkillsFor } from "../catalog/featureCatalog.js";

type Frontmatter = {
  name?: string;
  description?: string;
  type?: string;
  arguments?: string[] | string;
};

const parseFrontmatter = (file: string): { frontmatter: Frontmatter | null; body: string } => {
  const text = readFileSync(file, "utf8");
  // e.g. "---\nname: foo\n---\n# body" → groups: frontmatter block, body
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: text };
  const lines = match[1].split("\n");
  const frontmatter: Frontmatter = {};
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === "arguments") {
      // e.g. "stop exit" → ["stop","exit"] (JSON array also accepted)
      frontmatter.arguments = value.startsWith("[") ? JSON.parse(value) : value.split(/\s+/).filter(Boolean);
    } else if (key === "name" || key === "description" || key === "type") {
      frontmatter[key] = value;
    }
  }
  return { frontmatter, body: match[2] };
};

const skillRoot = path.dirname(fileURLToPath(import.meta.url));

const installedSkills = installedSkillsFor(featureCatalog.map((feature) => feature.id)).map((skill) => {
  const feature = featureCatalog.find((candidate) => candidate.installedSkill._tag === "skill" && candidate.installedSkill.id === skill.id);
  if (feature === undefined) {
    throw new Error(`Installed skill ${skill.id} is missing a catalog feature.`);
  }
  return {
    skillId: skill.id,
    sourceDirectory: feature.sourceDirectory,
  };
});

const sourceSkillDirectories = readdirSync(skillRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => existsSync(path.join(skillRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

const expectValidSkillFrontmatter = (skillMd: string, expectedName: string): void => {
  expect(existsSync(skillMd)).toBe(true);

  const { frontmatter } = parseFrontmatter(skillMd);
  expect(frontmatter).not.toBeNull();
  expect(frontmatter?.name).toBe(expectedName);
  // e.g. "png-to-code", "autorun" — not "PngToCode"
  expect(frontmatter?.name).toMatch(/^[a-z0-9-]+$/);
  expect((frontmatter?.name ?? "").length).toBeLessThanOrEqual(64);
  expect(frontmatter?.description).toBeTruthy();
  expect((frontmatter?.description ?? "").length).toBeLessThanOrEqual(1024);

  if (frontmatter?.type) {
    expect(["prompt", "inline", "flow"]).toContain(frontmatter.type);
  }
};

describe("shipped skills", () => {
  it.each(installedSkills)("$skillId has valid Kimi/Kiro frontmatter under $sourceDirectory", ({ skillId, sourceDirectory }) => {
    expectValidSkillFrontmatter(path.join(skillRoot, sourceDirectory, "SKILL.md"), skillId);
  });
});

describe("local skill sources", () => {
  it.each(sourceSkillDirectories)("%s is camelCase and has valid skill frontmatter", (sourceDirectory) => {
    // e.g. "pngToCode" — not "png-to-code"
    expect(sourceDirectory).toMatch(/^[a-z][a-zA-Z0-9]*$/);

    const feature = featureCatalog.find((candidate) => candidate.sourceDirectory === sourceDirectory);
    // e.g. "pngToCode" → "png-to-code" when catalog has no installed skill id
    const expectedName =
      feature?.installedSkill._tag === "skill"
        ? feature.installedSkill.id
        : sourceDirectory.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

    expectValidSkillFrontmatter(path.join(skillRoot, sourceDirectory, "SKILL.md"), expectedName);
  });
});
