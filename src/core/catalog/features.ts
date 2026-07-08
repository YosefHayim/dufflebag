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
  "github-repo-metadata": {
    id: "github-repo-metadata",
    title: "GitHub repo metadata",
    summary:
      "A skill that writes and audits GitHub repository About metadata: concise descriptions, homepage/demo links, and topics/tags grounded in official GitHub guidance. Pure skill (no hooks).",
    requires: [],
    platform: "any",
    skills: ["github-repo-metadata"],
    ships: ["SKILL.md"],
    hooks: [],
  },
  "write-a-post": {
    id: "write-a-post",
    title: "Write a blog post (voice + cover)",
    summary:
      "A skill that writes a portfolio blog post in the owner's exact voice, scaffolds it into the blog data file via a one-command dev script, and generates a matching cover image by driving a real ChatGPT browser conversation through ai-browser-bridge (attaching the likeness photo + an existing cover so the character and flat-2D style stay consistent). Pure skill (no hooks).",
    requires: [],
    platform: "any",
    skills: ["write-a-post"],
    ships: ["SKILL.md"],
    hooks: [],
  },
  "readme-editor": {
    id: "readme-editor",
    title: "README editor",
    summary:
      "A skill that audits and rewrites README.md, AGENTS.md, CLAUDE.md, Copilot instructions, and llms.txt from repo evidence, with official links for named tools and technologies. Pure skill (no hooks).",
    requires: [],
    platform: "any",
    skills: ["readme-editor"],
    ships: ["SKILL.md", "references"],
    hooks: [],
  },
  "refresh-agent-docs": {
    id: "refresh-agent-docs",
    title: "Refresh agent docs",
    summary:
      "A skill that refetches current official guidance for AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules, Kiro steering, Roo rules, and Codex instructions before rewriting repo agent docs. Pure skill (no hooks).",
    requires: [],
    platform: "any",
    skills: ["refresh-agent-docs"],
    ships: ["SKILL.md", "sources.json", "scripts"],
    hooks: [],
  },
  deslop: {
    id: "deslop",
    title: "Deslop",
    summary:
      "A skill that reviews code readability first, then applies approved cleanup to make the full pipeline understandable in seconds. Use when the user asks to clean up, rename, or make code less AI-generated.",
    requires: [],
    platform: "any",
    skills: ["deslop"],
    ships: ["SKILL.md", "references"],
    hooks: [],
  },
  "grill-me": {
    id: "grill-me",
    title: "Grill me",
    summary:
      "A skill that interviews the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree one question at a time.",
    requires: [],
    platform: "any",
    skills: ["grill-me"],
    ships: ["SKILL.md"],
    hooks: [],
  },
  "grill-me-code-style": {
    id: "grill-me-code-style",
    title: "Grill me — code style (greenfield)",
    summary:
      "A greenfield code-style grilling skill. Interviews the user about how a new project is built, then renders an interactive HTML plan and writes CODE-STYLE.md, formatter config, and AGENTS.md digest on approval.",
    requires: [],
    platform: "any",
    skills: ["grill-me-code-style"],
    ships: ["SKILL.md", "_shared"],
    hooks: [],
  },
  "grill-me-code-style-with-docs": {
    id: "grill-me-code-style-with-docs",
    title: "Grill me — code style (existing codebase)",
    summary:
      "An existing-codebase code-style grilling skill. Uses real code as evidence, fans out sub-agents for repeated patterns, then writes/updates CODE-STYLE.md and the AGENTS.md digest on approval.",
    requires: ["grill-me-code-style"],
    platform: "any",
    skills: ["grill-me-code-style-with-docs"],
    ships: ["SKILL.md", "SCAN.md"],
    hooks: [],
  },
  "grill-with-docs": {
    id: "grill-with-docs",
    title: "Grill with docs",
    summary:
      "A grilling session that challenges a plan against the existing domain model, sharpens terminology, and updates CONTEXT.md, PROJECT.md, and ADRs inline as decisions crystallise.",
    requires: ["grill-me-code-style"],
    platform: "any",
    skills: ["grill-with-docs"],
    ships: ["SKILL.md", "CONTEXT-FORMAT.md", "ADR-FORMAT.md"],
    hooks: [],
  },
  planpage: {
    id: "planpage",
    title: "planpage",
    summary:
      "A skill for rendering agent plans, review gates, and reports as beautiful interactive HTML pages using the open-source planpage package.",
    requires: [],
    platform: "any",
    skills: ["planpage"],
    ships: ["SKILL.md", "COMPONENTS.md"],
    hooks: [],
  },
  "web-perf-ci": {
    id: "web-perf-ci",
    title: "Website performance CI (Core Web Vitals)",
    summary:
      "A skill that wires automated performance gates into a website's CI/CD: a Lighthouse CI budget check on every PR (lab), a Chrome UX Report (CrUX) real-user field check after deploy, and an optional web-vitals RUM snippet — all enforcing Core Web Vitals budgets (LCP, INP, CLS). It interviews the repo to detect the stack and run mode, then writes lighthouserc, the GitHub Actions workflows, and zero-dep CrUX + PSI checkers. Pure skill (no hooks); the checks need Node 18+ and a free Google API key (Chrome UX Report + PageSpeed Insights APIs).",
    requires: [],
    platform: "any",
    skills: ["web-perf-ci"],
    ships: ["SKILL.md", "README.md", "CONTEXT.md", "TECH-GLOSSARY.md", "reference", "scripts", "templates"],
    hooks: [],
  },
};

/** Every feature id, in display/install order. */
export const ALL_FEATURES: FeatureId[] = [
  "context-guard",
  "dedup-guard",
  "autonomous-loop",
  "speak-response",
  "png-to-code",
  "github-repo-metadata",
  "write-a-post",
  "readme-editor",
  "refresh-agent-docs",
  "deslop",
  "grill-me",
  "grill-me-code-style",
  "grill-me-code-style-with-docs",
  "grill-with-docs",
  "planpage",
  "web-perf-ci",
];

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
