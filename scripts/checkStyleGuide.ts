export type StyleGuideRule = {
  id: string;
  statement: string;
  verify: string;
};

export type StyleGuideViolation = {
  ruleId: string;
  line: number;
  message: string;
};

type CheckStyleGuideRequest = {
  guide: string;
  rules: ReadonlyArray<StyleGuideRule>;
};

type SectionHeading = {
  title: string;
  line: number;
};

type CardRange = {
  heading: string;
  headingLine: number;
  start: number;
  end: number;
};

type ValidateCardRequest = {
  lines: ReadonlyArray<string>;
  card: CardRange;
  rulesById: ReadonlyMap<string, StyleGuideRule>;
};

const REQUIRED_SECTIONS = ["Rules", "Canonical example", "Golden path", "Exemplars", "Never"];

// e.g. "[rule:function.arrow-only] · verify: `pnpm style`" or "… · verify: judgment"
const METADATA_PATTERN = /^\[rule:([a-z][a-z0-9]*(?:[.-][a-z0-9]+)*)\] · verify: (?:`([^`]+)`|judgment)$/u;

const FORMAT_RULE = "format.rule-card";

const sectionHeadings = (lines: ReadonlyArray<string>): ReadonlyArray<SectionHeading> =>
  lines
    .map((text, index) => ({ text, index }))
    .filter((entry) => entry.text.startsWith("## "))
    .map((entry) => ({ title: entry.text.slice(3).trim(), line: entry.index + 1 }));

const fencedLineNumbers = (lines: ReadonlyArray<string>): ReadonlySet<number> => {
  const fenced = new Set<number>();
  let inside = false;

  // Track fence state so headings inside example code are never read as structure.
  for (const [index, text] of lines.entries()) {
    if (text.startsWith("```")) {
      inside = !inside;
      fenced.add(index);
      continue;
    }

    if (inside) {
      fenced.add(index);
    }
  }

  return fenced;
};

const rulesSectionRange = (request: { lines: ReadonlyArray<string>; fenced: ReadonlySet<number> }) => {
  const start = request.lines.findIndex((text, index) => text.trim() === "## Rules" && !request.fenced.has(index));
  if (start < 0) {
    return undefined;
  }

  const nextSection = request.lines.findIndex(
    (text, index) => index > start && text.startsWith("## ") && !request.fenced.has(index),
  );

  return { start, end: nextSection < 0 ? request.lines.length : nextSection };
};

const ruleCardRanges = (request: {
  lines: ReadonlyArray<string>;
  fenced: ReadonlySet<number>;
  section: { start: number; end: number };
}): ReadonlyArray<CardRange> => {
  const headingIndexes = request.lines
    .map((text, index) => ({ text, index }))
    .filter(
      (entry) =>
        entry.index > request.section.start &&
        entry.index < request.section.end &&
        entry.text.startsWith("### ") &&
        !request.fenced.has(entry.index),
    )
    .map((entry) => entry.index);

  return headingIndexes.map((headingIndex, position) => ({
    heading: request.lines[headingIndex]?.slice(4).trim() ?? "",
    headingLine: headingIndex + 1,
    start: headingIndex,
    end: headingIndexes[position + 1] ?? request.section.end,
  }));
};

const firstContentIndex = (request: { lines: ReadonlyArray<string>; from: number; to: number }) => {
  for (let index = request.from; index < request.to; index += 1) {
    if ((request.lines[index] ?? "").trim().length > 0) {
      return index;
    }
  }

  return -1;
};

const codeBlockText = (request: { lines: ReadonlyArray<string>; from: number; to: number }) => {
  const open = request.lines.findIndex(
    (text, index) => index >= request.from && index < request.to && text.startsWith("```"),
  );
  if (open < 0) {
    return undefined;
  }

  const close = request.lines.findIndex((text, index) => index > open && index < request.to && text.startsWith("```"));
  if (close < 0) {
    return undefined;
  }

  return { text: request.lines.slice(open + 1, close).join("\n"), close };
};

