import fs from "node:fs/promises";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build as viteBuild } from "vite";
import {
  minimalStageRoot,
  portableStageRoot,
  stageRoot,
  toPosixPath,
  workspaceRoot,
} from "./paths";
import type { PackageKind, Platform } from "./platforms";
import installTextTemplate from "./templates/INSTALL.txt?raw";
import { renderTemplate } from "./templates";
import { buildRustBinary } from "./rust";

interface StageOptions {
  readonly platform: Platform;
  readonly kind: PackageKind;
  readonly revision: string;
}

interface AppStageResult {
  readonly serverRelativePath: string;
}

export async function stagePackage(options: StageOptions): Promise<string> {
  const root = stageRoot(options.platform, options.kind);
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const app = await copyNextStandaloneApp(root, options.platform);
  await copyIfExists(
    path.join(workspaceRoot(), "README.md"),
    path.join(root, "README.md"),
  );
  await copyIfExists(
    path.join(workspaceRoot(), "LICENSE"),
    path.join(root, "LICENSE"),
  );
  await writeLaunchers(root, options.platform, options.kind);
  await writePackageManifest(root, options, app.serverRelativePath);
  return root;
}

export async function refreshMinimalStageFromPortable(
  platform: Platform,
  revision: string,
): Promise<string> {
  const source = portableStageRoot(platform);
  const target = minimalStageRoot(platform);
  await fs.rm(target, { recursive: true, force: true });
  await copyDirectoryWithout(source, target, new Set(["portables"]));
  await writePackageManifest(
    target,
    {
      platform,
      kind: "minimal",
      revision,
    },
    await readServerRelativePath(target),
  );
  return target;
}

async function copyNextStandaloneApp(
  root: string,
  platform: Platform,
): Promise<AppStageResult> {
  const workspace = workspaceRoot();
  const webuiRoot = path.join(workspace, "packages", "ema-webui");
  const standaloneRoot = path.join(webuiRoot, ".next", "standalone");
  const staticRoot = path.join(webuiRoot, ".next", "static");
  const publicRoot = path.join(webuiRoot, "public");

  if (!(await exists(standaloneRoot))) {
    throw new Error(
      "Next.js standalone output was not found. Run pnpm --filter ema-webui build first.",
    );
  }

  const appRoot = path.join(root, "app");
  await fs.mkdir(appRoot, { recursive: true });
  await writeCommonJsPackageManifest(appRoot);

  const serverPath = await findServerEntry(standaloneRoot);
  const serverDir = path.dirname(serverPath);
  const bundledServerPath = path.join(appRoot, "server.js");
  await bundleNextServerEntry({
    outputPath: bundledServerPath,
    serverPath,
  });

  await copyIfExists(
    path.join(serverDir, ".next"),
    path.join(appRoot, ".next"),
  );
  await copyIfExists(staticRoot, path.join(appRoot, ".next", "static"));
  await copyIfExists(publicRoot, path.join(appRoot, "public"));
  await copyStandaloneNodeModules(standaloneRoot, serverDir, appRoot);
  await copyEmaRuntimeAssets(appRoot);
  await prunePlatformNativeDependencies(appRoot, platform);
  await ensurePlatformNativeDependencies(appRoot, platform);

  const serverRelativePath = toPosixPath(
    path.relative(root, bundledServerPath),
  );
  await fs.writeFile(
    path.join(root, "server-relpath.txt"),
    `${serverRelativePath}\n`,
  );
  return { serverRelativePath };
}

async function writeCommonJsPackageManifest(appRoot: string): Promise<void> {
  await fs.writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  );
}

async function bundleNextServerEntry(options: {
  readonly outputPath: string;
  readonly serverPath: string;
}): Promise<void> {
  await viteBuild({
    configFile: false,
    logLevel: "warn",
    build: {
      emptyOutDir: false,
      minify: false,
      outDir: path.dirname(options.outputPath),
      ssr: true,
      target: "node18",
      lib: {
        entry: options.serverPath,
        formats: ["cjs"],
        fileName: () => path.basename(options.outputPath),
      },
      rollupOptions: {
        external: nodeBuiltins(),
        output: {
          entryFileNames: path.basename(options.outputPath),
          inlineDynamicImports: true,
        },
      },
    },
  });
}

