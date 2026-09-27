import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { checkDuplicates } from "./checkDuplicates.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

afterEach(() => {
  process.exitCode = 0;
});

describe("checkDuplicates", () => {
  it("skips a repo whose own TypeScript is unresolvable (exit 0, never fails CI)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dufflebag-duplicates-"));
    try {
      writeFileSync(path.join(dir, "a.ts"), "export const x = 1;\n");
      process.exitCode = 0;
      checkDuplicates({ workspace: dir, skipFolders: [] });
      expect(process.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails (exit 1) when a duplicate function body is present", () => {
    // Fixture lives under the repo so the guard resolves the repo's own typescript.
    const dir = mkdtempSync(path.join(REPO_ROOT, "tmp-duplicates-"));
    try {
      writeFileSync(path.join(dir, "a.ts"), "export function add(x: number, y: number) { return x + y; }\n");
      writeFileSync(path.join(dir, "b.ts"), "export function sum(a: number, b: number) { return a + b; }\n");
      process.exitCode = 0;
      checkDuplicates({ workspace: dir, skipFolders: [] });
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
