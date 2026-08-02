/** `dufflebag uninstall` — remove only artifacts authorized by the receipt. */

import { Command } from "@effect/cli";
import { Terminal } from "@effect/platform";
import { Effect } from "effect";

import { uninstall } from "../install/uninstall.js";
import { captureHostEvidence, destinationForScope } from "./hostEvidence.js";
import { CliUsageError, formatOption, scopeOption, yesOption } from "./scopeOptions.js";
import * as TerminalUI from "./TerminalUI.js";

const presentUninstallCancellation = (request: { readonly format: "text" | "json"; readonly scope: string }) =>
  request.format === "json"
    ? TerminalUI.json({ _tag: "cancelled", scope: request.scope })
    : TerminalUI.outro("Cancelled — nothing was changed.");

export const uninstallCommand = Command.make(
  "uninstall",
  {
    scope: scopeOption,
    yes: yesOption,
    format: formatOption,
  },
  (args) =>
    Effect.gen(function* () {
      if (args.format === "text") yield* TerminalUI.intro("uninstall");
      const terminal = yield* Terminal.Terminal;
      const isTTY = yield* terminal.isTTY;
      if (!args.yes && !isTTY) {
        return yield* new CliUsageError({ issue: "Non-interactive uninstall requires --yes." });
      }

      if (!args.yes) {
        const confirmed = yield* TerminalUI.confirm({
          message: `Uninstall dufflebag from ${args.scope} scope?`,
          initialValue: false,
        });
        if (!confirmed) {
          yield* presentUninstallCancellation(args);
          return;
        }
      }

      const host = yield* captureHostEvidence;
      const uninstallation = yield* uninstall({
        destination: destinationForScope({
          scope: args.scope,
          homeRoot: host.homeRoot,
          projectRoot: host.projectRoot,
        }),
        host: { homeRoot: host.homeRoot },
        interaction: args.yes ? { _tag: "scripted" } : { _tag: "interactive" },
      });

      if (args.format === "json") {
        yield* TerminalUI.json(uninstallation);
        return;
      }

      yield* TerminalUI.success(
        uninstallation._tag === "uninstalled"
          ? `Uninstalled ${uninstallation.scope} installation.`
          : `No ${uninstallation.scope} installation present.`,
      );
      yield* TerminalUI.outro("Done.");
    }),
).pipe(Command.withDescription("Remove the receipt-owned installation from one scope"));
