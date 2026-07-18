/**
 * Pure cycle-gate decision for the ctx-watch daemon.
 *
 * The daemon only types `/compact` + a continuation when every safety input
 * below is true. Keeping the conjunction pure means CI can cover every refuse
 * and halt branch without AppleScript or a live Ghostty window.
 *
 * Conjunction (issue #1): armed ∧ ≥warn% ∧ fresh handoff ∧ idle ∧ frontmost ∧
 * window-located ∧ under budget/cap ∧ not done.
 */

/** Snapshot of every input the daemon evaluates before attempting a cycle. */
export type CycleGateSnapshot = {
  armed: boolean;
  /** Latest main-thread occupancy tokens, or null when the transcript has none. */
  occupancy: number | null;
  /** Model context window in tokens (must be > 0). */
  windowTokens: number;
  /** Fraction of the window that arms the warn band (e.g. 0.18). */
  warnFraction: number;
  /** Completed compact cycles this arm. */
  cycles: number;
  /** Soft budget from /autorun N (disarm when cycles ≥ budget). */
  budget: number;
  /** Hard anti-runaway cap (disarm when cycles ≥ hardCap). */
  hardCap: number;
  /** handoff*.md written at/after warn-band entry. */
  freshHandoff: boolean;
  /** Transcript quiescent and last main turn finished. */
  turnIdle: boolean;
  /** Ghostty is the frontmost application. */
  ghosttyFrontmost: boolean;
  /** Session window located uniquely and raised successfully. */
  windowLocated: boolean;
  /** Done-marker present for this session. */
  done: boolean;
};

/** Why the daemon waits without typing or halting. */
export type CycleGateWaitReason = "no-occupancy" | "below-warn" | "no-fresh-handoff" | "not-idle" | "not-frontmost" | "window-not-located";

/** Why the daemon disarms and records a halt marker. */
export type CycleGateHaltReason = "hard-cap" | "budget-reached" | "done";

/**
 * Decision the poll loop acts on:
 * - observe: disarmed — pure observer, reset warn-band tracking
 * - wait: armed but a gate blocks; reason names the first failed check
 * - halt: disarm and write the halt reason (budget, hard-cap, or done)
 * - cycle: every gate passed — attempt /compact + continuation
 */
export type CycleGateDecision =
  | { kind: "observe" }
  | { kind: "wait"; reason: CycleGateWaitReason }
  | { kind: "halt"; reason: CycleGateHaltReason }
  | { kind: "cycle" };

/**
 * Decide whether this poll may type keystrokes.
 * Order matches the daemon's historical fail-closed checks: disarmed and
 * occupancy first, then warn band, caps, handoff, idle, focus, window, done.
 */
export const decideCycleGate = (snapshot: CycleGateSnapshot): CycleGateDecision => {
  if (!snapshot.armed) return { kind: "observe" };

  if (snapshot.occupancy === null) return { kind: "wait", reason: "no-occupancy" };

  // windowTokens comes from windowFor(), which always returns a positive constant.
  const fraction = snapshot.occupancy / snapshot.windowTokens;
  if (fraction < snapshot.warnFraction) return { kind: "wait", reason: "below-warn" };

  if (snapshot.cycles >= snapshot.hardCap) return { kind: "halt", reason: "hard-cap" };
  if (snapshot.cycles >= snapshot.budget) return { kind: "halt", reason: "budget-reached" };

  if (!snapshot.freshHandoff) return { kind: "wait", reason: "no-fresh-handoff" };
  if (!snapshot.turnIdle) return { kind: "wait", reason: "not-idle" };
  if (!snapshot.ghosttyFrontmost) return { kind: "wait", reason: "not-frontmost" };
  if (!snapshot.windowLocated) return { kind: "wait", reason: "window-not-located" };

  if (snapshot.done) return { kind: "halt", reason: "done" };

  return { kind: "cycle" };
};
