/**
 * Validation for every shipped skill referenced by the feature catalog. These
 * checks are cheap and catch the frontmatter mistakes that make Kimi or Kiro
 * silently skip a skill.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_FEATURES, bundledSkillsDir, FEATURES } from "../core/index.js";

interface Frontmatter {
  name?: string;
  description?: string;
  type?: string;
  arguments?: string[] | string;
}

function parseFrontmatter(file: string): { frontmatter: Frontmatter | null; body: string } {
  const text = readFileSync(file, "utf8");
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
      frontmatter.arguments = value.startsWith("[") ? JSON.parse(value) : value.split(/\s+/).filter(Boolean);
    } else if (key === "name" || key === "description" || key === "type") {
      (frontmatter as Record<string, string>)[key] = value;
    }
  }
  return { frontmatter, body: match[2] };
}

const skillRoot = bundledSkillsDir();
const skillNames = [...new Set(ALL_FEATURES.flatMap((id) => FEATURES[id].skills))];
const sourceSkillNames = readdirSync(skillRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => existsSync(path.join(skillRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

function expectValidSkillFrontmatter(dirName: string): void {
  const skillMd = path.join(skillRoot, dirName, "SKILL.md");
  expect(existsSync(skillMd)).toBe(true);

  const { frontmatter } = parseFrontmatter(skillMd);
  expect(frontmatter).not.toBeNull();
  expect(frontmatter?.name).toBe(dirName);
  expect(frontmatter?.name).toMatch(/^[a-z0-9-]+$/);
  expect((frontmatter?.name ?? "").length).toBeLessThanOrEqual(64);
  expect(frontmatter?.description).toBeTruthy();
  expect((frontmatter?.description ?? "").length).toBeLessThanOrEqual(1024);

  if (frontmatter?.type) {
    expect(["prompt", "inline", "flow"]).toContain(frontmatter.type);
  }
}

describe("shipped skills", () => {
  it.each(skillNames)("%s has valid Kimi/Kiro frontmatter", (dirName) => {
    expectValidSkillFrontmatter(dirName);
  });
});

describe("local skill sources", () => {
  it.each(sourceSkillNames)("%s has valid skill frontmatter", (dirName) => {
    expectValidSkillFrontmatter(dirName);
  });
});
