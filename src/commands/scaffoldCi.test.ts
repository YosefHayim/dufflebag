/**
 * Tests for `scaffold-ci`: the pure resolvers (publish placeholder fill +
 * verbatim pass-through) with no disk, plus a temp-dir integration proving the
 * whole workflow set is copied, only publish.yml is templated, and existing files
 * are preserved unless `--force`.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fillPublishTemplate, resolveWorkflows, scaffoldCi } from "./scaffoldCi.js";

describe("fillPublishTemplate", () => {
  it("substitutes every placeholder", () => {
    const out = fillPublishTemplate("{{OWNER}}/{{REPO}} ships {{PACKAGE}} — {{OWNER}} again", {
      owner: "Acme",
      repo: "widget",
      packageName: "widget-cli",
    });
    expect(out).toBe("Acme/widget ships widget-cli — Acme again");
    expect(out).not.toContain("{{");
  });
});

describe("resolveWorkflows", () => {
  it("fills publish.yml, passes other workflows through verbatim, and drops non-yml", () => {
    const out = resolveWorkflows(
      [
        { name: "ci.yml", raw: "name: CI\nuses: ./.github/workflows/biome.yml\n" },
        { name: "publish.yml", raw: "{{OWNER}}/{{REPO}} ships {{PACKAGE}}" },
        { name: "README.md", raw: "ignore me" },
      ],
      { owner: "Acme", repo: "widget", packageName: "widget-cli" },
    );
    expect(out.map((f) => f.name)).toEqual(["ci.yml", "publish.yml"]);
    expect(out.find((f) => f.name === "publish.yml")?.content).toBe("Acme/widget ships widget-cli");
    expect(out.find((f) => f.name === "ci.yml")?.content).toContain("./.github/workflows/biome.yml");
  });
});

describe("scaffoldCi (integration)", () => {
  it("copies the whole workflow set, templating only publish.yml", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dufflebag-scaffold-"));
    try {
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }));
      scaffoldCi({ path: dir });

      const workflows = path.join(dir, ".github", "workflows");
      const ciYml = readFileSync(path.join(workflows, "ci.yml"), "utf8");
      const publishYml = readFileSync(path.join(workflows, "publish.yml"), "utf8");

      // Copy model: ci.yml composes local legs; it does NOT reference dufflebag remotely.
      expect(ciYml).toContain("uses: ./.github/workflows/biome.yml");
      expect(ciYml).not.toContain("YosefHayim/dufflebag");
      // Every single-purpose leg + the opt-in e2e land alongside.
      for (const leg of ["biome.yml", "typecheck.yml", "test.yml", "build.yml", "report-failure.yml", "e2e.yml"]) {
        expect(existsSync(path.join(workflows, leg))).toBe(true);
      }
      // publish.yml is the only templated file — placeholders filled, none left.
      expect(publishYml).toContain("test-pkg");
      expect(publishYml).not.toMatch(/\{\{\s*(OWNER|REPO|PACKAGE)\s*\}\}/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps existing workflow files unless --force", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dufflebag-scaffold-"));
    try {
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }));
      const ciPath = path.join(dir, ".github", "workflows", "ci.yml");
      scaffoldCi({ path: dir });
      writeFileSync(ciPath, "name: CUSTOMIZED\n");

      scaffoldCi({ path: dir }); // no force — must not clobber a repo's customization
      expect(readFileSync(ciPath, "utf8")).toBe("name: CUSTOMIZED\n");

      scaffoldCi({ path: dir, force: true }); // force — resync overwrites
      expect(readFileSync(ciPath, "utf8")).not.toBe("name: CUSTOMIZED\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
