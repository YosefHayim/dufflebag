/**
 * Host and agent evidence capture for the CLI edge.
 *
 * Capabilities receive decoded evidence; they never probe the environment.
 */

import { Command, FileSystem, Path } from "@effect/platform";
import { Effect, Schema } from "effect";

import { type AgentEvidence, agentCatalog, agentEvidenceSchema } from "../catalog/agentCatalog.js";
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

export type HostRoots = {
  readonly homeRoot: string;
  readonly projectRoot: string;
};

export type HostEvidence = HostRoots & {
  readonly platform: DoctorPlatform;
  readonly agentEvidence: AgentEvidence;
};

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

const captureAgentEvidence = (homeRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const homePaths: Array<string> = [];
    const absolutePaths: Array<string> = [];
    const commands: Array<string> = [];

    // Observe every catalog-declared detection alternative exactly once.
    for (const agent of agentCatalog) {
      for (const homePath of agent.detection.homePaths) {
        if (yield* fileSystem.exists(path.join(homeRoot, homePath))) {
          homePaths.push(homePath);
        }
      }

      for (const absolutePath of agent.detection.absolutePaths) {
        if (yield* fileSystem.exists(absolutePath)) {
          absolutePaths.push(absolutePath);
        }
      }

      for (const commandName of agent.detection.commands) {
        if (yield* commandAvailable(commandName)) {
          commands.push(commandName);
        }
      }
    }

    return yield* Schema.decodeUnknown(agentEvidenceSchema, {
      onExcessProperty: "error",
    })({
      homePaths: uniqueSorted(homePaths),
      absolutePaths: uniqueSorted(absolutePaths),
      commands: uniqueSorted(commands),
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
  const homeRoot = absoluteRoot(process.env.HOME ?? process.env.USERPROFILE ?? "", path);
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
