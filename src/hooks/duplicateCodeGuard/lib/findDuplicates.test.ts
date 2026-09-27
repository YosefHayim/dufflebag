import path from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { extractFromText } from "./codeFingerprint.js";
import { type DuplicateIndex, indexDeclarations } from "./duplicateIndex.js";
import { findDuplicatesInEdit, scanForDuplicates } from "./findDuplicates.js";

const REPO = "/repo";
const ADD = "export function add(x: number, y: number) { return x + y; }";
const SUM = "export function sum(a: number, b: number) { return a + b; }";

// An in-memory index from { repoRelativePath: source }, the way buildDuplicateIndex builds one from disk.
const indexFrom = (files: Record<string, string>): DuplicateIndex =>
  indexDeclarations(
    Object.fromEntries(
      Object.entries(files).map(([file, sourceText]) => [file, extractFromText({ ts, sourceText, fileName: file })]),
    ),
  );

const matchesIn = (index: DuplicateIndex, edit: { file: string; addedText: string }) =>
  findDuplicatesInEdit({
    ts,
    index,
    repoRoot: REPO,
    filePath: path.posix.join(REPO, edit.file),
    addedText: edit.addedText,
  });

describe("findDuplicatesInEdit for functions", () => {
  const index = indexFrom({ "a.ts": ADD });

  it("flags a renamed copy of an existing function body", () => {
    const matches = matchesIn(index, { file: "b.ts", addedText: SUM });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: "function", name: "sum", existing: { name: "add", file: "a.ts" } });
  });

  it("flags a copy repeated within the same edit", () => {
    expect(matchesIn(indexFrom({}), { file: "b.ts", addedText: `${ADD}\n${SUM}` })).toMatchObject([
      { name: "sum", line: 2, existing: { name: "add", file: "b.ts", line: 1 } },
    ]);
  });

  it.each([
    {
      edit: "a body that differs by operator",
      file: "b.ts",
      addedText: "export function mul(a: number, b: number) { return a * b; }",
    },
    {
      edit: "a copy marked // allow-duplicate on its declaration line",
      file: "b.ts",
      addedText: `${SUM} // allow-duplicate`,
    },
    { edit: "the function's own name in its own file", file: "a.ts", addedText: ADD },
  ])("does not flag $edit", (edit) => {
    expect(matchesIn(index, edit)).toHaveLength(0);
  });
});

describe("findDuplicatesInEdit for types", () => {
  const index = indexFrom({ "models.ts": "export interface User { id: string; name: string; }" });

  it("flags an identical shape under a new name, regardless of field order", () => {
    const matches = matchesIn(index, {
      file: "acct.ts",
      addedText: "export interface Account { name: string; id: string; }",
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: "type", name: "Account", existing: { name: "User" } });
  });

  it("does not flag a shape with a different field type", () => {
    expect(
      matchesIn(index, { file: "acct.ts", addedText: "export interface Account { id: number; name: string; }" }),
    ).toHaveLength(0);
  });
});

describe("scanForDuplicates", () => {
  const index = indexFrom({
    "a.ts": ADD,
    "b.ts": "export const sum = (a: number, b: number) => { return a + b; };",
    "c.ts": "export function unique() { return 42; }",
  });

  it("returns one cluster for the duplicated body, ignoring the unique one", () => {
    const clusters = scanForDuplicates(index);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].kind).toBe("function");
    expect(clusters[0].declarations.map((declaration) => declaration.file).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("restricts findings to clusters touching the given files", () => {
    expect(scanForDuplicates(index, new Set(["b.ts"]))).toHaveLength(1);
    expect(scanForDuplicates(index, new Set(["c.ts"]))).toHaveLength(0);
  });

  it("excludes declarations marked // allow-duplicate", () => {
    expect(scanForDuplicates(indexFrom({ "a.ts": ADD, "b.ts": `${SUM} // allow-duplicate` }))).toHaveLength(0);
  });
});
