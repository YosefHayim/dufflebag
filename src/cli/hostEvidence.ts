/**
 * Host and agent evidence capture for the CLI edge.
 *
 * Capabilities receive decoded evidence; they never probe the environment.
 */

import { Command, FileSystem, Path } from "@effect/platform";
import { Effect, Schema } from "effect";

import { agentCatalog, agentEvidenceSchema } from "../catalog/agentCatalog.js";
import { doctorPlatformSchema } from "../doctor.js";

export class HostEvidenceError extends Schema.TaggedError<HostEvidenceError>()("HostEvidenceError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable host evidence capture failure.",
  }),
}) {
  get message(): string {
    return `Cannot capture host evidence: ${this.issue}`;
  }
}

export type DoctorPlatform = Schema.Schema.Type<typeof doctorPlatformSchema>;

export const hostRootsSchema = Schema.Struct({
  homeRoot: Schema.String.annotations({
    description: "Absolute home root that owns global-scope artifacts.",
  }),
  projectRoot: Schema.String.annotations({
    description: "Absolute current-project root that owns project-scope artifacts.",
  }),
}).annotations({
  description: "Filesystem roots resolved once at the CLI edge.",
});

export type HostRoots = Schema.Schema.Type<typeof hostRootsSchema>;

export const hostEvidenceSchema = Schema.Struct({
  ...hostRootsSchema.fields,
  platform: doctorPlatformSchema,
  agentEvidence: agentEvidenceSchema,
}).annotations({
  description: "Complete host observation handed to capabilities so they never probe the environment.",
});

export type HostEvidence = Schema.Schema.Type<typeof hostEvidenceSchema>;

const uniqueSorted = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(values)].sort();

const absoluteRoot = (value: string, path: Path.Path): string => path.resolve(value).replaceAll("\\", "/");

const commandAvailable = (commandName: string) =>
  Command.make("which", commandName).pipe(
    Command.exitCode,
    Effect.map((code) => code === 0),
    Effect.catchAll(() => Effect.succeed(false)),
  );

const ghosttyAvailable = Effect.gen(function* () {
  if (process.env.TERM_PROGRAM?.toLowerCase() === "ghostty") {
    return true;
  }

  const fileSystem = yield* FileSystem.FileSystem;
  if (yield* fileSystem.exists("/Applications/Ghostty.app")) {
    return true;
  }

  return yield* commandAvailable("ghostty");
});

const presentHomePaths = (detection: { homeRoot: string; homePaths: ReadonlyArray<string> }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* Effect.filter(detection.homePaths, (homePath) =>
      fileSystem.exists(path.join(detection.homeRoot, homePath)),
    );
  });

const presentAbsolutePaths = (absolutePaths: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* Effect.filter(absolutePaths, (absolutePath) => fileSystem.exists(absolutePath));
  });

const availableCommands = (commandNames: ReadonlyArray<string>) =>
  Effect.filter(commandNames, (commandName) => commandAvailable(commandName));

// Observe every catalog-declared detection alternative for one agent exactly once.
const observeAgentDetection = (detection: {
  homeRoot: string;
  homePaths: ReadonlyArray<string>;
  absolutePaths: ReadonlyArray<string>;
  commands: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const homePaths = yield* presentHomePaths({ homeRoot: detection.homeRoot, homePaths: detection.homePaths });
    const absolutePaths = yield* presentAbsolutePaths(detection.absolutePaths);
    const commands = yield* availableCommands(detection.commands);
    return { homePaths, absolutePaths, commands };
  });

const captureAgentEvidence = (homeRoot: string) =>
  Effect.gen(function* () {
    const observations = yield* Effect.forEach(agentCatalog, (agent) =>
      observeAgentDetection({
        homeRoot,
        homePaths: agent.detection.homePaths,
        absolutePaths: agent.detection.absolutePaths,
        commands: agent.detection.commands,
      }),
    );

    return yield* Schema.decodeUnknown(agentEvidenceSchema, {
      onExcessProperty: "error",
    })({
      homePaths: uniqueSorted(observations.flatMap((observation) => observation.homePaths)),
      absolutePaths: uniqueSorted(observations.flatMap((observation) => observation.absolutePaths)),
      commands: uniqueSorted(observations.flatMap((observation) => observation.commands)),
    }).pipe(
      Effect.mapError(
        (error) =>
          new HostEvidenceError({
            issue: `Observed agent evidence is invalid: ${String(error)}`,
          }),
      ),
    );
  });

// Capture home/project roots, platform observations, and agent detection evidence.
export const captureHostEvidence = Effect.gen(function* () {
  const path = yield* Path.Path;
  const homeRoot = absoluteRoot(process.env.HOME || process.env.USERPROFILE || "", path);
  if (homeRoot === "/" || homeRoot === "") {
    return yield* new HostEvidenceError({
      issue: "HOME (or USERPROFILE) must resolve to an absolute home directory.",
    });
  }

  const projectRoot = absoluteRoot(process.cwd(), path);
  const platform = yield* Schema.decodeUnknown(doctorPlatformSchema, {
    onExcessProperty: "error",
  })({
    operatingSystem: process.platform,
    ghosttyAvailable: yield* ghosttyAvailable,
  }).pipe(
    Effect.mapError(
      (error) =>
        new HostEvidenceError({
          issue: `Host platform evidence is invalid: ${String(error)}`,
        }),
    ),
  );
  const agentEvidence = yield* captureAgentEvidence(homeRoot);

  return {
    homeRoot,
    projectRoot,
    platform,
    agentEvidence,
  } satisfies HostEvidence;
});

export const destinationForScope = (input: {
  scope: "global" | "project";
  homeRoot: string;
  projectRoot: string;
}): { _tag: "global"; root: string } | { _tag: "project"; root: string } => {
  if (input.scope === "global") {
    return { _tag: "global", root: input.homeRoot };
  }

  return { _tag: "project", root: input.projectRoot };
};
