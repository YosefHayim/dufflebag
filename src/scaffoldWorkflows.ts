/**
 * Scaffold reusable CI + publish workflow templates into a repository.
 *
 * Templates live under `templates/workflows/`. Only `publish.yml` is filled
 * with OWNER/REPO/PACKAGE placeholders; every other `.yml` copies verbatim.
 */

import { Command, FileSystem, Path } from "@effect/platform";
import { Effect, Schema } from "effect";

export class ScaffoldWorkflowsError extends Schema.TaggedError<ScaffoldWorkflowsError>()("ScaffoldWorkflowsError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable workflow scaffolding failure.",
  }),
}) {
  get message(): string {
    return `Cannot scaffold workflows: ${this.issue}`;
  }
}

export const scaffoldInputsSchema = Schema.Struct({
  owner: Schema.NonEmptyTrimmedString.annotations({
    description: "GitHub org or user that owns the target repository.",
  }),
  repo: Schema.NonEmptyTrimmedString.annotations({
    description: "Target repository name.",
  }),
  packageName: Schema.NonEmptyTrimmedString.annotations({
    description: "npm package name used by publish.yml.",
  }),
});

export type ScaffoldInputs = Schema.Schema.Type<typeof scaffoldInputsSchema>;

export const templateFileSchema = Schema.Struct({
  name: Schema.NonEmptyTrimmedString.annotations({
    description: "Template filename, e.g. ci.yml.",
  }),
  raw: Schema.String.annotations({
    description: "Raw template file contents, verbatim.",
  }),
});

export type TemplateFile = Schema.Schema.Type<typeof templateFileSchema>;

export const plannedWorkflowFileSchema = Schema.Struct({
  name: Schema.NonEmptyTrimmedString.annotations({
    description: "Destination filename under .github/workflows.",
  }),
  content: Schema.String.annotations({
    description: "Final text to write (publish.yml filled; others verbatim).",
  }),
});

export type PlannedWorkflowFile = Schema.Schema.Type<typeof plannedWorkflowFileSchema>;

export const scaffoldWorkflowsRequestSchema = Schema.Struct({
  targetRoot: Schema.NonEmptyTrimmedString.annotations({
    description: "Absolute repository root that receives the workflow files.",
  }),
  templateDirectory: Schema.NonEmptyTrimmedString.annotations({
    description: "Absolute directory containing shipped workflow templates.",
  }),
  force: Schema.Boolean.annotations({
    description: "Whether existing workflow files should be overwritten.",
  }),
});

export type ScaffoldWorkflowsRequest = Schema.Schema.Type<typeof scaffoldWorkflowsRequestSchema>;

export const scaffoldWorkflowsResultSchema = Schema.Struct({
  written: Schema.Array(Schema.NonEmptyTrimmedString).annotations({
    description: "Workflow filenames written by this run.",
  }),
  skipped: Schema.Array(Schema.NonEmptyTrimmedString).annotations({
    description: "Workflow filenames kept because they already exist.",
  }),
  targetRoot: Schema.NonEmptyTrimmedString.annotations({
    description: "Absolute repository root that received the workflow files.",
  }),
});

export type ScaffoldWorkflowsResult = Schema.Schema.Type<typeof scaffoldWorkflowsResultSchema>;

export const fillPublishTemplate = (input: { template: string; inputs: ScaffoldInputs }): string =>
  input.template
    .replaceAll("{{OWNER}}", input.inputs.owner)
    .replaceAll("{{REPO}}", input.inputs.repo)
    .replaceAll("{{PACKAGE}}", input.inputs.packageName);

export const resolveWorkflows = (input: {
  files: ReadonlyArray<TemplateFile>;
  inputs: ScaffoldInputs;
}): ReadonlyArray<PlannedWorkflowFile> =>
  input.files
    .filter((file) => file.name.endsWith(".yml"))
    .map((file) => ({
      name: file.name,
      content: file.name === "publish.yml" ? fillPublishTemplate({ template: file.raw, inputs: input.inputs }) : file.raw,
    }));

const readTemplates = (templateDirectory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!(yield* fileSystem.exists(templateDirectory))) {
      return yield* new ScaffoldWorkflowsError({
        issue: `templates/workflows missing at ${templateDirectory} — reinstall dufflebag.`,
      });
    }

    const names = (yield* fileSystem.readDirectory(templateDirectory)).filter((name) => name.endsWith(".yml")).sort();
    const files = yield* Effect.forEach(names, (name) =>
      Effect.gen(function* () {
        const raw = yield* fileSystem.readFileString(path.join(templateDirectory, name));
        return { name, raw };
      }),
    );

    if (files.length === 0) {
      return yield* new ScaffoldWorkflowsError({
        issue: `No workflow templates found in ${templateDirectory} — reinstall dufflebag.`,
      });
    }

    return files;
  });

const detectGitRemote = (root: string) =>
  Command.make("git", "remote", "get-url", "origin").pipe(
    Command.workingDirectory(root),
    Command.string,
    Effect.map((url) => {
      // e.g. "git@github.com:Acme/app.git" or "https://github.com/Acme/app" → owner=Acme, repo=app
      const match = url.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
      // Guard proves capture groups exist when match is non-null.
      return match === null ? undefined : { owner: match[1]!, repo: match[2]! };
    }),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );

const detectInputs = (root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const remote = yield* detectGitRemote(root);
    const packageJsonPath = path.join(root, "package.json");
    const packageName = yield* Effect.gen(function* () {
      if (!(yield* fileSystem.exists(packageJsonPath))) {
        const missing: string | undefined = undefined;
        return missing;
      }

      const raw = yield* fileSystem.readFileString(packageJsonPath);
      const parsed: unknown = yield* Effect.try({
        try: (): unknown => JSON.parse(raw),
        catch: (error) => error,
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

      if (typeof parsed === "object" && parsed !== null && "name" in parsed && typeof parsed.name === "string" && parsed.name.trim() !== "") {
        return parsed.name;
      }

      const missing: string | undefined = undefined;
      return missing;
    });

    return {
      owner: remote?.owner ?? "OWNER",
      repo: remote?.repo ?? "REPO",
      packageName: packageName ?? "your-package",
    } satisfies ScaffoldInputs;
  });

// Copy the CI + publish workflow set into a repository's .github/workflows.
export const scaffoldWorkflows = (input: unknown) =>
  Effect.gen(function* () {
    const request = yield* Schema.decodeUnknown(scaffoldWorkflowsRequestSchema, {
      onExcessProperty: "error",
    })(input).pipe(
      Effect.mapError(
        (error) =>
          new ScaffoldWorkflowsError({
            issue: `Invalid scaffold request: ${String(error)}`,
          }),
      ),
    );
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const templates = yield* readTemplates(request.templateDirectory);
    const inputs = yield* detectInputs(request.targetRoot);
    const planned = resolveWorkflows({ files: templates, inputs });
    const workflowsDir = path.join(request.targetRoot, ".github", "workflows");
    yield* fileSystem.makeDirectory(workflowsDir, { recursive: true });

    const written: Array<string> = [];
    const skipped: Array<string> = [];

    // Write each planned workflow unless an existing file is being preserved.
    for (const file of planned) {
      const destination = path.join(workflowsDir, file.name);
      const exists = yield* fileSystem.exists(destination);
      if (exists && !request.force) {
        skipped.push(file.name);
        continue;
      }

      yield* fileSystem.writeFileString(destination, file.content);
      written.push(file.name);
    }

    return {
      written,
      skipped,
      targetRoot: request.targetRoot,
    } satisfies ScaffoldWorkflowsResult;
  });
