// "docs:dev": "scripts/docs.js dev",
// "docs:build": "scripts/docs.js build",
// "docs:gen": "typedoc packages/ema/src/index.ts --tsconfig packages/ema/tsconfig.json --plugin typedoc-plugin-markdown --plugin typedoc-vitepress-theme --out docs/api/docs",

import { execSync } from 'child_process';

function docsGen() {
    execSync('typedoc --entryPoints packages/ema/src/index.ts  --entryPoints packages/ema/src/db/index.ts  --entryPoints packages/ema/src/skills/index.ts --tsconfig packages/ema/tsconfig.json --out docs/core');
    execSync('typedoc --entryPoints packages/ema-ui/src/app/api/**/*.ts --tsconfig packages/ema-ui/tsconfig.json --out docs/http');
}

function docsDev() {
    execSync('vitepress dev docs', { stdio: 'inherit' });
}

function docsBuild() {
    execSync('vitepress build docs', { stdio: 'inherit' });
}

if (process.argv.includes('--dev')) {
    docsGen();
    docsDev();
} else if (process.argv.includes('--gen')) {
    docsGen();
} else {
    docsGen();
    docsBuild();
} 