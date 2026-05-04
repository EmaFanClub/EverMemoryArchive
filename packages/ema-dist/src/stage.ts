import fs from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build as viteBuild } from "vite";
import type { Plugin } from "vite";
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

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

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

  await copyIfExists(
    path.join(serverDir, ".next"),
    path.join(appRoot, ".next"),
  );
  await copyIfExists(staticRoot, path.join(appRoot, ".next", "static"));
  await copyIfExists(publicRoot, path.join(appRoot, "public"));
  await bundleNextServerEntry({
    outputPath: bundledServerPath,
    serverPath,
  });
  await bundleNextServerChunks({
    appRoot,
    serverDir,
  });
  await copyPlatformNativeDependencies(standaloneRoot, appRoot, platform);
  await copyEmaRuntimeAssets(appRoot);

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
  const serverDir = path.dirname(options.serverPath);
  await viteBuild({
    configFile: false,
    logLevel: "warn",
    plugins: nextServerBundlePlugins(serverDir),
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    resolve: nextServerBundleResolve(),
    ssr: {
      noExternal: true,
    },
    build: {
      emptyOutDir: false,
      minify: false,
      outDir: path.dirname(options.outputPath),
      ssr: true,
      target: "node18",
      commonjsOptions: nextServerCommonJsOptions(),
      lib: {
        entry: options.serverPath,
        formats: ["cjs"],
        fileName: () => path.basename(options.outputPath),
      },
      rollupOptions: {
        external: isNextServerBundleExternal,
        output: {
          entryFileNames: path.basename(options.outputPath),
          inlineDynamicImports: true,
        },
      },
    },
  });
}

async function bundleNextServerChunks(options: {
  readonly appRoot: string;
  readonly serverDir: string;
}): Promise<void> {
  const serverRoot = path.join(options.serverDir, ".next", "server");
  const chunkEntries = await findNextServerChunkEntries(
    options.serverDir,
    serverRoot,
  );
  if (Object.keys(chunkEntries).length === 0) {
    return;
  }

  await viteBuild({
    configFile: false,
    logLevel: "warn",
    plugins: nextServerBundlePlugins(options.serverDir),
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    resolve: nextServerBundleResolve(),
    ssr: {
      noExternal: true,
    },
    build: {
      emptyOutDir: false,
      minify: false,
      outDir: options.appRoot,
      ssr: true,
      target: "node18",
      commonjsOptions: nextServerCommonJsOptions(),
      rollupOptions: {
        input: chunkEntries,
        external: isNextServerBundleExternal,
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
          chunkFileNames: ".next/server/_bundled/[name]-[hash].js",
          sanitizeFileName,
        },
      },
    },
  });
}

function nextServerBundlePlugins(serverDir: string): Plugin[] {
  return [
    patchNextServerRequireHook(),
    inlineNextServerCommonJsModules(serverDir),
    stubRelativeCommonJsExternals(),
    resolveStandaloneCommonJsPackages(serverDir),
  ];
}

function nextServerBundleResolve(): {
  readonly conditions: string[];
  readonly mainFields: string[];
} {
  return {
    conditions: ["node", "require", "default"],
    mainFields: ["main"],
  };
}

function nextServerCommonJsOptions(): {
  readonly include: RegExp[];
  readonly ignoreDynamicRequires: true;
  readonly transformMixedEsModules: true;
} {
  return {
    include: [
      /[\\/]\.ema-dist-next-server-commonjs[\\/]/,
      /server\.js$/,
      /[\\/]\.next[\\/]server[\\/].*\.js$/,
      /node_modules/,
    ],
    ignoreDynamicRequires: true,
    transformMixedEsModules: true,
  };
}

function patchNextServerRequireHook(): Plugin {
  return {
    name: "ema-dist-patch-next-server-require-hook",
    transform(code, id) {
      if (!isNextServerRequireHook(id)) {
        return null;
      }

      const defaultOverrides = [
        "const defaultOverrides = {",
        "    'styled-jsx': path.dirname(resolve('styled-jsx/package.json')),",
        "    'styled-jsx/style': resolve('styled-jsx/style'),",
        "    'styled-jsx/style.js': resolve('styled-jsx/style')",
        "};",
      ].join("\n");

      if (!code.includes(defaultOverrides)) {
        return null;
      }

      return {
        code: code.replace(defaultOverrides, "const defaultOverrides = {};"),
        map: null,
      };
    },
  };
}

function isNextServerRequireHook(id: string): boolean {
  return toPosixPath(id.split("?", 1)[0]).endsWith(
    "next/dist/server/require-hook.js",
  );
}

const NEXT_SERVER_COMMONJS_DIR = ".ema-dist-next-server-commonjs";

interface NextVendoredCommonJsModule {
  readonly layer: "react-rsc" | "react-ssr";
  readonly exportName: string;
}

const NEXT_VENDORED_COMMONJS_MODULES = new Map<
  string,
  NextVendoredCommonJsModule
