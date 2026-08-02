import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkStyleGuide, type StyleGuideRule } from "./checkStyleGuide.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SAMPLE_RULES: ReadonlyArray<StyleGuideRule> = [
  {
    id: "function.arrow-only",
    statement: "Named functions are arrow constants declared before first use.",
    verify: "pnpm style",
  },
  {
    id: "function.one-job",
    statement: "A function performs one job its name fully describes.",
    verify: "judgment",
  },
];

const card = (request: { id: string; verify: string; assertion: string }) =>
  [
    `### ${request.id}`,
    `[rule:${request.id}] · verify: ${request.verify}`,
    "",
    request.assertion,
    "",
    "```ts",
    "// ✓ good",
    "const value = 1;",
    "",
    "// ✗ bad",
    "var value = 1;",
    "```",
    "",
    "Why: one reason.",
  ].join("\n");

const guideWith = (cards: ReadonlyArray<string>) =>
  [
    "# Style",
    "",
    "## Rules",
    "",
    ...cards,
    "",
    "## Canonical example",
    "",
    "## Golden path — adding a feature",
    "",
    "## Exemplars",
    "",
    "## Never",
    "",
  ].join("\n");

const validCards = [
  card({
    id: "function.arrow-only",
    verify: "`pnpm style`",
    assertion: "Named functions are arrow constants declared before first use.",
  }),
  card({
    id: "function.one-job",
    verify: "judgment",
    assertion: "A function performs one job its name fully describes.",
  }),
];

const messagesFor = (guide: string) =>
  checkStyleGuide({ guide, rules: SAMPLE_RULES }).map((violation) => violation.message);

describe("the repository style guide", () => {
  it("matches the rule-card format", () => {
    const guide = readFileSync(join(repositoryRoot, "CODE-STYLE.md"), "utf8");
    const parsed: unknown = JSON.parse(readFileSync(join(repositoryRoot, "code-style.rules.json"), "utf8"));
    const rules = Reflect.get(Object(parsed), "rules");

    expect(checkStyleGuide({ guide, rules })).toEqual([]);
  });
});

describe("rule-card format", () => {
  it("accepts a conforming guide", () => {
    expect(checkStyleGuide({ guide: guideWith(validCards), rules: SAMPLE_RULES })).toEqual([]);
  });

  it("requires every listed section", () => {
    const guide = guideWith(validCards).replace("## Never\n", "");

    expect(messagesFor(guide)).toContain('CODE-STYLE.md needs a "## Never" section.');
  });

  it("requires a metadata line under each card heading", () => {
    const guide = guideWith(validCards).replace("[rule:function.arrow-only] · verify: `pnpm style`\n", "");

    expect(messagesFor(guide).join("\n")).toMatch(/needs a metadata line/u);
  });

  it("rejects an assertion that runs to a second sentence", () => {
    const guide = guideWith([
      card({
        id: "function.arrow-only",
        verify: "`pnpm style`",
        assertion: "Named functions are arrow constants. Declare them before first use.",
      }),
      validCards.at(1) || "",
    ]);

    expect(messagesFor(guide).join("\n")).toMatch(/exactly one sentence/u);
  });

  it("rejects an assertion missing its period", () => {
    const guide = guideWith([
      card({
        id: "function.arrow-only",
        verify: "`pnpm style`",
        assertion: "Named functions are arrow constants declared before first use",
      }),
      validCards.at(1) || "",
    ]);

    expect(messagesFor(guide).join("\n")).toMatch(/exactly one sentence/u);
  });

  it("rejects an assertion that drifts from the machine statement", () => {
    const guide = guideWith([
      card({
        id: "function.arrow-only",
        verify: "`pnpm style`",
        assertion: "Named functions are arrow constants declared before use.",
      }),
      validCards.at(1) || "",
    ]);

    expect(messagesFor(guide)).toContain(
      "Rule function.arrow-only assertion does not match its code-style.rules.json statement.",
    );
  });

  it("rejects a verify command that drifts from the machine entry", () => {
    const guide = guideWith(validCards).replace(
      "[rule:function.arrow-only] · verify: `pnpm style`",
      "[rule:function.arrow-only] · verify: `pnpm lint`",
    );

    expect(messagesFor(guide)).toContain(
      'Rule function.arrow-only documents verify "pnpm lint" but code-style.rules.json records "pnpm style".',
    );
  });

  it.each([
    { name: "the chosen case", marker: "// ✓ good", expected: 'Rule function.arrow-only example needs a "// ✓" case.' },
    {
      name: "the rejected case",
      marker: "// ✗ bad",
      expected: 'Rule function.arrow-only example needs a "// ✗" case.',
    },
  ])("requires $name in the example", ({ marker, expected }) => {
    const guide = guideWith(validCards).replace(`${marker}\n`, "");

    expect(messagesFor(guide)).toContain(expected);
  });

  it("requires a Why line", () => {
    const guide = guideWith(validCards).replace("Why: one reason.\n", "");

    expect(messagesFor(guide)).toContain('Rule function.arrow-only needs a "Why:" line.');
  });

  it("requires a fenced example", () => {
    const guide = guideWith([
      [
        "### function.arrow-only",
        "[rule:function.arrow-only] · verify: `pnpm style`",
        "",
        "Named functions are arrow constants declared before first use.",
        "",
        "Why: one reason.",
      ].join("\n"),
      validCards.at(1) || "",
    ]);

    expect(messagesFor(guide)).toContain("Rule function.arrow-only needs a fenced example block.");
  });

  it("reports a machine rule with no card", () => {
    const guide = guideWith([validCards.at(0) || ""]);

    expect(messagesFor(guide)).toContain(
      "Rule function.one-job is in code-style.rules.json but has no card in CODE-STYLE.md.",
    );
  });

  it("reports a duplicated card", () => {
    const guide = guideWith([...validCards, validCards.at(0) || ""]);

    expect(messagesFor(guide)).toContain("Rule function.arrow-only has more than one card in CODE-STYLE.md.");
  });

  it("reports a card whose ID has no machine entry", () => {
    const guide = guideWith([
      ...validCards,
      card({ id: "function.invented", verify: "judgment", assertion: "Something asserted." }),
    ]);

    expect(messagesFor(guide)).toContain("Rule function.invented has no entry in code-style.rules.json.");
  });

  it("accepts an existing snake_case ID rather than forcing a rename", () => {
    const rules: ReadonlyArray<StyleGuideRule> = [
      { id: "python.no_lambda", statement: "Something asserted.", verify: "judgment" },
    ];
    const guide = guideWith([card({ id: "python.no_lambda", verify: "judgment", assertion: "Something asserted." })]);

    expect(checkStyleGuide({ guide, rules })).toEqual([]);
  });

  it("ignores headings that appear inside example code", () => {
    const guide = guideWith(validCards).replace("// ✓ good", "// ✓ good\n### not a card\n## not a section");

    expect(checkStyleGuide({ guide, rules: SAMPLE_RULES })).toEqual([]);
  });
});
