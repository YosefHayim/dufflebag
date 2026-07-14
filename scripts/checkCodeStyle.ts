import process from "node:process";
import { checkCodeStyle, validateCodeStyleMetadata } from "../src/style/checkCodeStyle.js";

const parseArguments = (argumentsToParse: ReadonlyArray<string>) => {
  let repositoryRoot = process.cwd();
  let validateRules = false;

  argumentsToParse.forEach((argument, index) => {
    if (argument === "--validate-rules") {
      validateRules = true;
      return;
    }
    if (argument === "--repository-root") {
      const value = argumentsToParse.at(index + 1);
      if (!value) {
        throw new Error("--repository-root requires a path");
      }
      repositoryRoot = value;
      return;
    }
    if (argumentsToParse.at(index - 1) !== "--repository-root") {
      throw new Error(`Unknown argument: ${argument}`);
    }
  });

  return { repositoryRoot, validateRules };
};

const renderMetadata = (repositoryRoot: string): void => {
  const metadata = validateCodeStyleMetadata(repositoryRoot);
  console.log(
    `Validated ${metadata.ruleCount} rules, ${metadata.protectedPathCount} protected paths, and ${metadata.exceptionCount} exceptions.`,
  );
  console.log(`Manual review rules: ${metadata.manualReviewRuleIds.join(", ") || "none"}.`);
};

const renderFullReport = (repositoryRoot: string): void => {
  const report = checkCodeStyle(repositoryRoot);
  report.protectedStates.forEach((entry) => {
    console.log(`${entry.path}: ${entry.state} (${entry.sha256})`);
  });
  report.violations.forEach((violation) => {
    console.error(`${violation.file}:${violation.line} [${violation.ruleId}] ${violation.message}`);
  });
  console.log(`Manual review rules: ${report.manualReviewRuleIds.join(", ") || "none"}.`);
  process.exitCode = report.violations.length === 0 ? 0 : 1;
};

const run = (): void => {
  const argumentsForRun = parseArguments(process.argv.slice(2));
  if (argumentsForRun.validateRules) {
    renderMetadata(argumentsForRun.repositoryRoot);
    return;
  }
  renderFullReport(argumentsForRun.repositoryRoot);
};

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
