import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  featureCatalog,
  featureCatalogSchema,
  findFeature,
  installedSkillsFor,
  resolveFeatureSelection,
  selectedFeatureIds,
  UnknownFeatureError,
} from "./featureCatalog.js";

const expectedFeatureSources = [
  ["context-guard", "contextGuard"],
  ["autonomous-loop", "autorun"],
  ["speak-response", "speakResponse"],
  ["dedup-guard", "dedupGuard"],
  ["png-to-code", "pngToCode"],
  ["github-repo-metadata", "githubRepoMetadata"],
  ["write-a-post", "writeAPost"],
  ["readme-editor", "readmeEditor"],
  ["refresh-agent-docs", "refreshAgentDocs"],
  ["deslop", "deslop"],
  ["deslop-v2", "deslopV2"],
  ["grill-me", "grillMe"],
  ["grill-me-code-style", "grillMeCodeStyle"],
  ["grill-me-code-style-coach", "grillMeCodeStyleCoach"],
  ["grill-me-code-style-review", "grillMeCodeStyleReview"],
  ["grill-me-code-style-with-docs", "grillMeCodeStyleWithDocs"],
  ["grill-me-stack", "grillMeStack"],
  ["grill-with-docs", "grillWithDocs"],
  ["planpage", "planpage"],
  ["web-perf-ci", "webPerfCi"],
  ["cws-listing-seo", "cwsListingSeo"],
  ["make-a-trailer", "makeATrailer"],
  ["web-best-practices", "webBestPractices"],
];

const expectedInstalledSkills = [
  ["autorun", ["SKILL.md"]],
  ["png-to-code", ["SKILL.md", "README.md", "CONTEXT.md", "TECH-GLOSSARY.md", "reference", "demo", "scripts"]],
  ["github-repo-metadata", ["SKILL.md"]],
  ["write-a-post", ["SKILL.md"]],
  ["readme-editor", ["SKILL.md", "references"]],
  ["refresh-agent-docs", ["SKILL.md", "sources.json", "scripts"]],
  ["deslop", ["SKILL.md", "references"]],
  ["deslop-v2", ["SKILL.md", "references"]],
  ["grill-me", ["SKILL.md"]],
  ["grill-me-code-style", ["SKILL.md", "_shared"]],
  ["grill-me-code-style-coach", ["SKILL.md"]],
  ["grill-me-code-style-review", ["SKILL.md"]],
  ["grill-me-code-style-with-docs", ["SKILL.md", "SCAN.md"]],
  ["grill-me-stack", ["SKILL.md", "TEACH-FORMAT.md"]],
  ["grill-with-docs", ["SKILL.md", "CONTEXT-FORMAT.md", "ADR-FORMAT.md"]],
  ["planpage", ["SKILL.md", "COMPONENTS.md"]],
  ["web-perf-ci", ["SKILL.md", "README.md", "CONTEXT.md", "TECH-GLOSSARY.md", "reference", "scripts", "templates"]],
  ["cws-listing-seo", ["SKILL.md", "REFERENCE.md", "scripts", "templates"]],
  ["make-a-trailer", ["SKILL.md", "reference", "scripts"]],
  ["web-best-practices", ["SKILL.md", "reference", "scripts", "templates"]],
];

