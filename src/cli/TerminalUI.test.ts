import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import * as TerminalUI from "./TerminalUI.js";

describe("TerminalUI", () => {
  it.effect("presentation effects complete under NodeContext without throwing", () =>
    Effect.gen(function* () {
      yield* TerminalUI.intro("test");
      yield* TerminalUI.step("working");
      yield* TerminalUI.success("ok");
      yield* TerminalUI.warn("careful");
      yield* TerminalUI.info("note");
      yield* TerminalUI.fail("problem");
      yield* TerminalUI.note("line one\nline two", "Details");
      yield* TerminalUI.outro("done");
      yield* TerminalUI.presentError(new Error("expected failure"));
      const interactive = yield* TerminalUI.isInteractiveTerminal();
      expect(typeof interactive).toBe("boolean");
    }).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("confirm returns the fallback on non-TTY without hanging", () =>
    Effect.gen(function* () {
      const answer = yield* TerminalUI.confirm({
        message: "Continue?",
        initialValue: true,
      });
      // Under vitest stdin is typically non-TTY, so the initial value is returned.
      expect(answer).toBe(true);
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});