async function copyStandaloneNodeModules(
  standaloneRoot: string,
  serverDir: string,
  appRoot: string,
): Promise<void> {
  const source = path.join(standaloneRoot, "node_modules");
  const destination = path.join(appRoot, "node_modules");
  await copyIfExists(source, destination);
  await linkHoistedPnpmNodeModules(destination);
  await linkPackageNodeModules(
    path.join(serverDir, "node_modules"),
    source,
    destination,
  );
}

async function linkHoistedPnpmNodeModules(
  nodeModulesRoot: string,
): Promise<void> {
  const hoistedRoot = path.join(nodeModulesRoot, ".pnpm", "node_modules");
  if (!(await exists(hoistedRoot))) {
    return;
  }

  const entries = await fs.readdir(hoistedRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      await linkHoistedPnpmScope(nodeModulesRoot, hoistedRoot, entry.name);
      continue;
    }
    await replaceWithSymlink(
      path.join(".pnpm", "node_modules", entry.name),
      path.join(nodeModulesRoot, entry.name),
    );
  }
}

async function linkHoistedPnpmScope(
  nodeModulesRoot: string,
  hoistedRoot: string,
  scope: string,
): Promise<void> {
  const scopeRoot = path.join(hoistedRoot, scope);
  const destinationScopeRoot = path.join(nodeModulesRoot, scope);
  await fs.mkdir(destinationScopeRoot, { recursive: true });
  const entries = await fs.readdir(scopeRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    await replaceWithSymlink(
      path.join("..", ".pnpm", "node_modules", scope, entry.name),
      path.join(destinationScopeRoot, entry.name),
    );
  }
}

async function linkPackageNodeModules(
  sourceNodeModulesRoot: string,
  standaloneNodeModulesRoot: string,
  destinationNodeModulesRoot: string,
): Promise<void> {
  if (!(await exists(sourceNodeModulesRoot))) {
    return;
  }

  const entries = await fs.readdir(sourceNodeModulesRoot, {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      await linkPackageNodeModulesScope(
        path.join(sourceNodeModulesRoot, entry.name),
        standaloneNodeModulesRoot,
        destinationNodeModulesRoot,
        path.join(destinationNodeModulesRoot, entry.name),
      );
      continue;
    }
    await linkPackageNodeModule(
      path.join(sourceNodeModulesRoot, entry.name),
      standaloneNodeModulesRoot,
      destinationNodeModulesRoot,
      path.join(destinationNodeModulesRoot, entry.name),
    );
  }
}

async function linkPackageNodeModulesScope(
  sourceScopeRoot: string,
  standaloneNodeModulesRoot: string,
  destinationNodeModulesRoot: string,
  destinationScopeRoot: string,
): Promise<void> {
  await fs.mkdir(destinationScopeRoot, { recursive: true });
  const entries = await fs.readdir(sourceScopeRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    await linkPackageNodeModule(
      path.join(sourceScopeRoot, entry.name),
      standaloneNodeModulesRoot,
      destinationNodeModulesRoot,
      path.join(destinationScopeRoot, entry.name),
    );
  }
}

async function linkPackageNodeModule(
  source: string,
  standaloneNodeModulesRoot: string,
  destinationNodeModulesRoot: string,
  destination: string,
): Promise<void> {
  const realSource = await fs.realpath(source);
  const relativeSource = path.relative(standaloneNodeModulesRoot, realSource);
  if (relativeSource.startsWith("..") || path.isAbsolute(relativeSource)) {
    await copyIfExists(source, destination);
    return;
  }

  const target = path.relative(
    path.dirname(destination),
    path.join(destinationNodeModulesRoot, relativeSource),
  );
  await replaceWithSymlink(target, destination);
}

