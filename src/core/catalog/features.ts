/**
 * The feature catalog: the authoritative description of every installable unit
 * and how it maps onto hooks, skills, and platform constraints.
 *
 * Commands never hard-code "which hook file for which event" — they read it from
 * here, so adding a feature (or moving a hook to a new event) is a one-place
 * change. Dependencies are resolved by {@link resolveFeatures} so that, e.g.,
 * asking for `autonomous-loop` always also pulls `context-guard` (they share
 * WARN_PCT and the daemon relies on the guard's wind-down contract).
 */

import type { Feature, FeatureId } from "./types.js";

/** Compiled hook filenames in the flat payload (assembled from src/skills/<feature>/hooks/*.ts) and copied into <installDir>/hooks. */
const HOOK = {
  guard: "contextGuard.js",
  ctxWatchSpawn: "ctxWatchSpawn.js",
  speak: "speakResponse.js",
  dedup: "dedupGuard.js",
} as const;

/** Tools the context guard throttles — kept identical to the original matcher. */
const WRITE_MATCHER = "Write|Edit|MultiEdit|NotebookEdit";

/** Tools the dedup guard inspects (notebooks excluded — it checks .ts/.tsx source). */
const DEDUP_MATCHER = "Write|Edit|MultiEdit";

export const FEATURES: Record<FeatureId, Feature> = {
  "context-guard": {
    id: "context-guard",
    title: "Context guard",
    summary:
      "Nudge a /handoff at ~18% of the model window and hard-deny new code edits at ~20%, so long sessions wind down gracefully instead of ballooning past usable context.",
    requires: [],
    platform: "any",
    skills: [],
    ships: [],
    hooks: [
      { event: "PreToolUse", matcher: WRITE_MATCHER, file: HOOK.guard },
      { event: "PostToolUse", matcher: WRITE_MATCHER, file: HOOK.guard },
      { event: "UserPromptSubmit", file: HOOK.guard },
    ],
  },
  "dedup-guard": {
    id: "dedup-guard",
    title: "Dedup guard",
    summary:
      "Block a Write/Edit that pastes a function body or interface/type shape already defined elsewhere in the repo — DRY enforced at the moment of the write. Uses the repo's own TypeScript; deny by default (tune with dufflebagDedupEnforcement). Also wires Cursor (warn) + an AGENTS.md rule for Codex.",
    requires: [],
    platform: "any",
    skills: [],
    ships: [],
    hooks: [{ event: "PreToolUse", matcher: DEDUP_MATCHER, file: HOOK.dedup }],
  },
  "autonomous-loop": {
    id: "autonomous-loop",
    title: "Autonomous loop (autorun)",
    summary:
      "A SessionStart daemon that auto-/compacts and resumes work hands-free once context nears the guardrail and a fresh handoff exists. macOS + Ghostty only (it types into your terminal window).",
    requires: ["context-guard"],
    platform: "macos+ghostty",
    skills: ["autorun"],
    ships: ["SKILL.md"],
    hooks: [{ event: "SessionStart", file: HOOK.ctxWatchSpawn }],
  },
  "speak-response": {
    id: "speak-response",
    title: "Speak responses (TTS)",
    summary: "A Stop hook that speaks Claude's prose (code blocks stripped) via the macOS `say` command. macOS only.",
    requires: [],
    platform: "macos",
    skills: [],
    ships: [],
    hooks: [{ event: "Stop", file: HOOK.speak }],
  },
  "png-to-code": {
    id: "png-to-code",
    title: "PNG → pixel-perfect code",
    summary:
      "A skill that turns a PNG design (illustration, logo, UI mockup) into SVG/HTML/CSS that measurably converges to a 1:1 match — a decompose → reuse-or-build → render → screenshot-diff → refine loop, plus a rig-first doctrine for animation. Pure skill (no hooks); its diff harness needs Node + Playwright.",
    requires: [],
    platform: "any",
    skills: ["png-to-code"],
    ships: ["SKILL.md", "README.md", "CONTEXT.md", "TECH-GLOSSARY.md", "reference", "demo", "scripts"],
    hooks: [],
  },
};

/** Every feature id, in display/install order. */
export const ALL_FEATURES: FeatureId[] = ["context-guard", "dedup-guard", "autonomous-loop", "speak-response", "png-to-code"];

/** The safe-by-default selection: works on any OS, no GUI automation. */
export const DEFAULT_FEATURES: FeatureId[] = ["context-guard"];

/**
 * Expand a requested selection to include all transitive dependencies, returned
 * in catalog order with duplicates removed. Throws on an unknown id.
 */
export function resolveFeatures(requested: FeatureId[]): FeatureId[] {
  const selected = new Set<FeatureId>();
  const visit = (id: FeatureId): void => {
    if (selected.has(id)) return;
    const feature = FEATURES[id];
    if (!feature) throw new Error(`Unknown feature: ${id}`);
    selected.add(id);
    feature.requires.forEach(visit);
  };
  requested.forEach(visit);
  return ALL_FEATURES.filter((id) => selected.has(id));
}

/** Collect the unique skill directory names across a set of features. */
export function skillsFor(ids: FeatureId[]): string[] {
  return [...new Set(ids.flatMap((id) => FEATURES[id].skills))];
}
