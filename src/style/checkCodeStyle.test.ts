import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkCodeStyle, validateCodeStyleMetadata } from "./checkCodeStyle.js";

type FixtureRule = {
  id: string;
  applicability: string;
  summary: string;
  rationale: string;
  goodExample: string;
  badExample: string;
  enforcement: Array<string>;
  autofix?: boolean;
};

type FixtureProtectedPath = {
  path: string;
  committedSha256: string;
  overlaySha256: string;
};

type FixtureException = {
  ruleId: string;
  path: string;
  state: string;
  maxViolations: number;
  reason: string;
  exitCondition: string;
};

type FixtureConfiguration = {
  rules: Array<FixtureRule>;
  protectedPaths: Array<FixtureProtectedPath>;
  exceptions: Array<FixtureException>;
};

type AutomaticChannelFixture = {
  ruleId: string;
  channel: "regex" | "ast" | "path" | "importGraph";
  files: Readonly<Record<string, string>>;
};

type SourceFixtureRequest = {
  repositoryRoot: string;
  path: string;
  source: string;
};

type ContractFixtureRequest = {
  repositoryRoot: string;
  state?: "committed" | "overlay";
  includeProtectedFiles?: boolean;
};

const ROOT = join(import.meta.dirname, "../..");
const PROTECTED_PATHS = [
  "src/skills/make-a-trailer/SKILL.md",
  "src/skills/make-a-trailer/reference/pipeline.md",
  "src/skills/make-a-trailer/scripts/assembleCut.mjs",
];

const committedProtectedContent = ["# committed skill\n", "# committed pipeline\n", "export const assemble = () => undefined;\n"];

const overlayAssembleCut = [
  "export function task01(first, second, third) {",
  "  while (pending) { break; }",
  "}",
  "",
  "export function task02(first, second, third) {",
  "  for (;;) { break; }",
  "}",
  "",
  "export function task03(first, second, third) { return first; }",
  "",
  "export function task04(first, second, third) { return first; }",
  "",
  "export function task05(first, second, third) { return first; }",
  "",
  "export function task06() { return undefined; }",
  "",
  "export function task07() { return undefined; }",
  "",
  "export function task08() { return undefined; }",
  "",
  "export function task09() { return undefined; }",
  "",
  "export function task10() { return undefined; }",
  "",
  "export function task11() { return undefined; }",
  "",
  "export function task12() { return undefined; }",
  "",
  "export function task13() { return undefined; }",
  "",
].join("\n");

const overlayProtectedContent = ["# overlay skill\n", "# overlay pipeline\n", overlayAssembleCut];
const semanticOverlayAssembleCut = `${overlayAssembleCut}
export const chooseFallback = (value, fallback) => {
  if (value === null) return fallback;
  else if (fallback === null) return value;
  else if ((value ?? null) === fallback) return value;
  return undefined;
};
`;
const temporaryRepositories = new Set<string>();

const automaticChannelFixtures: ReadonlyArray<AutomaticChannelFixture> = [
  {
    ruleId: "path.capability-layout",
    channel: "path",
    files: { "src/core/example.ts": "export const value = 1;\n" },
  },
  {
    ruleId: "path.no-generic-bucket",
    channel: "path",
    files: { "src/catalog/helpers.ts": "export const value = 1;\n" },
  },
  {
    ruleId: "path.authored-file-name",
    channel: "path",
    files: { "src/catalog/order.repository.ts": "export const value = 1;\n" },
  },
  {
    ruleId: "architecture.no-cycle",
    channel: "importGraph",
    files: {
      "src/catalog/featureCatalog.ts": 'import { config } from "../config/configFile.js";\nexport const features = config;\n',
      "src/config/configFile.ts": 'import { features } from "../catalog/featureCatalog.js";\nexport const config = features;\n',
    },
  },
  {
    ruleId: "function.arrow-only",
    channel: "ast",
    files: { "src/catalog/example.ts": "export function loadCatalog() {}\n" },
  },
  {
    ruleId: "function.effect-generator",
    channel: "ast",
    files: { "src/catalog/example.ts": "export const generator = function* named() { yield value; };\n" },
  },
  {
    ruleId: "function.input-shape",
    channel: "ast",
    files: { "src/catalog/example.ts": "export const load = (one: string, two: string, three: string) => one;\n" },
  },
  {
    ruleId: "function.no-pointless-extraction",
    channel: "ast",
    files: { "src/catalog/example.ts": "const getName = (item: Item) => item.name;\nexport const title = getName(item);\n" },
  },
  {
    ruleId: "function.blank-line",
    channel: "ast",
    files: { "src/catalog/example.ts": "export const first = () => 1;\nexport const second = () => 2;\n" },
  },
  {
    ruleId: "function.nesting",
    channel: "ast",
    files: {
      "src/catalog/example.ts": "export const choose = () => { if (first) { if (second) { if (third) return value; } } };\n",
    },
  },
  {
    ruleId: "class.tagged-error-only",
    channel: "ast",
    files: { "src/catalog/example.ts": "export class CatalogManager {}\n" },
  },
  {
    ruleId: "comment.loop-intent",
    channel: "ast",
    files: { "src/catalog/example.ts": "export const retry = () => { while (pending) attempt(); };\n" },
  },
  {
    ruleId: "comment.index-proof",
    channel: "ast",
    files: { "src/catalog/example.ts": "export const at = (items: string[], index: number) => items[index];\n" },
  },
  {
    ruleId: "comment.pipeline-contract",
    channel: "ast",
    files: {
      "src/catalog/example.ts":
        "export const run = Effect.gen(function* () { const a = yield* first; const b = yield* second(a); return yield* third(b); });\n",
    },
  },
  {
    ruleId: "documentation.signal-tsdoc",
    channel: "ast",
    files: { "src/catalog/example.ts": "/** Gets the value. */\nexport const getValue = () => value;\n" },
  },
  {
    ruleId: "type.schema-owned-runtime",
    channel: "ast",
    files: { "src/catalog/example.ts": "export type Feature = { id: string };\n" },
  },
  {
    ruleId: "type.interface-cases",
    channel: "ast",
    files: { "src/catalog/example.ts": "export interface Feature { id: string }\n" },
  },
  {
    ruleId: "type.no-enum",
    channel: "ast",
    files: { "src/catalog/example.ts": "export enum Scope { Global, Project }\n" },
  },
  {
    ruleId: "type.no-conditional",
    channel: "ast",
    files: { "src/catalog/example.ts": "export type Item<T> = T extends Array<infer U> ? U : T;\n" },
  },
  {
    ruleId: "type.no-assertion",
    channel: "ast",
    files: { "src/catalog/example.ts": "export const value = input as string;\n" },
  },
  {
    ruleId: "type.no-suppression",
    channel: "regex",
    files: { "src/catalog/example.ts": "// @ts-expect-error\nexport const value: string = input;\n" },
  },
  {
    ruleId: "type.absence-boundary",
    channel: "ast",
    files: { "src/catalog/example.ts": "export type MaybeName = string | null | undefined;\n" },
  },
  {
    ruleId: "export.named-only",
    channel: "ast",
    files: { "src/catalog/example.ts": "export default value;\n" },
  },
  {
    ruleId: "export.no-internal-barrel",
    channel: "ast",
    files: { "src/catalog/index.ts": 'export { value } from "./value.js";\n' },
  },
  {
    ruleId: "name.domain-specific",
    channel: "ast",
    files: { "src/catalog/example.ts": "export const catalogManager = {};\n" },
  },
  {
    ruleId: "mutation.no-input",
    channel: "ast",
    files: { "src/catalog/example.ts": "export const append = (items: string[]) => { items.push(value); };\n" },
  },
  {
    ruleId: "collection.no-builder-reduce",
    channel: "ast",
    files: { "src/catalog/example.ts": "export const collect = (items: string[]) => items.reduce((out, item) => [...out, item], []);\n" },
  },
  {
    ruleId: "effect.composition-depth",
    channel: "ast",
    files: {
      "src/catalog/example.ts": "export const run = () => source.pipe(Effect.flatMap(decode), Effect.flatMap(persist));\n",
    },
  },
  {
    ruleId: "effect.no-promise-all",
    channel: "ast",
    files: { "src/catalog/example.ts": "export const all = () => Promise.all(tasks);\n" },
  },
  {
    ruleId: "effect.runtime-edge",
    channel: "ast",
    files: { "src/catalog/example.ts": "export const result = Effect.runPromise(program);\n" },
  },
  {
    ruleId: "import.hook-runtime",
    channel: "importGraph",
    files: {
      "src/skills/contextGuard/hooks/contextGuard.ts": 'import { Effect } from "effect";\nexport const run = Effect.void;\n',
    },
  },
  {
    ruleId: "import.application-boundary",
    channel: "importGraph",
    files: {
      "src/runtime/readConfig.ts": "export const readConfig = () => ({});\n",
      "src/install/install.ts": 'import { readConfig } from "../runtime/readConfig.js";\nexport const install = readConfig;\n',
    },
  },
  {
    ruleId: "presentation.terminal-ui",
    channel: "ast",
    files: { "src/catalog/example.ts": 'export const report = () => console.log("done");\n' },
  },
  {
    ruleId: "script.thin-entrypoint",
    channel: "ast",
    files: {
      "scripts/build.ts": "const build = () => { inspect(); validate(); stage(); publish(); summarize(); };\nbuild();\n",
    },
  },
  {
    ruleId: "import.application-no-scripts",
    channel: "importGraph",
    files: {
      "scripts/build.ts": "export const build = () => undefined;\n",
      "src/build/buildPackage.ts": 'import { build } from "../../scripts/build.js";\nexport const buildPackage = build;\n',
    },
  },
  {
    ruleId: "adapter.external-sdk-confinement",
    channel: "importGraph",
    files: { "src/publish/publish.ts": 'import Stripe from "stripe";\nexport const publish = Stripe;\n' },
  },
];