async function replaceWithSymlink(
  target: string,
  linkPath: string,
): Promise<void> {
  await fs.rm(linkPath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  const linkTarget =
    process.platform === "win32"
      ? path.resolve(path.dirname(linkPath), target)
      : target;
  await fs.symlink(linkTarget, linkPath, "dir");
}

const LANCEDB_NATIVE_PACKAGES = [
  "@lancedb/lancedb-darwin-x64",
  "@lancedb/lancedb-darwin-arm64",
  "@lancedb/lancedb-linux-x64-gnu",
  "@lancedb/lancedb-linux-arm64-gnu",
  "@lancedb/lancedb-linux-x64-musl",
  "@lancedb/lancedb-linux-arm64-musl",
  "@lancedb/lancedb-win32-x64-msvc",
  "@lancedb/lancedb-win32-arm64-msvc",
] as const;

const SHARP_NATIVE_PACKAGES = [
  "@img/sharp-darwin-arm64",
  "@img/sharp-darwin-x64",
  "@img/sharp-libvips-darwin-arm64",
  "@img/sharp-libvips-darwin-x64",
  "@img/sharp-libvips-linux-arm",
  "@img/sharp-libvips-linux-arm64",
  "@img/sharp-libvips-linux-ppc64",
  "@img/sharp-libvips-linux-riscv64",
  "@img/sharp-libvips-linux-s390x",
  "@img/sharp-libvips-linux-x64",
  "@img/sharp-libvips-linuxmusl-arm64",
  "@img/sharp-libvips-linuxmusl-x64",
  "@img/sharp-linux-arm",
  "@img/sharp-linux-arm64",
  "@img/sharp-linux-ppc64",
  "@img/sharp-linux-riscv64",
  "@img/sharp-linux-s390x",
  "@img/sharp-linux-x64",
  "@img/sharp-linuxmusl-arm64",
  "@img/sharp-linuxmusl-x64",
  "@img/sharp-wasm32",
  "@img/sharp-win32-arm64",
  "@img/sharp-win32-ia32",
  "@img/sharp-win32-x64",
] as const;

const PLATFORM_NATIVE_PACKAGES = [
  ...LANCEDB_NATIVE_PACKAGES,
  ...SHARP_NATIVE_PACKAGES,
] as const;

async function prunePlatformNativeDependencies(
  appRoot: string,
  platform: Platform,
): Promise<void> {
  const pnpmRoot = path.join(appRoot, "node_modules", ".pnpm");
  if (!(await exists(pnpmRoot))) {
    return;
  }

  const keep = new Set(platformNativePackages(platform));
  const remove = PLATFORM_NATIVE_PACKAGES.filter((packageName) => {
    return !keep.has(packageName);
  });

  await removePnpmPackageStores(pnpmRoot, remove);
  await removePnpmPackageLinks(pnpmRoot, remove);
}

async function ensurePlatformNativeDependencies(
  appRoot: string,
  platform: Platform,
): Promise<void> {
  const pnpmRoot = path.join(appRoot, "node_modules", ".pnpm");
  if (!(await exists(pnpmRoot))) {
    return;
  }

  const missing = [];
  for (const packageName of platformNativePackages(platform)) {
    if (!(await pnpmPackageStoreExists(pnpmRoot, packageName))) {
      missing.push(packageName);
    }
  }

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    [
      `Missing native runtime package(s) for ${platform.id}: ${missing.join(", ")}.`,
      "Install optional dependencies for the target platform before running ema-dist build.",
    ].join("\n"),
  );
}

async function pnpmPackageStoreExists(
  pnpmRoot: string,
  packageName: string,
): Promise<boolean> {
  const prefix = pnpmPackageStorePrefix(packageName);
  const entries = await fs.readdir(pnpmRoot, { withFileTypes: true });
  return entries.some(
    (entry) => entry.isDirectory() && entry.name.startsWith(prefix),
  );
}

function platformNativePackages(platform: Platform): string[] {
  return [
    ...platformLancedbPackages(platform),
    ...platformSharpPackages(platform),
  ];
}

