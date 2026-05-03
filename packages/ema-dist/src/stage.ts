import fs from "node:fs/promises";
import path from "node:path";
import {
  minimalStageRoot,
  portableStageRoot,
  stageRoot,
  toPosixPath,
  workspaceRoot,
} from "./paths";
import type { PackageKind, Platform } from "./platforms";
import installTextTemplate from "./templates/INSTALL.txt?raw";
import configureCmdTemplate from "./templates/configure.cmd?raw";
import configureShTemplate from "./templates/configure.sh?raw";
import openWebuiCmdTemplate from "./templates/open-webui.cmd?raw";
import openWebuiShTemplate from "./templates/open-webui.sh?raw";
import startCmdTemplate from "./templates/start.cmd?raw";
import startShTemplate from "./templates/start.sh?raw";
import { renderTemplate } from "./templates";

interface StageOptions {
  readonly platform: Platform;
  readonly kind: PackageKind;
  readonly revision: string;
}

interface AppStageResult {
  readonly root: string;
  readonly serverRelativePath: string;
}

export async function stagePackage(options: StageOptions): Promise<string> {
  const root = stageRoot(options.platform, options.kind);
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const app = await copyStandaloneApp(root, options.platform);
  await copyIfExists(
    path.join(workspaceRoot(), "README.md"),
    path.join(root, "README.md"),
  );
  await copyIfExists(
    path.join(workspaceRoot(), "LICENSE"),
    path.join(root, "LICENSE"),
  );
  await writeLaunchers(
    root,
    options.platform,
    options.kind,
    app.serverRelativePath,
  );
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

async function copyStandaloneApp(
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
  const runtimeRoot = path.join(appRoot, APP_RUNTIME_ASSETS_DIR);
  await fs.mkdir(appRoot, { recursive: true });
  await writeCommonJsPackageManifest(appRoot);
  await fs.cp(standaloneRoot, runtimeRoot, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });

  const serverPath = await findServerEntry(runtimeRoot);
  const serverDir = path.dirname(serverPath);
  await copyIfExists(staticRoot, path.join(serverDir, ".next", "static"));
  await copyIfExists(publicRoot, path.join(serverDir, "public"));
  await copyEmaRuntimeAssets(runtimeRoot);
  await prunePlatformNativeDependencies(runtimeRoot, platform);
  await ensurePlatformNativeDependencies(runtimeRoot, platform);
  const flattenedServerPath = path.join(appRoot, "server.js");
  await writeFlattenedServerEntry({
    outputPath: flattenedServerPath,
    runtimeRoot,
    serverPath,
  });
  await fs.rm(serverPath, { force: true });

  const serverRelativePath = toPosixPath(
    path.relative(root, flattenedServerPath),
  );
  await fs.writeFile(
    path.join(root, "server-relpath.txt"),
    `${serverRelativePath}\n`,
  );
  return { root: appRoot, serverRelativePath };
}

async function writeCommonJsPackageManifest(appRoot: string): Promise<void> {
  await fs.writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  );
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

const APP_RUNTIME_ASSETS_DIR = path.join("assets", "runtime");

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

