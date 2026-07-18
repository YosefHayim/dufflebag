import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkCodeStyle } from "./checkCodeStyle.js";

type MachineRule = {
  id: string;
  summary: string;
  enforcement: "ast" | "biome" | "importGraph" | "manual" | "path";
};

type ProtectedPath = {
  path: string;
  codeRuleExemptions: ReadonlyArray<string>;
};

const PROTECTED_PATHS = [
  "src/skills/makeATrailer/SKILL.md",
  "src/skills/makeATrailer/reference/pipeline.md",
  "src/skills/makeATrailer/scripts/assembleCut.mjs",
];

const ASSEMBLE_CUT_EXEMPTIONS = [
  "function.arrow-only",
  "function.input-shape",
  "comment.loop-intent",
];

const MACHINE_RULES: ReadonlyArray<MachineRule> = [
  {
    id: "function.arrow-only",
    summary: "Named functions use arrow constants.",
    enforcement: "ast",
  },
  {
    id: "function.input-shape",
    summary: "Function inputs stay cohesive and positional booleans are forbidden.",
    enforcement: "ast",
  },
  {
    id: "comment.loop-intent",
    summary: "Every explicit loop has an immediately preceding intent comment.",
    enforcement: "ast",
  },
  {
    id: "function.effect-generator",
    summary: "Anonymous generators appear only as the direct Effect.gen callback.",
    enforcement: "ast",
  },
  {
    id: "class.tagged-error-only",
    summary: "Schema.TaggedError is the only class form.",
    enforcement: "ast",
  },
  {
    id: "type.no-assertion",
    summary: "Authored TypeScript assertions are forbidden.",
    enforcement: "ast",
  },
  {
    id: "comment.index-proof",
    summary: "Indexed non-null access has an immediately preceding proof comment.",
    enforcement: "ast",
  },
  {
    id: "type.no-interface",
    summary: "Interfaces are reserved for declaration-file augmentation.",
    enforcement: "ast",
  },
  {
    id: "type.no-enum",
    summary: "Enums are forbidden.",
    enforcement: "ast",
  },
  {
    id: "type.no-conditional",
    summary: "Authored conditional and infer type machinery is forbidden.",
    enforcement: "ast",
  },
  {
    id: "type.no-suppression",
    summary: "TypeScript suppression directives are forbidden.",
    enforcement: "ast",
  },
  {
    id: "function.blank-line",
    summary: "Function declarations are separated by one blank line.",
    enforcement: "ast",
  },
  {
    id: "function.nesting",
    summary: "Function control flow nests no more than two levels.",
    enforcement: "ast",
  },
  {
    id: "comment.pipeline-contract",
    summary: "Ordered multi-phase pipelines have a contract and numbered phases.",
    enforcement: "manual",
  },
  {
    id: "type.schema-owned-runtime",
    summary: "Exported runtime object types derive from Effect Schema.",
    enforcement: "ast",
  },
  {
    id: "barrel.direct-wildcard",
    summary: "Barrels contain direct wildcard exports only.",
    enforcement: "ast",
  },
  {
    id: "name.domain-specific",
    summary: "Identifiers avoid vague generic role names.",
    enforcement: "ast",
  },
  {
    id: "path.no-generic-bucket",
    summary: "Generic bucket filenames are forbidden.",
    enforcement: "path",
  },
  {
    id: "path.source-directory-case",
    summary: "Authored source directories use camelCase.",
    enforcement: "path",
  },
  {
    id: "path.capability-layout",
    summary: "Source paths expose named capabilities, not generic technical layers.",
    enforcement: "path",
  },
  {
    id: "mutation.no-input",
    summary: "Function inputs are never mutated.",
    enforcement: "ast",
  },
  {
    id: "collection.no-builder-reduce",
    summary: "Reduce is not used to build arrays or objects.",
    enforcement: "ast",
  },
  {
    id: "effect.no-promise-all",
    summary: "Main application effects do not use Promise.all.",
    enforcement: "ast",
  },
  {
    id: "effect.runtime-edge",
    summary: "Effect.run calls exist only at src/cli/main.ts.",
    enforcement: "ast",
  },
  {
    id: "presentation.terminal-ui",
    summary: "Main application presentation does not call console methods.",
    enforcement: "ast",
  },
  {
    id: "import.application-boundary",
    summary: "Application modules do not import the installed hook runtime.",
    enforcement: "importGraph",
  },
  {
    id: "import.hook-runtime",
    summary: "Installed hook graphs import only node modules and their runtime island.",
    enforcement: "importGraph",
  },
];