function platformLancedbPackages(platform: Platform): string[] {
  if (platform.os === "darwin") {
    return [`@lancedb/lancedb-darwin-${platform.arch}`];
  }
  if (platform.os === "win32") {
    return [`@lancedb/lancedb-win32-${platform.arch}-msvc`];
  }
  if (platform.os === "alpine" && platform.arch === "x64") {
    return ["@lancedb/lancedb-linux-x64-musl"];
  }
  if (platform.os === "linux" && platform.arch === "x64") {
    return ["@lancedb/lancedb-linux-x64-gnu"];
  }
  if (platform.os === "linux" && platform.arch === "arm64") {
    return ["@lancedb/lancedb-linux-arm64-gnu"];
  }
  return [];
}

function platformSharpPackages(platform: Platform): string[] {
  if (platform.os === "darwin") {
    return [
      `@img/sharp-darwin-${platform.arch}`,
      `@img/sharp-libvips-darwin-${platform.arch}`,
    ];
  }
  if (platform.os === "win32") {
    return [`@img/sharp-win32-${platform.arch}`];
  }
  if (platform.os === "alpine" && platform.arch === "x64") {
    return ["@img/sharp-linuxmusl-x64", "@img/sharp-libvips-linuxmusl-x64"];
  }
  if (platform.os === "linux" && platform.arch === "x64") {
    return ["@img/sharp-linux-x64", "@img/sharp-libvips-linux-x64"];
  }
  if (platform.os === "linux" && platform.arch === "arm64") {
    return ["@img/sharp-linux-arm64", "@img/sharp-libvips-linux-arm64"];
  }
  if (platform.os === "linux" && platform.arch === "armhf") {
    return ["@img/sharp-linux-arm", "@img/sharp-libvips-linux-arm"];
  }
  return [];
}

async function removePnpmPackageStores(
  pnpmRoot: string,
  packageNames: readonly string[],
): Promise<void> {
  const entries = await fs.readdir(pnpmRoot, { withFileTypes: true });
  const prefixes = packageNames.map((packageName) => {
    return pnpmPackageStorePrefix(packageName);
  });

  await Promise.all(
    entries
      .filter((entry) =>
        prefixes.some((prefix) => entry.name.startsWith(prefix)),
      )
      .map((entry) => {
        return fs.rm(path.join(pnpmRoot, entry.name), {
          recursive: true,
          force: true,
        });
      }),
  );
}

async function removePnpmPackageLinks(
  pnpmRoot: string,
  packageNames: readonly string[],
): Promise<void> {
  const entries = await fs.readdir(pnpmRoot, { withFileTypes: true });
  const nodeModulesRoots = [
    path.dirname(pnpmRoot),
    path.join(pnpmRoot, "node_modules"),
    ...entries.map((entry) => path.join(pnpmRoot, entry.name, "node_modules")),
  ];

  await Promise.all(
    nodeModulesRoots.flatMap((nodeModulesRoot) => {
      return packageNames.map((packageName) => {
        return fs.rm(packageLinkPath(nodeModulesRoot, packageName), {
          recursive: true,
          force: true,
        });
      });
    }),
  );
}

function pnpmPackageStorePrefix(packageName: string): string {
  return `${packageName.split("/").join("+")}@`;
}

function packageLinkPath(nodeModulesRoot: string, packageName: string): string {
  if (!packageName.startsWith("@")) {
    return path.join(nodeModulesRoot, packageName);
  }

  const [scope, name] = packageName.split("/");
  return path.join(nodeModulesRoot, scope, name);
}

async function findServerEntry(appRoot: string): Promise<string> {
  const preferred = [
    path.join(appRoot, "packages", "ema-webui", "server.js"),
    path.join(appRoot, "server.js"),
  ];
  for (const candidate of preferred) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  const found = await findFile(
    appRoot,
    (filePath) => path.basename(filePath) === "server.js",
  );
  if (!found) {
    throw new Error(
      `Could not find Next.js standalone server.js in ${appRoot}.`,
    );
  }
  return found;
}

