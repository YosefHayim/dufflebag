import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { extractFromText } from "./codeFingerprint.js";

const functionEntry = (sourceText: string) => extractFromText({ ts, sourceText, fileName: "a.ts" }).functions.at(0);

const typeEntry = (sourceText: string) => extractFromText({ ts, sourceText, fileName: "a.ts" }).types.at(0);

describe("function fingerprints", () => {
  it("match a copy whose parameters and locals are renamed", () => {
    const original = functionEntry("function add(x: number, y: number) { const total = x + y; return total; }");
    const renamed = functionEntry("const sum = (a: number, b: number) => { const s = a + b; return s; };");
    expect(original?.fingerprint).toBeDefined();
    expect(renamed?.fingerprint).toBe(original?.fingerprint);
  });

  it("differ when an operator changes", () => {
    expect(functionEntry("function add(x: number, y: number) { return x + y; }")?.fingerprint).not.toBe(
      functionEntry("function add(x: number, y: number) { return x * y; }")?.fingerprint,
    );
  });

  it("mark a declaration whose first line carries allow-duplicate", () => {
    expect(functionEntry("function add(x: number) { return x; } // allow-duplicate")?.ignored).toBe(true);
    expect(functionEntry("function add(x: number) { return x; }")?.ignored).toBe(false);
  });
});

describe("type signatures", () => {
  it("ignore field order", () => {
    expect(typeEntry("interface User { id: string; name: string; }")?.signature).toBe(
      typeEntry("type Account = { name: string; id: string };")?.signature,
    );
  });

  it("differ when a field type changes", () => {
    expect(typeEntry("interface User { id: string; name: string; }")?.signature).not.toBe(
      typeEntry("interface User { id: number; name: string; }")?.signature,
    );
  });
});
