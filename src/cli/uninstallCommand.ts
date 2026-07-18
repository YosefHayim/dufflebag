/**
 * `dufflebag uninstall` — remove a receipt-authorized installation.
 */

import { Command } from "@effect/cli";
import { Terminal } from "@effect/platform";
import { Effect } from "effect";

import { uninstall } from "../install/uninstall.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { globalOption, projectOption, resolveScope, yesOption } from "./scopeOptions.js";
import * as TerminalUI from "./TerminalUI.js";

export const uninstallCommand = Command.make(
  "uninstall",
  {
    project: projectOption,
    global: globalOption,
    yes: yesOption,
  },
  (args) =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("uninstall");
      const scope = yield* resolveScope(args);
      const host = yield* captureHostEvidence;
      const terminal = yield* Terminal.Terminal;
      const isTTY = yield* terminal.isTTY;
      const interaction: { _tag: "scripted" } | { _tag: "interactive" } =
        args.yes || !isTTY ? { _tag: "scripted" } : { _tag: "interactive" };

      if (interaction._tag === "interactive" && !args.yes) {
        const confirmed = yield* TerminalUI.confirm({
          message: `Uninstall dufflebag from ${scope} scope?`,
          initialValue: false,
        });
        if (!confirmed) {
          yield* TerminalUI.outro("Cancelled — nothing was changed.");
          return;
        }
      }

      const result = yield* uninstall({
        destination: destinationForScope({
          scope,
          homeRoot: host.homeRoot,
          projectRoot: host.projectRoot,
        }),
        host: { homeRoot: host.homeRoot },
        interaction,
      });

      yield* TerminalUI.success(
        result._tag === "uninstalled" ? `Uninstalled ${result.scope} installation.` : `No ${result.scope} installation present.`,
      );
      yield* TerminalUI.outro("Done.");
    }).pipe(Effect.catchAll((error) => TerminalUI.presentError(error))),
).pipe(Command.withDescription("Surgically remove everything dufflebag added"));
