import { Either, Option, Schema } from "effect";

// e.g. "context-guard", "png-to-code" — not "ContextGuard" or "png_to_code"
const FEATURE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// e.g. "contextGuard", "pngToCode" — not "context-guard" or "Context_Guard"
const SOURCE_DIRECTORY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
// e.g. "SKILL.md", "hooks/ctxWatch.ts" — not "/abs/path" or "a/../b"
const FEATURE_RELATIVE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+$/;
// e.g. "hooks/dedupGuard.ts" — feature-relative hook entrypoint only
const HOOK_SOURCE_ENTRYPOINT_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+\.ts$/;

export const featureIdSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(FEATURE_ID_PATTERN, {
    message: () => "Feature IDs must use lowercase kebab-case.",
  }),
  Schema.brand("FeatureId"),
  Schema.annotations({
    description: "Stable public feature ID.",
  }),
);

export type FeatureId = Schema.Schema.Type<typeof featureIdSchema>;

const sourceDirectorySchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(SOURCE_DIRECTORY_PATTERN, {
    message: () => "Source directories must use camelCase.",
  }),
);

const shippedPathSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(FEATURE_RELATIVE_PATH_PATTERN, {
    message: () => "Shipped paths must stay inside the authored skill directory.",
  }),
);

export const featurePlatformSchema = Schema.Literal("any", "macos", "macos+ghostty").annotations({
  description: "Host capability required by one selected feature.",
});

export const installedSkillSchema = Schema.TaggedStruct("skill", {
  id: Schema.NonEmptyTrimmedString.pipe(
    Schema.pattern(FEATURE_ID_PATTERN, {
      message: () => "Installed skill IDs must use lowercase kebab-case.",
    }),
    Schema.annotations({
      description: "Public directory name installed for this skill.",
    }),
  ),
  shippedPaths: Schema.Array(shippedPathSchema).pipe(
    Schema.filter((paths) => paths.length === new Set(paths).size, {
      message: () => "Shipped paths must be unique within one skill.",
    }),
    Schema.annotations({
      description: "Exact feature-relative allowlist copied into dist/skills.",
    }),
  ),
});

export const installedSkillDefinitionSchema = Schema.Union(Schema.TaggedStruct("none", {}), installedSkillSchema);

const hookMatcherSchema = Schema.Union(
  Schema.TaggedStruct("none", {}),
  Schema.TaggedStruct("pattern", {
    value: Schema.NonEmptyTrimmedString.annotations({
      description: "Tool matcher pattern supplied to the agent hook registration.",
    }),
  }),
).annotations({
  description: "Optional tool matcher represented without an optional property.",
});

const registrationEntrypointSchema = Schema.Union(
  Schema.TaggedStruct("featureDefault", {}).annotations({
    description: "Use the feature-level hook sourceEntrypoint.",
  }),
  Schema.TaggedStruct("path", {
    value: Schema.NonEmptyTrimmedString.pipe(
      Schema.pattern(HOOK_SOURCE_ENTRYPOINT_PATTERN, {
        message: () => "Registration entrypoints must end in .ts and stay feature-relative.",
      }),
      Schema.annotations({
        description: "Feature-relative TypeScript entrypoint for this registration only.",
      }),
    ),
  }),
).annotations({
  description: "Per-registration entrypoint without an optional property.",
});

const hookRegistrationSchema = Schema.Struct({
  event: Schema.Literal("PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "Stop").annotations({
    description: "Agent lifecycle event that invokes this entrypoint.",
  }),
  matcher: hookMatcherSchema,
  entrypoint: registrationEntrypointSchema,
});

export const featureRuntimeSchema = Schema.Union(
  Schema.TaggedStruct("none", {}),
  Schema.TaggedStruct("hook", {
    sourceEntrypoint: Schema.NonEmptyTrimmedString.pipe(
      Schema.pattern(HOOK_SOURCE_ENTRYPOINT_PATTERN, {
        message: () => "Hook source entrypoints must end in .ts and stay feature-relative.",
      }),
      Schema.annotations({
        description: "Feature-relative TypeScript entrypoint compiled into dist/runtime.",
      }),
    ),
    registrations: Schema.Array(hookRegistrationSchema).annotations({
      description: "Hook registrations derived into supported agent settings.",
    }),
  }),
);

