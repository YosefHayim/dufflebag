import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { featureCatalog } from "../catalog/featureCatalog.js";
import { stagePackage } from "./stagePackage.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const compiledSkillsRoot = path.join(packageRoot, "dist", "src", "skills");

describe("stagePackage", () => {
  it("keeps authored source directories camelCase and catalog-aligned", () => {
    for (const feature of featureCatalog) {
      expect(feature.sourceDirectory).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
    expect(new Set(featureCatalog.map((feature) => feature.sourceDirectory)).size).toBe(featureCatalog.length);
  });

  it.effect(
    "stages runtime entrypoints and package version when dist is built",
    () =>
      Effect.gen(function* () {
        if (!existsSync(compiledSkillsRoot)) {
          // CI may run tests before build; catalog casing is still covered above.
          return;
        }

        const staged = yield* stagePackage;
        expect(staged.root.endsWith("/dist/staged") || staged.root.endsWith("\\dist\\staged")).toBe(true);
        expect(staged.version).toMatch(/^\d+\.\d+\.\d+/);

        const contextGuardRoot = path.join(staged.root, "runtime/contextGuard");
        const contextGuard = path.join(contextGuardRoot, "hooks/contextGuard.js");
        expect(readFileSync(contextGuard, "utf8")).toContain("../lib/config.js");
        expect(existsSync(path.join(contextGuardRoot, "lib/config.js"))).toBe(true);
        expect(existsSync(path.join(contextGuardRoot, "lib/io.js"))).toBe(true);

        const execution = spawnSync(process.execPath, [contextGuard], {
          input: '{"hook_event_name":"UserPromptSubmit","session_id":"stage-package-test"}',
          encoding: "utf8",
        });
        expect(execution.stderr).toBe("");
        expect(execution.status).toBe(0);
      }).pipe(Effect.provide(NodeContext.layer)),
    { timeout: 30_000 },
  );
});
