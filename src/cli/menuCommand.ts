/**
 * Interactive menu routing for bare TTY invocations.
 * Routes into the same capability requests as explicit commands.
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";

import { featureCatalog, selectedFeatureIds } from "../catalog/featureCatalog.js";
import { doctor } from "../doctor.js";
import { install } from "../install/install.js";
import { uninstall } from "../install/uninstall.js";
import { update } from "../install/update.js";
import { scaffoldWorkflows } from "../scaffoldWorkflows.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { stagePackage } from "./stagePackage.js";
import * as TerminalUI from "./TerminalUI.js";

type MenuAction = "install" | "update" | "config" | "doctor" | "scaffold-ci" | "uninstall" | "exit";

const resolvePackageRoot = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  const moduleDirectory = yield* path.fromFileUrl(new URL(import.meta.url));
  let directory = path.dirname(moduleDirectory);

  // Walk toward the filesystem root until package.json is found.
  while (true) {
    const candidate = path.join(directory, "package.json");
    if (yield* fileSystem.exists(candidate)) {
      return directory;
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return directory;
    }

    directory = parent;
  }
});

const pickScope = (verb: string) =>
  TerminalUI.selectOne<"global" | "project">({
    message: `${verb} — which scope?`,
    choices: [
      { title: "global", value: "global", description: "home root · every session" },
      { title: "project", value: "project", description: "this repo · committable" },
    ],
    initial: "global",
  });

const runInstall = Effect.gen(function* () {
  const scope = yield* pickScope("Install");
  const host = yield* captureHostEvidence;
  const stagedPackage = yield* stagePackage;
  const features = yield* TerminalUI.multiSelect({
    message: "Select features to install",
    choices: featureCatalog.map((feature) => ({
      title: feature.title,
      value: feature.id,
      description: feature.summary,
      selected: feature.selectedByDefault,
    })),
    initial: selectedFeatureIds,
  });

  const result = yield* install({
    destination: destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
    host: { homeRoot: host.homeRoot },
    stagedPackage,
    features: { _tag: "selected", ids: features },
    agents: { _tag: "detected", evidence: host.agentEvidence },
    interaction: { _tag: "interactive" },
    configuration: { _tag: "automatic" },
  });

  yield* TerminalUI.success(`${result._tag}: ${result.features.join(", ")}`);
});

const runUpdate = Effect.gen(function* () {
  const scope = yield* pickScope("Update");
  const host = yield* captureHostEvidence;
  const stagedPackage = yield* stagePackage;
  const result = yield* update({
    destination: destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
    host: { homeRoot: host.homeRoot },
    stagedPackage,
    features: { _tag: "preserve" },
    agents: { _tag: "detected", evidence: host.agentEvidence },
    interaction: { _tag: "interactive" },
    configuration: { _tag: "automatic" },
  });

  yield* TerminalUI.success(`${result._tag}: ${result.features.join(", ")}`);
});

const runUninstall = Effect.gen(function* () {
  const scope = yield* pickScope("Uninstall");
  const confirmed = yield* TerminalUI.confirm({
    message: `Uninstall dufflebag from ${scope}?`,
    initialValue: false,
  });
  if (!confirmed) {
    yield* TerminalUI.outro("Cancelled — nothing was changed.");
    return;
  }

  const host = yield* captureHostEvidence;
  const result = yield* uninstall({
    destination: destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
    host: { homeRoot: host.homeRoot },
    interaction: { _tag: "interactive" },
  });

  yield* TerminalUI.success(result._tag);
});

const runDoctor = Effect.gen(function* () {
  const host = yield* captureHostEvidence;
  const stagedPackage = yield* stagePackage;

  const scopes: ReadonlyArray<"global" | "project"> = ["global", "project"];

  // Inspect both scopes from the menu the same way as the explicit command.
  for (const scope of scopes) {
    const report = yield* doctor({
      destination: destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
      stagedPackage,
      platform: host.platform,
      agentEvidence: host.agentEvidence,
    });
    yield* TerminalUI.step(
      `${scope}: ${report.installation._tag === "present" ? `v${report.installation.version}` : "missing"}`,
    );
  }
});

const runScaffold = Effect.gen(function* () {
  const path = yield* Path.Path;
  const packageRoot = yield* resolvePackageRoot;
  const result = yield* scaffoldWorkflows({
    targetRoot: path.resolve(process.cwd()),
    templateDirectory: path.join(packageRoot, "templates", "workflows"),
    force: false,
  });
  yield* TerminalUI.success(`wrote ${result.written.length}, skipped ${result.skipped.length}`);
});

// Interactive menu: pick an action, then invoke the same capability as the explicit command.
export const runMenu = Effect.gen(function* () {
  yield* TerminalUI.intro("menu");
  const action = yield* TerminalUI.selectOne<MenuAction>({
    message: "What would you like to do?",
    choices: [
      { title: "Install features", value: "install", description: "copy hooks + skills" },
      { title: "Update", value: "update", description: "refresh hook code" },
      { title: "Configure", value: "config", description: "show managed config" },
      { title: "Doctor", value: "doctor", description: "read-only health check" },
      { title: "Scaffold CI", value: "scaffold-ci", description: "copy workflow set" },
      { title: "Uninstall", value: "uninstall", description: "remove installation" },
      { title: "Exit", value: "exit", description: "close the bag" },
    ],
    initial: "exit",
  });

  switch (action) {
    case "install":
      yield* runInstall;
      break;
    case "update":
      yield* runUpdate;
      break;
    case "config":
      yield* TerminalUI.info("Use `dufflebag config` with flags to change tunables, or bare `dufflebag config` to show values.");
      break;
    case "doctor":
      yield* runDoctor;
      break;
    case "scaffold-ci":
      yield* runScaffold;
      break;
    case "uninstall":
      yield* runUninstall;
      break;
    case "exit":
      yield* TerminalUI.outro("Closed.");
      return;
  }

  yield* TerminalUI.outro("Done.");
}).pipe(Effect.catchAll((error) => TerminalUI.presentError(error)));