const isRecord = (value: unknown): value is object => typeof value === "object" && value !== null && !Array.isArray(value);

const stringProperty = (value: object, property: string): string => {
  const candidate = Reflect.get(value, property);
  if (typeof candidate !== "string") {
    throw new Error(`Fixture ${property} must be a string.`);
  }
  return candidate;
};

const stringArrayProperty = (value: object, property: string): Array<string> => {
  const candidate = Reflect.get(value, property);
  if (!Array.isArray(candidate) || !candidate.every((entry) => typeof entry === "string")) {
    throw new Error(`Fixture ${property} must be a string array.`);
  }
  return candidate.filter((entry): entry is string => typeof entry === "string");
};

const parseRule = (value: unknown): FixtureRule => {
  if (!isRecord(value)) {
    throw new Error("Fixture rule must be an object.");
  }
  const autofix = Reflect.get(value, "autofix");
  return {
    id: stringProperty(value, "id"),
    applicability: stringProperty(value, "applicability"),
    summary: stringProperty(value, "summary"),
    rationale: stringProperty(value, "rationale"),
    goodExample: stringProperty(value, "goodExample"),
    badExample: stringProperty(value, "badExample"),
    enforcement: stringArrayProperty(value, "enforcement"),
    ...(typeof autofix === "boolean" ? { autofix } : {}),
  };
};

const parseProtectedPath = (value: unknown): FixtureProtectedPath => {
  if (!isRecord(value)) {
    throw new Error("Fixture protected path must be an object.");
  }
  return {
    path: stringProperty(value, "path"),
    committedSha256: stringProperty(value, "committedSha256"),
    overlaySha256: stringProperty(value, "overlaySha256"),
  };
};

const parseException = (value: unknown): FixtureException => {
  if (!isRecord(value)) {
    throw new Error("Fixture exception must be an object.");
  }
  const maximum = Reflect.get(value, "maxViolations");
  if (typeof maximum !== "number") {
    throw new Error("Fixture maxViolations must be a number.");
  }
  return {
    ruleId: stringProperty(value, "ruleId"),
    path: stringProperty(value, "path"),
    state: stringProperty(value, "state"),
    maxViolations: maximum,
    reason: stringProperty(value, "reason"),
    exitCondition: stringProperty(value, "exitCondition"),
  };
};

const arrayProperty = (value: object, property: string): Array<unknown> => {
  const candidate = Reflect.get(value, property);
  if (!Array.isArray(candidate)) {
    throw new Error(`Fixture ${property} must be an array.`);
  }
  return candidate;
};

const parseConfiguration = (value: unknown): FixtureConfiguration => {
  if (!isRecord(value)) {
    throw new Error("Fixture configuration must be an object.");
  }
  return {
    rules: arrayProperty(value, "rules").map(parseRule),
    protectedPaths: arrayProperty(value, "protectedPaths").map(parseProtectedPath),
    exceptions: arrayProperty(value, "exceptions").map(parseException),
  };
};

const rootConfiguration = (): FixtureConfiguration =>
  parseConfiguration(JSON.parse(readFileSync(join(ROOT, "code-style.rules.json"), "utf8")));

const cloneConfiguration = (configuration: FixtureConfiguration): FixtureConfiguration => ({
  rules: configuration.rules.map((rule) => ({ ...rule, enforcement: [...rule.enforcement] })),
  protectedPaths: configuration.protectedPaths.map((entry) => ({ ...entry })),
  exceptions: configuration.exceptions.map((entry) => ({ ...entry })),
});

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

const createRepository = (): string => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "dufflebag-style-"));
  temporaryRepositories.add(repositoryRoot);
  return repositoryRoot;
};

