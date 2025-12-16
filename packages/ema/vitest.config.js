import { config } from "dotenv";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    globals: true,
    coverage: {
      provider: "v8",
      exclude: ["**/tests/**"],
    },
    env: {
      ...((config({ path: "../../.env" }).parsed) || {}),
    },
    testTimeout: 60000,
  },
});