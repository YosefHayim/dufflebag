import * as PlatformError from "@effect/platform/Error";
import * as FileSystem from "@effect/platform/FileSystem";
import { NodeFileSystem } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Cause, Effect, Option, Schema } from "effect";

import { bagConfigJsonSchema, defaultBagConfig } from "./bagConfigSchema.js";
import { readConfigFile } from "./configFile.js";

const bytes = (value: string): Uint8Array => {
  return new TextEncoder().encode(value);
};

const failureFrom = <A, E, R>(effect: Effect.Effect<A, E, R>) => {
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    if (exit._tag === "Success") {
      throw new Error("Expected the effect to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    if (Option.isNone(failure)) {
      throw new Error("Expected a typed failure.");
    }

    return failure.value;
  });
};

const withTemporaryRoot = <A, E, R>(run: (root: string) => Effect.Effect<A, E, R>) => {
  // Allocate the fixture root, run the caller, and remove the root in that order even when the caller fails.
  return Effect.gen(function* () {
    // 1. Acquire the official filesystem service.
    const fileSystem = yield* FileSystem.FileSystem;
    // 2. Allocate an independent fixture root.
    const root = yield* fileSystem.makeTempDirectory({ prefix: "dufflebag-config-file-test-" });

    // 3. Run the fixture and attach unconditional cleanup.
    return yield* run(root).pipe(
      Effect.ensuring(fileSystem.remove(root, { recursive: true, force: true }).pipe(Effect.catchAll(() => Effect.void))),
    );
  });
};

layer(NodeFileSystem.layer)("readConfigFile", (it) => {
  it.effect("returns Option.none only when the file is absent", () => {
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        const result = yield* readConfigFile(`${root}/missing.json`);

        expect(Option.isNone(result)).toBe(true);
      }),
    );
  });

  it.effect("returns the exact file bytes beside the strictly decoded complete config", () => {
    // Write a complete raw document, read through the public boundary, and compare both representations.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Acquire the filesystem used by the boundary.
        const fileSystem = yield* FileSystem.FileSystem;
        const targetPath = `${root}/config.json`;
        const raw = bytes(`${Schema.encodeSync(bagConfigJsonSchema)(defaultBagConfig)}\n`);
        // 2. Persist the exact fixture bytes.
        yield* fileSystem.writeFile(targetPath, raw);

        // 3. Read and decode through the public capability.
        const result = yield* readConfigFile(targetPath);
        if (Option.isNone(result)) {
          throw new Error("Expected a config snapshot.");
        }

        expect(Array.from(result.value.bytes)).toEqual(Array.from(raw));
        expect(result.value.config).toEqual(defaultBagConfig);
      }),
    );
  });

  it.effect("rejects an incomplete persisted object instead of applying interactive defaults", () => {
    // Persist an incomplete object, invoke the strict reader, and inspect its typed failure.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Acquire the filesystem used by the boundary.
        const fileSystem = yield* FileSystem.FileSystem;
        const targetPath = `${root}/config.json`;
        // 2. Persist a document that only the interactive defaulting schema would accept.
        yield* fileSystem.writeFile(targetPath, bytes('{"debugEnabled":false}'));

        // 3. Capture the strict persisted-schema failure.
        const failure = yield* failureFrom(readConfigFile(targetPath));

        expect(failure._tag).toBe("ConfigFileSchemaError");
        expect(failure.path).toBe(targetPath);
        expect(failure.message).toContain("complete managed configuration");
      }),
    );
  });

  it.effect("distinguishes invalid UTF-8, JSON syntax, and schema failures", () => {
    // Persist one fixture per decoding phase, read each, and compare their stable error tags.
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        // 1. Acquire the filesystem used by the boundary.
        const fileSystem = yield* FileSystem.FileSystem;
        const utf8Path = `${root}/utf8.json`;
        const jsonPath = `${root}/json.json`;
        const schemaPath = `${root}/schema.json`;
        // 2. Persist invalid transport bytes.
        yield* fileSystem.writeFile(utf8Path, new Uint8Array([0xc3, 0x28]));
        // 3. Persist invalid JSON syntax.
        yield* fileSystem.writeFile(jsonPath, bytes("{"));
        // 4. Persist a structurally invalid domain document.
        yield* fileSystem.writeFile(
          schemaPath,
          bytes(
            JSON.stringify({
              ...defaultBagConfig,
              unknownSetting: true,
            }),
          ),
        );

        // 5. Read the transport fixture through the public boundary.
        expect((yield* failureFrom(readConfigFile(utf8Path)))._tag).toBe("ConfigFileUtf8Error");
        // 6. Read the syntax fixture through the public boundary.
        expect((yield* failureFrom(readConfigFile(jsonPath)))._tag).toBe("ConfigFileJsonError");
        // 7. Read the domain fixture through the public boundary.
        expect((yield* failureFrom(readConfigFile(schemaPath)))._tag).toBe("ConfigFileSchemaError");
      }),
    );
  });

  it.effect("reports non-NotFound filesystem failures instead of treating them as absence", () => {
    return withTemporaryRoot((root) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const targetPath = `${root}/config.json`;
        const decorated: FileSystem.FileSystem = {
          ...fileSystem,
          readFile: (readPath) =>
            readPath === targetPath
              ? Effect.fail(
                  new PlatformError.SystemError({
                    reason: "PermissionDenied",
                    module: "FileSystem",
                    method: "readFile",
                    pathOrDescriptor: readPath,
                    description: "Injected permission failure.",
                  }),
                )
              : fileSystem.readFile(readPath),
        };

        const failure = yield* failureFrom(readConfigFile(targetPath).pipe(Effect.provideService(FileSystem.FileSystem, decorated)));

        expect(failure._tag).toBe("ConfigFileReadError");
        expect(failure.path).toBe(targetPath);
        expect(failure.cause.reason).toBe("PermissionDenied");
      }),
    );
  });
});