export const featureDefinitionSchema = Schema.Struct({
  id: featureIdSchema.annotations({
    description: "Stable public feature ID.",
  }),
  sourceDirectory: sourceDirectorySchema.annotations({
    description: "Authored directory under src/skills.",
  }),
  installedSkill: installedSkillDefinitionSchema.annotations({
    description: "Installed output, separate from feature identity.",
  }),
  title: Schema.NonEmptyTrimmedString.annotations({
    description: "Short human-readable CLI label.",
  }),
  summary: Schema.NonEmptyTrimmedString.annotations({
    description: "One-line user-facing feature description.",
  }),
  selectedByDefault: Schema.Boolean.annotations({
    description: "Whether a fresh interactive install preselects the feature.",
  }),
  dependencies: Schema.Array(featureIdSchema).annotations({
    description: "Feature IDs resolved before this feature.",
  }),
  platform: featurePlatformSchema.annotations({
    description: "Host requirement surfaced by install and doctor.",
  }),
  runtime: featureRuntimeSchema.annotations({
    description: "Optional dependency-free hook runtime.",
  }),
});

export type FeatureDefinition = Schema.Schema.Type<typeof featureDefinitionSchema>;

const duplicateIndexes = (values: ReadonlyArray<string>): ReadonlyArray<number> =>
  values.flatMap((value, index) => (values.indexOf(value) === index ? [] : [index]));

const duplicateFeatureIdIssues = (features: ReadonlyArray<FeatureDefinition>) =>
  duplicateIndexes(features.map((feature) => feature.id)).map((index) => ({
    path: [index, "id"],
    message: "Feature IDs must be unique.",
  }));

const duplicateSourceDirectoryIssues = (features: ReadonlyArray<FeatureDefinition>) =>
  duplicateIndexes(features.map((feature) => feature.sourceDirectory)).map((index) => ({
    path: [index, "sourceDirectory"],
    message: "Source directories must be unique.",
  }));

const duplicateInstalledSkillIssues = (features: ReadonlyArray<FeatureDefinition>) =>
  features.flatMap((feature, index) => {
    if (feature.installedSkill._tag === "none") {
      return [];
    }

    const installedSkillId = feature.installedSkill.id;
    const firstIndex = features.findIndex(
      (candidate) => candidate.installedSkill._tag === "skill" && candidate.installedSkill.id === installedSkillId,
    );

    return firstIndex === index ? [] : [{ path: [index, "installedSkill", "id"], message: "Installed skill IDs must be unique." }];
  });

const missingDependencyIssues = (features: ReadonlyArray<FeatureDefinition>) => {
  const featureIds = new Set(features.map((feature) => feature.id));

  return features.flatMap((feature, index) =>
    feature.dependencies.flatMap((dependency, dependencyIndex) =>
      featureIds.has(dependency)
        ? []
        : [
            {
              path: [index, "dependencies", dependencyIndex],
              message: "Dependencies must reference catalog features.",
            },
          ],
    ),
  );
};

const dependencyCycleIssues = (features: ReadonlyArray<FeatureDefinition>) => {
  const createsCycle = (id: FeatureId, path: ReadonlyArray<FeatureId>): boolean => {
    if (path.includes(id)) {
      return true;
    }

    const feature = features.find((candidate) => candidate.id === id);
    if (feature === undefined) {
      return false;
    }

    return feature.dependencies.some((dependency) => createsCycle(dependency, [...path, id]));
  };

  return features.flatMap((feature, index) =>
    createsCycle(feature.id, []) ? [{ path: [index, "dependencies"], message: "Feature dependencies must be acyclic." }] : [],
  );
};

const validateFeatureCatalog = (features: ReadonlyArray<FeatureDefinition>) => {
  return [
    ...duplicateFeatureIdIssues(features),
    ...duplicateSourceDirectoryIssues(features),
    ...duplicateInstalledSkillIssues(features),
    ...missingDependencyIssues(features),
    ...dependencyCycleIssues(features),
  ];
};

