#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";

const args = process.argv.slice(2);
let targetArg = "";
let outputJson = false;
let write = false;

for (const arg of args) {
  if (arg === "--json") {
    outputJson = true;
    continue;
  }

  if (arg === "--write") {
    write = true;
    continue;
  }

  if (!targetArg) {
    targetArg = arg;
    continue;
  }

  usage(`Unexpected argument: ${arg}`);
}

if (!targetArg) {
  usage("Missing target version");
}

const targetVersion = normalizeVersion(targetArg);
validateVersion(targetVersion);

const jsonVersionFiles = [
  "package.json",
  "packages/ema/package.json",
  "packages/ema-webui/package.json",
];

const cargoPackages = [
  { path: "packages/ema-dist/Cargo.toml", name: "ema-dist" },
];

let updates = inspectVersionUpdates();

if (write) {
  applyUpdates(updates);
  updates = inspectVersionUpdates();
}

const result = {
  targetVersion,
  targetTag: `v${targetVersion}`,
  releaseType: classifyReleaseType(targetVersion),
  branch: currentBranch(),
  changelog: inspectChangelog("CHANGELOG.md", targetVersion),
  updates,
  pendingUpdates: updates.filter((item) => item.currentVersion !== targetVersion),
  commands: {
    applyVersionUpdates: `node scripts/release-preflight.mjs v${targetVersion} --write`,
    generateChangelog: `node scripts/generate-changelog.mjs v${targetVersion} --write`,
    draftReleaseNotes: `node scripts/draft-release.mjs v${targetVersion}`,
  },
};

if (outputJson) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  printHuman(result);
}

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error("Usage: node scripts/release-preflight.mjs <version> [--write] [--json]");
  process.exit(1);
}

function normalizeVersion(version) {
  return version.startsWith("v") ? version.slice(1) : version;
}

function validateVersion(version) {
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    return;
  }

  usage(`Invalid semver version: ${version}`);
}

function classifyReleaseType(version) {
  return version.includes("-") ? "prerelease" : "stable";
}

function inspectVersionUpdates() {
  return [
    ...jsonVersionFiles.map((filePath) => inspectJsonVersion(filePath)),
    ...cargoPackages.map((pkg) => inspectCargoVersion(pkg.path)),
    ...cargoPackages.map((pkg) =>
      inspectCargoLockVersion("packages/ema-dist/Cargo.lock", pkg.name),
    ),
  ].filter(Boolean);
}

function inspectJsonVersion(filePath) {
  const content = readText(filePath);
  const parsed = JSON.parse(content);
  if (typeof parsed.version !== "string") {
    return null;
  }

  return {
    path: filePath,
    kind: "json",
    currentVersion: parsed.version,
    nextVersion: targetVersion,
  };
}

function inspectCargoVersion(filePath) {
  const content = readText(filePath);
  const match = content.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    return null;
  }

  return {
    path: filePath,
    kind: "cargo-toml",
    currentVersion: match[1],
    nextVersion: targetVersion,
  };
}

function inspectCargoLockVersion(filePath, packageName) {
  const content = readText(filePath);
  const blockPattern = new RegExp(
    `(\\[\\[package\\]\\]\\nname = "${escapeRegExp(packageName)}"\\nversion = ")([^"]+)(")`,
  );
  const match = content.match(blockPattern);
  if (!match) {
    return null;
  }

  return {
    path: filePath,
    kind: "cargo-lock",
    packageName,
    currentVersion: match[2],
    nextVersion: targetVersion,
  };
}

function applyUpdates(items) {
  const byPath = new Map();
  for (const item of items) {
    if (item.currentVersion === targetVersion) {
      continue;
    }

    const group = byPath.get(item.path) ?? [];
    group.push(item);
    byPath.set(item.path, group);
  }

  for (const [filePath, fileUpdates] of byPath) {
    const first = fileUpdates[0];
    if (first.kind === "json") {
      writeJsonVersion(filePath);
      continue;
    }

    if (first.kind === "cargo-toml") {
      writeCargoTomlVersion(filePath);
      continue;
    }

    if (first.kind === "cargo-lock") {
      writeCargoLockVersions(filePath, fileUpdates);
      continue;
    }
  }
}

function writeJsonVersion(filePath) {
  const parsed = JSON.parse(readText(filePath));
  parsed.version = targetVersion;
  fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function writeCargoTomlVersion(filePath) {
  const next = readText(filePath).replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${targetVersion}"`,
  );
  fs.writeFileSync(filePath, next, "utf8");
}

function writeCargoLockVersions(filePath, fileUpdates) {
  let next = readText(filePath);
  for (const item of fileUpdates) {
    const blockPattern = new RegExp(
      `(\\[\\[package\\]\\]\\nname = "${escapeRegExp(item.packageName)}"\\nversion = ")[^"]+(")`,
    );
    next = next.replace(blockPattern, `$1${targetVersion}$2`);
  }
  fs.writeFileSync(filePath, next, "utf8");
}

function inspectChangelog(filePath, version) {
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      status: "missing",
      heading: null,
    };
  }

  const content = readText(filePath);
  const headingPattern = new RegExp(`^## v${escapeRegExp(version)}\\b`, "m");
  const match = content.match(headingPattern);
  return {
    path: filePath,
    status: match ? "present" : "missing-entry",
    heading: match?.[0] ?? null,
  };
}

function currentBranch() {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printHuman(result) {
  console.log(`Target: ${result.targetTag} (${result.releaseType})`);
  console.log(`Branch: ${result.branch || "(unknown)"}`);
  console.log(`Changelog: ${result.changelog.status}`);
  console.log("");

  if (result.pendingUpdates.length === 0) {
    console.log("Version strings are already up to date.");
  } else {
    console.log("Pending version updates:");
    for (const item of result.pendingUpdates) {
      const label = item.packageName ? `${item.path} (${item.packageName})` : item.path;
      console.log(`- ${label}: ${item.currentVersion} -> ${item.nextVersion}`);
    }
  }

  console.log("");
  console.log("Commands:");
  console.log(`- ${result.commands.applyVersionUpdates}`);
  console.log(`- ${result.commands.generateChangelog}`);
  console.log(`- ${result.commands.draftReleaseNotes}`);
}
