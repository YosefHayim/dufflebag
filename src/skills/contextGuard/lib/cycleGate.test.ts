/**
 * Unit coverage for the pure ctx-watch cycle gate. Every refuse and halt branch
 * is asserted so the daemon's safety conjunction stays verifiable in CI without
 * AppleScript or a live Ghostty session.
 */

import { describe, expect, it } from "vitest";

import { type CycleGateSnapshot, decideCycleGate } from "./cycleGate.js";

const ready: CycleGateSnapshot = {
  armed: true,
  occupancy: 200_000,
  windowTokens: 1_000_000,
  warnFraction: 0.18,
  cycles: 0,
  budget: 10,
  hardCap: 50,
  freshHandoff: true,
  turnIdle: true,
  ghosttyFrontmost: true,
  windowLocated: true,
  done: false,
};

const withSnapshot = (overrides: Partial<CycleGateSnapshot>): CycleGateSnapshot => ({
  ...ready,
  ...overrides,
});

describe("decideCycleGate", () => {
  it("cycles when every safety gate passes", () => {
    expect(decideCycleGate(ready)).toEqual({ kind: "cycle" });
  });

  it("observes when disarmed", () => {
    expect(decideCycleGate(withSnapshot({ armed: false }))).toEqual({ kind: "observe" });
  });

  it("waits when occupancy is unknown", () => {
    expect(decideCycleGate(withSnapshot({ occupancy: null }))).toEqual({
      kind: "wait",
      reason: "no-occupancy",
    });
  });

  it("waits when occupancy is below the warn fraction", () => {
    // 100k / 1M = 0.10 < 0.18
    expect(decideCycleGate(withSnapshot({ occupancy: 100_000 }))).toEqual({
      kind: "wait",
      reason: "below-warn",
    });
  });

  it("cycles at exactly the warn fraction", () => {
    // 180k / 1M = 0.18 — at-or-above warn, not below
    expect(decideCycleGate(withSnapshot({ occupancy: 180_000 }))).toEqual({ kind: "cycle" });
  });

  it("halts on the hard cycle cap before the soft budget", () => {
    expect(decideCycleGate(withSnapshot({ cycles: 50, budget: 100, hardCap: 50 }))).toEqual({
      kind: "halt",
      reason: "hard-cap",
    });
  });

  it("halts when the soft budget is reached", () => {
    expect(decideCycleGate(withSnapshot({ cycles: 10, budget: 10, hardCap: 50 }))).toEqual({
      kind: "halt",
      reason: "budget-reached",
    });
  });

  it("prefers hard-cap over budget-reached when both apply", () => {
    expect(decideCycleGate(withSnapshot({ cycles: 50, budget: 10, hardCap: 50 }))).toEqual({
      kind: "halt",
      reason: "hard-cap",
    });
  });

  it("waits without a fresh handoff", () => {
    expect(decideCycleGate(withSnapshot({ freshHandoff: false }))).toEqual({
      kind: "wait",
      reason: "no-fresh-handoff",
    });
  });

  it("waits when the turn is not idle", () => {
    expect(decideCycleGate(withSnapshot({ turnIdle: false }))).toEqual({
      kind: "wait",
      reason: "not-idle",
    });
  });

  it("waits when Ghostty is not frontmost", () => {
    expect(decideCycleGate(withSnapshot({ ghosttyFrontmost: false }))).toEqual({
      kind: "wait",
      reason: "not-frontmost",
    });
  });

  it("waits when the session window is not located", () => {
    expect(decideCycleGate(withSnapshot({ windowLocated: false }))).toEqual({
      kind: "wait",
      reason: "window-not-located",
    });
  });

  it("halts when the done marker is present", () => {
    expect(decideCycleGate(withSnapshot({ done: true }))).toEqual({
      kind: "halt",
      reason: "done",
    });
  });

  it("checks gates in order: disarmed before occupancy", () => {
    expect(decideCycleGate(withSnapshot({ armed: false, occupancy: null }))).toEqual({
      kind: "observe",
    });
  });

  it("checks gates in order: occupancy before warn fraction", () => {
    expect(decideCycleGate(withSnapshot({ occupancy: null, freshHandoff: false }))).toEqual({
      kind: "wait",
      reason: "no-occupancy",
    });
  });

  it("checks gates in order: budget before handoff", () => {
    expect(decideCycleGate(withSnapshot({ cycles: 10, budget: 10, freshHandoff: false }))).toEqual({
      kind: "halt",
      reason: "budget-reached",
    });
  });

  it("checks gates in order: handoff before idle", () => {
    expect(decideCycleGate(withSnapshot({ freshHandoff: false, turnIdle: false }))).toEqual({
      kind: "wait",
      reason: "no-fresh-handoff",
    });
  });

  it("checks gates in order: idle before frontmost", () => {
    expect(decideCycleGate(withSnapshot({ turnIdle: false, ghosttyFrontmost: false }))).toEqual({
      kind: "wait",
      reason: "not-idle",
    });
  });

  it("checks gates in order: frontmost before window-located", () => {
    expect(decideCycleGate(withSnapshot({ ghosttyFrontmost: false, windowLocated: false }))).toEqual({
      kind: "wait",
      reason: "not-frontmost",
    });
  });

  it("checks gates in order: window-located before done", () => {
    expect(decideCycleGate(withSnapshot({ windowLocated: false, done: true }))).toEqual({
      kind: "wait",
      reason: "window-not-located",
    });
  });

  it("checks gates in order: done before cycle", () => {
    expect(decideCycleGate(withSnapshot({ done: true }))).toEqual({
      kind: "halt",
      reason: "done",
    });
  });
});
