import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests co-locate beside their source (no test/ dir). The png harness is a
    // separate sub-package with its own runner, so it's excluded here.
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "src/skills/png-to-code/scripts/**"],
    environment: "node",
  },
});