export const featureCatalogSchema = Schema.Array(featureDefinitionSchema).pipe(Schema.filter(validateFeatureCatalog));

export const featureCatalog = Schema.decodeUnknownSync(featureCatalogSchema, {
  onExcessProperty: "error",
})([
  {
    id: "context-guard",
    sourceDirectory: "contextGuard",
    installedSkill: { _tag: "none" },
    title: "Context guard",
    summary:
      "Nudge a /handoff at ~18% of the model window and hard-deny new code edits at ~20%, so long sessions wind down gracefully instead of ballooning past usable context.",
    selectedByDefault: true,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
      sourceEntrypoint: "hooks/contextGuard.ts",
      registrations: [
        {
          event: "PreToolUse",
          matcher: { _tag: "pattern", value: "Write|Edit|MultiEdit|NotebookEdit" },
          entrypoint: { _tag: "featureDefault" },
        },
        {
          event: "PostToolUse",
          matcher: { _tag: "pattern", value: "Write|Edit|MultiEdit|NotebookEdit" },
          entrypoint: { _tag: "featureDefault" },
        },
        {
          event: "UserPromptSubmit",
          matcher: { _tag: "none" },
          entrypoint: { _tag: "featureDefault" },
        },
        {
          event: "SessionStart",
          matcher: { _tag: "none" },
          entrypoint: { _tag: "path", value: "hooks/ctxWatchSpawn.ts" },
        },
      ],
    },
  },
  {
    id: "autonomous-loop",
    sourceDirectory: "autorun",
    installedSkill: {
      _tag: "skill",
      id: "autorun",
      shippedPaths: ["SKILL.md"],
    },
    title: "Autonomous loop (autorun)",
    summary:
      "A skill that arms the context-guard SessionStart daemon to auto-/compact and resume hands-free once context nears the guardrail and a fresh handoff exists. macOS + Ghostty only (it types into your terminal window). Hook runtime lives under context-guard.",
    selectedByDefault: false,
    dependencies: ["context-guard"],
    platform: "macos+ghostty",
    runtime: { _tag: "none" },
  },
  {
    id: "speak-response",
    sourceDirectory: "speakResponse",
    installedSkill: { _tag: "none" },
    title: "Speak responses (TTS)",
    summary: "A Stop hook that speaks Claude's prose (code blocks stripped) via the macOS `say` command. macOS only.",
    selectedByDefault: false,
    dependencies: [],
    platform: "macos",
    runtime: {
      _tag: "hook",
      sourceEntrypoint: "hooks/speakResponse.ts",
      registrations: [
        {
          event: "Stop",
          matcher: { _tag: "none" },
          entrypoint: { _tag: "featureDefault" },
        },
      ],
    },
  },
  {
    id: "dedup-guard",
    sourceDirectory: "dedupGuard",
    installedSkill: { _tag: "none" },
    title: "Dedup guard",
    summary:
      "Block a Write/Edit that pastes a function body or interface/type shape already defined elsewhere in the repo — DRY enforced at the moment of the write. Uses the repo's own TypeScript; deny by default (tune with dufflebagDedupEnforcement). Also wires Cursor (warn) + an AGENTS.md rule for Codex.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
      sourceEntrypoint: "hooks/dedupGuard.ts",
      registrations: [
        {
          event: "PreToolUse",
          matcher: { _tag: "pattern", value: "Write|Edit|MultiEdit" },
          entrypoint: { _tag: "featureDefault" },
        },
      ],
    },
  },
  {
    id: "png-to-code",
    sourceDirectory: "pngToCode",
    installedSkill: {
      _tag: "skill",
      id: "png-to-code",
      shippedPaths: [
        "SKILL.md",
        "README.md",
        "CONTEXT.md",
        "TECH-GLOSSARY.md",
        "reference",
        "demo",
        "scripts/package.json",
        "scripts/svgo.config.mjs",
        "scripts/robot.svgo.config.mjs",
        "scripts/tsconfig.json",
        "scripts/src",
      ],
    },
    title: "PNG → pixel-perfect code",
    summary:
      "A skill that turns a PNG design (illustration, logo, UI mockup) into SVG/HTML/CSS that measurably converges to a 1:1 match — a decompose → reuse-or-build → render → screenshot-diff → refine loop, plus a rig-first doctrine for animation. Pure skill (no hooks); its diff harness needs Node + Playwright.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "github-repo-metadata",
    sourceDirectory: "githubRepoMetadata",
    installedSkill: {
      _tag: "skill",
      id: "github-repo-metadata",
      shippedPaths: ["SKILL.md"],
    },
    title: "GitHub repo metadata",
    summary:
      "A skill that writes and audits GitHub repository About metadata: concise descriptions, homepage/demo links, and topics/tags grounded in official GitHub guidance. Pure skill (no hooks).",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "write-a-post",
    sourceDirectory: "writeAPost",
    installedSkill: {
      _tag: "skill",
      id: "write-a-post",
      shippedPaths: ["SKILL.md"],
    },
    title: "Write a blog post (voice + cover)",
    summary:
      "A skill that writes a portfolio blog post in the owner's exact voice, scaffolds it into the blog data file via a one-command dev script, and generates a matching cover image by driving a real ChatGPT browser conversation through ai-browser-bridge (attaching the likeness photo + an existing cover so the character and flat-2D style stay consistent). Pure skill (no hooks).",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "readme-editor",
    sourceDirectory: "readmeEditor",
    installedSkill: {
      _tag: "skill",
      id: "readme-editor",
      shippedPaths: ["SKILL.md", "references"],
    },
    title: "README editor",
    summary:
      "A skill that audits and rewrites README.md, AGENTS.md, CLAUDE.md, Copilot instructions, and llms.txt from repo evidence, with official links for named tools and technologies. Pure skill (no hooks).",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "refresh-agent-docs",
    sourceDirectory: "refreshAgentDocs",
    installedSkill: {
      _tag: "skill",
      id: "refresh-agent-docs",
      shippedPaths: ["SKILL.md", "sources.json", "scripts"],
    },
    title: "Refresh agent docs",
    summary:
      "A skill that refetches current official guidance for AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules, Kiro steering, Roo rules, and Codex instructions before rewriting repo agent docs. Pure skill (no hooks).",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "deslop",
    sourceDirectory: "deslop",
    installedSkill: {
      _tag: "skill",
      id: "deslop",
      shippedPaths: ["SKILL.md", "references"],
    },
    title: "Deslop",
    summary:
      "A skill that reviews code readability first, then applies approved cleanup to make the full pipeline understandable in seconds. Use when the user asks to clean up, rename, or make code less AI-generated.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "deslop-v2",
    sourceDirectory: "deslopV2",
    installedSkill: {
      _tag: "skill",
      id: "deslop-v2",
      shippedPaths: ["SKILL.md", "references"],
    },
    title: "Deslop v2 — kill over-engineering",
    summary:
      "The over-engineering companion to deslop: reviews code and repo structure for excess — pass-through wrappers, `??` fallback chains, nested ternaries, grab-bag returns, and over-nested folders/packages — then removes it so the code does exactly what it needs and no more. Use when the user says code is over-engineered, over-abstracted, or too complicated, or asks to simplify, flatten, or cut needless indirection and layers. Pure skill (no hooks).",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "grill-me",
    sourceDirectory: "grillMe",
    installedSkill: {
      _tag: "skill",
      id: "grill-me",
      shippedPaths: ["SKILL.md"],
    },
    title: "Grill me",
    summary:
      "A skill that interviews the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree one question at a time.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "grill-me-code-style",
    sourceDirectory: "grillMeCodeStyle",
    installedSkill: {
      _tag: "skill",
      id: "grill-me-code-style",
      shippedPaths: ["SKILL.md", "_shared"],
    },
    title: "Grill me — code style (greenfield)",
    summary:
      "A greenfield code-style grilling skill. Interviews the user about how a new project is built, then renders an interactive HTML plan and writes CODE-STYLE.md, formatter config, and AGENTS.md digest on approval.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "grill-me-code-style-coach",
    sourceDirectory: "grillMeCodeStyleCoach",
    installedSkill: {
      _tag: "skill",
      id: "grill-me-code-style-coach",
      shippedPaths: ["SKILL.md"],
    },
    title: "Grill me — code style coach",
    summary: "Coach real style and structure decisions while code is being built or fixed.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "grill-me-code-style-review",
    sourceDirectory: "grillMeCodeStyleReview",
    installedSkill: {
      _tag: "skill",
      id: "grill-me-code-style-review",
      shippedPaths: ["SKILL.md"],
    },
    title: "Grill me — code style review",
    summary: "Review a large changeset against its code-style contract and explain only real deviations.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "grill-me-code-style-with-docs",
    sourceDirectory: "grillMeCodeStyleWithDocs",
    installedSkill: {
      _tag: "skill",
      id: "grill-me-code-style-with-docs",
      shippedPaths: ["SKILL.md", "SCAN.md"],
    },
    title: "Grill me — code style (existing codebase)",
    summary:
      "An existing-codebase code-style grilling skill. Uses real code as evidence, fans out sub-agents for repeated patterns, then writes/updates CODE-STYLE.md and the AGENTS.md digest on approval.",
    selectedByDefault: false,
    dependencies: ["grill-me-code-style"],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "grill-me-stack",
    sourceDirectory: "grillMeStack",
    installedSkill: {
      _tag: "skill",
      id: "grill-me-stack",
      shippedPaths: ["SKILL.md", "TEACH-FORMAT.md"],
    },
    title: "Grill me — technology stack",
    summary: "Teach and challenge a project's technology choices until their tradeoffs are explainable.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "grill-with-docs",
    sourceDirectory: "grillWithDocs",
    installedSkill: {
      _tag: "skill",
      id: "grill-with-docs",
      shippedPaths: ["SKILL.md", "CONTEXT-FORMAT.md", "ADR-FORMAT.md"],
    },
    title: "Grill with docs",
    summary:
      "A grilling session that challenges a plan against the existing domain model, sharpens terminology, and updates CONTEXT.md, PROJECT.md, and ADRs inline as decisions crystallise.",
    selectedByDefault: false,
    dependencies: ["grill-me-code-style"],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "planpage",
    sourceDirectory: "planpage",
    installedSkill: {
      _tag: "skill",
      id: "planpage",
      shippedPaths: ["SKILL.md", "COMPONENTS.md"],
    },
    title: "planpage",
    summary:
      "A skill for rendering agent plans, review gates, and reports as beautiful interactive HTML pages using the open-source planpage package.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "web-perf-ci",
    sourceDirectory: "webPerfCi",
    installedSkill: {
      _tag: "skill",
      id: "web-perf-ci",
      shippedPaths: ["SKILL.md", "README.md", "CONTEXT.md", "TECH-GLOSSARY.md", "reference", "scripts", "templates"],
    },
    title: "Website performance CI (Core Web Vitals)",
    summary:
      "A skill that wires automated performance gates into a website's CI/CD: a Lighthouse CI budget check on every PR (lab), a Chrome UX Report (CrUX) real-user field check after deploy, and an optional web-vitals RUM snippet — all enforcing Core Web Vitals budgets (LCP, INP, CLS). It interviews the repo to detect the stack and run mode, then writes lighthouserc, the GitHub Actions workflows, and zero-dep CrUX + PSI checkers. Pure skill (no hooks); the checks need Node 18+ and a free Google API key (Chrome UX Report + PageSpeed Insights APIs).",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "cws-listing-seo",
    sourceDirectory: "cwsListingSeo",
    installedSkill: {
      _tag: "skill",
      id: "cws-listing-seo",
      shippedPaths: ["SKILL.md", "REFERENCE.md", "scripts", "templates"],
    },
    title: "Chrome Web Store listing SEO (+ GEO)",
    summary:
      "A skill that optimizes Chrome Web Store listing copy (name, summary, Overview) and marketing-site GEO using official Chrome/Google guidance. Ships a zero-dep validator for limits + Keyword Spam heuristics; CWS keyword volume stays manual/browser research (no official free API). Pure skill (no hooks).",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "make-a-trailer",
    sourceDirectory: "makeATrailer",
    installedSkill: {
      _tag: "skill",
      id: "make-a-trailer",
      shippedPaths: ["SKILL.md", "reference", "scripts"],
    },
    title: "Make a trailer (cinematic project video)",
    summary:
      "A skill that directs a cinematic, viral-ready vertical trailer for any project: it reads the repo's own docs to derive the story, consults ChatGPT (GPT-5.5 Thinking) over ai-browser-bridge to write the transcript + storyboard, batch-generates the keyframes as ChatGPT images, animates them with Higgsfield or Flow/Veo, produces voiceover + music (ElevenLabs → Higgsfield → local synth), and assembles a 9:16 master + 16:9/1:1/4:5 cuts with ffmpeg — behind two planpage approval gates and a resumable generation manifest. macOS + Chrome (ai-browser-bridge), the Higgsfield MCP, and ffmpeg required. Pure skill (no hooks).",
    selectedByDefault: false,
    dependencies: ["planpage"],
    platform: "macos",
    runtime: { _tag: "none" },
  },
  {
    id: "web-best-practices",
    sourceDirectory: "webBestPractices",
    installedSkill: {
      _tag: "skill",
      id: "web-best-practices",
      shippedPaths: ["SKILL.md", "reference", "scripts", "templates"],
    },
    title: "Web best practices",
    summary: "Audit and fix semantics, accessibility, assets, security, SEO, and machine readability.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "organized-commits",
    sourceDirectory: "organizedCommits",
    installedSkill: {
      _tag: "skill",
      id: "organized-commits",
      shippedPaths: ["SKILL.md", "REFERENCE.md"],
    },
    title: "Organized commits",
    summary: "Organize Git changes into atomic, evidence-backed commits and safely push or consolidate work when requested.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "finish-and-ship",
    sourceDirectory: "finishAndShip",
    installedSkill: {
      _tag: "skill",
      id: "finish-and-ship",
      shippedPaths: ["SKILL.md"],
    },
    title: "Finish and ship",
    summary: "Close implementation, verification, Git history, push, hosted checks, and handoff without hidden leftovers.",
    selectedByDefault: false,
    dependencies: ["organized-commits"],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "preview-and-prove",
    sourceDirectory: "previewAndProve",
    installedSkill: {
      _tag: "skill",
      id: "preview-and-prove",
      shippedPaths: ["SKILL.md"],
    },
    title: "Preview and prove",
    summary: "Launch the real product surface and prove a user-visible flow through browser, network, and persisted-state evidence.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "reuse-first-audit",
    sourceDirectory: "reuseFirstAudit",
    installedSkill: {
      _tag: "skill",
      id: "reuse-first-audit",
      shippedPaths: ["SKILL.md"],
    },
    title: "Reuse-first audit",
    summary: "Search internal code, platform primitives, and primary ecosystem sources before deciding to build new surface.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "agent-session-auditor",
    sourceDirectory: "agentSessionAuditor",
    installedSkill: {
      _tag: "skill",
      id: "agent-session-auditor",
      shippedPaths: ["SKILL.md"],
    },
    title: "Agent session auditor",
    summary: "Privacy-safe local session coverage, prompt extraction, fuzzy clustering, and evidence-backed skill prioritization.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "sync-agent-skills",
    sourceDirectory: "syncAgentSkills",
    installedSkill: {
      _tag: "skill",
      id: "sync-agent-skills",
      shippedPaths: ["SKILL.md"],
    },
    title: "Sync agent skills",
    summary: "Synchronize canonical skills through receipt-backed native formats and prove parity across detected supported agents.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "env-config-contract",
    sourceDirectory: "envConfigContract",
    installedSkill: {
      _tag: "skill",
      id: "env-config-contract",
      shippedPaths: ["SKILL.md"],
    },
    title: "Environment config contract",
    summary: "Consolidate environment reads into fail-loud schema boundaries without leaking secrets across trust zones.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "mcp-oauth-onboarding",
    sourceDirectory: "mcpOauthOnboarding",
    installedSkill: {
      _tag: "skill",
      id: "mcp-oauth-onboarding",
      shippedPaths: ["SKILL.md"],
    },
    title: "MCP OAuth onboarding",
    summary: "Install an MCP at the intended scope, complete OAuth, reload the agent, and prove it with a harmless tool call.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "rtl-ui-audit",
    sourceDirectory: "rtlUiAudit",
    installedSkill: {
      _tag: "skill",
      id: "rtl-ui-audit",
      shippedPaths: ["SKILL.md"],
    },
    title: "RTL UI audit",
    summary: "Audit and verify real right-to-left layout, bidi content, directional assets, interaction, and accessibility.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "deploy-and-prove",
    sourceDirectory: "deployAndProve",
    installedSkill: {
      _tag: "skill",
      id: "deploy-and-prove",
      shippedPaths: ["SKILL.md"],
    },
    title: "Deploy and prove",
    summary: "Deploy or publish an immutable source identity and prove the provider, live runtime, and changed behavior serve it.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "coordinate-worktrees",
    sourceDirectory: "coordinateWorktrees",
    installedSkill: {
      _tag: "skill",
      id: "coordinate-worktrees",
      shippedPaths: ["SKILL.md"],
    },
    title: "Coordinate worktrees",
    summary: "Safely reconcile overlapping branches and worktrees with backups, intent-aware integration, and reachability proof.",
    selectedByDefault: false,
    dependencies: ["organized-commits"],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "capture-workflow",
    sourceDirectory: "captureWorkflow",
    installedSkill: {
      _tag: "skill",
      id: "capture-workflow",
      shippedPaths: ["SKILL.md"],
    },
    title: "Capture workflow",
    summary: "Turn a proven task into the smallest reusable skill, script, template, test, or runbook and replay it cleanly.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "finish-agent-sessions",
    sourceDirectory: "finishAgentSessions",
    installedSkill: {
      _tag: "skill",
      id: "finish-agent-sessions",
      shippedPaths: ["SKILL.md"],
    },
    title: "Finish agent sessions",
    summary: "Reconcile interrupted work across agent histories with current repositories, then finish or honestly classify every task.",
    selectedByDefault: false,
    dependencies: ["finish-and-ship", "agent-session-auditor"],
    platform: "any",
    runtime: { _tag: "none" },
  },
]);

