import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "src/**/*.test.ts",
    ],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    testTimeout: 30_000,
  },
});