const writeSource = ({ repositoryRoot, path, source }: SourceFixtureRequest): void => {
  const file = join(repositoryRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
};

const fixtureConfiguration = (): FixtureConfiguration => {
  const configuration = cloneConfiguration(rootConfiguration());
  const protectedPaths = configuration.protectedPaths.map((entry, index) => {
    const committed = committedProtectedContent.at(index);
    const overlay = overlayProtectedContent.at(index);
    if (committed === undefined || overlay === undefined) {
      throw new Error("Protected fixture content is incomplete.");
    }
    return {
      ...entry,
      committedSha256: sha256(committed),
      overlaySha256: sha256(overlay),
    };
  });
  return { ...configuration, protectedPaths };
};

const writeConfiguration = (repositoryRoot: string, configuration: FixtureConfiguration): void => {
  writeFileSync(join(repositoryRoot, "code-style.rules.json"), `${JSON.stringify(configuration, null, 2)}\n`);
};

const writeGuide = (repositoryRoot: string, configuration: FixtureConfiguration): void => {
  const guide = configuration.rules.map((rule) => `## Fixture [rule:${rule.id}]`).join("\n\n");
  writeFileSync(join(repositoryRoot, "CODE-STYLE.md"), `${guide}\n`);
};

const writeContract = ({
  repositoryRoot,
  state = "committed",
  includeProtectedFiles = true,
}: ContractFixtureRequest): FixtureConfiguration => {
  const configuration = fixtureConfiguration();
  writeGuide(repositoryRoot, configuration);
  writeConfiguration(repositoryRoot, configuration);
  if (includeProtectedFiles) {
    const contents = state === "committed" ? committedProtectedContent : overlayProtectedContent;
    PROTECTED_PATHS.forEach((path, index) => {
      const content = contents.at(index);
      if (content === undefined) {
        throw new Error("Protected fixture content is incomplete.");
      }
      writeSource({ repositoryRoot, path, source: content });
    });
  }
  return configuration;
};

const rewriteConfiguration = (repositoryRoot: string, update: (configuration: FixtureConfiguration) => void): void => {
  const configuration = parseConfiguration(JSON.parse(readFileSync(join(repositoryRoot, "code-style.rules.json"), "utf8")));
  update(configuration);
  writeConfiguration(repositoryRoot, configuration);
};

const writeOverlayAssemble = (repositoryRoot: string, source: string): void => {
  const assemblePath = PROTECTED_PATHS.at(2);
  if (!assemblePath) {
    throw new Error("Missing protected assemble fixture path.");
  }
  writeSource({ repositoryRoot, path: assemblePath, source });
  rewriteConfiguration(repositoryRoot, (configuration) => {
    const assembleConfiguration = configuration.protectedPaths.at(2);
    if (!assembleConfiguration) {
      throw new Error("Missing protected assemble fixture metadata.");
    }
    assembleConfiguration.overlaySha256 = sha256(source);
  });
};

const checkSource = (path: string, source: string) => {
  const repositoryRoot = createRepository();
  writeContract({ repositoryRoot });
  writeSource({ repositoryRoot, path, source });
  return checkCodeStyle(repositoryRoot);
};

const checkSources = (files: Readonly<Record<string, string>>) => {
  const repositoryRoot = createRepository();
  writeContract({ repositoryRoot });
  Object.entries(files).forEach(([path, source]) => {
    writeSource({ repositoryRoot, path, source });
  });
  return checkCodeStyle(repositoryRoot);
};

const violationsFor = (report: ReturnType<typeof checkCodeStyle>, ruleId: string) =>
  report.violations.filter((violation) => violation.ruleId === ruleId);

const ruleNamed = (configuration: FixtureConfiguration, ruleId: string): FixtureRule => {
  const rule = configuration.rules.find((candidate) => candidate.id === ruleId);
  if (!rule) {
    throw new Error(`Missing fixture rule ${ruleId}.`);
  }
  return rule;
};

const exceptionNamed = (configuration: FixtureConfiguration, ruleId: string): FixtureException => {
  const exception = configuration.exceptions.find((candidate) => candidate.ruleId === ruleId);
  if (!exception) {
    throw new Error(`Missing fixture exception ${ruleId}.`);
  }
  return exception;
};

afterEach(() => {
  temporaryRepositories.forEach((repositoryRoot) => {
    rmSync(repositoryRoot, { recursive: true, force: true });
  });
  temporaryRepositories.clear();
});

describe("machine contract metadata", () => {
  it("keeps a complete ordered human and machine bijection", () => {
    const metadata = validateCodeStyleMetadata(ROOT);
    const configuration = rootConfiguration();
    const guide = readFileSync(join(ROOT, "CODE-STYLE.md"), "utf8");
    const guideIds = [...guide.matchAll(/\[rule:([a-z0-9.-]+)\]/gu)].flatMap((match) => (match[1] ? [match[1]] : []));

    expect(guideIds).toEqual(configuration.rules.map((rule) => rule.id));
    expect(new Set(guideIds).size).toBe(guideIds.length);
    expect(metadata.ruleCount).toBe(configuration.rules.length);
    expect(
      configuration.rules.every(
        (rule) =>
          rule.applicability.length > 0 &&
          rule.summary.length > 0 &&
          rule.rationale.length > 0 &&
          rule.goodExample.length > 0 &&
          rule.badExample.length > 0 &&
          rule.enforcement.length > 0,
      ),
    ).toBe(true);
  });

  it("includes the approved const-default and public-error-boundary identities", () => {
    const configuration = rootConfiguration();
    const guide = readFileSync(join(ROOT, "CODE-STYLE.md"), "utf8");

    expect(ruleNamed(configuration, "binding.const-default").enforcement).toEqual(["linter"]);
    expect(ruleNamed(configuration, "error.public-boundary").enforcement).toEqual(["test", "manual"]);
    expect(ruleNamed(configuration, "effect.runtime-edge").goodExample).toBe(
      "NodeRuntime.runMain(program.pipe(Effect.provide(NodeContext.layer))) in src/cli/main.ts",
    );
    expect(guide).toContain("Preserve the original defect cause");
    expect(guide).toContain("NodeRuntime.runMain(program.pipe(Effect.provide(NodeContext.layer)))");
  });

  it("pins the three approved committed and overlay hashes plus only the 13/5/2 exceptions", () => {
    const configuration = rootConfiguration();
    expect(configuration.protectedPaths).toEqual([
      {
        path: "src/skills/make-a-trailer/SKILL.md",
        committedSha256: "5f9c3f49658d976168d4c6dfaea9f636bb3cf7cb219011486c4949e33b17a1e6",
        overlaySha256: "5bf0ec33ac92acd73b816f8c61c422c49f518f3cfcc5763986a8108d451cc297",
      },
      {
        path: "src/skills/make-a-trailer/reference/pipeline.md",
        committedSha256: "10f5da547d792f7ca2067621082e08cdbf5826070c612c3e248c4276cdd01c73",
        overlaySha256: "3bb89d856d28995c50fba23aca6a6a1af1fe56f10d67546a0515fe0d276f1669",
      },
      {
        path: "src/skills/make-a-trailer/scripts/assembleCut.mjs",
        committedSha256: "d6f05101b3fdbcd966696a7e4b144f1eca082744b7262d0b82ff32f6fea2b2a5",
        overlaySha256: "6dceccae4b1f49bc7b64b89bd164882c29e57142ef9193d0208ccc1f9d2291ad",
      },
    ]);
    expect(
      configuration.exceptions.map((entry) => ({
        ruleId: entry.ruleId,
        path: entry.path,
        state: entry.state,
        maxViolations: entry.maxViolations,
      })),
    ).toEqual([
      {
        ruleId: "function.arrow-only",
        path: "src/skills/make-a-trailer/scripts/assembleCut.mjs",
        state: "protected-overlay",
        maxViolations: 13,
      },
      {
        ruleId: "function.input-shape",
        path: "src/skills/make-a-trailer/scripts/assembleCut.mjs",
        state: "protected-overlay",
        maxViolations: 5,
      },
      {
        ruleId: "comment.loop-intent",
        path: "src/skills/make-a-trailer/scripts/assembleCut.mjs",
        state: "protected-overlay",
        maxViolations: 2,
      },
    ]);
  });

  it("accepts only the approved enforcement vocabulary and safe autofix channels", () => {
    const repositoryRoot = createRepository();
    const configuration = writeContract({ repositoryRoot });
    const approved = new Set(["formatter", "linter", "regex", "ast", "path", "importGraph", "typecheck", "test", "manual"]);

    expect(configuration.rules.flatMap((rule) => rule.enforcement).every((entry) => approved.has(entry))).toBe(true);
    expect(
      configuration.rules
        .filter((rule) => rule.autofix)
        .every((rule) => rule.enforcement.every((entry) => entry === "formatter" || entry === "linter")),
    ).toBe(true);

    ruleNamed(configuration, "function.arrow-only").autofix = true;
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/autofix/u);
  });

  it("fails for a missing field, invalid channel, duplicate ID, or guide mismatch", () => {
    const repositoryRoot = createRepository();
    const configuration = writeContract({ repositoryRoot });
    ruleNamed(configuration, "function.arrow-only").rationale = "";
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/rationale/u);

    ruleNamed(configuration, "function.arrow-only").rationale = "Readable declaration order.";
    ruleNamed(configuration, "function.arrow-only").enforcement = ["biome"];
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/enforcement/u);

    ruleNamed(configuration, "function.arrow-only").enforcement = ["ast"];
    const firstRule = configuration.rules.at(0);
    if (!firstRule) {
      throw new Error("Missing first fixture rule.");
    }
    configuration.rules.push({ ...firstRule, enforcement: ["path"] });
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/exactly once|unique/u);

    configuration.rules.pop();
    writeConfiguration(repositoryRoot, configuration);
    writeFileSync(join(repositoryRoot, "CODE-STYLE.md"), "# no rule IDs\n");
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/exactly once/u);
  });

  it("enumerates manual rules instead of claiming automatic proof", () => {
    const repositoryRoot = createRepository();
    const configuration = writeContract({ repositoryRoot });
    const report = checkCodeStyle(repositoryRoot);
    const expected = configuration.rules.filter((rule) => rule.enforcement.includes("manual")).map((rule) => rule.id);

    expect(report.manualReviewRuleIds).toEqual(expected);
    expect(report.manualReviewRuleIds).toContain("architecture.no-wrapper-layer");
  });

  it.each([
    {
      channel: "ast",
      ruleId: "function.arrow-only",
      path: "src/catalog/example.ts",
      source: "export function loadCatalog() {}\n",
    },
    {
      channel: "regex",
      ruleId: "type.no-suppression",
      path: "src/catalog/example.ts",
      source: "// @ts-expect-error\nexport const value: string = input;\n",
    },
    {
      channel: "path",
      ruleId: "path.no-generic-bucket",
      path: "src/catalog/helpers.ts",
      source: "export const value = 1;\n",
    },
    {
      channel: "importGraph",
      ruleId: "import.hook-runtime",
      path: "src/skills/contextGuard/hooks/contextGuard.ts",
      source: 'import { Effect } from "effect";\nexport const run = Effect.void;\n',
    },
  ])("runs the $channel detector only through its declared channel", ({ ruleId, path, source }) => {
    const repositoryRoot = createRepository();
    writeContract({ repositoryRoot });
    writeSource({ repositoryRoot, path, source });
    rewriteConfiguration(repositoryRoot, (configuration) => {
      ruleNamed(configuration, ruleId).enforcement = ["manual"];
    });

    expect(violationsFor(checkCodeStyle(repositoryRoot), ruleId)).toEqual([]);
  });

  it("has a positive dispatch fixture for every declared automatic custom channel", () => {
    const declared = rootConfiguration().rules.flatMap((rule) =>
      rule.enforcement
        .filter((channel) => channel === "regex" || channel === "ast" || channel === "path" || channel === "importGraph")
        .map((channel) => `${rule.id}:${channel}`),
    );
    const covered = automaticChannelFixtures.map((fixture) => `${fixture.ruleId}:${fixture.channel}`);
    expect([...covered].sort()).toEqual([...declared].sort());

    automaticChannelFixtures.forEach((fixture) => {
      const repositoryRoot = createRepository();
      writeContract({ repositoryRoot });
      Object.entries(fixture.files).forEach(([path, source]) => {
        writeSource({ repositoryRoot, path, source });
      });
      rewriteConfiguration(repositoryRoot, (configuration) => {
        ruleNamed(configuration, fixture.ruleId).enforcement = [fixture.channel];
      });

      expect(violationsFor(checkCodeStyle(repositoryRoot), fixture.ruleId), `${fixture.ruleId}:${fixture.channel}`).not.toEqual([]);
    });
  });
});

