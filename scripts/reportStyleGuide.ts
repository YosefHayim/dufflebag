import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkStyleGuide } from "./checkStyleGuide.js";

const repositoryRoot = resolve(process.argv[2] || process.cwd());
const guidePath = join(repositoryRoot, "CODE-STYLE.md");
const rulesPath = join(repositoryRoot, "code-style.rules.json");

const missing = [guidePath, rulesPath].filter((path) => !existsSync(path));
if (missing.length > 0) {
  process.stdout.write(`${repositoryRoot}\n  missing: ${missing.join(", ")}\n`);
  process.exitCode = 1;
} else {
  const parsed: unknown = JSON.parse(readFileSync(rulesPath, "utf8"));
  const rules = Reflect.get(Object(parsed), "rules");
  const violations = checkStyleGuide({ guide: readFileSync(guidePath, "utf8"), rules });

  // One line per violation so a migration can be driven straight from this output.
  for (const violation of violations) {
    process.stdout.write(`  CODE-STYLE.md:${violation.line}  ${violation.message}\n`);
  }

  const ruleCount = Array.isArray(rules) ? rules.length : 0;
  process.stdout.write(
    violations.length === 0
      ? `${repositoryRoot}\n  OK — ${ruleCount} rule card(s) conform\n`
      : `${repositoryRoot}\n  ${violations.length} format violation(s) across ${ruleCount} declared rule(s)\n`,
  );
  process.exitCode = violations.length > 0 ? 1 : 0;
}
