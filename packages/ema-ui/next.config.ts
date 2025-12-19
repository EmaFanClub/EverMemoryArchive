import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(`${process.cwd()}/../../`);

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
