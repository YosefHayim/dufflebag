import { describe, expect, it } from "vitest";

import { documentedRecurringTokenEstimate, freePoolSnapshot } from "./freeProviderCatalog.js";

describe("free provider catalog", () => {
  it("keeps the attributed snapshot pool-deduplicated and identity-unique", () => {
    expect(freePoolSnapshot).toHaveLength(43);
    expect(documentedRecurringTokenEstimate).toBe(1_526_225_000);
    expect(new Set(freePoolSnapshot.map((freePool) => freePool.poolId)).size).toBe(43);
    expect(new Set(freePoolSnapshot.map((freePool) => freePool.providerId)).size).toBe(43);
    expect(new Set(freePoolSnapshot.map((freePool) => `${freePool.providerId}/${freePool.modelId}`)).size).toBe(43);
  });
});
