import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

loadEnvConfig(workspaceRoot);

function readWorkspaceVersion() {
  const packageJsonPath = join(workspaceRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };

  if (typeof packageJson.version !== "string" || !packageJson.version) {
    throw new Error("Workspace package.json version is missing.");
  }

  return packageJson.version;
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["ema"],
  env: {
    NEXT_PUBLIC_EMA_VERSION: readWorkspaceVersion(),
  },
  serverExternalPackages: [
    "@lancedb/lancedb",
    "mongodb",
    "mongodb-agenda",
    "pino",
    "pino-pretty",
    "thread-stream",
  ],
};

export default nextConfig;
