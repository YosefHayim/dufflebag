import { describe, expect, it } from "vitest";

import { isProcessAlive } from "./processAlive.js";

describe("isProcessAlive", () => {
  it("sees the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("never treats a missing or group pid as alive", () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(Number.NaN)).toBe(false);
  });
});
