/**
 * Tests for the dedup-guard engine — the property that actually makes it useful:
 * a function body matches even when its params/locals are renamed (alpha-
 * canonical fingerprint), an object type matches regardless of field order, and
 * neither matches when the logic/shape genuinely differs. Also covers the
 * `// dup-ignore` escape hatch, self-file exclusion, the disk index + skip dirs,
 * and the whole-repo cluster scan.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildIndex, type Decl, type DupIndex, extractFromText, findDuplicatesInAddedText, scanForDuplicates } from "./dupIndex.js";

const REPO = "/repo";
const abs = (rel: string): string => path.posix.join(REPO, rel);

/** Build an in-memory index from a {relPath: source} map (mirrors what buildIndex does on disk). */
function indexFrom(files: Record<string, string>): DupIndex {
  const typeSig = new Map<string, Decl[]>();
  const fnFp = new Map<string, Decl[]>();
  const push = (map: Map<string, Decl[]>, key: string, value: Decl): void => {
    // dup-ignore (deliberate test mirror of the engine's index push)
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const [file, text] of Object.entries(files)) {
    const { types, fns } = extractFromText(ts, text, file);
    for (const t of types) push(typeSig, t.sig, { name: t.name, file, line: t.line, ignored: t.ignored });
    for (const f of fns) push(fnFp, f.fp, { name: f.name, file, line: f.line, ignored: f.ignored });
  }
  return { typeSig, fnFp };
}

describe("function fingerprints", () => {
  const index = indexFrom({ "a.ts": "export function add(x: number, y: number) { return x + y; }" });

  it("flags a renamed copy of an existing function body", () => {
    const hits = findDuplicatesInAddedText(ts, index, REPO, abs("b.ts"), "export function sum(a: number, b: number) { return a + b; }");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "function", name: "sum", existing: { name: "add", file: "a.ts" } });
  });

  it("does NOT flag a body that differs by operator", () => {
    const hits = findDuplicatesInAddedText(ts, index, REPO, abs("b.ts"), "export function mul(a: number, b: number) { return a * b; }");
    expect(hits).toHaveLength(0);
  });

  it("respects a // dup-ignore on the declaration line", () => {
    const hits = findDuplicatesInAddedText(
      ts,
      index,
      REPO,
      abs("b.ts"),
      "export function sum(a: number, b: number) { return a + b; } // dup-ignore",
    );
    expect(hits).toHaveLength(0);
  });

  it("never trips on the function's own name in its own file", () => {
    const self = indexFrom({ "a.ts": "export function add(x: number, y: number) { return x + y; }" });
    const hits = findDuplicatesInAddedText(ts, self, REPO, abs("a.ts"), "export function add(x: number, y: number) { return x + y; }");
    expect(hits).toHaveLength(0);
  });
});

describe("type signatures", () => {
  const index = indexFrom({ "models.ts": "export interface User { id: string; name: string; }" });

  it("flags an identical shape under a new name, regardless of field order", () => {
    const hits = findDuplicatesInAddedText(ts, index, REPO, abs("acct.ts"), "export interface Account { name: string; id: string; }");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "type", name: "Account", existing: { name: "User" } });
  });

  it("does NOT flag a shape with a different field type", () => {
    const hits = findDuplicatesInAddedText(ts, index, REPO, abs("acct.ts"), "export interface Account { id: number; name: string; }");
    expect(hits).toHaveLength(0);
  });
});

describe("scanForDuplicates", () => {
  const index = indexFrom({
    "a.ts": "export function add(x: number, y: number) { return x + y; }",
    "b.ts": "export const sum = (a: number, b: number) => { return a + b; };",
    "c.ts": "export function unique() { return 42; }",
  });

  it("returns one cluster for the duplicated body, ignoring the unique one", () => {
    const clusters = scanForDuplicates(index);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].kind).toBe("function");
    expect(clusters[0].decls.map((d) => d.file).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("restricts findings to clusters touching the given files", () => {
    expect(scanForDuplicates(index, new Set(["b.ts"]))).toHaveLength(1);
    expect(scanForDuplicates(index, new Set(["c.ts"]))).toHaveLength(0);
  });

  it("excludes declarations annotated // dup-ignore", () => {
    const ignored = indexFrom({
      "a.ts": "export function add(x: number, y: number) { return x + y; }",
      "b.ts": "export function sum(a: number, b: number) { return a + b; } // dup-ignore",
    });
    expect(scanForDuplicates(ignored)).toHaveLength(0);
  });
});

describe("buildIndex on disk", () => {
  let repoRoot: string;
  beforeAll(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "dedup-"));
    writeFileSync(path.join(repoRoot, "a.ts"), "export function add(x: number, y: number) { return x + y; }");
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "b.ts"), "export function sum(a: number, b: number) { return a + b; }");
    // A copy inside node_modules must be skipped (default skip dir).
    mkdirSync(path.join(repoRoot, "node_modules", "dep"), { recursive: true });
    writeFileSync(path.join(repoRoot, "node_modules", "dep", "x.ts"), "export function add2(x: number, y: number) { return x + y; }");
  });
  afterAll(() => rmSync(repoRoot, { recursive: true, force: true }));

  it("indexes source files, skips node_modules, and finds the cross-dir duplicate", () => {
    const index = buildIndex({ repoRoot, ts });
    const clusters = scanForDuplicates(index);
    expect(clusters).toHaveLength(1);
    const files = clusters[0].decls.map((d) => d.file).sort();
    expect(files).toEqual(["a.ts", "src/b.ts"]);
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
  });
});
