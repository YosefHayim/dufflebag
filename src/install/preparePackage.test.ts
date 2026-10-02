import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { featureCatalog } from "../catalog/featureCatalog.js";
import { preparePackage } from "./preparePackage.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const compiledHooksRoot = path.join(packageRoot, "dist", "src", "hooks");
const voiceWorker = path.join(packageRoot, "src", "hooks", "voice", "dufflebag-voice");
// preparePackage needs the compiled hooks (`pnpm build`) and the native voice worker (buildVoiceWorker.sh);
// CI runs tests before either exists, and catalog casing is still covered without them.
const packageIsBuilt = existsSync(compiledHooksRoot) && existsSync(voiceWorker);

// e.g. `from "../lib/hookConfig.js"` or `import("./duplicateIndex.js")` in a compiled runtime file
const RELATIVE_IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*)"(\.{1,2}\/[^"]+)"/g;

const unresolvedRuntimeImports = (preparedRuntimeRoot: string): ReadonlyArray<string> =>
  readdirSync(preparedRuntimeRoot, { recursive: true, encoding: "utf8" })
    .filter((relativePath) => relativePath.endsWith(".js"))
    .flatMap((relativePath) => {
      const preparedFile = path.join(preparedRuntimeRoot, relativePath);
      const specifiers = [...readFileSync(preparedFile, "utf8").matchAll(RELATIVE_IMPORT_PATTERN)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      );
      return specifiers
        .filter((specifier) => !existsSync(path.resolve(path.dirname(preparedFile), specifier)))
        .map((specifier) => `${relativePath} -> ${specifier}`);
    });

describe("preparePackage", () => {
  it("keeps authored source directories camelCase and catalog-aligned", () => {
    // Assert the casing contract on every catalog entry, not just a sample.
    for (const feature of featureCatalog) {
      expect(feature.sourceDirectory).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
    expect(new Set(featureCatalog.map((feature) => feature.sourceDirectory)).size).toBe(featureCatalog.length);
  });

  it.effect.skipIf(!packageIsBuilt)(
    "prepares runtime entrypoints and commands whose imports resolve inside the prepared tree",
    () =>
      Effect.gen(function* () {
        const prepared = yield* preparePackage;
        expect(prepared.root.endsWith("/dist/prepared") || prepared.root.endsWith("\\dist\\prepared")).toBe(true);
        expect(prepared.version).toMatch(/^\d+\.\d+\.\d+/);

        const preparedRuntimeRoot = path.join(prepared.root, "hooks");
        expect(unresolvedRuntimeImports(preparedRuntimeRoot)).toEqual([]);

        const contextGuardRoot = path.join(preparedRuntimeRoot, "contextGuard");
        const contextGuard = path.join(contextGuardRoot, "hooks/contextGuard.js");
        expect(readFileSync(contextGuard, "utf8")).toContain("../lib/hookConfig.js");
        expect(existsSync(path.join(contextGuardRoot, "lib/hookConfig.js"))).toBe(true);
        expect(existsSync(path.join(contextGuardRoot, "lib/hookOutput.js"))).toBe(true);

        // lib files that use the shared runtime import the copy beside them.
        expect(readFileSync(path.join(contextGuardRoot, "lib/stateFiles.js"), "utf8")).toContain("./hookConfig.js");

        const checkDuplicates = path.join(preparedRuntimeRoot, "duplicateCodeGuard/command/checkDuplicates.js");
        expect(readFileSync(checkDuplicates, "utf8")).not.toContain("../../lib/");
        const commandLoad = spawnSync(
          process.execPath,
          ["--input-type=module", "--eval", `await import(${JSON.stringify(pathToFileURL(checkDuplicates).href)});`],
          { encoding: "utf8" },
        );
        expect(commandLoad.stderr).toBe("");
        expect(commandLoad.status).toBe(0);

        const voiceRoot = path.join(preparedRuntimeRoot, "voice");
        // Every authored voice asset must reach the prepared tree byte-for-byte.
        const voiceAssets = [
          "refine_prompt.py",
          "refine_providers.py",
          "refine_choices.py",
          "mac_picker.py",
          "text_to_speech.py",
          "text_to_speech.py.lock",
        ];
        for (const asset of voiceAssets) {
          expect(readFileSync(path.join(voiceRoot, asset))).toEqual(
            readFileSync(path.join(packageRoot, "src/hooks/voice", asset)),
          );
        }
        // The voice hook reads transcripts through the shared hook lib, so preparing copies it beside the hook.
        expect(readFileSync(path.join(voiceRoot, "hooks/speakReply.js"), "utf8")).toContain(
          "../lib/transcriptReader.js",
        );
        expect(existsSync(path.join(voiceRoot, "lib/transcriptReader.js"))).toBe(true);

        // The hook reads its transcript under HOME, so give it a throwaway one.
        const hookHome = mkdtempSync(path.join(tmpdir(), "dufflebag-prepared-home-"));
        try {
          const execution = spawnSync(process.execPath, [contextGuard], {
            input: '{"hook_event_name":"UserPromptSubmit","session_id":"prepared-package-test"}',
            encoding: "utf8",
            env: { ...process.env, HOME: hookHome },
          });
          expect(execution.stderr).toBe("");
          expect(execution.status).toBe(0);
        } finally {
          rmSync(hookHome, { recursive: true, force: true });
        }
      }).pipe(Effect.provide(NodeContext.layer)),
    { timeout: 30_000 },
  );
});
