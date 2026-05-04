import fs from "node:fs/promises";
import path from "node:path";
import { installerFileName, platformDistRoot, stageRoot } from "./paths";
import type { PackageKind, Platform } from "./platforms";
import { buildRustBinary } from "./rust";

export async function createSelfInstaller(
  platform: Platform,
  kind: PackageKind,
  revision: string,
): Promise<string> {
  const outDir = platformDistRoot(platform);
  const outputPath = path.join(
    outDir,
    installerFileName(platform, kind, revision),
  );
  const payloadRoot = stageRoot(platform, kind);
  await fs.access(payloadRoot);

  const setupBinary = await buildRustBinary(platform, "setup", {
    env: {
      EMA_DIST_SETUP_PAYLOAD_DIR: payloadRoot,
      EMA_DIST_SETUP_PLATFORM: platform.id,
      EMA_DIST_SETUP_KIND: kind,
    },
  });
  await fs.copyFile(setupBinary, outputPath);
  if (platform.os !== "win32") {
    await fs.chmod(outputPath, 0o755);
  }
  return outputPath;
}