describe("protected states and overlay ratchets", () => {
  it("reports exactly three independent committed states", () => {
    const repositoryRoot = createRepository();
    writeContract({ repositoryRoot });

    expect(checkCodeStyle(repositoryRoot).protectedStates).toEqual(
      PROTECTED_PATHS.map((path, index) => ({
        path,
        state: "protected-committed",
        sha256: sha256(committedProtectedContent.at(index) ?? ""),
      })),
    );
  });

  it("accepts the exact overlay hashes and equal 13/5/2 raw counts", () => {
    const repositoryRoot = createRepository();
    writeContract({ repositoryRoot, state: "overlay" });
    const report = checkCodeStyle(repositoryRoot);

    expect(report.protectedStates.every((entry) => entry.state === "protected-overlay")).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it("keeps JavaScript null checks and else-if chains out of overlay violations", () => {
    const repositoryRoot = createRepository();
    writeContract({ repositoryRoot, state: "overlay" });
    writeOverlayAssemble(repositoryRoot, semanticOverlayAssembleCut);
    const report = checkCodeStyle(repositoryRoot);

    expect(report.protectedStates.every((entry) => entry.state === "protected-overlay")).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it.each([
    {
      name: "function count below",
      source: overlayAssembleCut.replace("export function task13() { return undefined; }", "export const task13 = () => undefined;"),
      expected: /function\.arrow-only requires exactly 13 violations, found 12/u,
    },
    {
      name: "function count above",
      source: `${overlayAssembleCut}export function task14() { return undefined; }\n`,
      expected: /function\.arrow-only requires exactly 13 violations, found 14/u,
    },
    {
      name: "input count below",
      source: overlayAssembleCut.replace(
        "export function task05(first, second, third) { return first; }",
        "export function task05() { return undefined; }",
      ),
      expected: /function\.input-shape requires exactly 5 violations, found 4/u,
    },
    {
      name: "input count above",
      source: overlayAssembleCut.replace(
        "export function task06() { return undefined; }",
        "export function task06(first, second, third) { return first; }",
      ),
      expected: /function\.input-shape requires exactly 5 violations, found 6/u,
    },
    {
      name: "loop count zero",
      source: overlayAssembleCut
        .replace("  while (pending) { break; }", "  // Retry until the queue is empty.\n  while (pending) { break; }")
        .replace("  for (;;) { break; }", "  // Stop after the first durable write.\n  for (;;) { break; }"),
      expected: /comment\.loop-intent requires exactly 2 violations, found 0/u,
    },
    {
      name: "loop count below",
      source: overlayAssembleCut.replace(
        "  while (pending) { break; }",
        "  // Retry until the queue is empty.\n  while (pending) { break; }",
      ),
      expected: /comment\.loop-intent requires exactly 2 violations, found 1/u,
    },
    {
      name: "loop count above",
      source: overlayAssembleCut.replace(
        "export function task03(first, second, third) { return first; }",
        "export function task03(first, second, third) { while (extra) { break; } return first; }",
      ),
      expected: /comment\.loop-intent requires exactly 2 violations, found 3/u,
    },
  ])("rejects $name before applying an overlay exception", ({ source, expected }) => {
    const repositoryRoot = createRepository();
    writeContract({ repositoryRoot, state: "overlay" });
    writeOverlayAssemble(repositoryRoot, source);
    expect(() => checkCodeStyle(repositoryRoot)).toThrow(expected);
  });

  it("skips overlay-only counts for exact committed bytes", () => {
    const repositoryRoot = createRepository();
    writeContract({ repositoryRoot });
    expect(checkCodeStyle(repositoryRoot).violations).toEqual([]);
  });

  it("fails closed for mixed, missing, or third-hash protected bytes", () => {
    const mixedRoot = createRepository();
    writeContract({ repositoryRoot: mixedRoot });
    writeSource({
      repositoryRoot: mixedRoot,
      path: PROTECTED_PATHS[0] ?? "",
      source: overlayProtectedContent[0] ?? "",
    });
    expect(() => checkCodeStyle(mixedRoot)).toThrow(/mix/u);

    const missingRoot = createRepository();
    writeContract({ repositoryRoot: missingRoot });
    unlinkSync(join(missingRoot, PROTECTED_PATHS[1] ?? ""));
    expect(() => checkCodeStyle(missingRoot)).toThrow(/missing/u);

    const unknownRoot = createRepository();
    writeContract({ repositoryRoot: unknownRoot });
    writeSource({ repositoryRoot: unknownRoot, path: PROTECTED_PATHS[2] ?? "", source: "third state\n" });
    expect(() => checkCodeStyle(unknownRoot)).toThrow(/unknown content hash/u);
  });

  it("fails for wildcard, missing, or fourth protected metadata", () => {
    const repositoryRoot = createRepository();
    const configuration = writeContract({ repositoryRoot });
    configuration.protectedPaths[2] = {
      ...(configuration.protectedPaths.at(2) ?? configuration.protectedPaths[0]),
      path: "src/skills/make-a-trailer/**",
    };
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/exact paths|wildcard/u);

    configuration.protectedPaths = configuration.protectedPaths.slice(0, 2);
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/three approved/u);

    configuration.protectedPaths.push({
      path: "src/legacy.ts",
      committedSha256: "a".repeat(64),
      overlaySha256: "b".repeat(64),
    });
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/three approved/u);
  });

  it("fails for malformed or non-independent hashes", () => {
    const repositoryRoot = createRepository();
    const configuration = writeContract({ repositoryRoot });
    const first = configuration.protectedPaths.at(0);
    if (!first) {
      throw new Error("Missing fixture protected path.");
    }
    first.committedSha256 = "not-a-hash";
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/SHA-256/u);

    first.committedSha256 = first.overlaySha256;
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/independent/u);
  });

  it.each([0, 12, 14])("fails a function ratchet changed to %i", (maximum) => {
    const repositoryRoot = createRepository();
    const configuration = writeContract({ repositoryRoot });
    exceptionNamed(configuration, "function.arrow-only").maxViolations = maximum;
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/approved nonzero maximum/u);
  });

  it("fails unknown, extra, broad, or incomplete exception metadata", () => {
    const repositoryRoot = createRepository();
    const configuration = writeContract({ repositoryRoot });
    exceptionNamed(configuration, "function.arrow-only").ruleId = "unknown.rule";
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/unknown rule/u);

    exceptionNamed(configuration, "unknown.rule").ruleId = "function.arrow-only";
    const firstException = configuration.exceptions.at(0);
    if (!firstException) {
      throw new Error("Missing first fixture exception.");
    }
    configuration.exceptions.push({ ...firstException });
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/exactly the three/u);

    configuration.exceptions.pop();
    exceptionNamed(configuration, "function.arrow-only").path = "src/skills/make-a-trailer/**";
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/exact protected/u);

    exceptionNamed(configuration, "function.arrow-only").path = PROTECTED_PATHS[2] ?? "";
    exceptionNamed(configuration, "function.arrow-only").exitCondition = "";
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/exitCondition/u);

    exceptionNamed(configuration, "function.arrow-only").exitCondition = "Owner review removes it.";
    exceptionNamed(configuration, "function.arrow-only").reason = "";
    writeConfiguration(repositoryRoot, configuration);
    expect(() => validateCodeStyleMetadata(repositoryRoot)).toThrow(/reason/u);
  });

  it("validates metadata in a subprocess without reading protected bytes", () => {
    const repositoryRoot = createRepository();
    writeContract({ repositoryRoot, state: "committed", includeProtectedFiles: false });
    const result = spawnSync(
      "pnpm",
      ["tsx", join(ROOT, "scripts/checkCodeStyle.ts"), "--validate-rules", "--repository-root", repositoryRoot],
      { cwd: ROOT, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Validated \d+ rules, 3 protected paths, and 3 exceptions/u);
    expect(result.stderr).toBe("");

    rewriteConfiguration(repositoryRoot, (configuration) => {
      ruleNamed(configuration, "function.arrow-only").summary = "";
    });
    const invalidResult = spawnSync(
      "pnpm",
      ["tsx", join(ROOT, "scripts/checkCodeStyle.ts"), "--validate-rules", "--repository-root", repositoryRoot],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(invalidResult.status).toBe(1);
    expect(invalidResult.stderr).toMatch(/summary must be a non-empty string/u);
  });
});

