import { type CodeStyleViolation, checkCodeStyle, codeCategory } from "./checkCodeStyle.js";

/**
 * The hook island predates the current style and is still being migrated, so
 * its findings are reported but do not fail the gate yet. Every other category
 * is clean and stays that way.
 */
const isDeferred = (violation: CodeStyleViolation): boolean => codeCategory(violation.file) === "hookIsland";

const report = checkCodeStyle(process.cwd());
const gated = report.violations.filter((violation) => !isDeferred(violation));
const deferred = report.violations.filter(isDeferred);

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
    countsByRule.set(violation.ruleId, (countsByRule.get(violation.ruleId) ?? 0) + 1);
  }

  return [...countsByRule.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([ruleId, count]) => `  ${String(count).padStart(4)}  ${ruleId}`)
    .join("\n");
};

write(gated);
process.stdout.write(
  gated.length === 0
    ? "\nGated categories clean (application, tooling, payload placement).\n"
    : `\n${gated.length} gated violation(s)\n${summarize(gated)}\n`,
);

if (deferred.length > 0) {
  process.stdout.write(`\n--- hook island, reported but not gated ---\n`);
  write(deferred);
  process.stdout.write(`\n${deferred.length} deferred violation(s)\n${summarize(deferred)}\n`);
}

process.exitCode = gated.length > 0 ? 1 : 0;