const expectedPreservedCopy = [
  [
    "context-guard",
    "Context guard",
    "Nudge a /handoff at ~18% of the model window and hard-deny new code edits at ~20%, so long sessions wind down gracefully instead of ballooning past usable context.",
  ],
  [
    "dedup-guard",
    "Dedup guard",
    "Block a Write/Edit that pastes a function body or interface/type shape already defined elsewhere in the repo — DRY enforced at the moment of the write. Uses the repo's own TypeScript; deny by default (tune with dufflebagDedupEnforcement). Also wires Cursor (warn) + an AGENTS.md rule for Codex.",
  ],
  [
    "autonomous-loop",
    "Autonomous loop (autorun)",
    "A SessionStart daemon that auto-/compacts and resumes work hands-free once context nears the guardrail and a fresh handoff exists. macOS + Ghostty only (it types into your terminal window).",
  ],
  [
    "speak-response",
    "Speak responses (TTS)",
    "A Stop hook that speaks Claude's prose (code blocks stripped) via the macOS `say` command. macOS only.",
  ],
  [
    "png-to-code",
    "PNG → pixel-perfect code",
    "A skill that turns a PNG design (illustration, logo, UI mockup) into SVG/HTML/CSS that measurably converges to a 1:1 match — a decompose → reuse-or-build → render → screenshot-diff → refine loop, plus a rig-first doctrine for animation. Pure skill (no hooks); its diff harness needs Node + Playwright.",
  ],
  [
    "github-repo-metadata",
    "GitHub repo metadata",
    "A skill that writes and audits GitHub repository About metadata: concise descriptions, homepage/demo links, and topics/tags grounded in official GitHub guidance. Pure skill (no hooks).",
  ],
  [
    "write-a-post",
    "Write a blog post (voice + cover)",
    "A skill that writes a portfolio blog post in the owner's exact voice, scaffolds it into the blog data file via a one-command dev script, and generates a matching cover image by driving a real ChatGPT browser conversation through ai-browser-bridge (attaching the likeness photo + an existing cover so the character and flat-2D style stay consistent). Pure skill (no hooks).",
  ],
  [
    "readme-editor",
    "README editor",
    "A skill that audits and rewrites README.md, AGENTS.md, CLAUDE.md, Copilot instructions, and llms.txt from repo evidence, with official links for named tools and technologies. Pure skill (no hooks).",
  ],
  [
    "refresh-agent-docs",
    "Refresh agent docs",
    "A skill that refetches current official guidance for AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules, Kiro steering, Roo rules, and Codex instructions before rewriting repo agent docs. Pure skill (no hooks).",
  ],
  [
    "deslop",
    "Deslop",
    "A skill that reviews code readability first, then applies approved cleanup to make the full pipeline understandable in seconds. Use when the user asks to clean up, rename, or make code less AI-generated.",
  ],
  [
    "deslop-v2",
    "Deslop v2 — kill over-engineering",
    "The over-engineering companion to deslop: reviews code and repo structure for excess — pass-through wrappers, `??` fallback chains, nested ternaries, grab-bag returns, and over-nested folders/packages — then removes it so the code does exactly what it needs and no more. Use when the user says code is over-engineered, over-abstracted, or too complicated, or asks to simplify, flatten, or cut needless indirection and layers. Pure skill (no hooks).",
  ],
  [
    "grill-me",
    "Grill me",
    "A skill that interviews the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree one question at a time.",
  ],
  [
    "grill-me-code-style",
    "Grill me — code style (greenfield)",
    "A greenfield code-style grilling skill. Interviews the user about how a new project is built, then renders an interactive HTML plan and writes CODE-STYLE.md, formatter config, and AGENTS.md digest on approval.",
  ],
  [
    "grill-me-code-style-with-docs",
    "Grill me — code style (existing codebase)",
    "An existing-codebase code-style grilling skill. Uses real code as evidence, fans out sub-agents for repeated patterns, then writes/updates CODE-STYLE.md and the AGENTS.md digest on approval.",
  ],
  [
    "grill-with-docs",
    "Grill with docs",
    "A grilling session that challenges a plan against the existing domain model, sharpens terminology, and updates CONTEXT.md, PROJECT.md, and ADRs inline as decisions crystallise.",
  ],
  [
    "planpage",
    "planpage",
    "A skill for rendering agent plans, review gates, and reports as beautiful interactive HTML pages using the open-source planpage package.",
  ],
  [
    "web-perf-ci",
    "Website performance CI (Core Web Vitals)",
    "A skill that wires automated performance gates into a website's CI/CD: a Lighthouse CI budget check on every PR (lab), a Chrome UX Report (CrUX) real-user field check after deploy, and an optional web-vitals RUM snippet — all enforcing Core Web Vitals budgets (LCP, INP, CLS). It interviews the repo to detect the stack and run mode, then writes lighthouserc, the GitHub Actions workflows, and zero-dep CrUX + PSI checkers. Pure skill (no hooks); the checks need Node 18+ and a free Google API key (Chrome UX Report + PageSpeed Insights APIs).",
  ],
  [
    "cws-listing-seo",
    "Chrome Web Store listing SEO (+ GEO)",
    "A skill that optimizes Chrome Web Store listing copy (name, summary, Overview) and marketing-site GEO using official Chrome/Google guidance. Ships a zero-dep validator for limits + Keyword Spam heuristics; CWS keyword volume stays manual/browser research (no official free API). Pure skill (no hooks).",
  ],
  [
    "make-a-trailer",
    "Make a trailer (cinematic project video)",
    "A skill that directs a cinematic, viral-ready vertical trailer for any project: it reads the repo's own docs to derive the story, consults ChatGPT (GPT-5.5 Thinking) over ai-browser-bridge to write the transcript + storyboard, batch-generates the keyframes as ChatGPT images, animates them with Higgsfield or Flow/Veo, produces voiceover + music (ElevenLabs → Higgsfield → local synth), and assembles a 9:16 master + 16:9/1:1/4:5 cuts with ffmpeg — behind two planpage approval gates and a resumable generation manifest. macOS + Chrome (ai-browser-bridge), the Higgsfield MCP, and ffmpeg required. Pure skill (no hooks).",
  ],
];

