import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import {
  configJsonSchema,
  configSchema,
  configSettings,
  defaultConfig,
  defaultSettingValue,
  settingValueFromText,
  withSettingValue,
} from "./configSchema.js";

const decodeConfig = Schema.decodeUnknownSync(configSchema, { onExcessProperty: "error" });

const settingNamed = (name: string) => {
  const setting = configSettings.find((candidate) => candidate.name === name);
  if (setting === undefined) {
    throw new Error(`Expected a ${name} setting.`);
  }
  return setting;
};

describe("configSchema", () => {
  it("decodes the complete executable defaults", () => {
    expect(decodeConfig({})).toEqual({
      contextWarnPercent: 18,
      contextBlockPercent: 20,
      autorunDefaultCycles: 10,
      autorunMaxCycles: 50,
      autorunCheckEverySeconds: 5,
      autorunIdleAfterSeconds: 8,
      idleCompactAfter: "off",
      speechVoice: "F4",
      speechWordsPerMinute: 230,
      speechMode: "auto",
      refineMode: "off",
      refineProvider: "codex",
      refinePressEnter: false,
      refineSendTo: "caret",
      refineCmuxCommand: "",
      refineCmuxPressEnter: false,
      dictationReplacements: "",
      dictationKeepListeningSeconds: 0.2,
      dictationLanguage: "en",
      duplicateCodeMode: "block",
      duplicateCodeSkipFolders: [],
      debugLogs: false,
    });
    expect(defaultConfig).toEqual(decodeConfig({}));
  });

  it("keeps a label and a description on every setting", () => {
    for (const setting of configSettings) {
      expect(setting.label).not.toBe(setting.key);
      expect(setting.description).not.toBe("");
    }
  });

  it("derives kebab-case CLI names and value kinds from the schema keys", () => {
    expect(configSettings.map((setting) => setting.name)).toContain("duplicate-code-skip-folders");
    expect(settingNamed("context-warn-percent").kind).toBe("number");
    expect(settingNamed("debug-logs").kind).toBe("boolean");
    expect(settingNamed("duplicate-code-skip-folders").kind).toBe("list");
    expect(settingNamed("refine-mode").kind).toBe("text");
    expect(settingNamed("refine-mode").choices).toEqual(["off", "clipboard", "dictation", "both"]);
    expect(settingNamed("refine-effort").optional).toBe(true);
    expect(settingNamed("refine-provider").optional).toBe(false);
  });

  it("fills omitted properties but rejects excess properties", () => {
    expect(decodeConfig({ speechVoice: "Ava" })).toEqual({
      ...defaultConfig,
      speechVoice: "Ava",
    });
    expect(() => decodeConfig({ unknownProperty: true })).toThrow();
  });

  it.each(configSettings.map((setting) => setting.key))("rejects explicit undefined for %s", (property) => {
    expect(() => decodeConfig({ [property]: undefined })).toThrow();
  });

  it("accepts inclusive numeric boundaries", () => {
    expect(
      decodeConfig({
        contextWarnPercent: 1,
        contextBlockPercent: 99,
        autorunDefaultCycles: 1,
        autorunMaxCycles: 1000,
        autorunCheckEverySeconds: 1,
        autorunIdleAfterSeconds: 600,
        speechWordsPerMinute: 80,
        dictationKeepListeningSeconds: 0,
      }),
    ).toMatchObject({
      contextWarnPercent: 1,
      contextBlockPercent: 99,
      autorunDefaultCycles: 1,
      autorunMaxCycles: 1000,
      autorunCheckEverySeconds: 1,
      autorunIdleAfterSeconds: 600,
      speechWordsPerMinute: 80,
      dictationKeepListeningSeconds: 0,
    });
    expect(decodeConfig({ dictationKeepListeningSeconds: 2 }).dictationKeepListeningSeconds).toBe(2);
  });

  it.each([
    ["contextWarnPercent below", { contextWarnPercent: 0.99 }],
    ["contextWarnPercent above", { contextWarnPercent: 95.01, contextBlockPercent: 99 }],
    ["contextBlockPercent below", { contextWarnPercent: 0.5, contextBlockPercent: 0.9 }],
    ["contextBlockPercent above", { contextBlockPercent: 99.01 }],
    ["autorunDefaultCycles below", { autorunDefaultCycles: 0.999 }],
    ["autorunDefaultCycles above", { autorunDefaultCycles: 1000.001, autorunMaxCycles: 1000 }],
    ["autorunMaxCycles below", { autorunDefaultCycles: 1, autorunMaxCycles: 0.999 }],
    ["autorunMaxCycles above", { autorunMaxCycles: 1000.001 }],
    ["autorunCheckEverySeconds below", { autorunCheckEverySeconds: 0.999 }],
    ["autorunCheckEverySeconds above", { autorunCheckEverySeconds: 600.001 }],
    ["autorunIdleAfterSeconds below", { autorunIdleAfterSeconds: 0.999 }],
    ["autorunIdleAfterSeconds above", { autorunIdleAfterSeconds: 600.001 }],
    ["speechWordsPerMinute below", { speechWordsPerMinute: 79.999 }],
    ["speechWordsPerMinute above", { speechWordsPerMinute: 720.001 }],
    ["dictationKeepListeningSeconds below", { dictationKeepListeningSeconds: -0.001 }],
    ["dictationKeepListeningSeconds above", { dictationKeepListeningSeconds: 2.001 }],
  ])("rejects rather than clamps %s", (_case, input) => {
    expect(() => decodeConfig(input)).toThrow();
  });

  it("permits fractional counts, seconds, and words per minute", () => {
    expect(
      decodeConfig({
        autorunDefaultCycles: 10.5,
        autorunMaxCycles: 50.5,
        autorunCheckEverySeconds: 5.5,
        autorunIdleAfterSeconds: 8.5,
        speechWordsPerMinute: 230.5,
      }),
    ).toMatchObject({
      autorunDefaultCycles: 10.5,
      autorunMaxCycles: 50.5,
      autorunCheckEverySeconds: 5.5,
      autorunIdleAfterSeconds: 8.5,
      speechWordsPerMinute: 230.5,
    });
  });

  it.each([
    ["contextWarnPercent", { contextWarnPercent: 20, contextBlockPercent: 20 }],
    ["autorunDefaultCycles", { autorunDefaultCycles: 51, autorunMaxCycles: 50 }],
  ])("reports a path-aware cross-field issue on %s", (property, settings) => {
    expect(() => decodeConfig(settings)).toThrow(property);
  });

  it("trims documented text and preserves an empty voice", () => {
    expect(
      decodeConfig({
        speechVoice: "  Ava  ",
        speechMode: " focused ",
        refineMode: " clipboard ",
        refineProvider: " auto ",
        refineModel: "  gpt-5.3-codex-spark  ",
        refineEffort: " low ",
        dictationReplacements: "  Joseph=Yosef; type script=TypeScript  ",
        duplicateCodeMode: " warn ",
      }),
    ).toMatchObject({
      speechVoice: "Ava",
      speechMode: "focused",
      refineMode: "clipboard",
      refineProvider: "auto",
      refineModel: "gpt-5.3-codex-spark",
      refineEffort: "low",
      dictationReplacements: "Joseph=Yosef; type script=TypeScript",
      duplicateCodeMode: "warn",
    });
    expect(decodeConfig({ speechVoice: "   " }).speechVoice).toBe("");
  });

  it.each([
    { refineMode: "dictation" },
    { refineMode: "both" },
    { refineProvider: "local" },
    { refineProvider: "grok" },
    { refineProvider: "ollama" },
    { refineSendTo: "cmux-new" },
    { refineSendTo: "cmux-resume" },
    {
      refineModel: "grok-4.5",
      refineEffort: "low",
      refinePressEnter: true,
      refineCmuxCommand: 'codex --yolo -- "$(cat {{prompt_file}})"',
      refineCmuxPressEnter: true,
      duplicateCodeSkipFolders: ["templates", "fixtures"],
    },
  ])("accepts %o", (settings) => {
    expect(decodeConfig(settings)).toMatchObject(settings);
  });

  it.each([
    { refineModel: "" },
    { refineEffort: "" },
    { refineProvider: "" },
    { duplicateCodeSkipFolders: [""] },
  ])("rejects the empty value in %o, where the setting is optional instead", (settings) => {
    expect(() => decodeConfig(settings)).toThrow();
  });

  it.each([
    { duplicateCodeMode: "BLOCK" },
    { speechMode: "AUTO" },
    { refineMode: "CLIPBOARD" },
  ])("does not case-fold %o", (settings) => {
    expect(() => decodeConfig(settings)).toThrow();
  });
});

