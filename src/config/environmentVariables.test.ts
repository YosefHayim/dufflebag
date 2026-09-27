import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { globSync } from "glob";
import { describe, expect, it } from "vitest";

import { environmentVariables } from "./environmentVariables.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIST_FILES = new Set(["src/config/environmentVariables.ts", "src/config/environmentVariables.test.ts"]);
// e.g. "DUFFLEBAG_VOICE_DIR" inside TypeScript, Rust, Python, shell, or their docs
const ENVIRONMENT_VARIABLE_NAME = /DUFFLEBAG_[A-Z_]+/g;

const namesBySourceFile = (): ReadonlyMap<string, ReadonlySet<string>> =>
  new Map(
    globSync("src/**/*.{ts,tsx,js,mjs,rs,py,sh,swift,md}", {
      cwd: packageRoot,
      nodir: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/target/**", "src/scripts/dev/**"],
    })
      .filter((file) => !LIST_FILES.has(file))
      .map((file) => [
        file,
        new Set(readFileSync(path.join(packageRoot, file), "utf8").match(ENVIRONMENT_VARIABLE_NAME)),
      ]),
  );

describe("environmentVariables", () => {
  it("lists every DUFFLEBAG_* name that code or docs under src/ use", () => {
    const listed = new Set(environmentVariables.map((variable) => variable.name));
    const unlisted = [...namesBySourceFile()].flatMap(([file, names]) =>
      [...names].filter((name) => !listed.has(name)).map((name) => `${file}: ${name}`),
    );

    expect(unlisted).toEqual([]);
  });

  it("lists only names that some file under src/ still uses", () => {
    const used = new Set([...namesBySourceFile().values()].flatMap((names) => [...names]));

    expect(environmentVariables.map((variable) => variable.name).filter((name) => !used.has(name))).toEqual([]);
  });

  it("keeps each name once", () => {
    const names = environmentVariables.map((variable) => variable.name);

    expect(new Set(names).size).toBe(names.length);
  });
});