async function writeFlattenedServerEntry(options: {
  readonly outputPath: string;
  readonly runtimeRoot: string;
  readonly serverPath: string;
}): Promise<void> {
  const source = await fs.readFile(options.serverPath, "utf8");
  const relativeRuntimeRoot = toPosixPath(
    path.relative(path.dirname(options.outputPath), options.runtimeRoot),
  );
  const relativeServerDir = toPosixPath(
    path.relative(options.runtimeRoot, path.dirname(options.serverPath)),
  );
  const runtimeRootLiteral = JSON.stringify(relativeRuntimeRoot);
  const serverDirLiteral = JSON.stringify(relativeServerDir);

  let output = replaceRequired(
    source,
    "const path = require('path')",
    [
      "const path = require('path')",
      "const fs = require('fs')",
      "const Module = require('module')",
      "",
      `const runtimeRoot = path.join(__dirname, ${runtimeRootLiteral})`,
      `const runtimeServerDir = path.join(runtimeRoot, ${serverDirLiteral})`,
      "",
      "function addModulePath(modulePath) {",
      "  if (!fs.existsSync(modulePath)) return",
      "  if (!module.paths.includes(modulePath)) module.paths.unshift(modulePath)",
      "  if (!Module.globalPaths.includes(modulePath)) Module.globalPaths.unshift(modulePath)",
      "}",
      "",
      "function addPnpmPackageStorePaths(pnpmRoot) {",
      "  if (!fs.existsSync(pnpmRoot)) return",
      "  for (const entry of fs.readdirSync(pnpmRoot, { withFileTypes: true })) {",
      "    if (!entry.isDirectory()) continue",
      "    if (entry.name === 'node_modules') continue",
      "    addModulePath(path.join(pnpmRoot, entry.name, 'node_modules'))",
      "  }",
      "}",
      "",
      "addModulePath(path.join(runtimeRoot, 'node_modules'))",
      "addModulePath(path.join(runtimeRoot, 'node_modules', '.pnpm', 'node_modules'))",
      "addPnpmPackageStorePaths(path.join(runtimeRoot, 'node_modules', '.pnpm'))",
      "",
    ].join("\n"),
    options.serverPath,
  );

  output = replaceRequired(
    output,
    "const dir = path.join(__dirname)",
    "const dir = runtimeServerDir",
    options.serverPath,
  );
  output = replaceRequired(
    output,
    "process.chdir(__dirname)",
    "process.chdir(dir)",
    options.serverPath,
  );

  const withSourceMap = `${output.trimEnd()}\n//# sourceMappingURL=server.js.map\n`;
  await fs.writeFile(options.outputPath, withSourceMap);
  await fs.writeFile(
    `${options.outputPath}.map`,
    `${JSON.stringify(
      {
        version: 3,
        file: path.basename(options.outputPath),
        sources: [path.basename(options.outputPath)],
        sourcesContent: [withSourceMap],
        names: [],
        mappings: "",
      },
      null,
      2,
    )}\n`,
  );
}

function replaceRequired(
  source: string,
  search: string,
  replacement: string,
  filePath: string,
): string {
  if (!source.includes(search)) {
    throw new Error(`Could not rewrite standalone server entry ${filePath}.`);
  }
  return source.replace(search, replacement);
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
  serverRelativePath: string,
): Promise<void> {
  await fs.writeFile(
    path.join(root, "start.sh"),
    posixStartScript(serverRelativePath),
    {
      mode: 0o755,
    },
  );
  await fs.writeFile(path.join(root, "open-webui.sh"), posixOpenWebuiScript(), {
    mode: 0o755,
  });
  await fs.writeFile(path.join(root, "configure.sh"), posixConfigureScript(), {
    mode: 0o755,
  });
  await fs.writeFile(
    path.join(root, "start.cmd"),
    windowsStartScript(serverRelativePath),
  );
  await fs.writeFile(
    path.join(root, "open-webui.cmd"),
    windowsOpenWebuiScript(),
  );
  await fs.writeFile(
    path.join(root, "configure.cmd"),
    windowsConfigureScript(),
  );
  if (platform.os !== "win32") {
    await fs.chmod(path.join(root, "start.sh"), 0o755);
    await fs.chmod(path.join(root, "open-webui.sh"), 0o755);
    await fs.chmod(path.join(root, "configure.sh"), 0o755);
  }
  await fs.writeFile(
    path.join(root, "INSTALL.txt"),
    installText(platform, kind),
  );
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

function posixStartScript(serverRelativePath: string): string {
  return renderTemplate(startShTemplate, { serverRelativePath });
}

function windowsStartScript(serverRelativePath: string): string {
  return renderTemplate(startCmdTemplate, {
    serverRelativePath: serverRelativePath.split("/").join("\\"),
  });
}

function posixOpenWebuiScript(): string {
  return openWebuiShTemplate;
}

function windowsOpenWebuiScript(): string {
  return openWebuiCmdTemplate;
}

function posixConfigureScript(): string {
  return configureShTemplate;
}

function windowsConfigureScript(): string {
  return configureCmdTemplate;
}

function installText(platform: Platform, kind: PackageKind): string {
  const launcher = platform.os === "win32" ? "start.cmd" : "start.sh";
  return renderTemplate(installTextTemplate, {
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
