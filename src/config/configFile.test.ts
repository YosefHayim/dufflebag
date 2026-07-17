import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { bagConfigJsonSchema, defaultBagConfig } from "./bagConfigSchema.js";
import { ConfigFileParseError, ConfigFileSchemaError, readConfigFile } from "./configFile.js";

layer(NodeContext.layer)("configFile", (it) => {
  it.effect("returns a tagged missing snapshot when the managed config is absent", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-config-file-missing-" });

        expect(yield* readConfigFile(path.join(root, "config.json"))).toEqual({ _tag: "missing" });
      }),
    ),
  );

  it.effect("returns exact file bytes with one strict complete managed config", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-config-file-complete-" });
        const configPath = path.join(root, "config.json");
        const json = yield* Schema.encode(bagConfigJsonSchema)(defaultBagConfig);
        const bytes = new TextEncoder().encode(`\n${json}\n`);

        yield* fileSystem.writeFile(configPath, bytes);

        const snapshot = yield* readConfigFile(configPath);
        expect(snapshot._tag).toBe("present");
        if (snapshot._tag === "present") {
          expect([...snapshot.bytes]).toEqual([...bytes]);
          expect(snapshot.config).toEqual(defaultBagConfig);
        }
      }),
    ),
  );

  it.effect("reports the file and missing property for an incomplete config", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-config-file-incomplete-" });
        const configPath = path.join(root, "config.json");

        yield* fileSystem.writeFileString(configPath, JSON.stringify({ contextWarnFraction: 0.18 }));

        const error = yield* Effect.flip(readConfigFile(configPath));
        expect(error).toBeInstanceOf(ConfigFileSchemaError);
        expect(error.message).toContain(configPath);
        expect(error.message).toContain("contextBlockFraction");
        expect(error.message).toContain("Fix or remove");
      }),
    ),
  );

  it.effect("separates malformed JSON from strict schema failures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-config-file-invalid-" });
        const malformedPath = path.join(root, "malformed.json");
        const excessPath = path.join(root, "excess.json");

        yield* fileSystem.writeFileString(malformedPath, "{not-json");
        yield* fileSystem.writeFileString(excessPath, JSON.stringify({ ...defaultBagConfig, unexpected: true }));

        const malformed = yield* Effect.flip(readConfigFile(malformedPath));
        const excess = yield* Effect.flip(readConfigFile(excessPath));

        expect(malformed).toBeInstanceOf(ConfigFileParseError);
        expect(malformed.message).toContain(malformedPath);
        expect(excess).toBeInstanceOf(ConfigFileSchemaError);
        expect(excess.message).toContain("unexpected");
      }),
    ),
  );

  it.effect("rejects invalid bounds and cross-field invariants", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-config-file-domain-" });
        const boundsPath = path.join(root, "bounds.json");
        const invariantPath = path.join(root, "invariant.json");

        yield* fileSystem.writeFileString(boundsPath, JSON.stringify({ ...defaultBagConfig, speechWordsPerMinute: 79 }));
        yield* fileSystem.writeFileString(
          invariantPath,
          JSON.stringify({ ...defaultBagConfig, contextWarnFraction: 0.3, contextBlockFraction: 0.2 }),
        );

        const bounds = yield* Effect.flip(readConfigFile(boundsPath));
        const invariant = yield* Effect.flip(readConfigFile(invariantPath));

        expect(bounds).toBeInstanceOf(ConfigFileSchemaError);
        expect(bounds.message).toContain("speechWordsPerMinute");
        expect(invariant).toBeInstanceOf(ConfigFileSchemaError);
        expect(invariant.message).toContain("contextWarnFraction");
      }),
    ),
  );

  it.effect("rejects non-UTF-8 bytes instead of accepting replacement characters", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-config-file-encoding-" });
        const configPath = path.join(root, "config.json");
        const marker = "replacement-marker";
        const json = JSON.stringify({ ...defaultBagConfig, speechVoice: marker });
        const markerIndex = json.indexOf(marker);
        const textEncoder = new TextEncoder();
        const bytes = new Uint8Array([
          ...textEncoder.encode(json.slice(0, markerIndex)),
          0xff,
          ...textEncoder.encode(json.slice(markerIndex + marker.length)),
        ]);

        yield* fileSystem.writeFile(configPath, bytes);

        const error = yield* Effect.flip(readConfigFile(configPath));
        expect(error).toBeInstanceOf(ConfigFileParseError);
        expect(error.message).toContain("UTF-8");
      }),
    ),
  );

  it.effect("rejects duplicate properties before JSON parsing can collapse them", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-config-file-duplicate-" });
        const configPath = path.join(root, "config.json");
        const json = JSON.stringify(defaultBagConfig).replace(
          `"debugEnabled":${String(defaultBagConfig.debugEnabled)}`,
          '"\\u0064ebugEnabled":false,"debugEnabled":true',
        );

        yield* fileSystem.writeFileString(configPath, json);

        const error = yield* Effect.flip(readConfigFile(configPath));
        expect(error).toBeInstanceOf(ConfigFileParseError);
        expect(error.message).toContain("duplicate JSON property");
        expect(error.message).toContain("debugEnabled");
      }),
    ),
  );

  it.effect("rejects a UTF-8 BOM instead of silently normalizing the file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-config-file-bom-" });
        const configPath = path.join(root, "config.json");
        const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(JSON.stringify(defaultBagConfig))]);

        yield* fileSystem.writeFile(configPath, bytes);

        const error = yield* Effect.flip(readConfigFile(configPath));
        expect(error).toBeInstanceOf(ConfigFileParseError);
        expect(error.message).toContain("byte-order mark");
      }),
    ),
  );

  it.effect("preserves non-missing filesystem errors", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dufflebag-config-file-read-error-" });

        const error = yield* Effect.flip(readConfigFile(root));

        expect(error._tag).toBe("SystemError");
      }),
    ),
  );
});
