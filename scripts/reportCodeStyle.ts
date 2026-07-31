import { checkCodeStyle } from "./checkCodeStyle.js";

const report = checkCodeStyle(process.cwd());

// One line per violation so an editor can jump straight to the file and line.
for (const violation of report.violations) {
  process.stdout.write(`${violation.file}:${violation.line}  ${violation.ruleId}  ${violation.message}\n`);
}

const countsByRule = new Map<string, number>();

// Tally per rule so the largest migration debts are visible without reading every line.
for (const violation of report.violations) {
  countsByRule.set(violation.ruleId, (countsByRule.get(violation.ruleId) ?? 0) + 1);
}

const summary = [...countsByRule.entries()]
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  .map(([ruleId, count]) => `  ${String(count).padStart(4)}  ${ruleId}`);

process.stdout.write(
  `\n${report.violations.length} violation(s) across ${countsByRule.size} rule(s)\n${summary.join("\n")}\n`,
);

process.exitCode = report.violations.length > 0 ? 1 : 0;