describe("function and class forms", () => {
  it("reports a named declaration at the exact line", () => {
    const report = checkSource("src/catalog/example.ts", "\nexport function loadCatalog() {}\n");
    expect(violationsFor(report, "function.arrow-only")).toEqual([
      { ruleId: "function.arrow-only", file: "src/catalog/example.ts", line: 2, message: expect.any(String) },
    ]);
  });

  it("accepts arrow constants and a genuine variadic rest input", () => {
    const report = checkSource("src/catalog/example.ts", 'export const joinIds = (...ids: string[]) => ids.join("-");\n');
    expect(violationsFor(report, "function.arrow-only")).toEqual([]);
    expect(violationsFor(report, "function.input-shape")).toEqual([]);
  });

  it.each([
    ["a function expression", "export const load = function () { return value; };\n"],
    ["an object method", "export const loader = { load() { return value; } };\n"],
  ])("rejects %s as a named function form", (_name, source) => {
    expect(violationsFor(checkSource("src/catalog/example.ts", source), "function.arrow-only")).toHaveLength(1);
  });

  it("allows only an anonymous generator directly passed to Effect.gen", () => {
    const good = checkSource("src/install/example.ts", "export const load = Effect.gen(function* () { return yield* program; });\n");
    const bad = checkSource("src/install/example.ts", "export const generator = function* named() { return yield* program; };\n");
    expect(violationsFor(good, "function.effect-generator")).toEqual([]);
    expect(violationsFor(bad, "function.effect-generator")).toHaveLength(1);
  });

  it("allows only Schema.TaggedError classes", () => {
    const good = checkSource(
      "src/config/configError.ts",
      'export class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {}) {}\n',
    );
    const bad = checkSource("src/config/configManager.ts", "export class ConfigManager {}\n");
    expect(violationsFor(good, "class.tagged-error-only")).toEqual([]);
    expect(violationsFor(bad, "class.tagged-error-only")).toHaveLength(1);
  });

  it("rejects three raw inputs and positional booleans", () => {
    const three = checkSource("src/install/example.ts", "export const install = (root: string, feature: string, mode: string) => root;\n");
    const flag = checkSource("src/install/example.ts", "export const install = (root: string, force: boolean) => root;\n");
    expect(violationsFor(three, "function.input-shape")).toHaveLength(1);
    expect(violationsFor(flag, "function.input-shape")).toHaveLength(1);
  });

  it("detects a private one-use property accessor but not an exported concept", () => {
    const bad = checkSource("src/catalog/example.ts", "const getName = (item: Item) => item.name;\nexport const title = getName(item);\n");
    const good = checkSource("src/catalog/example.ts", "export const featureId = (feature: Feature) => feature.id;\n");
    expect(violationsFor(bad, "function.no-pointless-extraction")).toHaveLength(1);
    expect(violationsFor(good, "function.no-pointless-extraction")).toEqual([]);
  });

  it("enforces blank lines and no third nesting level", () => {
    const spacing = checkSource("src/install/example.ts", "export const first = () => 1;\nexport const second = () => 2;\n");
    const nesting = checkSource(
      "src/install/example.ts",
      "export const choose = () => {\n  if (first) {\n    if (second) {\n      if (third) return value;\n    }\n  }\n};\n",
    );
    expect(violationsFor(spacing, "function.blank-line")).toHaveLength(1);
    expect(violationsFor(nesting, "function.nesting")).toHaveLength(1);
  });
});

