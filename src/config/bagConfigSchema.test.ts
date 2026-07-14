import { Option, Schema, SchemaAST } from "effect";
import { describe, expect, it } from "vitest";

import {
  bagConfigJsonSchema,
  bagConfigSchema,
  defaultBagConfig,
  legacyBagConfigEnvironmentSchema,
  readSchemaDescription,
} from "./bagConfigSchema.js";

const expectedDefaultBagConfig = {
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
};

const expectedDescriptions = {
  contextWarnFraction: "Fraction of the context window that triggers a warning.",
  contextBlockFraction: "Fraction of the context window that blocks further automatic work.",
  autorunDefaultCycleCount: "Cycle count used when autorun starts without an explicit count.",
  autorunMaxCycleCount: "Maximum cycle count accepted by autorun.",
  autorunPollIntervalSeconds: "Seconds between autorun state polls.",
  autorunIdleThresholdSeconds: "Idle seconds required before autorun may continue.",
  speechVoice: "macOS voice used for spoken notifications.",
  speechWordsPerMinute: "Estimated speech rate in words per minute.",
  dedupEnforcement: "Behavior when duplicate skill content is detected.",
  dedupSkipDirectories: "Comma-separated directory names excluded from duplicate checks.",
  debugEnabled: "Whether Dufflebag emits debug diagnostics.",
};

const decodeBagConfig = Schema.decodeUnknownSync(bagConfigSchema);
const decodeLegacyBagConfig = Schema.decodeUnknownSync(legacyBagConfigEnvironmentSchema);

describe("bagConfigSchema", () => {
  it("decodes an empty object to all 11 executable defaults", () => {
    expect(decodeBagConfig({})).toEqual(expectedDefaultBagConfig);
    expect(defaultBagConfig).toEqual(expectedDefaultBagConfig);
    expect(Object.keys(defaultBagConfig)).toHaveLength(11);
  });

  it("keeps each description on its property signature", () => {
    const descriptionEntries = SchemaAST.getPropertySignatures(bagConfigSchema.ast).map(
      (property): readonly [string, string | undefined] => [String(property.name), Option.getOrUndefined(readSchemaDescription(property))],
    );

    expect(Object.fromEntries(descriptionEntries)).toEqual(expectedDescriptions);
  });

  it("defaults omitted properties but rejects unknown and invalid provided values", () => {
    expect(
      decodeBagConfig({
        debugEnabled: true,
      }),
    ).toEqual({
      ...expectedDefaultBagConfig,
      debugEnabled: true,
    });

    expect(() => {
      decodeBagConfig({
        unknownSetting: true,
      });
    }).toThrow();

    expect(() => {
      decodeBagConfig({
        speechWordsPerMinute: "230",
      });
    }).toThrow();

    expect(() => {
      decodeBagConfig({
        speechWordsPerMinute: undefined,
      });
    }).toThrow();
  });

  it.each([
    {
      field: "contextWarnFraction below its minimum",
      input: { contextWarnFraction: 0 },
      message: "contextWarnFraction must be between 0.01 and 0.95.",
    },
    {
      field: "contextWarnFraction above its maximum",
      input: { contextWarnFraction: 0.951, contextBlockFraction: 0.99 },
      message: "contextWarnFraction must be between 0.01 and 0.95.",
    },
    {
      field: "contextBlockFraction below its minimum",
      input: { contextBlockFraction: 0 },
      message: "contextBlockFraction must be between 0.01 and 0.99.",
    },
    {
      field: "contextBlockFraction above its maximum",
      input: { contextBlockFraction: 1 },
      message: "contextBlockFraction must be between 0.01 and 0.99.",
    },
    {
      field: "autorunDefaultCycleCount below its minimum",
      input: { autorunDefaultCycleCount: 0.99 },
      message: "autorunDefaultCycleCount must be between 1 and 1000.",
    },
    {
      field: "autorunDefaultCycleCount above its maximum",
      input: { autorunDefaultCycleCount: 1000.01, autorunMaxCycleCount: 1000 },
      message: "autorunDefaultCycleCount must be between 1 and 1000.",
    },
    {
      field: "autorunMaxCycleCount below its minimum",
      input: { autorunDefaultCycleCount: 1, autorunMaxCycleCount: 0.99 },
      message: "autorunMaxCycleCount must be between 1 and 1000.",
    },
    {
      field: "autorunMaxCycleCount above its maximum",
      input: { autorunMaxCycleCount: 1000.01 },
      message: "autorunMaxCycleCount must be between 1 and 1000.",
    },
    {
      field: "autorunPollIntervalSeconds below its minimum",
      input: { autorunPollIntervalSeconds: 0.99 },
      message: "autorunPollIntervalSeconds must be between 1 and 600.",
    },
    {
      field: "autorunPollIntervalSeconds above its maximum",
      input: { autorunPollIntervalSeconds: 600.01 },
      message: "autorunPollIntervalSeconds must be between 1 and 600.",
    },
    {
      field: "autorunIdleThresholdSeconds below its minimum",
      input: { autorunIdleThresholdSeconds: 0.99 },
      message: "autorunIdleThresholdSeconds must be between 1 and 600.",
    },
    {
      field: "autorunIdleThresholdSeconds above its maximum",
      input: { autorunIdleThresholdSeconds: 600.01 },
      message: "autorunIdleThresholdSeconds must be between 1 and 600.",
    },
    {
      field: "speechWordsPerMinute below its minimum",
      input: { speechWordsPerMinute: 79.99 },
      message: "speechWordsPerMinute must be between 80 and 720.",
    },
    {
      field: "speechWordsPerMinute above its maximum",
      input: { speechWordsPerMinute: 720.01 },
      message: "speechWordsPerMinute must be between 80 and 720.",
    },
  ])("rejects rather than clamps $field", ({ input, message }) => {
    expect(() => {
      decodeBagConfig(input);
    }).toThrow(message);
  });

  it("keeps decimal cycle and interval values valid", () => {
    expect(
      decodeBagConfig({
        autorunDefaultCycleCount: 10.5,
        autorunMaxCycleCount: 50.5,
        autorunPollIntervalSeconds: 5.5,
        autorunIdleThresholdSeconds: 8.5,
      }),
    ).toEqual({
      ...expectedDefaultBagConfig,
      autorunDefaultCycleCount: 10.5,
      autorunMaxCycleCount: 50.5,
      autorunPollIntervalSeconds: 5.5,
      autorunIdleThresholdSeconds: 8.5,
    });
  });

  it("requires the context warning fraction to stay below the blocking fraction", () => {
    expect(() => {
      decodeBagConfig({
        contextWarnFraction: 0.2,
        contextBlockFraction: 0.2,
      });
    }).toThrow("contextWarnFraction must be less than contextBlockFraction.");
  });

  it("requires the default autorun cycle count not to exceed the maximum", () => {
    expect(() => {
      decodeBagConfig({
        autorunDefaultCycleCount: 51,
        autorunMaxCycleCount: 50,
      });
    }).toThrow("autorunDefaultCycleCount must be less than or equal to autorunMaxCycleCount.");
  });

  it("trims documented text inputs while preserving allowed empty values", () => {
    expect(
      decodeBagConfig({
        speechVoice: "  Ava  ",
        dedupEnforcement: " warn ",
        dedupSkipDirectories: "  node_modules, dist  ",
      }),
    ).toEqual({
      ...expectedDefaultBagConfig,
      speechVoice: "Ava",
      dedupEnforcement: "warn",
      dedupSkipDirectories: "node_modules, dist",
    });

    expect(
      decodeBagConfig({
        speechVoice: "   ",
        dedupSkipDirectories: "   ",
      }),
    ).toEqual({
      ...expectedDefaultBagConfig,
      speechVoice: "",
      dedupSkipDirectories: "",
    });
  });

  it("does not case-fold enumerated values", () => {
    expect(() => {
      decodeBagConfig({
        dedupEnforcement: "WARN",
      });
    }).toThrow("dedupEnforcement must be deny, warn, or off.");
  });

  it("encodes the decoded default as a complete JSON config object", () => {
    const encoded = Schema.encodeSync(bagConfigJsonSchema)(defaultBagConfig);

    expect(JSON.parse(encoded)).toEqual(expectedDefaultBagConfig);
    expect(Object.keys(JSON.parse(encoded))).toHaveLength(11);
  });
});

