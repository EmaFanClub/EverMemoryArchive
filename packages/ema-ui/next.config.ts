import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

const nextConfig: NextConfig = {
  /* config options here */
};

const projectDir = process.cwd();
loadEnvConfig(projectDir + "/../../");


export default nextConfig;
