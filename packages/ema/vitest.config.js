import { loadEnvFile } from "node:process";
import { defineConfig } from "vitest/config";

try {
  loadEnvFile("../../.env");
} catch {
  // .env file might not exist
}

export default defineConfig({
  test: {
    passWithNoTests: true,
    globals: true,
    coverage: {
      provider: "v8",
      exclude: ["**/tests/**"],
    },
    testTimeout: 60000,
  },
});
