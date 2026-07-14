import { Either, Option, Schema } from "effect";

export const featureIdSchema = Schema.String.pipe(
  Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: () => "Feature IDs must use kebab-case.",
  }),
  Schema.brand("FeatureId"),
  Schema.annotations({
    description: "Stable public feature ID.",
  }),
);

export type FeatureId = Schema.Schema.Type<typeof featureIdSchema>;

const absentInstalledSkillSchema = Schema.Struct({
  _tag: Schema.Literal("none"),
});

const installedSkillSchema = Schema.Struct({
  _tag: Schema.Literal("skill"),
  id: Schema.String.pipe(
    Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: () => "Installed skill IDs must use kebab-case.",
    }),
    Schema.annotations({
      description: "Public directory name installed for this skill.",
    }),
  ),
  shippedPaths: Schema.Array(Schema.NonEmptyTrimmedString).annotations({
    description: "Exact feature-relative allowlist copied into dist/skills.",
  }),
});

export const installedSkillDefinitionSchema = Schema.Union(absentInstalledSkillSchema, installedSkillSchema).annotations({
  description: "Installed skill output, separate from feature identity.",
});

export type InstalledSkill = Schema.Schema.Type<typeof installedSkillSchema>;

export type InstalledSkillDefinition = Schema.Schema.Type<typeof installedSkillDefinitionSchema>;

const matcherSchema = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("none"),
  }),
  Schema.Struct({
    _tag: Schema.Literal("pattern"),
    value: Schema.NonEmptyTrimmedString,
  }),
).annotations({
  description: "Optional tool matcher represented without an optional property.",
});

const hookRegistrationSchema = Schema.Struct({
  event: Schema.Literal("PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "Stop").annotations({
    description: "Agent lifecycle event that invokes this entrypoint.",
  }),
  matcher: matcherSchema,
});

export const featureRuntimeSchema = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("none"),
  }),
  Schema.Struct({
    _tag: Schema.Literal("hook"),
    sourceEntrypoint: Schema.String.pipe(
      Schema.endsWith(".ts", {
        message: () => "Hook source entrypoints must end in .ts.",
      }),
      Schema.annotations({
        description: "Feature-relative TypeScript entrypoint compiled into dist/runtime.",
      }),
    ),
    registrations: Schema.Array(hookRegistrationSchema).annotations({
      description: "Hook registrations derived into supported agent settings.",
    }),
  }),
).annotations({
  description: "Optional hook runtime represented as a tagged union.",
});

export const featureDefinitionSchema = Schema.Struct({
  id: featureIdSchema,
  sourceDirectory: Schema.String.pipe(
    Schema.pattern(/^[a-z][a-zA-Z0-9]*$/, {
      message: () => "Source directories must use camelCase.",
    }),
    Schema.annotations({
      description: "Authored directory name under src/skills.",
    }),
  ),
  installedSkill: installedSkillDefinitionSchema,
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
  platform: Schema.Literal("any", "macos", "macos+ghostty").annotations({
    description: "Host requirement surfaced by install and doctor.",
  }),
  runtime: featureRuntimeSchema,
});

export type FeatureDefinition = Schema.Schema.Type<typeof featureDefinitionSchema>;

const duplicateValues = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return [...counts].filter(([, count]) => count > 1).map(([value]) => value);
};

const validateFeatureCatalog = (catalog: ReadonlyArray<FeatureDefinition>) => {
  const featureIds = catalog.map((feature) => feature.id);
  const featureById = new Map<string, FeatureDefinition>(catalog.map((feature) => [feature.id, feature]));
  const installedSkills = catalog.flatMap((feature) => (feature.installedSkill._tag === "skill" ? [feature.installedSkill] : []));
  const issues = [
    ...duplicateValues(featureIds).map((id) => ({
      path: [id],
      message: "Feature IDs must be unique.",
    })),
    ...duplicateValues(catalog.map((feature) => feature.sourceDirectory)).map((sourceDirectory) => ({
      path: [sourceDirectory],
      message: "Source directories must be unique.",
    })),
    ...duplicateValues(installedSkills.map((skill) => skill.id)).map((id) => ({
      path: [id],
      message: "Installed skill IDs must be unique.",
    })),
    ...catalog.flatMap((feature) =>
      feature.dependencies
        .filter((dependency) => !featureById.has(dependency))
        .map((dependency) => ({
          path: [feature.id, "dependencies", dependency],
          message: "Every dependency must identify a catalog feature.",
        })),
    ),
    ...installedSkills.flatMap((skill) =>
      duplicateValues(skill.shippedPaths).map((path) => ({
        path: [skill.id, "shippedPaths", path],
        message: "Shipped paths must be unique within an installed skill.",
      })),
    ),
  ];

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycleFrom = (featureId: string): boolean => {
    if (visiting.has(featureId)) {
      return true;
    }
    if (visited.has(featureId)) {
      return false;
    }

    const feature = featureById.get(featureId);
    if (!feature) {
      return false;
    }

    visiting.add(featureId);
    const hasCycle = feature.dependencies.some(hasCycleFrom);
    visiting.delete(featureId);
    visited.add(featureId);
    return hasCycle;
  };

  if (catalog.some((feature) => hasCycleFrom(feature.id))) {
    issues.push({
      path: ["dependencies"],
      message: "Feature dependencies must be acyclic.",
    });
  }

  return issues.length === 0 ? true : issues;
};

export const featureCatalogSchema = Schema.Array(featureDefinitionSchema).pipe(
  Schema.filter(validateFeatureCatalog),
  Schema.annotations({
    parseOptions: {
      onExcessProperty: "error",
    },
  }),
);

