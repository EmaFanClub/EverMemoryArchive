import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  assertPackageArchiveFormat,
  createPackageArchives,
  PACKAGE_ARCHIVE_FORMATS,
  type PackageArchiveFormat,
} from "./archive";
import {
  createPortableDebugSymbolsArchive,
  type PortableDebugSymbolsStageResult,
  stagePortableDebugSymbols,
} from "./debug-symbols";
import { downloadPortableDependencies } from "./download";
import { createSelfInstaller } from "./installer";
import { packageFileName, platformDistRoot, stageRoot } from "./paths";
import {
  assertPackageKind,
  getPlatform,
  hostPlatformId,
  PLATFORM_IDS,
  PLATFORMS,
  type PackageKind,
  type Platform,
} from "./platforms";
import { resolveRevision } from "./revision";
import { stagePackage } from "./stage";

const BUILD_INSTALLER_ARCHIVE_FORMATS: readonly PackageArchiveFormat[] = ["7z"];
const BUILD_OTHER_ARCHIVE_FORMATS: readonly PackageArchiveFormat[] =
  PACKAGE_ARCHIVE_FORMATS.filter((format) => format !== "7z");

interface PackKindOptions {
  readonly preparePortableDebugSymbols?: boolean;
}

const HELP = `
Usage:
  pnpm --filter ema-dist run revision
  pnpm --filter ema-dist run download -- --platform linux-x64
  pnpm --filter ema-dist run stage -- --platform linux-x64 --kind portable
  pnpm --filter ema-dist run pack -- --platform linux-x64 --kind portable
  pnpm --filter ema-dist run installers -- --platform linux-x64 --kind minimal
  pnpm --filter ema-dist run skip-note -- --platform linux-armhf
  pnpm --filter ema-dist run build -- --platform linux-x64

Options:
  --platform <id>                 Target platform. Defaults to the host platform.
  --all-platforms                 Run for every supported platform id.
  --kind <portable|minimal>        Package kind for stage/pack/installers.
  --format <zip|7z|all>            Archive format for pack. Defaults to all.
  --revision <revision>           Override computed git revision.
  --include-unsupported-portable   Also package portable archives when MongoDB cannot be bundled.
  --help                          Show this help.

Platforms:
  ${PLATFORM_IDS.join(", ")}
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0]?.startsWith("-") ? "help" : (argv[0] ?? "help");
  const rawArgsWithSeparator = argv[0]?.startsWith("-") ? argv : argv.slice(1);
  const rawArgs =
    rawArgsWithSeparator[0] === "--"
      ? rawArgsWithSeparator.slice(1)
      : rawArgsWithSeparator;
  const args = parseArgs({
    args: rawArgs,
    options: {
      platform: { type: "string" },
      "all-platforms": { type: "boolean", default: false },
      kind: { type: "string" },
      format: { type: "string" },
      revision: { type: "string" },
      "include-unsupported-portable": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (args.values.help || command === "help") {
    process.stdout.write(HELP.trimStart());
    return;
  }

  const revision = args.values.revision ?? (await resolveRevision());
  const platforms = resolvePlatforms(
    args.values.platform,
    args.values["all-platforms"],
  );
  const includeUnsupportedPortable = Boolean(
    args.values["include-unsupported-portable"],
  );
  const kind = args.values.kind
    ? assertPackageKind(args.values.kind)
    : undefined;
  const archiveFormats = resolveArchiveFormats(args.values.format);

  switch (command) {
    case "revision":
      process.stdout.write(`${revision}\n`);
      return;
    case "download":
      await runForPlatforms(platforms, async (platform) => {
        await downloadPortableDependencies(platform);
      });
      return;
    case "stage":
      await requireKind(kind, async (packageKind) => {
        await runForPlatforms(platforms, async (platform) => {
          await stagePackage({ platform, kind: packageKind, revision });
        });
      });
      return;
    case "pack":
      await requireKind(kind, async (packageKind) => {
        await runForPlatforms(platforms, async (platform) => {
          const result = await packKind(
            platform,
            packageKind,
            revision,
            archiveFormats,
          );
          if (packageKind === "portable") {
            await packPortableDebugSymbolsIfPresent(
              platform,
              revision,
              result.debugSymbols,
            );
          }
        });
      });
      return;
    case "skip-note":
      await runForPlatforms(platforms, async (platform) => {
        await writeSkipNote(platform, revision);
      });
      return;
    case "installers":
      await requireKind(kind, async (packageKind) => {
        await runForPlatforms(platforms, async (platform) => {
          await createSelfInstaller(platform, packageKind, revision);
        });
      });
      return;
    case "build":
      await runForPlatforms(platforms, async (platform) => {
        await buildPlatform(platform, revision, includeUnsupportedPortable);
      });
      return;
    case "list-platforms":
      for (const platform of PLATFORMS) {
        process.stdout.write(`${platform.id}\t${platform.label}\n`);
      }
      return;
    default:
      throw new Error(`Unknown ema-dist command '${command}'.\n\n${HELP}`);
  }
}

async function buildPlatform(
  platform: Platform,
  revision: string,
  includeUnsupportedPortable: boolean,
): Promise<void> {
  process.stdout.write(`Staging ${platform.id} minimal package\n`);
  await stagePackage({ platform, kind: "minimal", revision });
  await packKind(
    platform,
    "minimal",
    revision,
    BUILD_INSTALLER_ARCHIVE_FORMATS,
  );
  await createSelfInstaller(platform, "minimal", revision);
  await packOtherBuildFormats(platform, "minimal", revision);

  process.stdout.write(`Staging ${platform.id} portable package\n`);
  await stagePackage({ platform, kind: "portable", revision });
  await downloadPortableDependencies(platform);
  const debugSymbols = await stagePortableDebugSymbols(platform, {
    reset: true,
  });

  const packagePortable = platform.canBundleMongo || includeUnsupportedPortable;
  if (packagePortable) {
    await packKind(
      platform,
      "portable",
      revision,
      BUILD_INSTALLER_ARCHIVE_FORMATS,
      { preparePortableDebugSymbols: false },
    );
    await createSelfInstaller(platform, "portable", revision);
    await packPortableDebugSymbolsIfPresent(platform, revision, debugSymbols);
  } else {
    process.stdout.write(
      `Skipping ${platform.id} portable package: ${platform.mongoNote}\n`,
    );
    await writeSkipNote(platform, revision);
  }

  if (packagePortable) {
    await packOtherBuildFormats(platform, "portable", revision, {
      preparePortableDebugSymbols: false,
    });
  }
}

async function packOtherBuildFormats(
  platform: Platform,
  kind: PackageKind,
  revision: string,
  options?: PackKindOptions,
): Promise<void> {
  if (BUILD_OTHER_ARCHIVE_FORMATS.length === 0) {
    return;
  }
  await packKind(
    platform,
    kind,
    revision,
    BUILD_OTHER_ARCHIVE_FORMATS,
    options,
  );
}

async function packPortableDebugSymbolsIfPresent(
  platform: Platform,
  revision: string,
  debugSymbols?: PortableDebugSymbolsStageResult,
): Promise<void> {
  if (debugSymbols && debugSymbols.count === 0) {
    return;
  }
  const output = await createPortableDebugSymbolsArchive(platform, revision);
  if (output) {
    process.stdout.write(`Wrote ${output}\n`);
  }
}

async function packKind(
  platform: Platform,
  kind: PackageKind,
  revision: string,
  formats: readonly PackageArchiveFormat[],
  options?: PackKindOptions,
): Promise<{ debugSymbols?: PortableDebugSymbolsStageResult }> {
  const debugSymbols =
    kind === "portable" && options?.preparePortableDebugSymbols !== false
      ? await stagePortableDebugSymbols(platform)
      : undefined;
  const root = stageRoot(platform, kind);
  await ensureStageExists(root, platform, kind);
  const outputs = await createPackageArchives(
    platform,
    kind,
    revision,
    root,
    formats,
  );
  for (const output of outputs) {
    process.stdout.write(`Wrote ${output}\n`);
  }
  return { debugSymbols };
}

function resolveArchiveFormats(
  formatArg: string | undefined,
): readonly PackageArchiveFormat[] {
  if (!formatArg) {
    return PACKAGE_ARCHIVE_FORMATS;
  }
  const format = assertPackageArchiveFormat(formatArg);
  return format === "all" ? PACKAGE_ARCHIVE_FORMATS : [format];
}

async function writeSkipNote(
  platform: Platform,
  revision: string,
): Promise<void> {
  const outDir = platformDistRoot(platform);
  await fs.mkdir(outDir, { recursive: true });
  const skippedName = packageFileName(platform, "portable", revision, "7z");
  await fs.writeFile(
    path.join(outDir, `${skippedName}.SKIPPED.txt`),
    `${platform.mongoNote}\nUse the minimal package and configure MongoDB from PATH or EMA_MONGO_URI.\n`,
  );
}

async function ensureStageExists(
  root: string,
  platform: Platform,
  kind: PackageKind,
): Promise<void> {
  try {
    await fs.access(root);
  } catch {
    throw new Error(
      `Missing ${kind} stage for ${platform.id}: ${root}. Run stage or build first.`,
    );
  }
}

function resolvePlatforms(
  platformArg: string | undefined,
  allPlatforms: boolean | undefined,
): Platform[] {
  if (allPlatforms) {
    return [...PLATFORMS];
  }
  return [getPlatform(platformArg ?? hostPlatformId())];
}

async function requireKind(
  kind: PackageKind | undefined,
  callback: (kind: PackageKind) => Promise<void>,
): Promise<void> {
  if (!kind) {
    throw new Error("--kind <portable|minimal> is required for this command.");
  }
  await callback(kind);
}

async function runForPlatforms(
  platforms: readonly Platform[],
  callback: (platform: Platform) => Promise<void>,
): Promise<void> {
  for (const platform of platforms) {
    await callback(platform);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
