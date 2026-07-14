import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  bagConfigJsonSchema,
  bagConfigSchema,
  defaultBagConfig,
  legacyBagConfigEnvironmentSchema,
  readSchemaDescription,
} from "./bagConfigSchema.js";

const decodeBagConfig = Schema.decodeUnknownSync(bagConfigSchema, {
  onExcessProperty: "error",
});

const decodeLegacyBagConfig = Schema.decodeUnknownSync(legacyBagConfigEnvironmentSchema, {
  onExcessProperty: "error",
});

const expectDescription = (property: Schema.PropertySignature.All) => {
  const description = Option.getOrUndefined(readSchemaDescription(property));

  expect(description).toBeTypeOf("string");
  expect(description).not.toBe("");
};

describe("bagConfigSchema", () => {
  it("decodes the complete executable defaults", () => {
    expect(decodeBagConfig({})).toEqual({
      contextWarnFraction: 0.18,
      contextBlockFraction: 0.2,
      autorunDefaultCycleCount: 10,
      autorunMaxCycleCount: 50,
      autorunPollIntervalSeconds: 5,
      autorunIdleThresholdSeconds: 8,
      speechVoice: "Samantha",
      speechWordsPerMinute: 230,
      dedupEnforcement: "deny",
      dedupSkipDirectories: "",
      debugEnabled: false,
    });
    expect(defaultBagConfig).toEqual(decodeBagConfig({}));
  });

  it("keeps a description on every owned property", () => {
    expectDescription(bagConfigSchema.from.fields.contextWarnFraction);
    expectDescription(bagConfigSchema.from.fields.contextBlockFraction);
    expectDescription(bagConfigSchema.from.fields.autorunDefaultCycleCount);
    expectDescription(bagConfigSchema.from.fields.autorunMaxCycleCount);
    expectDescription(bagConfigSchema.from.fields.autorunPollIntervalSeconds);
    expectDescription(bagConfigSchema.from.fields.autorunIdleThresholdSeconds);
    expectDescription(bagConfigSchema.from.fields.speechVoice);
    expectDescription(bagConfigSchema.from.fields.speechWordsPerMinute);
    expectDescription(bagConfigSchema.from.fields.dedupEnforcement);
    expectDescription(bagConfigSchema.from.fields.dedupSkipDirectories);
    expectDescription(bagConfigSchema.from.fields.debugEnabled);
  });

  it("fills omitted properties but rejects excess properties", () => {
    expect(decodeBagConfig({ speechVoice: "Ava" })).toEqual({
      ...defaultBagConfig,
      speechVoice: "Ava",
    });
    expect(() => decodeBagConfig({ unknownProperty: true })).toThrow();
  });

  it.each([
    "contextWarnFraction",
    "contextBlockFraction",
    "autorunDefaultCycleCount",
    "autorunMaxCycleCount",
    "autorunPollIntervalSeconds",
    "autorunIdleThresholdSeconds",
    "speechVoice",
    "speechWordsPerMinute",
    "dedupEnforcement",
    "dedupSkipDirectories",
    "debugEnabled",
  ])("rejects explicit undefined for %s", (property) => {
    expect(() => decodeBagConfig({ [property]: undefined })).toThrow();
  });

  it("accepts inclusive numeric boundaries", () => {
    expect(
      decodeBagConfig({
        contextWarnFraction: 0.01,
        contextBlockFraction: 0.99,
        autorunDefaultCycleCount: 1,
        autorunMaxCycleCount: 1000,
        autorunPollIntervalSeconds: 1,
        autorunIdleThresholdSeconds: 600,
        speechWordsPerMinute: 80,
      }),
    ).toMatchObject({
      contextWarnFraction: 0.01,
      contextBlockFraction: 0.99,
      autorunDefaultCycleCount: 1,
      autorunMaxCycleCount: 1000,
      autorunPollIntervalSeconds: 1,
      autorunIdleThresholdSeconds: 600,
      speechWordsPerMinute: 80,
    });
  });

  it.each([
    ["contextWarnFraction below", { contextWarnFraction: 0.009 }],
    ["contextWarnFraction above", { contextWarnFraction: 0.951, contextBlockFraction: 0.99 }],
    ["contextBlockFraction below", { contextWarnFraction: 0.005, contextBlockFraction: 0.009 }],
    ["contextBlockFraction above", { contextBlockFraction: 0.991 }],
    ["autorunDefaultCycleCount below", { autorunDefaultCycleCount: 0.999 }],
    ["autorunDefaultCycleCount above", { autorunDefaultCycleCount: 1000.001, autorunMaxCycleCount: 1000 }],
    ["autorunMaxCycleCount below", { autorunDefaultCycleCount: 1, autorunMaxCycleCount: 0.999 }],
    ["autorunMaxCycleCount above", { autorunMaxCycleCount: 1000.001 }],
    ["autorunPollIntervalSeconds below", { autorunPollIntervalSeconds: 0.999 }],
    ["autorunPollIntervalSeconds above", { autorunPollIntervalSeconds: 600.001 }],
    ["autorunIdleThresholdSeconds below", { autorunIdleThresholdSeconds: 0.999 }],
    ["autorunIdleThresholdSeconds above", { autorunIdleThresholdSeconds: 600.001 }],
    ["speechWordsPerMinute below", { speechWordsPerMinute: 79.999 }],
    ["speechWordsPerMinute above", { speechWordsPerMinute: 720.001 }],
  ])("rejects rather than clamps %s", (_case, input) => {
    expect(() => decodeBagConfig(input)).toThrow();
  });

  it("permits fractional counts, seconds, and words per minute", () => {
    expect(
      decodeBagConfig({
        autorunDefaultCycleCount: 10.5,
        autorunMaxCycleCount: 50.5,
        autorunPollIntervalSeconds: 5.5,
        autorunIdleThresholdSeconds: 8.5,
        speechWordsPerMinute: 230.5,
      }),
    ).toMatchObject({
      autorunDefaultCycleCount: 10.5,
      autorunMaxCycleCount: 50.5,
      autorunPollIntervalSeconds: 5.5,
      autorunIdleThresholdSeconds: 8.5,
      speechWordsPerMinute: 230.5,
    });
  });

  it("reports a path-aware warn-before-block issue", () => {
    expect(() =>
      decodeBagConfig({
        contextWarnFraction: 0.2,
        contextBlockFraction: 0.2,
      }),
    ).toThrow(/contextWarnFraction/);
  });

  it("reports a path-aware default-within-maximum cycle issue", () => {
    expect(() =>
      decodeBagConfig({
        autorunDefaultCycleCount: 51,
        autorunMaxCycleCount: 50,
      }),
    ).toThrow(/autorunDefaultCycleCount/);
  });

  it("trims documented text and preserves an empty voice", () => {
    expect(
      decodeBagConfig({
        speechVoice: "  Ava  ",
        dedupEnforcement: " warn ",
        dedupSkipDirectories: "  templates, fixtures  ",
      }),
    ).toMatchObject({
      speechVoice: "Ava",
      dedupEnforcement: "warn",
      dedupSkipDirectories: "templates, fixtures",
    });
    expect(decodeBagConfig({ speechVoice: "   " }).speechVoice).toBe("");
  });

  it("does not case-fold dedup enforcement", () => {
    expect(() => decodeBagConfig({ dedupEnforcement: "DENY" })).toThrow();
  });
});

