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
  it("lists dufflebag-owned skills without user-global runtime skills", () => {
    const skillsSection = autoSection("<!-- AUTO:SKILLS:START -->", "<!-- AUTO:SKILLS:END -->");

    expect(skillsSection).toContain("**readme-editor**");
    expect(skillsSection).toContain("**refresh-agent-docs**");
    expect(skillsSection).toContain("**github-repo-metadata**");
    expect(skillsSection).toContain("**png-to-code**");
    expect(skillsSection).not.toContain("**agents-sdk**");
    expect(skillsSection).not.toContain("**cloudflare**");
    expect(skillsSection).not.toContain("**expo-deployment**");
  });

  it("keeps official links for external tools and runtimes in the authored README", () => {
    const readme = readFileSync(path.resolve("README.md"), "utf8");

    expect(readme).toContain("[Claude Code](https://code.claude.com/docs/en/overview)");
    expect(readme).toContain("[Cursor](https://cursor.com/docs)");
    expect(readme).toContain("[TypeScript](https://www.typescriptlang.org/)");
    expect(readme).toContain("[Node.js](https://nodejs.org/en)");
  });
});