const temporaryRepositories = new Set<string>();

const createRepository = (): string => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "dufflebag-style-"));
  temporaryRepositories.add(repositoryRoot);
  return repositoryRoot;
};

const writeGuide = (repositoryRoot: string, ruleIds: ReadonlyArray<string>): void => {
  const guide = ruleIds.map((ruleId) => `## Rule [rule:${ruleId}]`).join("\n\n");
  writeFileSync(join(repositoryRoot, "CODE-STYLE.md"), `${guide}\n`);
};

const writeConfiguration = (
  repositoryRoot: string,
  rules: ReadonlyArray<MachineRule> = MACHINE_RULES,
  protectedPaths: ReadonlyArray<ProtectedPath> = [
    { path: PROTECTED_PATHS[0] ?? "", codeRuleExemptions: [] },
    { path: PROTECTED_PATHS[1] ?? "", codeRuleExemptions: [] },
    {
      path: PROTECTED_PATHS[2] ?? "",
      codeRuleExemptions: ASSEMBLE_CUT_EXEMPTIONS,
    },
  ],
): void => {
  writeFileSync(
    join(repositoryRoot, "code-style.rules.json"),
    `${JSON.stringify({ rules, protectedPaths }, null, 2)}\n`,
  );
};

const writeValidContract = (repositoryRoot: string): void => {
  writeGuide(
    repositoryRoot,
    MACHINE_RULES.map((rule) => rule.id),
  );
  writeConfiguration(repositoryRoot);
};

