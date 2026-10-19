import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node's test-runner suites have their own npm scripts and must not be
    // imported as Vitest suites (which reports "No test suite found").
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
