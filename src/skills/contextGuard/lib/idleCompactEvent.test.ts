import { describe, expect, it } from "vitest";

import { applyIdleCompactEvent, type IdleCompactSessionState, normalizeIdleCompactEvent } from "./idleCompactEvent.js";

const state = (phase: IdleCompactSessionState["phase"]): IdleCompactSessionState => ({
  agentId: "grok",
  sessionId: "session-1",
  agentPid: 42,
  terminalId: "terminal-1",
  compactCommand: "/compact",
  idleSeconds: 60,
  phase,
  phaseStartedAtMs: 1_000,
  sessionEnded: false,
  lastEventAtMs: 1_000,
});

describe("idle compact lifecycle events", () => {
  it.each([
    [{ hook_event_name: "SessionStart", session_id: "claude-1" }, "claude-code", "session-started"],
    [{ hookEventName: "UserPromptSubmit", sessionId: "codex-1" }, "codex", "prompt-started"],
    [{ hookEventName: "stop", sessionId: "grok-1" }, "grok", "turn-ended"],
    [{ hook_event_name: "PreCompact", session_id: "codex-2" }, "codex", "compact-started"],
    [{ hookEventName: "post_compact", sessionId: "grok-2" }, "grok", "compact-finished"],
    [{ hook_event_name: "SessionEnd", session_id: "claude-2" }, "claude-code", "session-ended"],
  ])("normalizes provider payload %#", (input, agentId, event) => {
    expect(normalizeIdleCompactEvent(input, { DUFFLEBAG_AGENT_ID: agentId }, 5_000)).toEqual({
      agentId,
      sessionId: "sessionId" in input ? input.sessionId : input.session_id,
      event,
      occurredAtMs: 5_000,
    });
  });

  it("uses Grok hook environment when its payload omits lifecycle identity", () => {
    expect(
      normalizeIdleCompactEvent({}, { DUFFLEBAG_AGENT_ID: "grok", GROK_HOOK_EVENT: "session_start", GROK_SESSION_ID: "grok-env" }, 7_000),
    ).toEqual({ agentId: "grok", sessionId: "grok-env", event: "session-started", occurredAtMs: 7_000 });
  });

  it.each([
    ["invalid JSON shape", null, { DUFFLEBAG_AGENT_ID: "codex" }],
    ["missing agent", { hookEventName: "Stop", sessionId: "one" }, {}],
    ["unknown event", { hookEventName: "SubagentStop", sessionId: "one" }, { DUFFLEBAG_AGENT_ID: "codex" }],
  ])("refuses %s", (_name, input, env) => {
    expect(normalizeIdleCompactEvent(input, env, 1_000)).toBeNull();
  });

  it("moves a human prompt and its completed turn into a new idle cycle", () => {
    const working = applyIdleCompactEvent(state("parked"), {
      agentId: "grok",
      sessionId: "session-1",
      event: "prompt-started",
      occurredAtMs: 2_000,
    });
    expect(working.phase).toBe("working");

    const waiting = applyIdleCompactEvent(working, {
      agentId: "grok",
      sessionId: "session-1",
      event: "turn-ended",
      occurredAtMs: 3_000,
    });
    expect(waiting).toMatchObject({ phase: "waitingIdle", phaseStartedAtMs: 3_000 });
  });

  it("does not let a trailing Stop rearm a completed compaction", () => {
    const finished = applyIdleCompactEvent(state("compactionFinished"), {
      agentId: "grok",
      sessionId: "session-1",
      event: "turn-ended",
      occurredAtMs: 4_000,
    });

    expect(finished.phase).toBe("compactionFinished");
  });

  it("marks session end without changing ownership data", () => {
    const ended = applyIdleCompactEvent(state("working"), {
      agentId: "grok",
      sessionId: "session-1",
      event: "session-ended",
      occurredAtMs: 9_000,
    });

    expect(ended).toMatchObject({ agentPid: 42, terminalId: "terminal-1", sessionEnded: true, lastEventAtMs: 9_000 });
  });
});
