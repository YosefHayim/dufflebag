import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // imageToCode/scripts is its own package with its own runner; src/scripts/dev is gitignored scratch.
    exclude: ["**/node_modules/**", "**/dist/**", "src/skills/imageToCode/scripts/**", "src/scripts/dev/**"],
    environment: "node",
    // Install round-trips run beside CLI help spawns; the 5s default flakes under parallel load.
    testTimeout: 30_000,
  },
});
