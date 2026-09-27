import { execFile, spawn } from "node:child_process";

import { Effect, Option } from "effect";

const keychainService = "ys-dufflebag.openrouter";
const keychainAccount = "dufflebag";

export const requireKeychain = () =>
  process.platform === "darwin"
    ? Effect.void
    : Effect.fail(new Error("OpenRouter Keychain consent is currently available on macOS only."));

// Replaces any earlier entry.
export const saveOpenRouterCredential = (credential: string) =>
  Effect.async<void, Error>((resume) => {
    const saveFailure = () => new Error("macOS Keychain could not save the OpenRouter credential.");
    // A `-w <secret>` argument would expose the key in the process list, so expect answers the prompt from stdin.
    const keychainPrompt = [
      `spawn security add-generic-password -a ${keychainAccount} -s ${keychainService} -U -w`,
      'expect "password data for new item:"',
      "gets stdin credential",
      'send -- "$credential\\r"',
      'expect "retype password for new item:"',
      'send -- "$credential\\r"',
      "expect eof",
    ].join("\n");
    const keychainWriter = spawn("expect", ["-c", keychainPrompt], { stdio: ["pipe", "ignore", "ignore"] });
    keychainWriter.once("error", () => resume(Effect.fail(saveFailure())));
    keychainWriter.once("close", (exitCode) => resume(exitCode === 0 ? Effect.void : Effect.fail(saveFailure())));
    keychainWriter.stdin.write(`${credential}\n`);
    keychainWriter.stdin.end();
  });

// None when Keychain is unavailable, empty, or has no entry.
export const readOpenRouterCredential = (): Effect.Effect<Option.Option<string>> => {
  if (process.platform !== "darwin") return Effect.succeed(Option.none());
  return Effect.async<Option.Option<string>>((resume) => {
    execFile(
      "security",
      ["find-generic-password", "-a", keychainAccount, "-s", keychainService, "-w"],
      (failure, stdout) => {
        const credential = failure === null ? stdout.trim() : "";
        resume(Effect.succeed(credential === "" ? Option.none() : Option.some(credential)));
      },
    );
  });
};

export const requireOpenRouterCredential = () =>
  requireKeychain().pipe(
    Effect.zipRight(readOpenRouterCredential()),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new Error("No OpenRouter credential is saved in macOS Keychain. Run `dufflebag openrouter connect`."),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );
