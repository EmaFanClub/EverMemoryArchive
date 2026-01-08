import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(`${process.cwd()}/../../`);

const nextConfig: NextConfig = {
  /* config options here */

  // https://github.com/vercel/next.js/issues/85371
  serverExternalPackages: [
    "@lancedb/lancedb",
    "pino",
    "thread-stream",
    "pino-pretty",
  ],
};

export default nextConfig;