describe("comments and signal documentation", () => {
  it("accepts a self-evident loop without a ceremonial comment", () => {
    const report = checkSource(
      "src/catalog/example.ts",
      "export const printAll = () => {\n  for (const item of items) {\n    print(item);\n  }\n};\n",
    );
    expect(violationsFor(report, "comment.loop-intent")).toEqual([]);
  });

  it("requires an immediate intent comment for a non-obvious loop", () => {
    const bad = checkSource("src/install/example.ts", "export const retry = () => {\n  while (pending) { attempt(); }\n};\n");
    const good = checkSource(
      "src/install/example.ts",
      "export const retry = () => {\n  // Stop as soon as the receipt becomes durable.\n  while (pending) { attempt(); }\n};\n",
    );
    expect(violationsFor(bad, "comment.loop-intent")).toHaveLength(1);
    expect(violationsFor(good, "comment.loop-intent")).toEqual([]);
  });

  it("requires an indexed-access proof without allowing an assertion", () => {
    const bad = checkSource("src/catalog/example.ts", "export const at = (items: string[], index: number) => items[index];\n");
    const asserted = checkSource(
      "src/catalog/example.ts",
      "export const at = (items: string[], index: number) => {\n  // The guard proves the index exists.\n  return items[index]!;\n};\n",
    );
    expect(violationsFor(bad, "comment.index-proof")).toHaveLength(1);
    expect(violationsFor(asserted, "comment.index-proof")).toEqual([]);
    expect(violationsFor(asserted, "type.no-assertion")).toHaveLength(1);
  });

  it("accepts indexed reads bounded by their classic loop and dynamic assignment targets", () => {
    const report = checkSource(
      "src/catalog/example.ts",
      "export const parsePairs = (argv: string[]) => {\n  const out: Record<string, string> = {};\n  // Walk the already validated key-value pairs in order.\n  for (let i = 0; i < argv.length; i += 2) out[argv[i]] = argv[i + 1];\n  return out;\n};\n",
    );
    expect(violationsFor(report, "comment.index-proof")).toEqual([]);
  });

  it("requires a contract and numbered phases for a real ordered pipeline", () => {
    const bad = checkSource(
      "src/install/example.ts",
      "export const apply = Effect.gen(function* () {\n  const a = yield* inspect;\n  const b = yield* stage(a);\n  return yield* commit(b);\n});\n",
    );
    const good = checkSource(
      "src/install/example.ts",
      "// Apply a validated plan in order and commit ownership last.\nexport const apply = Effect.gen(function* () {\n  // 1. Inspect without writing.\n  const a = yield* inspect;\n  // 2. Stage every destination.\n  const b = yield* stage(a);\n  // 3. Commit and record ownership.\n  return yield* commit(b);\n});\n",
    );
    expect(violationsFor(bad, "comment.pipeline-contract")).toHaveLength(1);
    expect(violationsFor(good, "comment.pipeline-contract")).toEqual([]);
  });

  it("rejects ceremonial TSDoc and accepts a caller-relevant invariant", () => {
    const bad = checkSource(
      "src/install/example.ts",
      "/** Gets the name. @param item The item. @returns The result. */\nexport const getName = (item: Item) => item.name;\n",
    );
    const good = checkSource(
      "src/install/example.ts",
      "/** Deletes only destinations proven owned by the persisted receipt. */\nexport const uninstall = (receipt: Receipt) => program;\n",
    );
    expect(violationsFor(bad, "documentation.signal-tsdoc")).toHaveLength(1);
    expect(violationsFor(good, "documentation.signal-tsdoc")).toEqual([]);
  });
});

describe("schema, interfaces, assertions, and absence", () => {
  it("rejects exported handwritten runtime objects and accepts schema-derived types", () => {
    const bad = checkSource("src/catalog/featureCatalog.ts", "export type FeatureDefinition = { id: string };\n");
    const good = checkSource(
      "src/catalog/featureCatalog.ts",
      "export type FeatureDefinition = Schema.Schema.Type<typeof featureDefinitionSchema>;\n",
    );
    expect(violationsFor(bad, "type.schema-owned-runtime")).toHaveLength(1);
    expect(violationsFor(good, "type.schema-owned-runtime")).toEqual([]);
  });

  it("allows declaration augmentation and an earned feature adapter port only", () => {
    const declaration = checkSource(
      "src/types/environment.d.ts",
      "declare global { interface ProcessEnv { DUFFLEBAG_HOME?: string } }\nexport {};\n",
    );
    const port = checkSource(
      "src/publish/adapters/githubPort.ts",
      "export interface GitHubPort { create(input: unknown): unknown; update(input: unknown): unknown; }\n",
    );
    const runtime = checkSource("src/catalog/example.ts", "export interface Feature { id: string }\n");
    const fakePort = checkSource(
      "src/publish/adapters/githubPort.ts",
      "export interface GitHubPort { create(input: unknown): unknown; }\n",
    );
    expect(violationsFor(declaration, "type.interface-cases")).toEqual([]);
    expect(violationsFor(port, "type.interface-cases")).toEqual([]);
    expect(violationsFor(runtime, "type.interface-cases")).toHaveLength(1);
    expect(violationsFor(fakePort, "type.interface-cases")).toHaveLength(1);
  });

  it("rejects enums, conditional types, assertions, and lexical suppressions", () => {
    expect(violationsFor(checkSource("src/config/scope.ts", "export enum Scope { Global, Project }\n"), "type.no-enum")).toHaveLength(1);
    expect(
      violationsFor(checkSource("src/config/item.ts", "export type Item<T> = T extends Array<infer U> ? U : T;\n"), "type.no-conditional"),
    ).toHaveLength(1);
    expect(violationsFor(checkSource("src/config/value.ts", "export const value = input as string;\n"), "type.no-assertion")).toHaveLength(
      1,
    );
    expect(
      violationsFor(
        checkSource("src/config/value.ts", "// @ts-expect-error\nexport const value: string = input;\n"),
        "type.no-suppression",
      ),
    ).toHaveLength(1);
    expect(violationsFor(checkSource("src/config/value.ts", 'export const copy = "@ts-expect-error";\n'), "type.no-suppression")).toEqual(
      [],
    );
  });

  it("uses type structure for automatic absence checks and leaves expression boundaries for review", () => {
    const applicationNull = checkSource("src/config/example.ts", "export const missing = null;\n");
    const javascriptNullCheck = checkSource("src/config/example.mjs", "export const isMissing = (value) => value === null;\n");
    const protocolNull = checkSource("src/publish/adapters/githubClient.ts", "export const missing = null;\n");
    const mixed = checkSource("src/config/example.ts", "export type MaybeName = string | null | undefined;\n");
    expect(violationsFor(applicationNull, "type.absence-boundary")).toEqual([]);
    expect(violationsFor(javascriptNullCheck, "type.absence-boundary")).toEqual([]);
    expect(violationsFor(protocolNull, "type.absence-boundary")).toEqual([]);
    expect(violationsFor(mixed, "type.absence-boundary")).toHaveLength(1);
  });
});

