import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildDuplicateIndex } from "./duplicateIndex.js";
import { scanForDuplicates } from "./findDuplicates.js";

describe("buildDuplicateIndex on disk", () => {
  let repoRoot: string;
  beforeAll(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "duplicate-index-"));
    writeFileSync(path.join(repoRoot, "a.ts"), "export function add(x: number, y: number) { return x + y; }");
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "b.ts"), "export function sum(a: number, b: number) { return a + b; }");
    // A copy inside node_modules must be skipped (default skip folder).
    mkdirSync(path.join(repoRoot, "node_modules", "dep"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "node_modules", "dep", "x.ts"),
      "export function add2(x: number, y: number) { return x + y; }",
    );
    // A configured skip folder is left out too.
    mkdirSync(path.join(repoRoot, "vendor"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "vendor", "y.ts"),
      "export function add3(x: number, y: number) { return x + y; }",
    );
  });
  afterAll(() => rmSync(repoRoot, { recursive: true, force: true }));

  it("indexes source files, skips node_modules and configured folders, and finds the cross-folder duplicate", () => {
    const index = buildDuplicateIndex({ repoRoot, skipFolders: ["vendor"], ts });
    const clusters = scanForDuplicates(index);
    expect(clusters).toHaveLength(1);
    const files = clusters[0].declarations.map((declaration) => declaration.file).sort();
    expect(files).toEqual(["a.ts", "src/b.ts"]);
  });

  it("gives an empty index when the repo has no typescript", () => {
    const index = buildDuplicateIndex({ repoRoot, skipFolders: [], ts: null });
    expect(scanForDuplicates(index)).toEqual([]);
  });
});
