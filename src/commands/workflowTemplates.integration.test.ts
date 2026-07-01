/**
 * The single-purpose reusable legs are shipped twice — as dufflebag's own active
 * CI (`.github/workflows/`) and as the copy-templates `scaffold-ci` stamps into
 * other repos (`templates/workflows/`). They MUST stay byte-identical; this fails
 * the moment one is edited without the other. `ci.yml` (own trigger vs opt-in
 * e2e leg), `e2e.yml`, and `publish.yml` legitimately differ and are excluded.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHARED_LEGS = ["biome.yml", "typecheck.yml", "test.yml", "build.yml", "report-failure.yml"];

describe("templates/workflows stay in sync with .github/workflows", () => {
  for (const name of SHARED_LEGS) {
    it(`${name} is byte-identical in both locations`, () => {
      const active = readFileSync(path.join(repoRoot, ".github", "workflows", name), "utf8");
      const template = readFileSync(path.join(repoRoot, "templates", "workflows", name), "utf8");
      expect(template).toBe(active);
    });
  }
});
