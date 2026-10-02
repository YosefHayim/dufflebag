// The autorun watcher types `/compact` and a continuation only when every check below passes. Keeping the checks
// pure lets tests cover each refuse and halt branch without AppleScript or a live Ghostty window.

export type AutorunSnapshot = {
  armed: boolean;
  // Latest main-thread occupancy in tokens, or null when the transcript has none.
  occupancy: number | null;
  // Always positive (windowFor returns a constant), so the warn percent never divides by zero.
  windowTokens: number;
  warnPercent: number;
  // Completed compact cycles since /autorun armed the session.
  cycles: number;
  // Soft limit from /autorun N.
  budget: number;
  // Anti-runaway limit from autorunMaxCycles.
  hardCap: number;
  // A handoff*.md was written after the session entered the warn band.
  freshHandoff: boolean;
  // The transcript is quiet and the last main turn finished.
  turnIdle: boolean;
  ghosttyFrontmost: boolean;
  done: boolean;
};

// observe: disarmed; wait: a check failed; halt: disarm and record why; cycle: compact and resume.
type AutorunStep =
  | { kind: "observe" }
  | { kind: "wait"; reason: "no-occupancy" | "below-warn" | "no-fresh-handoff" | "not-idle" | "not-frontmost" }
  | { kind: "halt"; reason: "hard-cap" | "budget-reached" | "done" }
  | { kind: "cycle" };

// Order matters: each result names the first check that fails.
export const decideAutorunStep = (snapshot: AutorunSnapshot): AutorunStep => {
  if (!snapshot.armed) return { kind: "observe" };
  if (snapshot.occupancy === null) return { kind: "wait", reason: "no-occupancy" };
  if ((snapshot.occupancy * 100) / snapshot.windowTokens < snapshot.warnPercent) {
    return { kind: "wait", reason: "below-warn" };
  }
  if (snapshot.cycles >= snapshot.hardCap) return { kind: "halt", reason: "hard-cap" };
  if (snapshot.cycles >= snapshot.budget) return { kind: "halt", reason: "budget-reached" };
  if (!snapshot.freshHandoff) return { kind: "wait", reason: "no-fresh-handoff" };
  if (!snapshot.turnIdle) return { kind: "wait", reason: "not-idle" };
  if (!snapshot.ghosttyFrontmost) return { kind: "wait", reason: "not-frontmost" };
  if (snapshot.done) return { kind: "halt", reason: "done" };
  return { kind: "cycle" };
};
