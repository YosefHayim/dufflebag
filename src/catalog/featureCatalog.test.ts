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

const expectedFeatureIds = [
  "context-guard",
  "autonomous-loop",
  "speak-response",
  "dedup-guard",
  "png-to-code",
  "github-repo-metadata",
  "write-a-post",
  "readme-editor",
  "refresh-agent-docs",
  "deslop",
  "deslop-v2",
  "grill-me",
  "grill-me-code-style",
  "grill-me-code-style-coach",
  "grill-me-code-style-review",
  "grill-me-code-style-with-docs",
  "grill-me-stack",
  "grill-with-docs",
  "planpage",
  "web-perf-ci",
  "cws-listing-seo",
  "make-a-trailer",
  "web-best-practices",
  "organized-commits",
  "finish-and-ship",
  "preview-and-prove",
  "reuse-first-audit",
  "agent-session-auditor",
  "sync-agent-skills",
  "env-config-contract",
  "mcp-oauth-onboarding",
  "rtl-ui-audit",
  "deploy-and-prove",
  "coordinate-worktrees",
  "capture-workflow",
  "finish-agent-sessions",
];

const expectedSourceDirectories = [
  "contextGuard",
  "autorun",
  "speakResponse",
  "dedupGuard",
  "pngToCode",
  "githubRepoMetadata",
  "writeAPost",
  "readmeEditor",
  "refreshAgentDocs",
  "deslop",
  "deslopV2",
  "grillMe",
  "grillMeCodeStyle",
  "grillMeCodeStyleCoach",
  "grillMeCodeStyleReview",
  "grillMeCodeStyleWithDocs",
  "grillMeStack",
  "grillWithDocs",
  "planpage",
  "webPerfCi",
  "cwsListingSeo",
  "makeATrailer",
  "webBestPractices",
  "organizedCommits",
  "finishAndShip",
  "previewAndProve",
  "reuseFirstAudit",
  "agentSessionAuditor",
  "syncAgentSkills",
  "envConfigContract",
  "mcpOauthOnboarding",
  "rtlUiAudit",
  "deployAndProve",
  "coordinateWorktrees",
  "captureWorkflow",
  "finishAgentSessions",
];

const validFixture = [
  {
    id: "alpha",
    sourceDirectory: "alpha",
    installedSkill: {
      _tag: "skill",
      id: "alpha",
      shippedPaths: ["SKILL.md"],
    },
    title: "Alpha",
    summary: "Alpha feature.",
    selectedByDefault: true,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "beta",
    sourceDirectory: "beta",
    installedSkill: {
      _tag: "skill",
      id: "beta",
      shippedPaths: ["SKILL.md", "reference"],
    },
    title: "Beta",
    summary: "Beta feature.",
    selectedByDefault: false,
    dependencies: ["alpha"],
    platform: "macos",
    runtime: {
      _tag: "hook",
      sourceEntrypoint: "hooks/beta.ts",
      registrations: [
        {
          event: "Stop",
          matcher: { _tag: "none" },
          entrypoint: { _tag: "featureDefault" },
        },
      ],
    },
  },
];

const decodeFixture = (input: unknown) =>
  Schema.decodeUnknownEither(featureCatalogSchema, {
    onExcessProperty: "error",
  })(input);