export class UnknownFeatureError extends Schema.TaggedError<UnknownFeatureError>()("UnknownFeatureError", {
  featureId: Schema.String.annotations({
    description: "Unknown feature ID supplied by the caller.",
  }),
}) {
  get message(): string {
    return `Unknown feature: ${this.featureId}`;
  }
}

export const findFeature = (id: string): Option.Option<FeatureDefinition> =>
  Option.fromNullable(featureCatalog.find((feature) => feature.id === id));

export const selectedFeatureIds = featureCatalog.filter((feature) => feature.selectedByDefault).map((feature) => feature.id);

export const resolveFeatureSelection = (
  requestedIds: ReadonlyArray<string>,
): Either.Either<ReadonlyArray<FeatureId>, UnknownFeatureError> => {
  const resolvedIds = new Set<FeatureId>();
  const visitFeature = (id: string): Either.Either<void, UnknownFeatureError> => {
    const feature = Option.getOrNull(findFeature(id));
    if (feature === null) {
      return Either.left(new UnknownFeatureError({ featureId: id }));
    }

    if (resolvedIds.has(feature.id)) {
      return Either.right(undefined);
    }

    resolvedIds.add(feature.id);

    // Resolve every declared dependency before returning this feature.
    for (const dependency of feature.dependencies) {
      const result = visitFeature(dependency);
      if (Either.isLeft(result)) {
        return result;
      }
    }

    return Either.right(undefined);
  };

  // Validate and expand every caller selection into the owned set.
  for (const requestedId of requestedIds) {
    const result = visitFeature(requestedId);
    if (Either.isLeft(result)) {
      return Either.left(result.left);
    }
  }

  return Either.right(featureCatalog.filter((feature) => resolvedIds.has(feature.id)).map((feature) => feature.id));
};

export const installedSkillsFor = (featureIds: ReadonlyArray<FeatureId>) => {
  const requestedIds = new Set(featureIds);

  return featureCatalog.flatMap((feature) => {
    if (!requestedIds.has(feature.id) || feature.installedSkill._tag === "none") {
      return [];
    }

    return [feature.installedSkill];
  });
};
