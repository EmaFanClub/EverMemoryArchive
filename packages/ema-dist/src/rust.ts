import fs from "node:fs/promises";
import path from "node:path";
import { ensureWindowsIconAsset } from "./icons";
import { execFile } from "./shell";
import { workspaceRoot } from "./paths";
import type { Platform, PlatformId } from "./platforms";

const RUST_TARGETS: Record<PlatformId, string> = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-armhf": "armv7-unknown-linux-gnueabihf",
  "darwin-arm64": "aarch64-apple-darwin",
  "alpine-x64": "x86_64-unknown-linux-musl",
};

interface BuildRustBinaryOptions {
  readonly env?: NodeJS.ProcessEnv;
}

export function rustCrateRoot(): string {
  return path.join(workspaceRoot(), "packages", "ema-dist");
}

export function rustTarget(platform: Platform): string {
  const envKey = `EMA_DIST_RUST_TARGET_${platform.id
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "_")}`;
  return (
    process.env[envKey] ??
    process.env.EMA_DIST_RUST_TARGET ??
    RUST_TARGETS[platform.id]
  );
}

export async function buildRustBinary(
  platform: Platform,
  binary: "ema-launcher" | "setup",
  options: BuildRustBinaryOptions = {},
): Promise<string> {
  const crateRoot = rustCrateRoot();
  const target = rustTarget(platform);
  if (platform.os === "win32") {
    await ensureWindowsIconAsset();
  }
  await execFile(
    "cargo",
    ["build", "--release", "--locked", "--bin", binary, "--target", target],
    {
      cwd: crateRoot,
      env: {
        ...process.env,
        ...options.env,
      },
    },
  );
  const binaryName = `${binary}${platform.executableExt}`;
  const binaryPath = path.join(
    crateRoot,
    "target",
    target,
    "release",
    binaryName,
  );
  await fs.access(binaryPath);
  return binaryPath;
}