>([
  [
    "react-server-dom-webpack/client",
    {
      layer: "react-ssr",
      exportName: "ReactServerDOMWebpackClient",
    },
  ],
  [
    "react-server-dom-webpack/client.node",
    {
      layer: "react-ssr",
      exportName: "ReactServerDOMWebpackClient",
    },
  ],
  [
    "react-server-dom-webpack/server",
    {
      layer: "react-rsc",
      exportName: "ReactServerDOMWebpackServer",
    },
  ],
  [
    "react-server-dom-webpack/server.node",
    {
      layer: "react-rsc",
      exportName: "ReactServerDOMWebpackServer",
    },
  ],
  [
    "react-server-dom-webpack/static",
    {
      layer: "react-rsc",
      exportName: "ReactServerDOMWebpackStatic",
    },
  ],
  [
    "react-server-dom-webpack/static.node",
    {
      layer: "react-rsc",
      exportName: "ReactServerDOMWebpackStatic",
    },
  ],
  [
    "react-server-dom-turbopack/client",
    {
      layer: "react-ssr",
      exportName: "ReactServerDOMTurbopackClient",
    },
  ],
  [
    "react-server-dom-turbopack/client.node",
    {
      layer: "react-ssr",
      exportName: "ReactServerDOMTurbopackClient",
    },
  ],
  [
    "react-server-dom-turbopack/server",
    {
      layer: "react-rsc",
      exportName: "ReactServerDOMTurbopackServer",
    },
  ],
  [
    "react-server-dom-turbopack/server.node",
    {
      layer: "react-rsc",
      exportName: "ReactServerDOMTurbopackServer",
    },
  ],
  [
    "react-server-dom-turbopack/static",
    {
      layer: "react-rsc",
      exportName: "ReactServerDOMTurbopackStatic",
    },
  ],
  [
    "react-server-dom-turbopack/static.node",
    {
      layer: "react-rsc",
      exportName: "ReactServerDOMTurbopackStatic",
    },
  ],
]);

function inlineNextServerCommonJsModules(serverDir: string): Plugin {
  const moduleRoot = path.join(serverDir, NEXT_SERVER_COMMONJS_DIR);
  const moduleIds = new Map<string, string>();
  for (const moduleName of [
    "critters",
    "@opentelemetry/api",
    ...NEXT_VENDORED_COMMONJS_MODULES.keys(),
  ]) {
    moduleIds.set(
      moduleName,
      path.join(moduleRoot, `${encodeURIComponent(moduleName)}.cjs`),
    );
  }

  return {
    name: "ema-dist-inline-next-server-commonjs-modules",
    enforce: "pre",
    resolveId(id) {
      return moduleIds.get(id) ?? null;
    },
    load(id) {
      if (!id.startsWith(`${moduleRoot}${path.sep}`)) {
        return null;
      }

      const moduleName = decodeURIComponent(path.basename(id, ".cjs"));
      if (moduleName === "critters") {
        return crittersStubCommonJsModule();
      }
      if (moduleName === "@opentelemetry/api") {
        return nextCompiledOpenTelemetryCommonJsModule();
      }

      const vendoredModule = NEXT_VENDORED_COMMONJS_MODULES.get(moduleName);
      if (!vendoredModule) {
        return null;
      }
      return nextVendoredCommonJsModule(vendoredModule);
    },
  };
}

function nextCompiledOpenTelemetryCommonJsModule(): string {
  return [
    '"use strict";',
    'module.exports = require("next/dist/compiled/@opentelemetry/api");',
  ].join("\n");
}

function nextVendoredCommonJsModule(
  module: NextVendoredCommonJsModule,
): string {
  return [
    '"use strict";',
    'const moduleCompiled = require("next/dist/server/route-modules/app-page/module.compiled");',
    `module.exports = moduleCompiled.vendored[${JSON.stringify(module.layer)}][${JSON.stringify(module.exportName)}];`,
  ].join("\n");
}

function crittersStubCommonJsModule(): string {
  return [
    '"use strict";',
    "class Critters {",
    "  async process(html) {",
    "    return html;",
    "  }",
    "}",
    "module.exports = Critters;",
    "module.exports.default = Critters;",
  ].join("\n");
}

const EMPTY_COMMONJS_EXTERNAL_PREFIX = "\0ema-dist-empty-commonjs:";

function stubRelativeCommonJsExternals(): Plugin {
  return {
    name: "ema-dist-stub-relative-commonjs-externals",
    enforce: "pre",
    resolveId(id) {
      if (
        isProductionOnlyRelativeModule(id) ||
        (id.startsWith("\0.") && id.endsWith("?commonjs-external"))
      ) {
        return `${EMPTY_COMMONJS_EXTERNAL_PREFIX}${id}`;
      }
      return null;
    },
    load(id) {
      if (id.startsWith(EMPTY_COMMONJS_EXTERNAL_PREFIX)) {
        return "export default {};";
      }
      return null;
    },
  };
}

function isProductionOnlyRelativeModule(id: string): boolean {
  return (
    id.startsWith("./dev/") ||
    id.includes("/dev/") ||
    id.includes("setup-dev-bundler") ||
    id.includes("hot-reloader") ||
    id.includes("dev-overlay") ||
    id.includes("next-devtools")
  );
}