const writeSource = (repositoryRoot: string, path: string, source: string): void => {
  const file = join(repositoryRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
};

const checkSource = (path: string, source: string) => {
  const repositoryRoot = createRepository();
  writeValidContract(repositoryRoot);
  writeSource(repositoryRoot, path, source);
  return checkCodeStyle(repositoryRoot);
};

const checkSources = (files: Readonly<Record<string, string | undefined>>) => {
  const repositoryRoot = createRepository();
  writeValidContract(repositoryRoot);
  Object.entries(files).forEach(([path, source]) => {
    if (source !== undefined) {
      writeSource(repositoryRoot, path, source);
    }
  });
  return checkCodeStyle(repositoryRoot);
};

afterEach(() => {
  temporaryRepositories.forEach((repositoryRoot) => {
    rmSync(repositoryRoot, { recursive: true, force: true });
  });
  temporaryRepositories.clear();
});

describe("code-style contract configuration", () => {
  it("fails when a documented rule has no machine entry", () => {
    const repositoryRoot = createRepository();
    writeGuide(repositoryRoot, [...MACHINE_RULES.map((rule) => rule.id), "type.no-interface"]);
    writeConfiguration(repositoryRoot);

    expect(() => checkCodeStyle(repositoryRoot)).toThrow(/type\.no-interface/u);
  });

  it("fails when a machine rule has no documented ID", () => {
    const repositoryRoot = createRepository();
    writeGuide(repositoryRoot, MACHINE_RULES.slice(1).map((rule) => rule.id));
    writeConfiguration(repositoryRoot);

    expect(() => checkCodeStyle(repositoryRoot)).toThrow(/function\.arrow-only/u);
  });

  it("reports exactly the three protected paths for the approved configuration", () => {
    const repositoryRoot = createRepository();
    writeValidContract(repositoryRoot);

    expect(checkCodeStyle(repositoryRoot).protectedPaths).toEqual(PROTECTED_PATHS);
  });

  it.each([
    {
      name: "a wildcard path",
      mutate: (protectedPaths: ReadonlyArray<ProtectedPath>): ReadonlyArray<ProtectedPath> => [
        ...protectedPaths.slice(0, 2),
        { path: "src/skills/makeATrailer/**", codeRuleExemptions: ASSEMBLE_CUT_EXEMPTIONS },
      ],
    },
    {
      name: "a fourth path",
      mutate: (protectedPaths: ReadonlyArray<ProtectedPath>): ReadonlyArray<ProtectedPath> => [
        ...protectedPaths,
        { path: "src/legacy.ts", codeRuleExemptions: [] },
      ],
    },
    {
      name: "an exemption on protected Markdown",
      mutate: (protectedPaths: ReadonlyArray<ProtectedPath>): ReadonlyArray<ProtectedPath> => [
        { path: PROTECTED_PATHS[0] ?? "", codeRuleExemptions: ["function.arrow-only"] },
        ...protectedPaths.slice(1),
      ],
    },
    {
      name: "an extra assembleCut exemption",
      mutate: (protectedPaths: ReadonlyArray<ProtectedPath>): ReadonlyArray<ProtectedPath> => [
        ...protectedPaths.slice(0, 2),
        {
          path: PROTECTED_PATHS[2] ?? "",
          codeRuleExemptions: [...ASSEMBLE_CUT_EXEMPTIONS, "type.no-interface"],
        },
      ],
    },
  ])("fails closed when protected configuration contains $name", ({ mutate }) => {
    const repositoryRoot = createRepository();
    writeGuide(
      repositoryRoot,
      MACHINE_RULES.map((rule) => rule.id),
    );
    const validProtectedPaths: ReadonlyArray<ProtectedPath> = [
      { path: PROTECTED_PATHS[0] ?? "", codeRuleExemptions: [] },
      { path: PROTECTED_PATHS[1] ?? "", codeRuleExemptions: [] },
      {
        path: PROTECTED_PATHS[2] ?? "",
        codeRuleExemptions: ASSEMBLE_CUT_EXEMPTIONS,
      },
    ];
    writeConfiguration(repositoryRoot, MACHINE_RULES, mutate(validProtectedPaths));

    expect(() => checkCodeStyle(repositoryRoot)).toThrow(/protected|exemption/u);
  });
});

describe("function and class forms", () => {
  it("reports a named function declaration at its exact line", () => {
    const report = checkSource("src/catalog/example.ts", "\nexport function loadCatalog() {}\n");

    expect(report.violations).toEqual([
      {
        ruleId: "function.arrow-only",
        file: "src/catalog/example.ts",
        line: 2,
        message: expect.any(String),
      },
    ]);
  });

  it("accepts an arrow constant", () => {
    const report = checkSource("src/catalog/example.ts", "export const loadCatalog = () => [];\n");

    expect(report.violations).toEqual([]);
  });

  it.each([
    { name: "an ordinary function expression", source: "export const load = function () {};\n" },
    { name: "a named function expression", source: "export const load = function loadCatalog() {};\n" },
    { name: "an object method", source: "export const catalog = { load() {} };\n" },
  ])("rejects $name", ({ source }) => {
    const report = checkSource("src/catalog/example.ts", source);

    expect(report.violations).toEqual([
      {
        ruleId: "function.arrow-only",
        file: "src/catalog/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("accepts only an anonymous generator passed directly to Effect.gen", () => {
    const report = checkSource(
      "src/install/example.ts",
      'import { Effect } from "effect";\nexport const install = Effect.gen(function* () { yield* Effect.void; });\n',
    );

    expect(report.violations).toEqual([]);
  });

  it.each([
    {
      name: "an indirect generator",
      source:
        'import { Effect } from "effect";\nconst operation = function* () {};\nexport const install = Effect.gen(operation);\n',
      line: 2,
    },
    {
      name: "a named generator",
      source:
        'import { Effect } from "effect";\nexport const install = Effect.gen(function* installWorkflow() {});\n',
      line: 2,
    },
    {
      name: "another object gen method",
      source: "export const install = Other.gen(function* () {});\n",
      line: 1,
    },
  ])("rejects $name", ({ source, line }) => {
    const report = checkSource("src/install/example.ts", source);

    expect(report.violations).toEqual([
      {
        ruleId: "function.effect-generator",
        file: "src/install/example.ts",
        line,
        message: expect.any(String),
      },
    ]);
  });

  it("accepts a class with direct Schema.TaggedError heritage", () => {
    const report = checkSource(
      "src/install/example.ts",
      'import { Schema } from "effect";\nexport class InstallError extends Schema.TaggedError<InstallError>()("InstallError", {}) {}\n',
    );

    expect(report.violations).toEqual([]);
  });

  it.each([
    {
      name: "a plain class",
      source: "export class InstallError {}\n",
    },
    {
      name: "another object TaggedError",
      source: 'export class InstallError extends Other.TaggedError<InstallError>()("InstallError", {}) {}\n',
    },
    {
      name: "a similarly named Schema member",
      source:
        'export class InstallError extends Schema.TaggedErrorAlias<InstallError>()("InstallError", {}) {}\n',
    },
  ])("rejects $name", ({ source }) => {
    const report = checkSource("src/install/example.ts", source);

    expect(report.violations).toEqual([
      {
        ruleId: "class.tagged-error-only",
        file: "src/install/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });
});

describe("type assertions", () => {
  it.each([
    {
      name: "an as expression",
      source: "export const decoded = input as string;\n",
    },
    {
      name: "an angle-bracket assertion",
      source: "export const decoded = <string>input;\n",
    },
  ])("reports $name at its exact line", ({ source }) => {
    const report = checkSource("src/config/example.ts", source);

    expect(report.violations).toEqual([
      {
        ruleId: "type.no-assertion",
        file: "src/config/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it.each([
    { name: "a type alias", source: "export type FeatureId = string;\n" },
    { name: "assertion-looking string content", source: 'export const copy = "input as string";\n' },
    {
      name: "a satisfies expression",
      source: "export const values = { id: 1 } satisfies Record<string, unknown>;\n",
    },
  ])("does not mistake $name for an assertion", ({ source }) => {
    const report = checkSource("src/config/example.ts", source);

    expect(report.violations).toEqual([]);
  });
});

describe("function inputs", () => {
  it.each([
    {
      name: "three positional parameters",
      source: "export const combine = (first: string, second: string, third: string) => first + second + third;\n",
    },
    {
      name: "a rest parameter",
      source: "export const combine = (...parts: string[]) => parts.join(\"\");\n",
    },
    {
      name: "a positional boolean",
      source: "export const render = (value: string, enabled: boolean) => (enabled ? value : \"\");\n",
    },
    {
      name: "an inferred positional boolean default",
      source: "export const render = (value: string, enabled = false) => (enabled ? value : \"\");\n",
    },
  ])("rejects $name", ({ source }) => {
    const report = checkSource("src/install/example.ts", source);

    expect(report.violations).toEqual([
      {
        ruleId: "function.input-shape",
        file: "src/install/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("accepts a natural pair and a named request object", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const pair = (left: string, right: string) => left + right;\n\nexport const install = (request: InstallRequest) => request.scope;\n",
    );

    expect(report.violations).toEqual([]);
  });
});

describe("loop and indexed-access comments", () => {
  it("reports every explicit loop form without an immediately preceding intent comment", () => {
    const report = checkSource(
      "src/install/example.ts",
      [
        "export const scan = () => {",
        "  for (;;) { break; }",
        "  for (const item of items) { consume(item); }",
        "  for (const key in record) { consume(key); }",
        "  while (ready) { consume(); }",
        "  do { consume(); } while (ready);",
        "};",
        "",
      ].join("\n"),
    );

    expect(report.violations).toEqual(
      [2, 3, 4, 5, 6].map((line) => ({
        ruleId: "comment.loop-intent",
        file: "src/install/example.ts",
        line,
        message: expect.any(String),
      })),
    );
  });

  it("accepts an intent comment with no blank gap", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const scan = () => {\n  // Preserve catalog order while validating each entry.\n  for (const item of items) { consume(item); }\n};\n",
    );

    expect(report.violations).toEqual([]);
  });

  it("rejects a loop comment separated by a blank line", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const scan = () => {\n  // Preserve catalog order.\n\n  for (const item of items) { consume(item); }\n};\n",
    );

    expect(report.violations).toEqual([
      {
        ruleId: "comment.loop-intent",
        file: "src/install/example.ts",
        line: 4,
        message: expect.any(String),
      },
    ]);
  });

  it("requires proof immediately above indexed non-null access", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const pick = (items: string[], index: number) => {\n  return items[index]!;\n};\n",
    );

    expect(report.violations).toEqual([
      {
        ruleId: "comment.index-proof",
        file: "src/install/example.ts",
        line: 2,
        message: expect.any(String),
      },
    ]);
  });

  it("accepts an immediately preceding indexed-access proof", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const pick = (items: string[], index: number) => {\n  // Bounds were checked before this lookup.\n  return items[index]!;\n};\n",
    );

    expect(report.violations).toEqual([]);
  });

  it("still rejects a non-indexed non-null assertion", () => {
    const report = checkSource("src/install/example.ts", "export const required = value!;\n");

    expect(report.violations).toEqual([
      {
        ruleId: "type.no-assertion",
        file: "src/install/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });
});

describe("forbidden type declarations and directives", () => {
  it("rejects an interface outside declaration-file augmentation", () => {
    const report = checkSource("src/config/example.ts", "export interface BagConfig { debug: boolean }\n");

    expect(report.violations).toEqual([
      {
        ruleId: "type.no-interface",
        file: "src/config/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("allows interface augmentation in a declaration file", () => {
    const report = checkSource(
      "src/types/environment.d.ts",
      'declare global { interface ProcessEnv { DUFFLEBAG_HOME?: string } }\nexport {};\n',
    );

    expect(report.violations).toEqual([]);
  });

  it("rejects an enum", () => {
    const report = checkSource("src/config/example.ts", "export enum Scope { Global, Project }\n");

    expect(report.violations).toEqual([
      {
        ruleId: "type.no-enum",
        file: "src/config/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("reports authored conditional and infer machinery once", () => {
    const report = checkSource(
      "src/config/example.ts",
      "export type ElementOf<Value> = Value extends ReadonlyArray<infer Item> ? Item : Value;\n",
    );

    expect(report.violations).toEqual([
      {
        ruleId: "type.no-conditional",
        file: "src/config/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it.each(["@ts-ignore", "@ts-expect-error", "@ts-nocheck"])("rejects %s", (directive) => {
    const report = checkSource(
      "src/config/example.ts",
      `// ${directive}\nexport const value: string = input;\n`,
    );

    expect(report.violations).toEqual([
      {
        ruleId: "type.no-suppression",
        file: "src/config/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it.each([
    "// biome-ignore lint/suspicious/noExplicitAny: fixture",
    "// prettier-ignore",
    "// eslint-disable-next-line no-console",
    "/* c8 ignore next */",
    "/* istanbul ignore next */",
    "/* v8 ignore next */",
  ])("rejects tool suppression %s", (directive) => {
    const report = checkSource(
      "src/config/example.ts",
      `${directive}\nexport const value: string = input;\n`,
    );

    expect(report.violations).toEqual([
      {
        ruleId: "type.no-suppression",
        file: "src/config/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("does not inspect directive-looking string content", () => {
    const report = checkSource("src/config/example.ts", 'export const copy = "@ts-ignore";\n');

    expect(report.violations).toEqual([]);
  });
});

describe("readability structure", () => {
  it("requires a blank line between arrow-function declarations", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const first = () => 1;\nexport const second = () => 2;\n",
    );

    expect(report.violations).toEqual([
      {
        ruleId: "function.blank-line",
        file: "src/install/example.ts",
        line: 2,
        message: expect.any(String),
      },
    ]);
  });

  it("accepts a blank line between arrow-function declarations", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const first = () => 1;\n\nexport const second = () => 2;\n",
    );

    expect(report.violations).toEqual([]);
  });

  it("reports a third nesting level at its exact line", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const choose = () => {\n  if (first) {\n    if (second) {\n      if (third) { return value; }\n    }\n  }\n};\n",
    );

    expect(report.violations).toEqual([
      {
        ruleId: "function.nesting",
        file: "src/install/example.ts",
        line: 4,
        message: expect.any(String),
      },
    ]);
  });

  it("accepts two nesting levels", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const choose = () => {\n  if (first) {\n    if (second) { return value; }\n  }\n};\n",
    );

    expect(report.violations).toEqual([]);
  });

});

describe("schema-owned object types", () => {
  it("rejects an exported handwritten object type in application source", () => {
    const report = checkSource(
      "src/catalog/featureCatalog.ts",
      "export type FeatureDefinition = { id: string };\n",
    );

    expect(report.violations).toEqual([
      {
        ruleId: "type.schema-owned-runtime",
        file: "src/catalog/featureCatalog.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("accepts a type derived from an Effect Schema", () => {
    const report = checkSource(
      "src/catalog/featureCatalog.ts",
      "export type FeatureDefinition = Schema.Schema.Type<typeof featureDefinitionSchema>;\n",
    );

    expect(report.violations).toEqual([]);
  });

  it.each([
    "src/runtime/hookInput.ts",
    "src/skills/contextGuard/hooks/hookInput.ts",
    "src/skills/contextGuard/runtime/runtimeState.ts",
  ])("allows a small structural transport type in the dependency-free runtime at %s", (path) => {
    const report = checkSource(path, "export type HookInput = { sessionId: string };\n");

    expect(report.violations).toEqual([]);
  });

  it("keeps similarly named application directories inside the schema boundary", () => {
    const report = checkSource(
      "src/install/runtime/runtimeState.ts",
      "export type RuntimeState = { sessionId: string };\n",
    );

    expect(report.violations).toEqual([
      {
        ruleId: "type.schema-owned-runtime",
        file: "src/install/runtime/runtimeState.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });
});

describe("barrels, names, and paths", () => {
  it("accepts a direct wildcard barrel", () => {
    const report = checkSource("src/catalog/index.ts", 'export * from "./featureCatalog.js";\n');

    expect(report.violations).toEqual([]);
  });

  it.each([
    { name: "a selective export", source: 'export { featureCatalog } from "./featureCatalog.js";\n' },
    { name: "an aliased namespace export", source: 'export * as catalog from "./featureCatalog.js";\n' },
    { name: "logic", source: "export const catalog = [];\n" },
    { name: "a chained index export", source: 'export * from "./catalog/index.js";\n' },
  ])("rejects $name in a barrel", ({ source }) => {
    const report = checkSource("src/index.ts", source);

    expect(report.violations).toEqual([
      {
        ruleId: "barrel.direct-wildcard",
        file: "src/index.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("rejects a barrel chain hidden behind a regular module filename", () => {
    const report = checkSources({
      "src/index.ts": 'export * from "./catalog.js";\n',
      "src/catalog.ts": 'export * from "./catalog/featureCatalog.js";\n',
      "src/catalog/featureCatalog.ts": "export const featureCatalog = [];\n",
    });

    expect(report.violations).toEqual([
      {
        ruleId: "barrel.direct-wildcard",
        file: "src/index.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("rejects a vague role identifier", () => {
    const report = checkSource("src/install/example.ts", "export const artifactManager = {};\n");

    expect(report.violations).toEqual([
      {
        ruleId: "name.domain-specific",
        file: "src/install/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("accepts a domain-specific identifier", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const artifactPlan = {};\nexport const metadata = {};\n",
    );

    expect(report.violations).toEqual([]);
  });

  it.each([
    { path: "src/install/helpers.ts", ruleId: "path.no-generic-bucket" },
    { path: "src/bad-directory/example.ts", ruleId: "path.source-directory-case" },
    { path: "src/core/example.ts", ruleId: "path.capability-layout" },
  ])("reports $ruleId for $path", ({ path, ruleId }) => {
    const report = checkSource(path, "export const value = 1;\n");

    expect(report.violations).toEqual([
      {
        ruleId,
        file: path,
        line: 1,
        message: expect.any(String),
      },
    ]);
  });
});

describe("mutation, collections, runtime, and presentation", () => {
  it("rejects mutation of an input property", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const normalize = (request: Request) => {\n  request.scope = \"global\";\n  return request;\n};\n",
    );

    expect(report.violations).toEqual([
      {
        ruleId: "mutation.no-input",
        file: "src/install/example.ts",
        line: 2,
        message: expect.any(String),
      },
    ]);
  });

  it.each([
    {
      name: "a mutating method",
      source:
        'export const append = (request: { items: string[] }) => { request.items.push("next"); };\n',
    },
    {
      name: "a postfix increment",
      source: "export const increment = (request: { count: number }) => { request.count++; };\n",
    },
    {
      name: "a delete expression",
      source:
        "export const clear = (request: { cache?: string }) => { delete request.cache; };\n",
    },
    {
      name: "a destructured input binding",
      source:
        'export const append = ({ items }: { items: string[] }) => { items.push("next"); };\n',
    },
    {
      name: "an outer input captured by a nested callback",
      source:
        'export const append = (request: { items: string[] }) => Effect.sync(() => request.items.push("next"));\n',
    },
  ])("rejects input mutation through $name", ({ source }) => {
    const report = checkSource("src/install/example.ts", source);

    expect(report.violations).toEqual([
      {
        ruleId: "mutation.no-input",
        file: "src/install/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("accepts mutation of a locally owned collection", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const collect = () => {\n  const items: string[] = [];\n  items.push(\"value\");\n  return items;\n};\n",
    );

    expect(report.violations).toEqual([]);
  });

  it("accepts a locally owned collection that shadows an outer input", () => {
    const report = checkSource(
      "src/install/example.ts",
      'export const collect = (items: string[]) => Effect.sync(() => {\n  const items: string[] = [];\n  items.push("value");\n  return items;\n});\n',
    );

    expect(report.violations).toEqual([]);
  });

  it("accepts a loop binding that shadows an outer input", () => {
    const report = checkSource(
      "src/install/example.ts",
      'export const collect = (items: string[]) => {\n  // Visit each locally bound batch.\n  for (const items of batches) {\n    items.push("value");\n  }\n};\n',
    );

    expect(report.violations).toEqual([]);
  });

  it("accepts a catch binding that shadows an outer input", () => {
    const report = checkSource(
      "src/install/example.ts",
      'export const handle = (error: Error) => {\n  try {\n    run();\n  } catch (error) {\n    error.name = "handled";\n  }\n};\n',
    );

    expect(report.violations).toEqual([]);
  });

  it("rejects reduce used to build an array", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const collect = (items: string[]) => items.reduce((result, item) => [...result, item], []);\n",
    );

    expect(report.violations).toEqual([
      {
        ruleId: "collection.no-builder-reduce",
        file: "src/install/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("accepts reduce for a scalar calculation", () => {
    const report = checkSource(
      "src/install/example.ts",
      "export const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);\n",
    );

    expect(report.violations).toEqual([]);
  });

  it("rejects Promise.all in application source", () => {
    const report = checkSource("src/install/example.ts", "export const apply = () => Promise.all(tasks);\n");

    expect(report.violations).toEqual([
      {
        ruleId: "effect.no-promise-all",
        file: "src/install/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("rejects Effect.run calls outside the main runtime edge", () => {
    const report = checkSource("src/install/example.ts", "export const result = Effect.runPromise(program);\n");

    expect(report.violations).toEqual([
      {
        ruleId: "effect.runtime-edge",
        file: "src/install/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("accepts Effect.run at src/cli/main.ts", () => {
    const report = checkSource("src/cli/main.ts", "export const result = Effect.runPromise(program);\n");

    expect(report.violations).toEqual([]);
  });

  it("rejects console presentation in application source", () => {
    const report = checkSource("src/install/example.ts", 'console.log("installed");\n');

    expect(report.violations).toEqual([
      {
        ruleId: "presentation.terminal-ui",
        file: "src/install/example.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("excludes root tooling from application Effect and presentation boundaries", () => {
    const report = checkSource(
      "scripts/example.ts",
      'console.log("checking");\nexport const result = Promise.all(tasks);\nEffect.runPromise(program);\n',
    );

    expect(report.violations).toEqual([]);
  });
});

describe("application and installed-hook import graphs", () => {
  it("allows node imports plus shared and feature-local runtime imports", () => {
    const report = checkSources({
      "src/runtime/readConfig.ts": 'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n',
      "src/skills/contextGuard/hooks/contextGuard.ts":
        'import { read } from "../../../runtime/readConfig.js";\nimport { decide } from "../runtime/decide.js";\nexport const run = () => decide(read);\n',
      "src/skills/contextGuard/runtime/decide.ts": "export const decide = (value: unknown) => value;\n",
    });

    expect(report.violations).toEqual([]);
  });

  it.each([
    {
      name: "a third-party import",
      files: {
        "src/skills/contextGuard/hooks/contextGuard.ts": 'import { Effect } from "effect";\nexport const run = Effect.void;\n',
      },
      file: "src/skills/contextGuard/hooks/contextGuard.ts",
      line: 1,
    },
    {
      name: "a type-only application import",
      files: {
        "src/install/artifactPlan.ts": "export type ArtifactPlan = string;\n",
        "src/skills/contextGuard/hooks/contextGuard.ts":
          'import type { ArtifactPlan } from "../../../install/artifactPlan.js";\nexport const run = () => undefined;\n',
      },
      file: "src/skills/contextGuard/hooks/contextGuard.ts",
      line: 1,
    },
    {
      name: "an application re-export",
      files: {
        "src/install/artifactPlan.ts": "export const artifactPlan = {};\n",
        "src/skills/contextGuard/hooks/contextGuard.ts":
          'export * from "../../../install/artifactPlan.js";\n',
      },
      file: "src/skills/contextGuard/hooks/contextGuard.ts",
      line: 1,
    },
    {
      name: "a dynamic third-party import",
      files: {
        "src/skills/contextGuard/hooks/contextGuard.ts":
          'export const run = () => import("effect");\n',
      },
      file: "src/skills/contextGuard/hooks/contextGuard.ts",
      line: 1,
    },
    {
      name: "a transitive third-party import",
      files: {
        "src/skills/contextGuard/hooks/contextGuard.ts":
          'export { run } from "../runtime/bridge.js";\n',
        "src/skills/contextGuard/runtime/bridge.ts":
          'import { Effect } from "effect";\nexport const run = Effect.void;\n',
      },
      file: "src/skills/contextGuard/runtime/bridge.ts",
      line: 1,
    },
  ])("rejects $name from the hook graph", ({ files, file, line }) => {
    const report = checkSources(files);

    expect(report.violations).toEqual([
      {
        ruleId: "import.hook-runtime",
        file,
        line,
        message: expect.any(String),
      },
    ]);
  });

  it("rejects an application import of the hook runtime", () => {
    const report = checkSources({
      "src/runtime/readConfig.ts": "export const readConfig = () => ({});\n",
      "src/install/install.ts": 'import { readConfig } from "../runtime/readConfig.js";\nexport const install = readConfig;\n',
    });

    expect(report.violations).toEqual([
      {
        ruleId: "import.application-boundary",
        file: "src/install/install.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });

  it("detects a transitive application re-export into the hook runtime", () => {
    const report = checkSources({
      "src/runtime/readConfig.ts": "export const readConfig = () => ({});\n",
      "src/install/runtimeBridge.ts": 'export * from "../runtime/readConfig.js";\n',
      "src/install/install.ts": 'export * from "./runtimeBridge.js";\n',
    });

    expect(report.violations).toEqual([
      {
        ruleId: "import.application-boundary",
        file: "src/install/runtimeBridge.ts",
        line: 1,
        message: expect.any(String),
      },
    ]);
  });
});

describe("scan boundaries and protected baseline", () => {
  it("excludes dependencies, build output, and generated provider projections", () => {
    const repositoryRoot = createRepository();
    writeValidContract(repositoryRoot);
    [
      "node_modules/package/index.ts",
      "dist/src/generated.ts",
      ".agents/skills/generated.ts",
      ".cursor/rules/generated.ts",
      ".devin/instructions/generated.ts",
    ].forEach((path) => writeSource(repositoryRoot, path, "export function forbidden() {}\n"));

    expect(checkCodeStyle(repositoryRoot).violations).toEqual([]);
  });

  it("applies exactly the three approved code exemptions to assembleCut.mjs", () => {
    const report = checkSource(
      "src/skills/makeATrailer/scripts/assembleCut.mjs",
      "export function assemble(first, second, third) {\n  for (const cut of cuts) { render(cut); }\n}\n",
    );

    expect(report.violations).toEqual([]);
  });
});

describe("committed contract artifacts", () => {
  it("keep guide and machine rule IDs in a strict ordered bijection", () => {
    const repositoryRoot = join(import.meta.dirname, "..");
    const guide = readFileSync(join(repositoryRoot, "CODE-STYLE.md"), "utf8");
    const configuration = JSON.parse(
      readFileSync(join(repositoryRoot, "code-style.rules.json"), "utf8"),
    );
    const guideIds = [...guide.matchAll(/\[rule:([a-z0-9.-]+)\]/gu)].map((match) => match[1]);
    const machineIds = configuration.rules.map((rule: MachineRule) => rule.id);

    expect(guideIds).toEqual(machineIds);
    expect(new Set(guideIds).size).toBe(guideIds.length);
    expect(
      configuration.rules.every(
        (rule: MachineRule) =>
          Object.keys(rule).sort().join(",") === "enforcement,id,summary" && rule.summary.length > 0,
      ),
    ).toBe(true);
  });

  it("makes FeatureDefinition schema-first with property-owned descriptions and checks", () => {
    const guide = readFileSync(join(import.meta.dirname, "..", "CODE-STYLE.md"), "utf8");

    expect(guide).toContain("export const featureDefinitionSchema = Schema.Struct({");
    expect(guide).toContain("id: Schema.NonEmptyTrimmedString.pipe(");
    expect(guide).toContain("sourceDirectory: Schema.NonEmptyTrimmedString.pipe(");
    expect(guide).toContain("Schema.Schema.Type<typeof featureDefinitionSchema>");
    expect(guide).toContain('description: "Stable public feature ID."');
    expect(guide).toContain("Schema.pattern(");
    expect(guide).not.toMatch(/interface\s+Feature(?:Definition)?\b/u);
    expect(guide).not.toMatch(/type\s+FeatureDefinition\s*=\s*\{/u);
  });
});
