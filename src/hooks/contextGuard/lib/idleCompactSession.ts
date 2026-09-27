import type { IdleCompactPhase } from "./idleCompactDecision.js";

type IdleCompactEventName =
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
    idleSeconds,
    phase,
    phaseStartedAtMs,
    sessionEnded,
    lastEventAtMs,
  };
};

// Agents spell lifecycle events differently (SessionStart, session_start, …), so compare a folded form.
const EVENT_NAMES = new Map<string, IdleCompactEventName>([
  ["sessionstart", "session-started"],
  ["userpromptsubmit", "prompt-started"],
  ["stop", "turn-ended"],
  ["precompact", "compact-started"],
  ["postcompact", "compact-finished"],
  ["sessionend", "session-ended"],
]);

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

  const event = EVENT_NAMES.get(agentEventCandidate.replaceAll("_", "").replaceAll("-", "").toLowerCase());
  if (!event) return null;
  return { agentId, sessionId, event, occurredAtMs: request.occurredAtMs };
};

export const applyIdleCompactEvent = (
  state: IdleCompactSessionState,
  event: IdleCompactEvent,
): IdleCompactSessionState => {
  if (state.agentId !== event.agentId || state.sessionId !== event.sessionId) return state;
  const enter = (phase: IdleCompactPhase): IdleCompactSessionState => ({
    ...state,
    phase,
    phaseStartedAtMs: event.occurredAtMs,
    lastEventAtMs: event.occurredAtMs,
  });
  switch (event.event) {
    case "session-ended":
      return { ...state, sessionEnded: true, lastEventAtMs: event.occurredAtMs };
    case "prompt-started":
      return { ...enter("working"), sessionEnded: false };
    case "turn-ended":
      // A trailing Stop must not rearm a compaction that already started.
      if (state.phase === "compacting" || state.phase === "compactionFinished" || state.phase === "parked") {
        return { ...state, lastEventAtMs: event.occurredAtMs };
      }
      return enter("waitingIdle");
    case "compact-started":
      return enter("compacting");
    case "compact-finished":
      return enter("compactionFinished");
    case "session-started":
      return enter("working");
  }
};