describe("exports, paths, and names", () => {
  it("rejects default exports, every export star, and internal index barrels", () => {
    expect(violationsFor(checkSource("src/catalog/example.ts", "export default value;\n"), "export.named-only")).toHaveLength(1);
    expect(
      violationsFor(checkSource("src/index.ts", 'export * from "./catalog/featureCatalog.js";\n'), "export.no-internal-barrel"),
    ).toHaveLength(1);
    expect(
      violationsFor(
        checkSource("src/catalog/index.ts", 'export { featureCatalog } from "./featureCatalog.js";\n'),
        "export.no-internal-barrel",
      ),
    ).toHaveLength(1);
    expect(
      violationsFor(
        checkSource("src/index.ts", 'export { featureCatalog } from "./catalog/featureCatalog.js";\n'),
        "export.no-internal-barrel",
      ),
    ).toEqual([]);
  });

  it.each([
    ["namespace export star", 'export * as catalog from "./featureCatalog.js";\n'],
    ["named re-export-only internal barrel", 'export { featureCatalog } from "./featureCatalog.js";\n'],
  ])("rejects a %s", (_case, source) => {
    const report = checkSource("src/catalog/catalogApi.ts", source);

    expect(violationsFor(report, "export.no-internal-barrel")).toHaveLength(1);
  });

  it("allows an explicit named re-export at the real public package boundary", () => {
    const report = checkSource("src/index.ts", 'export { featureCatalog } from "./catalog/featureCatalog.js";\n');

    expect(violationsFor(report, "export.no-internal-barrel")).toEqual([]);
  });

  it.each([
    ["src/install/helpers.ts", "path.no-generic-bucket"],
    ["src/install/order.repository.ts", "path.authored-file-name"],
    ["src/install/orderRepositoryRepository.ts", "path.authored-file-name"],
    ["src/bad-directory/example.ts", "path.authored-file-name"],
    ["src/core/example.ts", "path.capability-layout"],
  ])("reports %s through %s", (path, ruleId) => {
    expect(violationsFor(checkSource(path, "export const value = 1;\n"), ruleId)).toHaveLength(1);
  });

  it("accepts camelCase files, PascalCase components, and standard test suffixes", () => {
    const report = checkSources({
      "src/install/orderStore.ts": "export const orderStore = {};\n",
      "src/ui/OrderCard.tsx": "export const OrderCard = () => <article />;\n",
      "src/install/orderStore.test.ts": "export const fixture = {};\n",
    });
    expect(violationsFor(report, "path.authored-file-name")).toEqual([]);
  });

  it("rejects vague role names", () => {
    const report = checkSource("src/install/example.ts", "export const artifactManager = {};\n");
    expect(violationsFor(report, "name.domain-specific")).toHaveLength(1);
  });
});

describe("mutation, collections, and Effect composition", () => {
  it("rejects input mutation while accepting locally owned mutation and shadowing", () => {
    const bad = checkSource("src/install/example.ts", 'export const append = (request: Request) => { request.items.push("next"); };\n');
    const local = checkSource(
      "src/install/example.ts",
      'export const collect = () => { const items: string[] = []; items.push("next"); return items; };\n',
    );
    const shadowed = checkSource(
      "src/install/example.ts",
      'export const collect = (items: string[]) => Effect.sync(() => { const items: string[] = []; items.push("next"); });\n',
    );
    expect(violationsFor(bad, "mutation.no-input")).toHaveLength(1);
    expect(violationsFor(local, "mutation.no-input")).toEqual([]);
    expect(violationsFor(shadowed, "mutation.no-input")).toEqual([]);
  });

  it("rejects builder reduce and accepts scalar reduce", () => {
    const bad = checkSource(
      "src/install/example.ts",
      "export const collect = (items: string[]) => items.reduce((result, item) => [...result, item], []);\n",
    );
    const good = checkSource(
      "src/install/example.ts",
      "export const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);\n",
    );
    expect(violationsFor(bad, "collection.no-builder-reduce")).toHaveLength(1);
    expect(violationsFor(good, "collection.no-builder-reduce")).toEqual([]);
  });

  it("allows one flatMap and rejects a second dependent flatMap", () => {
    const one = checkSource("src/install/example.ts", "export const load = () => source.pipe(Effect.flatMap(decode));\n");
    const two = checkSource(
      "src/install/example.ts",
      "export const load = () => source.pipe(Effect.flatMap(decode), Effect.flatMap(persist));\n",
    );
    expect(violationsFor(one, "effect.composition-depth")).toEqual([]);
    expect(violationsFor(two, "effect.composition-depth")).toHaveLength(1);
  });

  it("keeps Promise.all, Effect.run, and console outside application capabilities", () => {
    expect(
      violationsFor(checkSource("src/install/example.ts", "export const all = () => Promise.all(tasks);\n"), "effect.no-promise-all"),
    ).toHaveLength(1);
    expect(
      violationsFor(checkSource("src/install/example.ts", "export const result = Effect.runPromise(program);\n"), "effect.runtime-edge"),
    ).toHaveLength(1);
    expect(violationsFor(checkSource("src/install/example.ts", 'console.log("done");\n'), "presentation.terminal-ui")).toHaveLength(1);
    expect(
      violationsFor(checkSource("src/cli/main.ts", "export const result = Effect.runPromise(program);\n"), "effect.runtime-edge"),
    ).toHaveLength(1);
  });

  it("keeps NodeRuntime.runMain and NodeContext.layer out of application capabilities", () => {
    const runOutsideMain = checkSource("src/install/example.ts", "export const result = NodeRuntime.runMain(program);\n");
    const layerOutsideMain = checkSource(
      "src/install/example.ts",
      "export const result = program.pipe(Effect.provide(NodeContext.layer));\n",
    );

    expect(violationsFor(runOutsideMain, "effect.runtime-edge")).toHaveLength(1);
    expect(violationsFor(layerOutsideMain, "effect.runtime-edge")).toHaveLength(1);
  });

  it.each([
    ["wrong NodeRuntime.runMain shape", "NodeRuntime.runMain(program);\n"],
    [
      "duplicate exact edges",
      [
        "NodeRuntime.runMain(program.pipe(Effect.provide(NodeContext.layer)));",
        "NodeRuntime.runMain(secondProgram.pipe(Effect.provide(NodeContext.layer)));",
        "",
      ].join("\n"),
    ],
    ["Effect.runPromise-only edge", "Effect.runPromise(program);\n"],
    [
      "additional Effect.runPromise runner",
      ["NodeRuntime.runMain(program.pipe(Effect.provide(NodeContext.layer)));", "Effect.runPromise(secondProgram);", ""].join("\n"),
    ],
  ])("rejects a main with %s", (_case, source) => {
    const report = checkSource("src/cli/main.ts", source);

    expect(violationsFor(report, "effect.runtime-edge")).toHaveLength(1);
  });

  it("accepts one exact Node runtime and context edge at the CLI main", () => {
    const report = checkSource("src/cli/main.ts", "NodeRuntime.runMain(program.pipe(Effect.provide(NodeContext.layer)));\n");

    expect(violationsFor(report, "effect.runtime-edge")).toEqual([]);
  });

  it("allows the png-to-code harness to own its independent exact runtime graph", () => {
    const report = checkSources({
      "src/cli/main.ts": "NodeRuntime.runMain(program.pipe(Effect.provide(NodeContext.layer)));\n",
      "src/skills/png-to-code/scripts/main.ts": "NodeRuntime.runMain(harness.pipe(Effect.provide(NodeContext.layer)));\n",
    });

    expect(violationsFor(report, "effect.runtime-edge")).toEqual([]);
  });
});