async function copyEmaRuntimeAssets(appRoot: string): Promise<void> {
  const sourceRoot = path.join(workspaceRoot(), "packages", "ema", "src");
  const candidates = [
    path.join(appRoot, "packages", "ema", "src"),
    path.join(appRoot, "node_modules", "ema", "src"),
  ];
  for (const candidate of candidates) {
    await copyIfExists(
      path.join(sourceRoot, "prompt", "templates"),
      path.join(candidate, "prompt", "templates"),
    );
    await copySkillAssets(
      path.join(sourceRoot, "skills"),
      path.join(candidate, "skills"),
    );
  }
}

async function copySkillAssets(
  source: string,
  destination: string,
): Promise<void> {
  if (!(await exists(source))) {
    return;
  }
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    await copyIfExists(path.join(from, "SKILL.md"), path.join(to, "SKILL.md"));
    await copyIfExists(path.join(from, "assets"), path.join(to, "assets"));
  }
}

async function writeLaunchers(
  root: string,
  platform: Platform,
  kind: PackageKind,
): Promise<void> {
  await writeRustLauncher(root, platform);
  await writeLauncherRuntime(root);
  await fs.writeFile(
    path.join(root, "INSTALL.txt"),
    installText(platform, kind),
  );
}

async function writeRustLauncher(
  root: string,
  platform: Platform,
): Promise<void> {
  const source = await buildRustBinary(platform, "ema-launcher");
  const output = path.join(root, `ema-launcher${platform.executableExt}`);
  await fs.copyFile(source, output);
  if (platform.os !== "win32") {
    await fs.chmod(output, 0o755);
  }
}

async function writeLauncherRuntime(root: string): Promise<void> {
  const launcherRoot = path.join(root, "launcher");
  await fs.mkdir(launcherRoot, { recursive: true });
  const entry = fileURLToPath(
    new URL("./templates/open-webui.mjs", import.meta.url),
  );
  await viteBuild({
    configFile: false,
    logLevel: "warn",
    ssr: {
      noExternal: true,
    },
    build: {
      emptyOutDir: false,
      minify: false,
      outDir: launcherRoot,
      ssr: true,
      target: "node18",
      lib: {
        entry,
        formats: ["es"],
        fileName: () => "open-webui.mjs",
      },
      rollupOptions: {
        external: nodeBuiltins(),
        output: {
          entryFileNames: "open-webui.mjs",
          inlineDynamicImports: true,
        },
      },
    },
  });
}

function nodeBuiltins(): string[] {
  return [
    ...builtinModules,
    ...builtinModules.map((moduleName) => `node:${moduleName}`),
  ];
}

async function writePackageManifest(
  root: string,
  options: StageOptions,
  serverRelativePath: string,
): Promise<void> {
  await fs.writeFile(
    path.join(root, "ema-package.json"),
    `${JSON.stringify(
      {
        name: "EverMemoryArchive",
        revision: options.revision,
        platform: options.platform.id,
        platformLabel: options.platform.label,
        kind: options.kind,
        serverRelativePath,
        portableMongoBundled:
          options.kind === "portable" && options.platform.canBundleMongo,
        portableMongoNote: options.platform.mongoNote,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

async function readServerRelativePath(root: string): Promise<string> {
  return (
    await fs.readFile(path.join(root, "server-relpath.txt"), "utf8")
  ).trim();
}

function installText(platform: Platform, kind: PackageKind): string {
  const launcher =
    platform.os === "win32" ? "ema-launcher.exe" : "./ema-launcher";
  const configure =
    platform.os === "win32"
      ? "ema-launcher.exe configure"
      : "./ema-launcher configure";
  return renderTemplate(installTextTemplate, {
    configure,
    kind,
    launcher,
    platformLabel: platform.label,
  });
}

async function copyIfExists(
  source: string,
  destination: string,
): Promise<void> {
  if (!(await exists(source))) {
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
}

async function copyDirectoryWithout(
  source: string,
  destination: string,
  excludedNames: Set<string>,
): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (excludedNames.has(entry.name)) {
      continue;
    }
    await fs.cp(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      {
        recursive: true,
        force: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      },
    );
  }
}

async function findFile(
  root: string,
  predicate: (filePath: string) => boolean,
): Promise<string | null> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(entryPath, predicate);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (predicate(entryPath)) {
      return entryPath;
    }
  }
  return null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
