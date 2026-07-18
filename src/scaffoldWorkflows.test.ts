import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { fillPublishTemplate, resolveWorkflows, scaffoldWorkflows } from "./scaffoldWorkflows.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("fillPublishTemplate", () => {
  it("substitutes every placeholder", () => {
    const out = fillPublishTemplate({
      template: "{{OWNER}}/{{REPO}} ships {{PACKAGE}} — {{OWNER}} again",
      inputs: {
        owner: "Acme",
        repo: "widget",
        packageName: "widget-cli",
      },
    });
    expect(out).toBe("Acme/widget ships widget-cli — Acme again");
    expect(out).not.toContain("{{");
  });
});

describe("resolveWorkflows", () => {
  it("fills publish.yml, passes other workflows through verbatim, and drops non-yml", () => {
    const out = resolveWorkflows({
      files: [
        { name: "ci.yml", raw: "name: CI\nuses: ./.github/workflows/biome.yml\n" },
        { name: "publish.yml", raw: "{{OWNER}}/{{REPO}} ships {{PACKAGE}}" },
        { name: "README.md", raw: "ignore me" },
      ],
      inputs: { owner: "Acme", repo: "widget", packageName: "widget-cli" },
    });
    expect(out.map((file) => file.name)).toEqual(["ci.yml", "publish.yml"]);
    expect(out.find((file) => file.name === "publish.yml")?.content).toBe("Acme/widget ships widget-cli");
    expect(out.find((file) => file.name === "ci.yml")?.content).toContain("./.github/workflows/biome.yml");
  });
});

describe("scaffoldWorkflows", () => {
  it.effect("copies the whole workflow set, templating only publish.yml", () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(path.join(tmpdir(), "dufflebag-scaffold-"));
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }));

      const result = yield* scaffoldWorkflows({
        targetRoot: dir,
        templateDirectory: path.join(REPO_ROOT, "templates", "workflows"),
        force: false,
      }).pipe(Effect.provide(NodeContext.layer));

      const workflows = path.join(dir, ".github", "workflows");
      const ciYml = readFileSync(path.join(workflows, "ci.yml"), "utf8");
      const publishYml = readFileSync(path.join(workflows, "publish.yml"), "utf8");

      expect(result.written.length).toBeGreaterThan(0);
      expect(ciYml).toContain("uses: ./.github/workflows/biome.yml");
      expect(ciYml).not.toContain("YosefHayim/dufflebag");
      // Every single-purpose leg + the opt-in e2e land alongside.
      for (const leg of ["biome.yml", "typecheck.yml", "test.yml", "build.yml", "report-failure.yml", "e2e.yml"]) {
        expect(existsSync(path.join(workflows, leg))).toBe(true);
      }
      expect(publishYml).toContain("test-pkg");
      expect(publishYml).not.toMatch(/\{\{\s*(OWNER|REPO|PACKAGE)\s*\}\}/);

      rmSync(dir, { recursive: true, force: true });
    }),
  );

  it.effect("keeps existing workflow files unless force is true", () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(path.join(tmpdir(), "dufflebag-scaffold-"));
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }));
      const templateDirectory = path.join(REPO_ROOT, "templates", "workflows");

      yield* scaffoldWorkflows({
        targetRoot: dir,
        templateDirectory,
        force: false,
      }).pipe(Effect.provide(NodeContext.layer));

      const ciPath = path.join(dir, ".github", "workflows", "ci.yml");
      writeFileSync(ciPath, "name: CUSTOMIZED\n");

      yield* scaffoldWorkflows({
        targetRoot: dir,
        templateDirectory,
        force: false,
      }).pipe(Effect.provide(NodeContext.layer));
      expect(readFileSync(ciPath, "utf8")).toBe("name: CUSTOMIZED\n");

      yield* scaffoldWorkflows({
        targetRoot: dir,
        templateDirectory,
        force: true,
      }).pipe(Effect.provide(NodeContext.layer));
      expect(readFileSync(ciPath, "utf8")).not.toBe("name: CUSTOMIZED\n");

      rmSync(dir, { recursive: true, force: true });
    }),
  );
});
