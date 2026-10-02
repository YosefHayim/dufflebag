import { describe, expect, it } from "vitest";

import { decideDuplicateEdit } from "./duplicateDecision.js";

const duplicateMatch = {
  kind: "function" as const,
  name: "sum",
  line: 1,
  existing: { name: "add", file: "src/math.ts", line: 4 },
};

describe("decideDuplicateEdit", () => {
  it("allows an edit when the duplicate-code mode is off", () => {
    expect(
      decideDuplicateEdit({ mode: "off", filePath: "src/newMath.ts", duplicateMatches: [duplicateMatch] }),
    ).toEqual({
      _tag: "allow",
    });
  });

  it("blocks a duplicate edit with the existing declaration location", () => {
    const decision = decideDuplicateEdit({
      mode: "block",
      filePath: "src/newMath.ts",
      duplicateMatches: [duplicateMatch],
    });

    expect(decision._tag).toBe("block");
    if (decision._tag === "block") {
      expect(decision.reason).toContain("src/math.ts:4");
    }
  });

  it("warns without blocking when the mode is warn", () => {
    expect(
      decideDuplicateEdit({ mode: "warn", filePath: "src/newMath.ts", duplicateMatches: [duplicateMatch] })._tag,
    ).toBe("warn");
  });
});