const isSingleSentence = (assertion: string): boolean =>
  assertion.endsWith(".") && !assertion.includes(". ") && !/^[-*#|>`]/u.test(assertion);

const validateCard = (request: ValidateCardRequest): ReadonlyArray<StyleGuideViolation> => {
  const { lines, card, rulesById } = request;
  const metadataIndex = firstContentIndex({ lines, from: card.start + 1, to: card.end });
  const metadata = lines[metadataIndex]?.trim() ?? "";
  const match = METADATA_PATTERN.exec(metadata);
  if (!match) {
    return [
      {
        ruleId: FORMAT_RULE,
        line: card.headingLine,
        message: `Card "${card.heading}" needs a metadata line "[rule:<id>] · verify: \`<command>\`" or "… · verify: judgment".`,
      },
    ];
  }

  const id = match[1] ?? "";
  const verify = match[2] ?? "judgment";
  const rule = rulesById.get(id);
  const violations: Array<StyleGuideViolation> = [];
  if (!rule) {
    violations.push({
      ruleId: FORMAT_RULE,
      line: metadataIndex + 1,
      message: `Rule ${id} has no entry in code-style.rules.json.`,
    });
  }

  if (rule && rule.verify !== verify) {
    violations.push({
      ruleId: id,
      line: metadataIndex + 1,
      message: `Rule ${id} documents verify "${verify}" but code-style.rules.json records "${rule.verify}".`,
    });
  }

  const assertionIndex = firstContentIndex({ lines, from: metadataIndex + 1, to: card.end });
  const assertion = lines[assertionIndex]?.trim() ?? "";
  if (assertionIndex < 0 || assertion.startsWith("```")) {
    return [
      ...violations,
      {
        ruleId: id,
        line: card.headingLine,
        message: `Rule ${id} needs one assertion sentence between its metadata line and its example.`,
      },
    ];
  }

  if (!isSingleSentence(assertion)) {
    violations.push({
      ruleId: id,
      line: assertionIndex + 1,
      message: `Rule ${id} must state exactly one sentence ending in a period; split a second sentence into its own rule.`,
    });
  }

  if (rule && rule.statement !== assertion) {
    violations.push({
      ruleId: id,
      line: assertionIndex + 1,
      message: `Rule ${id} assertion does not match its code-style.rules.json statement.`,
    });
  }

  const block = codeBlockText({ lines, from: assertionIndex + 1, to: card.end });
  if (!block) {
    violations.push({
      ruleId: id,
      line: assertionIndex + 1,
      message: `Rule ${id} needs a fenced example block.`,
    });

    return violations;
  }

  if (!block.text.includes("// ✓")) {
    violations.push({ ruleId: id, line: block.close + 1, message: `Rule ${id} example needs a "// ✓" case.` });
  }

  if (!block.text.includes("// ✗")) {
    violations.push({ ruleId: id, line: block.close + 1, message: `Rule ${id} example needs a "// ✗" case.` });
  }

  const hasWhy = lines.slice(block.close + 1, card.end).some((text) => text.trim().startsWith("Why:"));
  if (!hasWhy) {
    violations.push({ ruleId: id, line: block.close + 1, message: `Rule ${id} needs a "Why:" line.` });
  }

  return violations;
};

const missingSectionViolations = (headings: ReadonlyArray<SectionHeading>): ReadonlyArray<StyleGuideViolation> =>
  REQUIRED_SECTIONS.filter((section) => !headings.some((heading) => heading.title.startsWith(section))).map(
    (section) => ({
      ruleId: FORMAT_RULE,
      line: 1,
      message: `CODE-STYLE.md needs a "## ${section}" section.`,
    }),
  );

const parityViolations = (request: {
  cards: ReadonlyArray<CardRange>;
  documentedIds: ReadonlyArray<string>;
  rules: ReadonlyArray<StyleGuideRule>;
}): ReadonlyArray<StyleGuideViolation> => {
  const counts = new Map<string, number>();

  // Count documented cards per ID so a duplicated card is reported, not silently merged.
  for (const id of request.documentedIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const duplicated = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => ({
      ruleId: FORMAT_RULE,
      line: 1,
      message: `Rule ${id} has more than one card in CODE-STYLE.md.`,
    }));

  const undocumented = request.rules
    .filter((rule) => !counts.has(rule.id))
    .map((rule) => ({
      ruleId: FORMAT_RULE,
      line: 1,
      message: `Rule ${rule.id} is in code-style.rules.json but has no card in CODE-STYLE.md.`,
    }));

  return [...duplicated, ...undocumented];
};

export const checkStyleGuide = (request: CheckStyleGuideRequest): ReadonlyArray<StyleGuideViolation> => {
  const lines = request.guide.split("\n");
  const fenced = fencedLineNumbers(lines);
  const headings = sectionHeadings(lines).filter((heading) => !fenced.has(heading.line - 1));
  const section = rulesSectionRange({ lines, fenced });
  const sectionProblems = missingSectionViolations(headings);
  if (!section) {
    return sectionProblems;
  }

  const cards = ruleCardRanges({ lines, fenced, section });
  const rulesById = new Map(request.rules.map((rule) => [rule.id, rule]));
  const cardViolations = cards.flatMap((card) => validateCard({ lines, card, rulesById }));
  const documentedIds = cards
    .map((card) => METADATA_PATTERN.exec(lines[firstContentIndex({ lines, from: card.start + 1, to: card.end })] ?? ""))
    .flatMap((match) => (match?.[1] === undefined ? [] : [match[1]]));

  return [
    ...sectionProblems,
    ...cardViolations,
    ...parityViolations({ cards, documentedIds, rules: request.rules }),
  ].sort((left, right) => left.line - right.line || left.ruleId.localeCompare(right.ruleId));
};
