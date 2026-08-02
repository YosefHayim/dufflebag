import { type CodeStyleViolation, checkCodeStyle } from "./checkCodeStyle.js";

const report = checkCodeStyle(process.cwd());

// One line per violation so an editor can jump straight to the file and line.
const write = (violations: ReadonlyArray<CodeStyleViolation>): void => {
  // Stream each line to stdout as it is formatted instead of buffering the whole report.
  for (const violation of violations) {
    process.stdout.write(`${violation.file}:${violation.line}  ${violation.ruleId}  ${violation.message}\n`);
  }
};

// Tally per rule so the largest migration debts are visible without reading every line.
const summarize = (violations: ReadonlyArray<CodeStyleViolation>): string => {
  const countsByRule = new Map<string, number>();
  // Tally into one map the checker owns, because building a collection with reduce is forbidden.
  for (const violation of violations) {
    countsByRule.set(violation.ruleId, (countsByRule.get(violation.ruleId) || 0) + 1);
  }

  return [...countsByRule.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([ruleId, count]) => `  ${String(count).padStart(4)}  ${ruleId}`)
    .join("\n");
};

write(report.violations);
process.stdout.write(
  report.violations.length === 0
    ? "\nMaintained application, hook-island, tooling, and placement rules are clean.\n"
    : `\n${report.violations.length} violation(s)\n${summarize(report.violations)}\n`,
);

process.exitCode = report.violations.length > 0 ? 1 : 0;
