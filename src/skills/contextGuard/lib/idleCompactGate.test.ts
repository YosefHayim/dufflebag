import { describe, expect, it } from "vitest";

import { decideIdleCompactAction, type IdleCompactSnapshot } from "./idleCompactGate.js";

const snapshot = (phase: IdleCompactSnapshot["phase"], overrides: Partial<IdleCompactSnapshot> = {}): IdleCompactSnapshot => ({
  phase,
  nowMs: 20_000,
  phaseStartedAtMs: 10_000,
  idleSeconds: 30,
  acknowledgementSeconds: 3,
  agentAlive: true,
  sessionEnded: false,
  terminalAvailable: true,
  ...overrides,
});

describe("idle compact gate", () => {
  it("waits for the complete idle duration after a turn ends", () => {
    expect(decideIdleCompactAction(snapshot("waitingIdle"))).toEqual({ _tag: "wait", reason: "idle-duration" });
  });

  it("submits a waiting draft after the idle duration", () => {
    expect(decideIdleCompactAction(snapshot("waitingIdle", { nowMs: 40_000 }))).toEqual({ _tag: "submitDraft" });
  });

  it("waits briefly for a submitted prompt acknowledgement", () => {
    expect(decideIdleCompactAction(snapshot("awaitingPrompt", { nowMs: 12_000 }))).toEqual({
      _tag: "wait",
      reason: "prompt-acknowledgement",
    });
  });

  it("compacts when Enter produced no prompt event", () => {
    expect(decideIdleCompactAction(snapshot("awaitingPrompt", { nowMs: 13_000 }))).toEqual({ _tag: "compact" });
  });

  it("parks after compaction finishes and while already parked", () => {
    expect(decideIdleCompactAction(snapshot("compactionFinished"))).toEqual({ _tag: "park" });
    expect(decideIdleCompactAction(snapshot("parked"))).toEqual({ _tag: "park" });
  });

  it.each([
    ["working", "working"],
    ["compacting", "compacting"],
  ] as const)("waits while %s", (phase, reason) => {
    expect(decideIdleCompactAction(snapshot(phase))).toEqual({ _tag: "wait", reason });
  });

  it("reaps an ended session before considering input", () => {
    expect(decideIdleCompactAction(snapshot("waitingIdle", { sessionEnded: true, nowMs: 40_000 }))).toEqual({
      _tag: "reap",
      reason: "session-ended",
    });
  });

  it("reaps when the agent process exits", () => {
    expect(decideIdleCompactAction(snapshot("waitingIdle", { agentAlive: false }))).toEqual({
      _tag: "reap",
      reason: "agent-exited",
    });
  });

  it("reaps when the claimed terminal disappears", () => {
    expect(decideIdleCompactAction(snapshot("waitingIdle", { terminalAvailable: false }))).toEqual({
      _tag: "reap",
      reason: "terminal-missing",
    });
  });
});