describe("legacyBagConfigEnvironmentSchema", () => {
  it("decodes all owned legacy keys through complete base-10 representations", () => {
    expect(
      decodeLegacyBagConfig({
        dufflebagContextWarnFraction: " 0.18 ",
        dufflebagContextBlockFraction: " 2e-1 ",
        dufflebagAutorunDefaultCycleCount: " 10.5 ",
        dufflebagAutorunMaxCycleCount: " +50.5 ",
        dufflebagAutorunPollIntervalSeconds: " 5.5 ",
        dufflebagAutorunIdleThresholdSeconds: " 8.25 ",
        dufflebagSpeechVoice: "  Samantha  ",
        dufflebagSpeechWordsPerMinute: " 2.3e2 ",
        dufflebagDedupEnforcement: " deny ",
        dufflebagDedupSkipDirectories: "  node_modules, dist  ",
        dufflebagDebugEnabled: "false",
      }),
    ).toEqual({
      ...expectedDefaultBagConfig,
      autorunDefaultCycleCount: 10.5,
      autorunMaxCycleCount: 50.5,
      autorunPollIntervalSeconds: 5.5,
      autorunIdleThresholdSeconds: 8.25,
      dedupSkipDirectories: "node_modules, dist",
    });
  });

  it("accepts exactly the trimmed true and false legacy boolean strings", () => {
    expect(
      decodeLegacyBagConfig({
        dufflebagDebugEnabled: " true ",
      }).debugEnabled,
    ).toBe(true);
    expect(
      decodeLegacyBagConfig({
        dufflebagDebugEnabled: " false ",
      }).debugEnabled,
    ).toBe(false);

    for (const value of ["TRUE", "False", "1", "0", "yes", "no"]) {
      expect(() => {
        decodeLegacyBagConfig({
          dufflebagDebugEnabled: value,
        });
      }).toThrow();
    }
  });

  it.each(["230wpm", "0xE6", "NaN", "Infinity", "", "1e"])("rejects the incomplete or non-decimal numeric input %s", (value) => {
    expect(() => {
      decodeLegacyBagConfig({
        dufflebagSpeechWordsPerMinute: value,
      });
    }).toThrow("Legacy numeric values must use a complete base-10 decimal representation.");
  });

  it("rejects unknown aliases instead of silently defaulting", () => {
    expect(() => {
      decodeLegacyBagConfig({
        dufflebagContextWarningFraction: "0.1",
      });
    }).toThrow();
  });

  it("rejects invalid provided values instead of falling back to defaults", () => {
    expect(() => {
      decodeLegacyBagConfig({
        dufflebagContextWarnFraction: "not-a-number",
      });
    }).toThrow("Legacy numeric values must use a complete base-10 decimal representation.");

    expect(() => {
      decodeLegacyBagConfig({
        dufflebagDedupEnforcement: "DENY",
      });
    }).toThrow("dedupEnforcement must be deny, warn, or off.");
  });
});