describe("featureCatalog", () => {
  it("decodes all approved features in display order", () => {
    expect(featureCatalog.map((feature) => feature.id)).toEqual(expectedFeatureIds);
  });

  it("keeps public IDs, authored directories, and installed IDs distinct", () => {
    expect(featureCatalog.map((feature) => feature.sourceDirectory)).toEqual(expectedSourceDirectories);
    expect(featureCatalog.find((feature) => feature.id === "autonomous-loop")).toMatchObject({
      sourceDirectory: "autorun",
      installedSkill: { _tag: "skill", id: "autorun" },
    });
    expect(new Set(featureCatalog.map((feature) => feature.id)).size).toBe(featureCatalog.length);
    expect(new Set(featureCatalog.map((feature) => feature.sourceDirectory)).size).toBe(featureCatalog.length);

    const installedIds = installedSkillsFor(featureCatalog.map((feature) => feature.id)).map((skill) => skill.id);
    expect(new Set(installedIds).size).toBe(installedIds.length);
  });

  it("derives defaults, installed skills, and exact shipped allowlists", () => {
    expect(selectedFeatureIds).toEqual(["context-guard"]);
    expect(installedSkillsFor(["context-guard", "speak-response", "dedup-guard"])).toEqual([]);
    expect(installedSkillsFor(featureCatalog.map((feature) => feature.id)).map((skill) => [skill.id, skill.shippedPaths])).toEqual([
      ["autorun", ["SKILL.md"]],
      [
        "png-to-code",
        [
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
      ],
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
      ["organized-commits", ["SKILL.md", "REFERENCE.md"]],
      ["finish-and-ship", ["SKILL.md"]],
      ["preview-and-prove", ["SKILL.md"]],
      ["reuse-first-audit", ["SKILL.md"]],
      ["agent-session-auditor", ["SKILL.md"]],
      ["sync-agent-skills", ["SKILL.md"]],
      ["env-config-contract", ["SKILL.md"]],
      ["mcp-oauth-onboarding", ["SKILL.md"]],
      ["rtl-ui-audit", ["SKILL.md"]],
      ["deploy-and-prove", ["SKILL.md"]],
      ["coordinate-worktrees", ["SKILL.md"]],
      ["capture-workflow", ["SKILL.md"]],
      ["finish-agent-sessions", ["SKILL.md"]],
    ]);
  });

  it("stores authored TypeScript hook entrypoints and no generated JavaScript paths", () => {
    const runtimeFeatures = featureCatalog.flatMap((feature) =>
      feature.runtime._tag === "hook"
        ? [
            {
              id: feature.id,
              platform: feature.platform,
              sourceEntrypoint: feature.runtime.sourceEntrypoint,
              registrations: feature.runtime.registrations,
            },
          ]
        : [],
    );
    const runtimeEntrypoints = runtimeFeatures.map((feature) => feature.sourceEntrypoint);

    expect(runtimeEntrypoints).toEqual(["hooks/contextGuard.ts", "hooks/speakResponse.ts", "hooks/dedupGuard.ts"]);
    expect(runtimeFeatures).toEqual([
      {
        id: "context-guard",
        platform: "any",
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
      {
        id: "speak-response",
        platform: "macos",
        sourceEntrypoint: "hooks/speakResponse.ts",
        registrations: [
          {
            event: "Stop",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "featureDefault" },
          },
        ],
      },
      {
        id: "dedup-guard",
        platform: "any",
        sourceEntrypoint: "hooks/dedupGuard.ts",
        registrations: [
          {
            event: "PreToolUse",
            matcher: { _tag: "pattern", value: "Write|Edit|MultiEdit" },
            entrypoint: { _tag: "featureDefault" },
          },
        ],
      },
    ]);
    expect(featureCatalog.filter((feature) => feature.platform !== "any").map((feature) => [feature.id, feature.platform])).toEqual([
      ["autonomous-loop", "macos+ghostty"],
      ["speak-response", "macos"],
      ["make-a-trailer", "macos"],
    ]);
    expect(runtimeEntrypoints.every((entrypoint) => entrypoint.endsWith(".ts"))).toBe(true);
    expect(runtimeEntrypoints.some((entrypoint) => entrypoint.endsWith(".js"))).toBe(false);
  });

  it("finds features with Option", () => {
    expect(Option.map(findFeature("planpage"), (feature) => feature.title)).toEqual(Option.some("planpage"));
    expect(findFeature("missing-feature")).toEqual(Option.none());
  });

  it("expands dependencies once and returns stable catalog order", () => {
    expect(
      featureCatalog.filter((feature) => feature.dependencies.length > 0).map((feature) => [feature.id, feature.dependencies]),
    ).toEqual([
      ["autonomous-loop", ["context-guard"]],
      ["grill-me-code-style-with-docs", ["grill-me-code-style"]],
      ["grill-with-docs", ["grill-me-code-style"]],
      ["make-a-trailer", ["planpage"]],
      ["finish-and-ship", ["organized-commits"]],
      ["coordinate-worktrees", ["organized-commits"]],
      ["finish-agent-sessions", ["finish-and-ship", "agent-session-auditor"]],
    ]);
    expect(Either.getOrThrowWith(resolveFeatureSelection(["make-a-trailer", "autonomous-loop", "context-guard"]), String)).toEqual([
      "context-guard",
      "autonomous-loop",
      "planpage",
      "make-a-trailer",
    ]);
  });

  it("returns a tagged unknown-feature error", () => {
    const result = resolveFeatureSelection(["not-installed"]);

    expect(Either.isLeft(result)).toBe(true);
    expect(Option.getOrThrow(Either.getLeft(result))).toBeInstanceOf(UnknownFeatureError);
    expect(Option.getOrThrow(Either.getLeft(result)).featureId).toBe("not-installed");
  });
});

describe("featureCatalogSchema", () => {
  it("accepts a complete valid unknown fixture", () => {
    expect(Either.isRight(decodeFixture(validFixture))).toBe(true);
  });

  it.each([
    {
      name: "duplicate feature IDs",
      input: [validFixture[0], { ...validFixture[1], id: "alpha" }],
      message: "Feature IDs must be unique",
    },
    {
      name: "duplicate source directories",
      input: [validFixture[0], { ...validFixture[1], sourceDirectory: "alpha" }],
      message: "Source directories must be unique",
    },
    {
      name: "duplicate installed skill IDs",
      input: [validFixture[0], { ...validFixture[1], installedSkill: { _tag: "skill", id: "alpha", shippedPaths: [] } }],
      message: "Installed skill IDs must be unique",
    },
    {
      name: "missing dependencies",
      input: [validFixture[0], { ...validFixture[1], dependencies: ["missing"] }],
      message: "Dependencies must reference catalog features",
    },
    {
      name: "dependency cycles",
      input: [{ ...validFixture[0], dependencies: ["beta"] }, validFixture[1]],
      message: "Feature dependencies must be acyclic",
    },
    {
      name: "excess properties",
      input: [{ ...validFixture[0], unexpected: true }, validFixture[1]],
      message: "is unexpected",
    },
    {
      name: "generated runtime entrypoints",
      input: [
        validFixture[0],
        {
          ...validFixture[1],
          runtime: {
            _tag: "hook",
            sourceEntrypoint: "hooks/beta.js",
            registrations: [],
          },
        },
      ],
      message: "must end in .ts",
    },
  ])("rejects $name", ({ input, message }) => {
    const result = decodeFixture(input);

    expect(Either.isLeft(result)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(result)))).toContain(message);
  });
});