export const featureCatalog = Schema.decodeUnknownSync(featureCatalogSchema, {
  onExcessProperty: "error",
})([
  {
    id: "context-guard",
    sourceDirectory: "contextGuard",
    installedSkill: {
      _tag: "none",
    },
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
          matcher: {
            _tag: "pattern",
            value: "Write|Edit|MultiEdit|NotebookEdit",
          },
        },
        {
          event: "PostToolUse",
          matcher: {
            _tag: "pattern",
            value: "Write|Edit|MultiEdit|NotebookEdit",
          },
        },
        {
          event: "UserPromptSubmit",
          matcher: {
            _tag: "none",
          },
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
      "A SessionStart daemon that auto-/compacts and resumes work hands-free once context nears the guardrail and a fresh handoff exists. macOS + Ghostty only (it types into your terminal window).",
    selectedByDefault: false,
    dependencies: ["context-guard"],
    platform: "macos+ghostty",
    runtime: {
      _tag: "hook",
      sourceEntrypoint: "hooks/ctxWatchSpawn.ts",
      registrations: [
        {
          event: "SessionStart",
          matcher: {
            _tag: "none",
          },
        },
      ],
    },
  },
  {
    id: "speak-response",
    sourceDirectory: "speakResponse",
    installedSkill: {
      _tag: "none",
    },
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
          matcher: {
            _tag: "none",
          },
        },
      ],
    },
  },
  {
    id: "dedup-guard",
    sourceDirectory: "dedupGuard",
    installedSkill: {
      _tag: "none",
    },
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
          matcher: {
            _tag: "pattern",
            value: "Write|Edit|MultiEdit",
          },
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
      shippedPaths: ["SKILL.md", "README.md", "CONTEXT.md", "TECH-GLOSSARY.md", "reference", "demo", "scripts"],
    },
    title: "PNG → pixel-perfect code",
    summary:
      "A skill that turns a PNG design (illustration, logo, UI mockup) into SVG/HTML/CSS that measurably converges to a 1:1 match — a decompose → reuse-or-build → render → screenshot-diff → refine loop, plus a rig-first doctrine for animation. Pure skill (no hooks); its diff harness needs Node + Playwright.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
  },
  {
    id: "grill-me-code-style-coach",
    sourceDirectory: "grillMeCodeStyleCoach",
    installedSkill: {
      _tag: "skill",
      id: "grill-me-code-style-coach",
      shippedPaths: ["SKILL.md"],
    },
    title: "Code-style implementation coach",
    summary: "Coach real style and architecture decisions while code is being built, using the repository's own rules and exemplars.",
    selectedByDefault: false,
    dependencies: ["grill-me-code-style"],
    platform: "any",
    runtime: {
      _tag: "none",
    },
  },
  {
    id: "grill-me-code-style-review",
    sourceDirectory: "grillMeCodeStyleReview",
    installedSkill: {
      _tag: "skill",
      id: "grill-me-code-style-review",
      shippedPaths: ["SKILL.md"],
    },
    title: "Code-style changeset review",
    summary: "Review large changesets against repository style rules and intent, then teach only the deviations that require judgment.",
    selectedByDefault: false,
    dependencies: ["grill-me-code-style"],
    platform: "any",
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    summary:
      "Teach and record why a project uses its language, runtime, framework, and load-bearing services through one decision at a time.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    runtime: {
      _tag: "none",
    },
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
    summary: "Audit and fix semantic HTML, accessibility, assets, performance, security headers, SEO, and machine-readable web content.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "none",
    },
  },
]);

export class UnknownFeatureError extends Schema.TaggedError<UnknownFeatureError>()("UnknownFeatureError", {
  featureId: Schema.String,
}) {}

export const findFeature = (featureId: string): Option.Option<FeatureDefinition> =>
  Option.fromNullable(featureCatalog.find((feature) => feature.id === featureId));

export const selectedFeatureIds: ReadonlyArray<FeatureId> = featureCatalog
  .filter((feature) => feature.selectedByDefault)
  .map((feature) => feature.id);

export const resolveFeatureSelection = (
  requestedFeatureIds: ReadonlyArray<string>,
): Either.Either<ReadonlyArray<FeatureId>, UnknownFeatureError> => {
  const unknownFeatureId = requestedFeatureIds.find((featureId) => Option.isNone(findFeature(featureId)));
  if (unknownFeatureId) {
    return Either.left(
      new UnknownFeatureError({
        featureId: unknownFeatureId,
      }),
    );
  }

  const resolved = new Set<string>();
  const includeFeature = (feature: FeatureDefinition): void => {
    if (resolved.has(feature.id)) {
      return;
    }

    resolved.add(feature.id);
    feature.dependencies.forEach((dependency) => {
      includeFeature(Option.getOrThrow(findFeature(dependency)));
    });
  };

  requestedFeatureIds.forEach((featureId) => {
    includeFeature(Option.getOrThrow(findFeature(featureId)));
  });

  return Either.right(featureCatalog.filter((feature) => resolved.has(feature.id)).map((feature) => feature.id));
};

export const installedSkillsFor = (featureIds: ReadonlyArray<FeatureId>): ReadonlyArray<InstalledSkill> => {
  const selected = new Set<string>(featureIds);
  const installedSkillIds = new Set<string>();

  return featureCatalog.flatMap((feature) => {
    if (!selected.has(feature.id) || feature.installedSkill._tag === "none" || installedSkillIds.has(feature.installedSkill.id)) {
      return [];
    }

    installedSkillIds.add(feature.installedSkill.id);
    return [feature.installedSkill];
  });
};
