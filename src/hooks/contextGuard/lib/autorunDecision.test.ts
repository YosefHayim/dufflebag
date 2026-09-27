import { describe, expect, it } from "vitest";

import { type AutorunSnapshot, decideAutorunStep } from "./autorunDecision.js";

type StepCase = { when: string; overrides: Partial<AutorunSnapshot>; step: ReturnType<typeof decideAutorunStep> };

const ready: AutorunSnapshot = {
  armed: true,
  occupancy: 200_000,
  windowTokens: 1_000_000,
  warnPercent: 18,
  cycles: 0,
  budget: 10,
  hardCap: 50,
  freshHandoff: true,
  turnIdle: true,
  ghosttyFrontmost: true,
  done: false,
};

describe("decideAutorunStep", () => {
  it.each<StepCase>([
    { when: "every safety check passes", overrides: {}, step: { kind: "cycle" } },
    { when: "occupancy sits exactly at the warn percent", overrides: { occupancy: 180_000 }, step: { kind: "cycle" } },
    { when: "disarmed", overrides: { armed: false }, step: { kind: "observe" } },
    { when: "occupancy is unknown", overrides: { occupancy: null }, step: { kind: "wait", reason: "no-occupancy" } },
    {
      when: "occupancy is below the warn percent",
      overrides: { occupancy: 100_000 },
      step: { kind: "wait", reason: "below-warn" },
    },
    { when: "the hard cap is hit", overrides: { cycles: 50, budget: 100 }, step: { kind: "halt", reason: "hard-cap" } },
    { when: "the soft budget is reached", overrides: { cycles: 10 }, step: { kind: "halt", reason: "budget-reached" } },
    {
      when: "no fresh handoff exists",
      overrides: { freshHandoff: false },
      step: { kind: "wait", reason: "no-fresh-handoff" },
    },
    { when: "the turn is not idle", overrides: { turnIdle: false }, step: { kind: "wait", reason: "not-idle" } },
    {
      when: "Ghostty is not frontmost",
      overrides: { ghosttyFrontmost: false },
      step: { kind: "wait", reason: "not-frontmost" },
    },
    { when: "the done marker is present", overrides: { done: true }, step: { kind: "halt", reason: "done" } },
  ])("when $when", ({ overrides, step }) => {
    expect(decideAutorunStep({ ...ready, ...overrides })).toEqual(step);
  });

  it.each<StepCase>([
    { when: "disarmed before occupancy", overrides: { armed: false, occupancy: null }, step: { kind: "observe" } },
    {
      when: "occupancy before handoff",
      overrides: { occupancy: null, freshHandoff: false },
      step: { kind: "wait", reason: "no-occupancy" },
    },
    {
      when: "hard cap before budget",
      overrides: { cycles: 50, budget: 10 },
      step: { kind: "halt", reason: "hard-cap" },
    },
    {
      when: "budget before handoff",
      overrides: { cycles: 10, freshHandoff: false },
      step: { kind: "halt", reason: "budget-reached" },
    },
    {
      when: "handoff before idle",
      overrides: { freshHandoff: false, turnIdle: false },
      step: { kind: "wait", reason: "no-fresh-handoff" },
    },
    {
      when: "idle before frontmost",
      overrides: { turnIdle: false, ghosttyFrontmost: false },
      step: { kind: "wait", reason: "not-idle" },
    },
    {
      when: "frontmost before done",
      overrides: { ghosttyFrontmost: false, done: true },
      step: { kind: "wait", reason: "not-frontmost" },
    },
  ])("checks $when", ({ overrides, step }) => {
    expect(decideAutorunStep({ ...ready, ...overrides })).toEqual(step);
  });
});