describe("setting values from CLI text", () => {
  const applyText = (name: string, text: string) =>
    settingValueFromText({ setting: settingNamed(name), text }).pipe(
      Effect.flatMap((value) => withSettingValue({ config: defaultConfig, key: settingNamed(name).key, value })),
    );

  it.effect("parses numbers, booleans, and comma lists by the setting's kind", () =>
    Effect.gen(function* () {
      expect((yield* applyText("context-warn-percent", "15")).contextWarnPercent).toBe(15);
      expect((yield* applyText("debug-logs", "true")).debugLogs).toBe(true);
      expect(
        (yield* applyText("duplicate-code-skip-folders", "vendor, generated ,, tmp")).duplicateCodeSkipFolders,
      ).toEqual(["vendor", "generated", "tmp"]);
    }),
  );

  it.effect("clears an optional setting from empty text and its absent default", () =>
    Effect.gen(function* () {
      expect((yield* applyText("refine-model", "grok-4.5")).refineModel).toBe("grok-4.5");
      expect("refineModel" in (yield* applyText("refine-model", ""))).toBe(false);
      expect(defaultSettingValue("refineModel")).toEqual(Option.none());
      expect(defaultSettingValue("refineProvider")).toEqual(Option.some("codex"));
    }),
  );

  it.effect("rejects text the setting cannot hold", () =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(applyText("debug-logs", "sometimes"))).toBeDefined();
      expect(yield* Effect.flip(applyText("context-warn-percent", "0.5"))).toBeDefined();
    }),
  );
});

describe("configJsonSchema", () => {
  it("encodes every owned property into JSON", () => {
    const json = Schema.encodeSync(configJsonSchema)(defaultConfig);

    expect(JSON.parse(json)).toEqual(defaultConfig);
    expect(Object.keys(JSON.parse(json))).toHaveLength(22);
  });
});
