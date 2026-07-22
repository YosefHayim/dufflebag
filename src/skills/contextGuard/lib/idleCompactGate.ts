/** Pure decision policy for one idle auto-compact session. */

export type IdleCompactPhase = "working" | "waitingIdle" | "awaitingPrompt" | "compacting" | "compactionFinished" | "parked";

export type IdleCompactSnapshot = {
  readonly phase: IdleCompactPhase;
  readonly nowMs: number;
  readonly phaseStartedAtMs: number;
  readonly idleSeconds: number;
  readonly acknowledgementSeconds: number;
  readonly agentAlive: boolean;
  readonly sessionEnded: boolean;
  readonly terminalAvailable: boolean;
};

export type IdleCompactAction =
  | { readonly _tag: "wait"; readonly reason: "working" | "idle-duration" | "prompt-acknowledgement" | "compacting" }
  | { readonly _tag: "submitDraft" }
  | { readonly _tag: "compact" }
  | { readonly _tag: "park" }
  | { readonly _tag: "reap"; readonly reason: "session-ended" | "agent-exited" | "terminal-missing" };

const elapsedSeconds = (snapshot: IdleCompactSnapshot): number => (snapshot.nowMs - snapshot.phaseStartedAtMs) / 1_000;

export const decideIdleCompactAction = (snapshot: IdleCompactSnapshot): IdleCompactAction => {
  if (snapshot.sessionEnded) return { _tag: "reap", reason: "session-ended" };
  if (!snapshot.agentAlive) return { _tag: "reap", reason: "agent-exited" };
  if (!snapshot.terminalAvailable) return { _tag: "reap", reason: "terminal-missing" };
  if (snapshot.phase === "working") return { _tag: "wait", reason: "working" };
  if (snapshot.phase === "compacting") return { _tag: "wait", reason: "compacting" };
  if (snapshot.phase === "compactionFinished" || snapshot.phase === "parked") return { _tag: "park" };
  if (snapshot.phase === "waitingIdle") {
    return elapsedSeconds(snapshot) >= snapshot.idleSeconds ? { _tag: "submitDraft" } : { _tag: "wait", reason: "idle-duration" };
  }
  return elapsedSeconds(snapshot) >= snapshot.acknowledgementSeconds
    ? { _tag: "compact" }
    : { _tag: "wait", reason: "prompt-acknowledgement" };
};
