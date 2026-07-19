import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function autoSection(startMarker: string, endMarker: string): string {
  const readme = readFileSync(path.resolve("README.md"), "utf8");
  const startIndex = readme.indexOf(startMarker);
  const endIndex = readme.indexOf(endMarker);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return readme.slice(startIndex + startMarker.length, endIndex);
}

describe("README generation", () => {
  it("lists dufflebag-owned skills in the catalog, minus community and user-global skills", () => {
    const catalog = autoSection("<!-- AUTO:FEATURES:START -->", "<!-- AUTO:FEATURES:END -->");

    expect(catalog).toContain("**readme-editor**");
    expect(catalog).toContain("**refresh-agent-docs**");
    expect(catalog).toContain("**github-repo-metadata**");
    expect(catalog).toContain("**png-to-code**");

    // Third-party skills are credited in the community table, not the owned catalog.
    expect(catalog).not.toContain("**deslop**");
    expect(catalog).not.toContain("**grill-me**");
    expect(catalog).not.toContain("**grill-with-docs**");

    // User-global runtime skills never leak in.
    expect(catalog).not.toContain("**agents-sdk**");
    expect(catalog).not.toContain("**cloudflare**");
    expect(catalog).not.toContain("**expo-deployment**");
  });

  it("credits third-party skills in a separate community table with upstream links", () => {
    const community = autoSection("<!-- AUTO:SKILLS:START -->", "<!-- AUTO:SKILLS:END -->");

    expect(community).toContain("**deslop**");
    expect(community).toContain("**grill-me**");
    expect(community).toContain("**grill-with-docs**");
    expect(community).toContain("https://github.com/mattpocock/skills");
    expect(community).toContain("https://github.com/mikecann/agent-skills");

    // Owned skills are not duplicated into the community table.
    expect(community).not.toContain("**png-to-code**");
    expect(community).not.toContain("**readme-editor**");
  });

  it("keeps official links for external tools and runtimes in the authored README", () => {
    const readme = readFileSync(path.resolve("README.md"), "utf8");

    expect(readme).toContain("[Claude Code](https://code.claude.com/docs/en/overview)");
    expect(readme).toContain("[Cursor](https://cursor.com/docs)");
    expect(readme).toContain("[TypeScript](https://www.typescriptlang.org/)");
    expect(readme).toContain("[Node.js](https://nodejs.org/en)");
  });
});