describe("legacyBagConfigEnvironmentSchema", () => {
  it("fills every default when legacy keys are omitted", () => {
    expect(decodeLegacyBagConfig({})).toEqual(defaultBagConfig);
  });

  it("decodes complete base-10 numeric forms after trimming", () => {
    expect(
      decodeLegacyBagConfig({
        dufflebagContextWarnFraction: " +1.8e-1 ",
        dufflebagContextBlockFraction: ".25",
        dufflebagAutorunDefaultCycleCount: "+10.",
        dufflebagAutorunMaxCycleCount: "5e1",
        dufflebagAutorunPollIntervalSeconds: "5.",
        dufflebagAutorunIdleThresholdSeconds: "8e0",
        dufflebagSpeechWordsPerMinute: "2.30e2",
      }),
    ).toMatchObject({
      contextWarnFraction: 0.18,
      contextBlockFraction: 0.25,
      autorunDefaultCycleCount: 10,
      autorunMaxCycleCount: 50,
      autorunPollIntervalSeconds: 5,
      autorunIdleThresholdSeconds: 8,
      speechWordsPerMinute: 230,
    });
  });

  it.each([
    "12px",
    "0x10",
    "Infinity",
    "NaN",
    "",
    "   ",
    "1.2.3",
    "+",
    ".",
  ])("rejects partial or non-base-10 numeric input %j without fallback", (value) => {
    expect(() =>
      decodeLegacyBagConfig({
        dufflebagAutorunMaxCycleCount: value,
      }),
    ).toThrow();
  });

  it("rejects out-of-range legacy numbers without clamping or fallback", () => {
    expect(() =>
      decodeLegacyBagConfig({
        dufflebagAutorunPollIntervalSeconds: "0",
      }),
    ).toThrow();
  });

  it("accepts only exactly spelled trimmed legacy booleans", () => {
    expect(decodeLegacyBagConfig({ dufflebagDebugEnabled: " true " }).debugEnabled).toBe(true);
    expect(decodeLegacyBagConfig({ dufflebagDebugEnabled: "false" }).debugEnabled).toBe(false);
    expect(() => decodeLegacyBagConfig({ dufflebagDebugEnabled: "TRUE" })).toThrow();
    expect(() => decodeLegacyBagConfig({ dufflebagDebugEnabled: "1" })).toThrow();
    expect(() => decodeLegacyBagConfig({ dufflebagDebugEnabled: "yes" })).toThrow();
  });

  it("trims legacy text without case folding", () => {
    expect(
      decodeLegacyBagConfig({
        dufflebagSpeechVoice: "  Ava  ",
        dufflebagDedupEnforcement: " off ",
        dufflebagDedupSkipDirectories: "  templates, fixtures  ",
      }),
    ).toMatchObject({
      speechVoice: "Ava",
      dedupEnforcement: "off",
      dedupSkipDirectories: "templates, fixtures",
    });
    expect(() => decodeLegacyBagConfig({ dufflebagDedupEnforcement: "OFF" })).toThrow();
  });

  it("rejects unknown, canonical, and case-folded aliases", () => {
    expect(() => decodeLegacyBagConfig({ unknownAlias: "true" })).toThrow();
    expect(() => decodeLegacyBagConfig({ debugEnabled: "true" })).toThrow();
    expect(() => decodeLegacyBagConfig({ dufflebagdebugEnabled: "true" })).toThrow();
  });

  it("enforces the same cross-property relations", () => {
    expect(() =>
      decodeLegacyBagConfig({
        dufflebagContextWarnFraction: "0.3",
        dufflebagContextBlockFraction: "0.2",
      }),
    ).toThrow(/contextWarnFraction/);
    expect(() =>
      decodeLegacyBagConfig({
        dufflebagAutorunDefaultCycleCount: "51",
        dufflebagAutorunMaxCycleCount: "50",
      }),
    ).toThrow(/autorunDefaultCycleCount/);
  });
});

describe("bagConfigJsonSchema", () => {
  it("encodes every owned property into JSON", () => {
    const json = Schema.encodeSync(bagConfigJsonSchema)(defaultBagConfig);

    expect(JSON.parse(json)).toEqual(defaultBagConfig);
    expect(Object.keys(JSON.parse(json))).toHaveLength(11);
  });
});
