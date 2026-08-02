import type { IdleCompactPhase } from "./idleCompactGate.js";

export type IdleCompactEventName =
  | "session-started"
  | "prompt-started"
  | "turn-ended"
  | "compact-started"
  | "compact-finished"
  | "session-ended";

export type IdleCompactEvent = {
  readonly agentId: string;
  readonly sessionId: string;
  readonly event: IdleCompactEventName;
  readonly occurredAtMs: number;
};

export type IdleCompactSessionState = {
  readonly agentId: string;
  readonly sessionId: string;
  readonly agentPid: number;
  readonly terminalId: string;
  readonly compactCommand: string;
  readonly idleSeconds: number;
  readonly phase: IdleCompactPhase;
  readonly phaseStartedAtMs: number;
  readonly sessionEnded: boolean;
  readonly lastEventAtMs: number;
};

type Environment = Readonly<Record<string, string | undefined>>;

const stringProperty = (input: object, key: string): string | null => {
  const value = Object.getOwnPropertyDescriptor(input, key)?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
};

const numberProperty = (input: object, key: string): number | null => {
  const value = Object.getOwnPropertyDescriptor(input, key)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const booleanProperty = (input: object, key: string): boolean | null => {
  const value = Object.getOwnPropertyDescriptor(input, key)?.value;
  return typeof value === "boolean" ? value : null;
};

const decodePhase = (candidate: string | null): IdleCompactPhase | null => {
  switch (candidate) {
    case "working":
    case "waitingIdle":
    case "awaitingPrompt":
    case "compacting":
    case "compactionFinished":
    case "parked":
      return candidate;
    default:
      return null;
  }
};

export const decodeIdleCompactSessionState = (input: unknown): IdleCompactSessionState | null => {
  if (typeof input !== "object" || input === null) return null;
  const agentId = stringProperty(input, "agentId");
  const sessionId = stringProperty(input, "sessionId");
  const agentPid = numberProperty(input, "agentPid");
  const terminalId = stringProperty(input, "terminalId");
  const compactCommand = stringProperty(input, "compactCommand");
  const idleSeconds = numberProperty(input, "idleSeconds");
  const phase = decodePhase(stringProperty(input, "phase"));
  const phaseStartedAtMs = numberProperty(input, "phaseStartedAtMs");
  const sessionEnded = booleanProperty(input, "sessionEnded");
  const lastEventAtMs = numberProperty(input, "lastEventAtMs");
  if (
    !agentId ||
    !sessionId ||
    !agentPid ||
    !terminalId ||
    !compactCommand ||
    !idleSeconds ||
    !phase ||
    phaseStartedAtMs === null ||
    sessionEnded === null ||
    lastEventAtMs === null
  ) {
    return null;
  }
  return {
    agentId,
    sessionId,
    agentPid,
    terminalId,
    compactCommand,
    idleSeconds,
    phase,
    phaseStartedAtMs,
    sessionEnded,
    lastEventAtMs,
  };
};

const normalizedEvent = (value: string): IdleCompactEventName | null => {
  const event = value.replaceAll("_", "").replaceAll("-", "").toLowerCase();
  if (event === "sessionstart") return "session-started";
  if (event === "userpromptsubmit") return "prompt-started";
  if (event === "stop") return "turn-ended";
  if (event === "precompact") return "compact-started";
  if (event === "postcompact") return "compact-finished";
  if (event === "sessionend") return "session-ended";
  return null;
};

export const normalizeIdleCompactEvent = (request: {
  readonly input: unknown;
  readonly environment: Environment;
  readonly occurredAtMs: number;
}): IdleCompactEvent | null => {
  if (typeof request.input !== "object" || request.input === null) return null;

  const agentId = request.environment.DUFFLEBAG_AGENT_ID;
  if (!agentId) return null;

  const agentEventCandidate =
    stringProperty(request.input, "hook_event_name") ||
    stringProperty(request.input, "hookEventName") ||
    request.environment.GROK_HOOK_EVENT;
  const sessionId =
    stringProperty(request.input, "session_id") ||
    stringProperty(request.input, "sessionId") ||
    request.environment.GROK_SESSION_ID ||
    request.environment.CLAUDE_SESSION_ID;
  if (!agentEventCandidate || !sessionId) return null;

  const event = normalizedEvent(agentEventCandidate);
  if (!event) return null;
  return { agentId, sessionId, event, occurredAtMs: request.occurredAtMs };
};

export const applyIdleCompactEvent = (
  state: IdleCompactSessionState,
  event: IdleCompactEvent,
): IdleCompactSessionState => {
  if (state.agentId !== event.agentId || state.sessionId !== event.sessionId) return state;

  if (event.event === "session-ended") return { ...state, sessionEnded: true, lastEventAtMs: event.occurredAtMs };
  if (event.event === "prompt-started") {
    return {
      ...state,
      phase: "working",
      phaseStartedAtMs: event.occurredAtMs,
      sessionEnded: false,
      lastEventAtMs: event.occurredAtMs,
    };
  }
  if (event.event === "turn-ended") {
    if (state.phase === "compacting" || state.phase === "compactionFinished" || state.phase === "parked") {
      return { ...state, lastEventAtMs: event.occurredAtMs };
    }
    return { ...state, phase: "waitingIdle", phaseStartedAtMs: event.occurredAtMs, lastEventAtMs: event.occurredAtMs };
  }
  if (event.event === "compact-started") {
    return { ...state, phase: "compacting", phaseStartedAtMs: event.occurredAtMs, lastEventAtMs: event.occurredAtMs };
  }
  if (event.event === "compact-finished") {
    return {
      ...state,
      phase: "compactionFinished",
      phaseStartedAtMs: event.occurredAtMs,
      lastEventAtMs: event.occurredAtMs,
    };
  }
  return { ...state, phase: "working", phaseStartedAtMs: event.occurredAtMs, lastEventAtMs: event.occurredAtMs };
};
