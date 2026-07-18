/**
 * Build a staged package root for install, update, and doctor.
 *
 * Catalog `sourceDirectory` values are camelCase and match authored skill
 * directories under `src/skills/`. Compiled hooks live under
 * `dist/src/skills/<sourceDirectory>/`; this stages them into
 * `dist/staged/runtime/<sourceDirectory>/` and catalog skill allowlists into
 * `dist/staged/skills/<id>/`.
 */

import { FileSystem, Path } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Effect, Schema } from "effect";

import { featureCatalog } from "../catalog/featureCatalog.js";
import { versionSchema } from "../install/artifactReceipt.js";
import { type stagedPackageSchema } from "../install/install.js";

export class StagePackageError extends Schema.TaggedError<StagePackageError>()("StagePackageError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable staging failure describing what the operator should fix.",
  }),
}) {
  get message(): string {
    return `Cannot stage dufflebag package: ${this.issue}`;
  }
}

export type StagedPackage = Schema.Schema.Type<typeof stagedPackageSchema>;

const packageVersionSchema = Schema.Struct({
  version: versionSchema.annotations({
    description: "Semantic package version published in the ownership receipt.",
  }),
});

const resolvePackageRoot = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const moduleDirectory = yield* path.fromFileUrl(new URL(import.meta.url));
  let directory = path.dirname(moduleDirectory);

  // Prefer the nearest package.json above this module (src/cli or dist/src/cli).
  while (true) {
    const candidate = path.join(directory, "package.json");
    if (yield* fileSystem.exists(candidate)) {
      return directory;
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return yield* new StagePackageError({
        issue: `Could not locate package.json walking up from ${moduleDirectory}.`,
      });
    }

    directory = parent;
  }
});

const readPackageVersion = (packageRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const packageJsonPath = path.join(packageRoot, "package.json");
    const raw = yield* fileSystem.readFileString(packageJsonPath).pipe(
      Effect.mapError(
        (error) =>
          new StagePackageError({
            issue: `Could not read package.json at ${packageJsonPath}: ${error.message}`,
          }),
      ),
    );

    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: (error) =>
        new StagePackageError({
          issue: `package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        }),
    });

    // package.json carries many fields; only version is needed for the staged receipt.
    return yield* Schema.decodeUnknown(packageVersionSchema)(parsed).pipe(
      Effect.mapError(
        (error) =>
          new StagePackageError({
            issue: `package.json version is invalid: ${String(error)}`,
          }),
      ),
    );
  });

const copyFile = (input: { source: string; destination: string }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.makeDirectory(path.dirname(input.destination), { recursive: true });
    const bytes = yield* fileSystem.readFile(input.source);
    yield* fileSystem.writeFile(input.destination, bytes);
  });

const copyTree = (input: {
  source: string;
  destination: string;
}): Effect.Effect<void, StagePackageError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sourceExists = yield* fileSystem.exists(input.source);
    if (!sourceExists) {
      return;
    }

    const info = yield* fileSystem.stat(input.source);
    if (info.type === "File") {
      yield* copyFile(input);
      return;
    }

    if (info.type !== "Directory") {
      return;
    }

    yield* fileSystem.makeDirectory(input.destination, { recursive: true });
    const entries = yield* fileSystem.readDirectory(input.source);

    // Mirror every child path into the staged destination tree.
    for (const entry of entries) {
      yield* copyTree({
        source: path.join(input.source, entry),
        destination: path.join(input.destination, entry),
      });
    }
  });

const stageRuntimeFeature = (input: {
  packageRoot: string;
  stagedRoot: string;
  sourceDirectory: string;
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const compiledFeatureRoot = path.join(input.packageRoot, "dist", "src", "skills", input.sourceDirectory);
    const stagedFeatureRoot = path.join(input.stagedRoot, "runtime", input.sourceDirectory);
    const compiledExists = yield* fileSystem.exists(compiledFeatureRoot);
    if (!compiledExists) {
      return;
    }

    const runtimeParts: ReadonlyArray<string> = ["hooks", "lib", "command"];

    // Stage only the runtime-relevant subtrees under the compiled feature.
    for (const part of runtimeParts) {
      const sourcePart = path.join(compiledFeatureRoot, part);
      if (yield* fileSystem.exists(sourcePart)) {
        yield* copyTree({
          source: sourcePart,
          destination: path.join(stagedFeatureRoot, part),
        });
      }
    }
  });

const stageSkillFeature = (input: {
  packageRoot: string;
  stagedRoot: string;
  sourceDirectory: string;
  skillId: string;
  shippedPaths: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const skillSourceRoot = path.join(input.packageRoot, "src", "skills", input.sourceDirectory);
    const stagedSkillRoot = path.join(input.stagedRoot, "skills", input.skillId);
    const skillExists = yield* fileSystem.exists(skillSourceRoot);
    if (!skillExists) {
      return yield* new StagePackageError({
        issue: `Authored skill directory missing at ${skillSourceRoot}.`,
      });
    }

    // Copy only the catalog-declared allowlist into the staged skill tree.
    for (const shippedPath of input.shippedPaths) {
      const source = path.join(skillSourceRoot, shippedPath);
      const destination = path.join(stagedSkillRoot, shippedPath);
      if (!(yield* fileSystem.exists(source))) {
        return yield* new StagePackageError({
          issue: `Catalog-shipped path ${shippedPath} is missing under ${skillSourceRoot}.`,
        });
      }

      yield* copyTree({ source, destination });
    }
  });

// Stage catalog skills and compiled runtime entrypoints into one package root.
export const stagePackage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const packageRoot = yield* resolvePackageRoot;
  const compiledSkillsRoot = path.join(packageRoot, "dist", "src", "skills");
  if (!(yield* fileSystem.exists(compiledSkillsRoot))) {
    return yield* new StagePackageError({
      issue: `Compiled skills missing at ${compiledSkillsRoot}. Run \`pnpm build\` before install, update, or doctor.`,
    });
  }

  const { version } = yield* readPackageVersion(packageRoot);
  const stagedRoot = path.join(packageRoot, "dist", "staged");
  yield* fileSystem.remove(stagedRoot, { recursive: true }).pipe(Effect.catchAll(() => Effect.void));
  yield* fileSystem.makeDirectory(path.join(stagedRoot, "runtime"), { recursive: true });
  yield* fileSystem.makeDirectory(path.join(stagedRoot, "skills"), { recursive: true });

  // Stage every catalog feature's runtime tree and skill allowlist.
  for (const feature of featureCatalog) {
    if (feature.runtime._tag === "hook") {
      yield* stageRuntimeFeature({
        packageRoot,
        stagedRoot,
        sourceDirectory: feature.sourceDirectory,
      });
    }

    if (feature.installedSkill._tag === "skill") {
      yield* stageSkillFeature({
        packageRoot,
        stagedRoot,
        sourceDirectory: feature.sourceDirectory,
        skillId: feature.installedSkill.id,
        shippedPaths: feature.installedSkill.shippedPaths,
      });
    }
  }

  return {
    root: stagedRoot,
    version,
  } satisfies StagedPackage;
});
