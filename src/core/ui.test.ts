/**
 * ui wrappers — the non-interactive contract. select / text / confirm /
 * multiselect must return their fallback WITHOUT reaching the prompt library
 * when stdin is not a TTY, so a piped or CI invocation can never hang on input.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { confirm, multiselect, select, text } from "./index.js";

const originalIsTTY = process.stdin.isTTY;
beforeEach(() => Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true }));
afterEach(() => Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true }));

describe("ui wrappers fall back without a TTY", () => {
  it("select returns the fallback, not the initial", async () => {
    await expect(
      select(
        "pick",
        [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        "a",
        "b",
      ),
    ).resolves.toBe("b");
  });

  it("text returns the initial, or empty when none was given", async () => {
    await expect(text("path", { initial: "/tmp" })).resolves.toBe("/tmp");
    await expect(text("path")).resolves.toBe("");
  });

  it("confirm returns the fallback", async () => {
    await expect(confirm("ok?", true, false)).resolves.toBe(true);
  });

  it("multiselect returns the fallback set", async () => {
    await expect(multiselect("features", [{ value: "x", label: "X" }], ["x"], ["x"])).resolves.toEqual(["x"]);
  });
});
