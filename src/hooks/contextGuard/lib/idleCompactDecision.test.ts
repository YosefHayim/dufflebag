import { describe, expect, it } from "vitest";

import { decideIdleCompactAction, type IdleCompactAction, type IdleCompactSnapshot } from "./idleCompactDecision.js";

type ActionCase = {
  when: string;
  overrides: Pick<IdleCompactSnapshot, "phase"> & Partial<IdleCompactSnapshot>;
  action: IdleCompactAction;
};

const snapshot: Omit<IdleCompactSnapshot, "phase"> = {
  nowMs: 20_000,
  phaseStartedAtMs: 10_000,
  idleSeconds: 30,
  acknowledgementSeconds: 3,
  agentAlive: true,
  sessionEnded: false,
  terminalAvailable: true,
};

describe("idle compact decision", () => {
  it.each<ActionCase>([
    {
      when: "waits for the full idle duration after a turn ends",
      overrides: { phase: "waitingIdle" },
      action: { _tag: "wait", reason: "idle-duration" },
    },
    {
      when: "submits a waiting draft after the idle duration",
      overrides: { phase: "waitingIdle", nowMs: 40_000 },
      action: { _tag: "submitDraft" },
    },
    {
      when: "waits briefly for a submitted prompt acknowledgement",
      overrides: { phase: "awaitingPrompt", nowMs: 12_000 },
      action: { _tag: "wait", reason: "prompt-acknowledgement" },
    },
    {
      when: "compacts when Enter produced no prompt event",
      overrides: { phase: "awaitingPrompt", nowMs: 13_000 },
      action: { _tag: "compact" },
    },
    { when: "parks after compaction finishes", overrides: { phase: "compactionFinished" }, action: { _tag: "park" } },
    { when: "stays parked", overrides: { phase: "parked" }, action: { _tag: "park" } },
    { when: "waits while working", overrides: { phase: "working" }, action: { _tag: "wait", reason: "working" } },
    {
      when: "waits while compacting",
      overrides: { phase: "compacting" },
      action: { _tag: "wait", reason: "compacting" },
    },
    {
      when: "reaps an ended session before considering input",
      overrides: { phase: "waitingIdle", sessionEnded: true, nowMs: 40_000 },
      action: { _tag: "reap", reason: "session-ended" },
    },
    {
      when: "reaps when the agent process exits",
      overrides: { phase: "waitingIdle", agentAlive: false },
      action: { _tag: "reap", reason: "agent-exited" },
    },
    {
      when: "reaps when the claimed terminal disappears",
      overrides: { phase: "waitingIdle", terminalAvailable: false },
      action: { _tag: "reap", reason: "terminal-missing" },
    },
  ])("$when", ({ overrides, action }) => {
    expect(decideIdleCompactAction({ ...snapshot, ...overrides })).toEqual(action);
  });
});
