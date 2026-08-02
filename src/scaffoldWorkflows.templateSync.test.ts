/**
 * Failure reporting is shipped twice: as dufflebag's active reusable workflow
 * and as the copy-template `scaffold-ci` stamps into other repositories. The CI
 * and publish workflows legitimately differ because dufflebag's own voice tests
 * need Python and uv, while the generic templates remain Node-only.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_WORKFLOWS = ["report-failure.yml"];

describe("templates/workflows stay in sync with .github/workflows", () => {
  // Register one independently named case per shared workflow, so drift is reported by name.
  for (const name of SHARED_WORKFLOWS) {
    it(`${name} is byte-identical in both locations`, () => {
      const active = readFileSync(path.join(repoRoot, ".github", "workflows", name), "utf8");
      const template = readFileSync(path.join(repoRoot, "templates", "workflows", name), "utf8");
      expect(template).toBe(active);
    });
  }
});
