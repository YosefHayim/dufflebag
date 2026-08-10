/**
 * Presentation owner for the CLI edge. Translates decoded results and terminal
 * interactions into human-readable output using official Effect platform and
 * CLI facilities. Domain modules never print.
 */

import { Prompt } from "@effect/cli";
import { Terminal } from "@effect/platform";
import { Effect } from "effect";

const writeLine = (message: string) =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    yield* terminal.display(`${message}\n`);
  });

export const appendChatText = (message: string) =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    yield* terminal.display(message);
  });

export const intro = (title: string) => writeLine(`\n  dufflebag · ${title}\n`);

export const outro = (message: string) => writeLine(`\n  ${message}\n`);

export const step = (message: string) => writeLine(`  → ${message}`);

export const success = (message: string) => writeLine(`  ✓ ${message}`);

export const warn = (message: string) => writeLine(`  ! ${message}`);

export const fail = (message: string) => writeLine(`  ✗ ${message}`);

export const detail = (message: string) => writeLine(`  · ${message}`);

export const json = (document: unknown) => writeLine(JSON.stringify(document));

export const note = (message: string, title?: string) =>
  Effect.gen(function* () {
    if (title !== undefined) {
      yield* writeLine(`\n  ${title}`);
      yield* writeLine(`  ${"─".repeat(Math.min(title.length, 40))}`);
    }

    // Emit each note line under a consistent indent.
    for (const line of message.split("\n")) {
      yield* writeLine(`  ${line}`);
    }
  });

export const presentError = (error: unknown) =>
  Effect.gen(function* () {
    const message = error instanceof Error ? error.message : String(error);
    yield* fail(message);
  });

export const confirm = (input: { message: string; initialValue: boolean }) =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    const isTTY = yield* terminal.isTTY;
    if (!isTTY) {
      return input.initialValue;
    }

    return yield* Prompt.confirm({
      message: input.message,
      initial: input.initialValue,
    }).pipe(Prompt.run);
  });

export const selectOne = <Value>(input: {
  message: string;
  choices: ReadonlyArray<{ title: string; value: Value; description?: string }>;
  initial?: Value;
}) =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    const isTTY = yield* terminal.isTTY;
    if (!isTTY) {
      const fallback = input.initial === undefined ? input.choices.at(0)?.value : input.initial;
      if (fallback === undefined) {
        return yield* Effect.fail(new Error("No choices available for non-interactive select."));
      }

      return fallback;
    }

    return yield* Prompt.select({
      message: input.message,
      choices: input.choices.map((choice) => ({
        title: choice.title,
        value: choice.value,
        description: choice.description,
      })),
    }).pipe(Prompt.run);
  });

export const multiSelect = <Value>(input: {
  message: string;
  choices: ReadonlyArray<{ title: string; value: Value; description?: string; selected?: boolean }>;
  initial: ReadonlyArray<Value>;
}) =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    const isTTY = yield* terminal.isTTY;
    if (!isTTY) {
      return [...input.initial];
    }

    const selected = yield* Prompt.multiSelect({
      message: input.message,
      choices: input.choices.map((choice) => ({
        title: choice.title,
        value: choice.value,
        description: choice.description,
        selected: choice.selected,
      })),
    }).pipe(Prompt.run);

    return selected.length > 0 ? selected : [...input.initial];
  });

export const isInteractiveTerminal = () =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    return yield* terminal.isTTY;
  });

export const optionalText = (input: { message: string; fallback: string }) =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    const isTTY = yield* terminal.isTTY;
    if (!isTTY) {
      return input.fallback;
    }

    const value = yield* Prompt.text({
      message: input.message,
      default: input.fallback,
    }).pipe(Prompt.run);

    return value.trim() === "" ? input.fallback : value.trim();
  });

/** Numbered lines for a review-before-apply plan (pure; easy to unit-test). */
export const formatOrderedFlow = (
  steps: ReadonlyArray<{ readonly label: string; readonly detail: string }>,
): ReadonlyArray<string> => steps.map((step, index) => `${String(index + 1)}. ${step.label}: ${step.detail}`);

/** Print an ordered plan so the user can review intent before mutation. */
export const presentOrderedFlow = (input: {
  readonly title: string;
  readonly steps: ReadonlyArray<{ readonly label: string; readonly detail: string }>;
}) => note(formatOrderedFlow(input.steps).join("\n"), input.title);

/**
 * Show an ordered flow and require explicit confirmation before apply.
 * Non-TTY uses `initialValue` without prompting (same fail-safe as confirm).
 */
export const approveOrderedFlow = (input: {
  readonly title: string;
  readonly steps: ReadonlyArray<{ readonly label: string; readonly detail: string }>;
  readonly confirmMessage: string;
  readonly initialValue?: boolean;
}) =>
  Effect.gen(function* () {
    yield* presentOrderedFlow({ title: input.title, steps: input.steps });
    return yield* confirm({
      message: input.confirmMessage,
      initialValue: input.initialValue === undefined ? false : input.initialValue,
    });
  });