const decodeCatalog = Schema.decodeUnknownSync(featureCatalogSchema, {
  onExcessProperty: "error",
});

const featureNamed = (id: string) => Option.getOrThrow(findFeature(id));

describe("featureCatalog", () => {
  it("decodes all 23 entries in the approved topological display order", () => {
    expect(featureCatalog.map((feature) => [feature.id, feature.sourceDirectory])).toEqual(expectedFeatureSources);

    const positions = new Map(featureCatalog.map((feature, index) => [feature.id, index]));
    featureCatalog.forEach((feature, index) => {
      feature.dependencies.forEach((dependency) => {
        expect(positions.get(dependency)).toBeLessThan(index);
      });
    });
  });

  it("keeps IDs, source directories, and installed skill IDs unique", () => {
    const featureIds = featureCatalog.map((feature) => feature.id);
    const sourceDirectories = featureCatalog.map((feature) => feature.sourceDirectory);
    const installedSkillIds = featureCatalog.flatMap((feature) =>
      feature.installedSkill._tag === "skill" ? [feature.installedSkill.id] : [],
    );

    expect(new Set(featureIds).size).toBe(featureIds.length);
    expect(new Set(sourceDirectories).size).toBe(sourceDirectories.length);
    expect(new Set(installedSkillIds).size).toBe(installedSkillIds.length);
  });

  it("preserves the incumbent 19 titles and summaries exactly", () => {
    expect(
      expectedPreservedCopy.map(([id]) => {
        const feature = featureNamed(id);
        return [feature.id, feature.title, feature.summary];
      }),
    ).toEqual(expectedPreservedCopy);
  });

  it("declares useful metadata for the four newer catalog entries", () => {
    expect(
      ["grill-me-code-style-coach", "grill-me-code-style-review", "grill-me-stack", "web-best-practices"].map((id) => {
        const feature = featureNamed(id);
        return [feature.id, feature.title, feature.summary];
      }),
    ).toEqual([
      [
        "grill-me-code-style-coach",
        "Code-style implementation coach",
        "Coach real style and architecture decisions while code is being built, using the repository's own rules and exemplars.",
      ],
      [
        "grill-me-code-style-review",
        "Code-style changeset review",
        "Review large changesets against repository style rules and intent, then teach only the deviations that require judgment.",
      ],
      [
        "grill-me-stack",
        "Grill me — technology stack",
        "Teach and record why a project uses its language, runtime, framework, and load-bearing services through one decision at a time.",
      ],
      [
        "web-best-practices",
        "Web best practices",
        "Audit and fix semantic HTML, accessibility, assets, performance, security headers, SEO, and machine-readable web content.",
      ],
    ]);
  });

  it("derives only the declared default and exact installed skill allowlists", () => {
    expect(selectedFeatureIds).toEqual(["context-guard"]);

    const everyFeature = featureCatalog.map((feature) => feature.id);
    expect(installedSkillsFor(everyFeature).map((skill) => [skill.id, skill.shippedPaths])).toEqual(expectedInstalledSkills);
  });

  it("keeps source TypeScript entrypoints separate from generated JavaScript paths", () => {
    const runtimeEntrypoints = featureCatalog.flatMap((feature) =>
      feature.runtime._tag === "hook" ? [feature.runtime.sourceEntrypoint] : [],
    );

    expect(runtimeEntrypoints).toEqual([
      "hooks/contextGuard.ts",
      "hooks/ctxWatchSpawn.ts",
      "hooks/speakResponse.ts",
      "hooks/dedupGuard.ts",
    ]);
    expect(runtimeEntrypoints.every((entrypoint) => entrypoint.endsWith(".ts"))).toBe(true);
    expect(runtimeEntrypoints.some((entrypoint) => entrypoint.endsWith(".js"))).toBe(false);
  });

  it("maps autonomous-loop to autorun without inventing skills for runtime-only features", () => {
    expect(featureNamed("autonomous-loop")).toMatchObject({
      sourceDirectory: "autorun",
      installedSkill: {
        _tag: "skill",
        id: "autorun",
      },
      dependencies: ["context-guard"],
    });

    for (const id of ["context-guard", "speak-response", "dedup-guard"]) {
      expect(featureNamed(id).installedSkill).toEqual({ _tag: "none" });
    }
  });

  it("keeps exact runtime registrations and matchers", () => {
    expect(
      featureCatalog.flatMap((feature) =>
        feature.runtime._tag === "hook"
          ? feature.runtime.registrations.map((registration) => [feature.id, registration.event, registration.matcher])
          : [],
      ),
    ).toEqual([
      ["context-guard", "PreToolUse", { _tag: "pattern", value: "Write|Edit|MultiEdit|NotebookEdit" }],
      ["context-guard", "PostToolUse", { _tag: "pattern", value: "Write|Edit|MultiEdit|NotebookEdit" }],
      ["context-guard", "UserPromptSubmit", { _tag: "none" }],
      ["autonomous-loop", "SessionStart", { _tag: "none" }],
      ["speak-response", "Stop", { _tag: "none" }],
      ["dedup-guard", "PreToolUse", { _tag: "pattern", value: "Write|Edit|MultiEdit" }],
    ]);
  });

  it("finds meaningful absence through Option", () => {
    expect(Option.getOrUndefined(findFeature("png-to-code"))?.sourceDirectory).toBe("pngToCode");
    expect(Option.isNone(findFeature("missing-feature"))).toBe(true);
  });

  it("expands dependencies in stable catalog order and deduplicates requested IDs", () => {
    const resolved = resolveFeatureSelection(["make-a-trailer", "autonomous-loop", "planpage", "make-a-trailer", "context-guard"]);

    expect(Option.getOrThrow(Either.getRight(resolved))).toEqual(["context-guard", "autonomous-loop", "planpage", "make-a-trailer"]);
  });

  it("returns a tagged error for an unknown selection", () => {
    const result = resolveFeatureSelection(["png-to-code", "unknown-feature"]);
    const error = Option.getOrThrow(Either.getLeft(result));

    expect(error).toBeInstanceOf(UnknownFeatureError);
    expect(error).toMatchObject({
      _tag: "UnknownFeatureError",
      featureId: "unknown-feature",
    });
  });

  it("returns a tagged error when the first unknown selection is empty", () => {
    const result = resolveFeatureSelection(["png-to-code", "", "planpage"]);
    const error = Option.getOrThrow(Either.getLeft(result));

    expect(error).toBeInstanceOf(UnknownFeatureError);
    expect(error).toMatchObject({
      _tag: "UnknownFeatureError",
      featureId: "",
    });
  });

  it("rejects excess properties at every owned object boundary", () => {
    const contextGuard = featureNamed("context-guard");
    const pngToCode = featureNamed("png-to-code");

    expect(() => {
      decodeCatalog([{ ...contextGuard, extra: true }]);
    }).toThrow();
    expect(() => {
      decodeCatalog([
        {
          ...pngToCode,
          installedSkill: {
            ...pngToCode.installedSkill,
            extra: true,
          },
        },
      ]);
    }).toThrow();
    expect(() => {
      decodeCatalog([
        {
          ...pngToCode,
          installedSkill: {
            _tag: "skill",
            id: "png-to-code",
            shippedPaths: [
              {
                path: "SKILL.md",
                extra: true,
              },
            ],
          },
        },
      ]);
    }).toThrow();
    expect(() => {
      decodeCatalog([
        {
          ...contextGuard,
          runtime: {
            _tag: "hook",
            sourceEntrypoint: "hooks/contextGuard.ts",
            registrations: [],
            extra: true,
          },
        },
      ]);
    }).toThrow();
    expect(() => {
      decodeCatalog([
        {
          ...contextGuard,
          runtime: {
            _tag: "hook",
            sourceEntrypoint: "hooks/contextGuard.ts",
            registrations: [
              {
                event: "UserPromptSubmit",
                matcher: {
                  _tag: "none",
                },
                extra: true,
              },
            ],
          },
        },
      ]);
    }).toThrow();
    expect(() => {
      decodeCatalog([
        {
          ...contextGuard,
          runtime: {
            _tag: "hook",
            sourceEntrypoint: "hooks/contextGuard.ts",
            registrations: [
              {
                event: "PreToolUse",
                matcher: {
                  _tag: "pattern",
                  value: "Write",
                  extra: true,
                },
              },
            ],
          },
        },
      ]);
    }).toThrow();
  });

  it("rejects malformed IDs, generated entrypoints, duplicates, missing dependencies, and cycles", () => {
    const contextGuard = featureNamed("context-guard");
    const autonomousLoop = featureNamed("autonomous-loop");
    const githubRepoMetadata = featureNamed("github-repo-metadata");
    const pngToCode = featureNamed("png-to-code");
    const speakResponse = featureNamed("speak-response");

    expect(() => {
      decodeCatalog([{ ...contextGuard, id: "ContextGuard" }]);
    }).toThrow("Feature IDs must use kebab-case.");
    expect(() => {
      decodeCatalog([
        {
          ...contextGuard,
          runtime: {
            ...contextGuard.runtime,
            sourceEntrypoint: "hooks/contextGuard.js",
          },
        },
      ]);
    }).toThrow("Hook source entrypoints must end in .ts.");
    expect(() => {
      decodeCatalog([contextGuard, contextGuard]);
    }).toThrow("Feature IDs must be unique.");
    expect(() => {
      decodeCatalog([contextGuard, { ...speakResponse, sourceDirectory: contextGuard.sourceDirectory }]);
    }).toThrow("Source directories must be unique.");
    expect(() => {
      decodeCatalog([
        pngToCode,
        {
          ...githubRepoMetadata,
          installedSkill: {
            _tag: "skill",
            id: "png-to-code",
            shippedPaths: ["SKILL.md"],
          },
        },
      ]);
    }).toThrow("Installed skill IDs must be unique.");
    expect(() => {
      decodeCatalog([{ ...autonomousLoop, dependencies: ["missing-feature"] }]);
    }).toThrow("Every dependency must identify a catalog feature.");
    expect(() => {
      decodeCatalog([
        { ...contextGuard, dependencies: ["autonomous-loop"] },
        { ...autonomousLoop, dependencies: ["context-guard"] },
      ]);
    }).toThrow("Feature dependencies must be acyclic.");
  });
});
