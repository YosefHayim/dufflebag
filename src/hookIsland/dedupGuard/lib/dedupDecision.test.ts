import { describe, expect, it } from "vitest";

import { decideDuplicateEdit } from "./dedupDecision.js";

const duplicateHit = {
  kind: "function" as const,
  name: "sum",
  line: 1,
  existing: { name: "add", file: "src/math.ts", line: 4 },
};

describe("decideDuplicateEdit", () => {
  it("allows an edit when duplicate enforcement is off", () => {
    expect(decideDuplicateEdit({ mode: "off", filePath: "src/newMath.ts", duplicateHits: [duplicateHit] })).toEqual({
      _tag: "allow",
    });
  });

  it("denies a duplicate edit with the existing declaration location", () => {
    const decision = decideDuplicateEdit({
      mode: "deny",
      filePath: "src/newMath.ts",
      duplicateHits: [duplicateHit],
    });

    expect(decision._tag).toBe("deny");
    if (decision._tag === "deny") {
      expect(decision.reason).toContain("src/math.ts:4");
    }
  });

  it("warns without denying when enforcement is warn", () => {
    expect(decideDuplicateEdit({ mode: "warn", filePath: "src/newMath.ts", duplicateHits: [duplicateHit] })._tag).toBe(
      "warn",
    );
  });
});
