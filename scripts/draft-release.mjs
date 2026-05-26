#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
let targetArg = "";
let artifactsDir = "dist/release";
let changelogPath = "CHANGELOG.md";
let outputPath = "dist/release-notes.md";
let outputJson = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--artifacts") {
    artifactsDir = args[index + 1] ?? "";
    if (!artifactsDir) {
      usage("--artifacts requires a directory");
    }
    index += 1;
    continue;
  }

  if (arg === "--changelog") {
    changelogPath = args[index + 1] ?? "";
    if (!changelogPath) {
      usage("--changelog requires a file path");
    }
    index += 1;
    continue;
  }

  if (arg === "--output") {
    outputPath = args[index + 1] ?? "";
    if (!outputPath) {
      usage("--output requires a file path");
    }
    index += 1;
    continue;
  }

  if (arg === "--json") {
    outputJson = true;
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

const version = normalizeVersion(targetArg);
validateVersion(version);

const tag = `v${version}`;
const packageVersion = JSON.parse(
  fs.readFileSync("package.json", "utf8"),
).version;

if (packageVersion !== version) {
  throw new Error(
    `package.json version (${packageVersion}) does not match release version (${version})`,
  );
}

const repository = githubRepository();
const changelog = runText("parse-changelog", [changelogPath]);
const artifacts = listArtifacts(artifactsDir);
const artifactTable = renderArtifactTable(artifacts, repository, tag);
const notes = `${changelog.trimEnd()}\n\n${artifactTable}\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, notes, "utf8");

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
}

if (outputJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        version,
        tag,
        changelogPath,
        artifactsDir,
        outputPath,
        artifactCount: artifacts.length,
      },
      null,
      2,
    )}\n`,
  );
} else {
  console.log(`Wrote ${outputPath}`);
}

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    [
      "Usage:",
      "  node scripts/draft-release.mjs <version> [--artifacts <dir>]",
      "    [--changelog <file>] [--output <file>] [--json]",
    ].join(" "),
  );
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

function renderArtifactTable(artifacts, repository, tag) {
  if (artifacts.length === 0) {
    return "## Artifacts\n\nNo release artifacts were found.\n";
  }

  const urlBase = `https://github.com/${repository}/releases/download/${tag}`;
  const rows = artifacts.map((artifact) => {
    const file = `[${artifact.name}](${urlBase}/${encodeURIComponent(artifact.name)})`;
    const checksum = artifact.sha256 ? `\`${artifact.sha256}\`` : "";
    return `| ${file} | ${checksum} |`;
  });

  return [
    "## Artifacts",
    "",
    "| File | SHA-256 |",
    "| ---- | ------- |",
    ...rows,
    "",
  ].join("\n");
}

function listArtifacts(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return listFiles(directory)
    .filter((filePath) => isReleaseArtifact(filePath))
    .map((filePath) => ({
      path: filePath,
      name: path.basename(filePath),
      sha256: readChecksum(`${filePath}.sha256`),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function listFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function isReleaseArtifact(filePath) {
  const fileName = path.basename(filePath);
  if (fileName.endsWith(".sha256")) {
    return false;
  }
  if (fileName.endsWith(".SKIPPED.txt")) {
    return true;
  }
  return /\.(?:7z|zip|exe|run|command)$/.test(fileName);
}

function readChecksum(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }

  const content = fs.readFileSync(filePath, "utf8").trim();
  return content.split(/\s+/)[0] ?? "";
}

function githubRepository() {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }

  const remote = readGitRemote();
  const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Could not infer GitHub repository from origin: ${remote}`);
  }
  return match[1];
}

function readGitRemote() {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
    }).trim();
  } catch (error) {
    const stdout = error.stdout?.toString().trim();
    if (stdout) {
      return stdout;
    }
    throw error;
  }
}

function runText(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" });
  } catch (error) {
    const stdout = error.stdout?.toString();
    if (stdout) {
      return stdout;
    }
    if (error.code === "ENOENT") {
      throw new Error(
        `${command} was not found. Install parse-changelog before drafting release notes.`,
      );
    }
    throw error;
  }
}
