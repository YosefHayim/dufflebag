import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { durationSchema } from "./durationSchema.js";

const decodeDuration = Schema.decodeUnknownSync(durationSchema);

describe("durationSchema", () => {
  it.each(["off", "10s", "30s", "2m", "1h", "1d"])("accepts %s", (input) => {
    expect(decodeDuration(input)).toBe(input);
  });

  it.each(["", "9s", "86401s", "1.5m", "1w", "OFF", " 1m "])("rejects %s", (input) => {
    expect(() => decodeDuration(input)).toThrow();
  });
});
