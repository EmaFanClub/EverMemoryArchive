import { execSync } from "child_process";
import { globSync } from "fs";

/**
 * Generate the documentation for the core and HTTP endpoints.
 */
function docsGen() {
  execSync(
    "typedoc --entryPoints packages/ema/src/index.ts --entryPoints packages/ema/src/config.ts --entryPoints packages/ema/src/db/index.ts --entryPoints packages/ema/src/skills/index.ts --tsconfig packages/ema/tsconfig.json --out docs/core",
  );
  const routes = globSync("packages/ema-ui/src/app/api/**/route.ts").map(
    (it) => `--entryPoints ${it}`,
  );
  execSync(
    `typedoc ${routes.join(" ")} --tsconfig packages/ema-ui/tsconfig.json --out docs/http`,
  );
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
