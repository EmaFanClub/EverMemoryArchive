import { execFileSync, execSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { relative } from "path";

const API_ROUTE_ROOT = "packages/ema-webui/src/app/api";
const API_REFERENCE_DIR = "docs/api-reference";
const API_REFERENCE_PATH = `${API_REFERENCE_DIR}/index.md`;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Generate project documentation.
 */
function docsGen() {
  generateApiReference();
  execFileSync(
    "typedoc",
    [
      "--entryPoints",
      "packages/ema/src/index.ts",
      "--entryPoints",
      "packages/ema/src/config/index.ts",
      "--entryPoints",
      "packages/ema/src/db/index.ts",
      "--entryPoints",
      "packages/ema/src/skills/index.ts",
      "--tsconfig",
      "packages/ema/tsconfig.json",
      "--out",
      "docs/core",
    ],
    { stdio: "inherit" },
  );
}

function generateApiReference() {
  mkdirSync(API_REFERENCE_DIR, { recursive: true });

  const routeFiles = execFileSync(
    "git",
    ["ls-files", `${API_ROUTE_ROOT}/**/route.ts`],
    { encoding: "utf8" },
  )
    .split(/\r?\n/u)
    .filter(Boolean)
    .sort();

  const routes = routeFiles.flatMap((routeFile) => {
    const source = readFileSync(routeFile, "utf8");
    const methods = HTTP_METHODS.filter((method) =>
      new RegExp(`export\\s+async\\s+function\\s+${method}\\b`, "u").test(
        source,
      ),
    );

    return methods.map((method) => ({
      method,
      path: toApiPath(routeFile),
      source: relative(".", routeFile),
    }));
  });

  const rows = routes
    .map(
      (route) =>
        `| ${route.method} | \`${route.path}\` | \`${route.source}\` |`,
    )
    .join("\n");

  writeFileSync(
    API_REFERENCE_PATH,
    [
      "# API Reference",
      "",
      "This page is generated from Next.js route handlers under `packages/ema-webui/src/app/api`.",
      "",
      "Run `pnpm docs:gen` or `pnpm docs:build` to refresh it after API route changes.",
      "",
      "| Method | Path | Source |",
      "| --- | --- | --- |",
      rows,
      "",
    ].join("\n"),
  );
}

function toApiPath(routeFile) {
  return `/api/${relative(API_ROUTE_ROOT, routeFile)
    .replace(/\/route\.ts$/u, "")
    .replace(/\[([^\]]+)\]/gu, "{$1}")}`;
}

/**
 * Start the development server for the documentation.
 */
function docsDev() {
  execSync("vitepress dev docs", { stdio: "inherit" });
}

/**
 * Build the documentation.
 */
function docsBuild() {
  execSync("vitepress build docs", { stdio: "inherit" });
}

if (process.argv.includes("--dev")) {
  docsGen();
  docsDev();
} else if (process.argv.includes("--gen")) {
  docsGen();
} else {
  docsGen();
  docsBuild();
}