function resolveStandaloneCommonJsPackages(serverDir: string): Plugin {
  const baseRequire = createRequire(path.join(serverDir, "server.js"));
  return {
    name: "ema-dist-resolve-standalone-commonjs-packages",
    enforce: "pre",
    resolveId(id, importer) {
      if (!isBareModuleSpecifier(id)) {
        return null;
      }
      const importerPath = absoluteImporterPath(importer);
      const resolvers = importerPath
        ? [createRequire(importerPath), baseRequire]
        : [baseRequire];
      for (const resolver of resolvers) {
        try {
          return resolver.resolve(id);
        } catch {
          // Try the next resolver.
        }
      }
      return null;
    },
  };
}

function absoluteImporterPath(importer: string | undefined): string | null {
  if (!importer) {
    return null;
  }
  const withoutQuery = importer.split("?", 1)[0];
  if (!path.isAbsolute(withoutQuery)) {
    return null;
  }
  return withoutQuery;
}

function isBareModuleSpecifier(id: string): boolean {
  return (
    !id.startsWith(".") &&
    !id.startsWith("/") &&
    !id.startsWith("\0") &&
    !id.includes("?") &&
    !id.startsWith("data:") &&
    !NODE_BUILTINS.has(id) &&
    !isNativeRuntimeModule(id)
  );
}

function isNextServerBundleExternal(id: string): boolean {
  return (
    NODE_BUILTINS.has(id) ||
    id.endsWith(".map") ||
    id.endsWith(".node") ||
    isNativeRuntimeModule(id)
  );
}

function isNativeRuntimeModule(id: string): boolean {
  return (
    NATIVE_RUNTIME_PACKAGE_NAMES.has(id) ||
    id.startsWith("@lancedb/lancedb-") ||
    id.startsWith("@img/sharp-")
  );
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/\0/g, "_");
}

async function findNextServerChunkEntries(
  serverDir: string,
  root: string,
): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  await collectNextServerChunkEntries(serverDir, root, entries);
  return entries;
}

async function collectNextServerChunkEntries(
  serverDir: string,
  root: string,
  entries: Record<string, string>,
): Promise<void> {
  const dirEntries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of dirEntries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await collectNextServerChunkEntries(serverDir, entryPath, entries);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      continue;
    }
    if (!entryPath.split(path.sep).includes("chunks")) {
      continue;
    }
    entries[toPosixPath(path.relative(serverDir, entryPath)).slice(0, -3)] =
      entryPath;
  }
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

const NATIVE_RUNTIME_PACKAGE_NAMES = new Set<string>([
  ...LANCEDB_NATIVE_PACKAGES,
  ...SHARP_NATIVE_PACKAGES,
]);

async function copyPlatformNativeDependencies(
  standaloneRoot: string,
  appRoot: string,
  platform: Platform,
): Promise<void> {
  const pnpmRoot = path.join(standaloneRoot, "node_modules", ".pnpm");
  const packageNames = platformNativePackages(platform);
  if (packageNames.length === 0) {
    return;
  }

  if (!(await exists(pnpmRoot))) {
    throw new Error(
      [
        `Missing native runtime package(s) for ${platform.id}: ${packageNames.join(", ")}.`,
        "Install optional dependencies for the target platform before running ema-dist build.",
      ].join("\n"),
    );
  }

  const missing = [];
  for (const packageName of packageNames) {
    const packageRoot = await pnpmPackageRoot(pnpmRoot, packageName);
    if (!packageRoot) {
      missing.push(packageName);
      continue;
    }
    await copyNativePackage(
      packageRoot,
      path.join(appRoot, "node_modules"),
      packageName,
    );
  }

  if (missing.length > 0) {
    throw new Error(
      [
        `Missing native runtime package(s) for ${platform.id}: ${missing.join(", ")}.`,
        "Install optional dependencies for the target platform before running ema-dist build.",
      ].join("\n"),
    );
  }
}

async function pnpmPackageRoot(
  pnpmRoot: string,
  packageName: string,
): Promise<string | null> {
  const prefix = pnpmPackageStorePrefix(packageName);
  const entries = await fs.readdir(pnpmRoot, { withFileTypes: true });
  const store = entries.find(
    (entry) => entry.isDirectory() && entry.name.startsWith(prefix),
  );
  if (!store) {
    return null;
  }
  const packageRoot = packageLinkPath(
    path.join(pnpmRoot, store.name, "node_modules"),
    packageName,
  );
  if (!(await exists(packageRoot))) {
    return null;
  }
  return packageRoot;
}

async function copyNativePackage(
  packageRoot: string,
  destinationNodeModulesRoot: string,
  packageName: string,
): Promise<void> {
  const destination = packageLinkPath(destinationNodeModulesRoot, packageName);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(await fs.realpath(packageRoot), destination, {
    dereference: true,
    force: true,
    preserveTimestamps: true,
    recursive: true,
  });
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
  return Array.from(NODE_BUILTINS);
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