describe("import graph and executable boundaries", () => {
  it("allows only node, shared transport, and feature-local imports in hooks", () => {
    const good = checkSources({
      "src/runtime/readConfig.ts": "export const readConfig = () => ({});\n",
      "src/skills/contextGuard/runtime/decide.ts": "export const decide = (value: unknown) => value;\n",
      "src/skills/contextGuard/hooks/contextGuard.ts":
        'import { readConfig } from "../../../runtime/readConfig.js";\nimport { decide } from "../runtime/decide.js";\nexport const run = () => decide(readConfig());\n',
    });
    const bad = checkSource(
      "src/skills/contextGuard/hooks/contextGuard.ts",
      'import { Effect } from "effect";\nexport const run = Effect.void;\n',
    );
    expect(violationsFor(good, "import.hook-runtime")).toEqual([]);
    expect(violationsFor(bad, "import.hook-runtime")).toHaveLength(1);
  });

  it("rejects application imports of hook runtime and root scripts", () => {
    const hooks = checkSources({
      "src/runtime/readConfig.ts": "export const readConfig = () => ({});\n",
      "src/install/install.ts": 'import { readConfig } from "../runtime/readConfig.js";\nexport const install = readConfig;\n',
    });
    const scripts = checkSources({
      "scripts/build.ts": "export const build = () => undefined;\n",
      "src/install/install.ts": 'import { build } from "../../scripts/build.js";\nexport const install = build;\n',
    });
    expect(violationsFor(hooks, "import.application-boundary")).toHaveLength(1);
    expect(violationsFor(scripts, "import.application-no-scripts")).toHaveLength(1);
  });

  it.each(["src/build/buildPackage.ts", "src/style/styleOwner.ts"])("rejects a scripts import from every authored owner at %s", (path) => {
    const report = checkSources({
      "scripts/build.ts": "export const build = () => undefined;\n",
      [path]: 'import { build } from "../../scripts/build.js";\nexport const owner = build;\n',
    });
    expect(violationsFor(report, "import.application-no-scripts")).toHaveLength(1);
  });

  it("detects an internal relative import cycle", () => {
    const report = checkSources({
      "src/catalog/featureCatalog.ts": 'import { config } from "../config/configFile.js";\nexport const features = config;\n',
      "src/config/configFile.ts": 'import { features } from "../catalog/featureCatalog.js";\nexport const config = features;\n',
    });
    expect(violationsFor(report, "architecture.no-cycle")).toHaveLength(1);
  });

  it("confines provider SDK imports to feature-owned adapters", () => {
    const bad = checkSource("src/publish/publish.ts", 'import Stripe from "stripe";\nexport const publish = Stripe;\n');
    const good = checkSource("src/publish/adapters/stripeClient.ts", 'import Stripe from "stripe";\nexport const stripeClient = Stripe;\n');
    expect(violationsFor(bad, "adapter.external-sdk-confinement")).toHaveLength(1);
    expect(violationsFor(good, "adapter.external-sdk-confinement")).toEqual([]);
  });

  it("detects a substantive root script and accepts a thin entrypoint", () => {
    const bad = checkSource(
      "scripts/badScript.ts",
      'import { readFileSync } from "node:fs";\nexport const inspect = () => readFileSync("file");\n',
    );
    const good = checkSource(
      "scripts/goodScript.ts",
      'import { run } from "../src/build/run.js";\nconst result = run(process.argv.slice(2));\nconsole.log(result);\n',
    );
    expect(violationsFor(bad, "script.thin-entrypoint")).toHaveLength(1);
    expect(violationsFor(good, "script.thin-entrypoint")).toEqual([]);
  });

  it("rejects one large local script arrow and an imported owner that is never delegated to", () => {
    const localArrow = checkSource(
      "scripts/localScript.ts",
      "const run = () => { inspect(); validate(); stage(); publish(); summarize(); };\nrun();\n",
    );
    const unusedOwner = checkSources({
      "src/build/run.ts": "export const run = () => undefined;\n",
      "scripts/unusedOwner.ts":
        'import { run } from "../src/build/run.js";\nconst execute = () => { inspect(); validate(); stage(); publish(); summarize(); };\nexecute();\n',
    });

    expect(violationsFor(localArrow, "script.thin-entrypoint")).toHaveLength(1);
    expect(violationsFor(unusedOwner, "script.thin-entrypoint")).toHaveLength(1);
  });

  it("rejects a four-step local engine even when the script also delegates to an imported owner", () => {
    const report = checkSources({
      "src/build/run.ts": "export const run = () => undefined;\n",
      "scripts/localEngine.ts": [
        'import { run } from "../src/build/run.js";',
        "const execute = () => {",
        "  inspect();",
        "  validate();",
        "  stage();",
        "  publish();",
        "};",
        "execute();",
        "run();",
        "",
      ].join("\n"),
    });

    expect(violationsFor(report, "script.thin-entrypoint")).toHaveLength(1);
  });
});

describe("scan boundaries and committed artifacts", () => {
  it("keeps the real Task 2 contract implementation automatically self-compliant", () => {
    const repositoryRoot = createRepository();
    [
      "CODE-STYLE.md",
      "code-style.rules.json",
      "scripts/checkCodeStyle.ts",
      "src/style/checkCodeStyle.ts",
      "src/style/checkCodeStyle.test.ts",
      ...PROTECTED_PATHS,
    ].forEach((path) => {
      writeSource({ repositoryRoot, path, source: readFileSync(join(ROOT, path), "utf8") });
    });

    expect(checkCodeStyle(repositoryRoot).violations).toEqual([]);
  });

  it("excludes dependencies, build output, and generated provider projections", () => {
    const repositoryRoot = createRepository();
    writeContract({ repositoryRoot });
    [
      "node_modules/package/index.ts",
      "dist/src/generated.ts",
      ".agents/skills/generated.ts",
      ".cursor/rules/generated.ts",
      ".devin/instructions/generated.ts",
    ].forEach((path) => {
      writeSource({ repositoryRoot, path, source: "export function forbidden() {}\n" });
    });
    expect(checkCodeStyle(repositoryRoot).violations).toEqual([]);
  });

  it("shows the approved executable FeatureDefinition Schema pattern", () => {
    const guide = readFileSync(join(ROOT, "CODE-STYLE.md"), "utf8");
    expect(guide).toContain("export const featureDefinitionSchema = Schema.Struct({");
    expect(guide).toContain("id: featureIdSchema.annotations({");
    expect(guide).toContain("sourceDirectory: sourceDirectorySchema.annotations({");
    expect(guide).toContain("Schema.Schema.Type<typeof featureDefinitionSchema>");
    expect(guide).toContain('description: "Stable public feature ID."');
    expect(guide).not.toMatch(/interface\s+Feature(?:Definition)?\b/u);
    expect(guide).not.toMatch(/type\s+FeatureDefinition\s*=\s*\{/u);
    expect(guide).not.toContain("export * from");
  });
});
