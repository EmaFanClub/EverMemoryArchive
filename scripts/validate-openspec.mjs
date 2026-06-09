#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const localOpenSpecBin = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "openspec.cmd" : "openspec",
);
const openspecBin = existsSync(localOpenSpecBin)
  ? localOpenSpecBin
  : process.platform === "win32"
    ? "openspec.cmd"
    : "openspec";
const env = {
  ...process.env,
  OPENSPEC_TELEMETRY: "0",
};

function runOpenSpec(args) {
  const result = spawnSync(openspecBin, args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function parseJsonResult(args, emptyPayload) {
  const result = runOpenSpec(args);
  if (result.status !== 0) {
    throw new Error(formatFailure(args, result));
  }

  const output = result.stdout.trim();
  if (output.startsWith("No ") && output.endsWith(" found.")) {
    return emptyPayload;
  }

  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(
      `Failed to parse OpenSpec JSON output for "openspec ${args.join(" ")}": ${
        error instanceof Error ? error.message : String(error)
      }\n\n${result.stdout}`,
    );
  }
}

function formatFailure(args, result) {
  const output = [result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join("\n");

  return [
    `OpenSpec command failed: openspec ${args.join(" ")}`,
    `Exit code: ${result.status ?? "unknown"}`,
    output,
  ]
    .filter(Boolean)
    .join("\n");
}

function listNames(payload, key) {
  const items = Array.isArray(payload?.[key]) ? payload[key] : [];
  return items
    .map((item) => item?.name)
    .filter((name) => typeof name === "string" && name.length > 0);
}

const changes = listNames(
  parseJsonResult(["list", "--json"], { changes: [] }),
  "changes",
);
const specs = listNames(
  parseJsonResult(["list", "--specs", "--json"], { specs: [] }),
  "specs",
);
const failures = [];

for (const change of changes) {
  const result = runOpenSpec([
    "validate",
    change,
    "--type",
    "change",
    "--strict",
    "--json",
    "--no-interactive",
  ]);

  if (result.status !== 0) {
    failures.push(
      formatFailure(["validate", change, "--type", "change"], result),
    );
  }
}

for (const spec of specs) {
  const result = runOpenSpec([
    "validate",
    spec,
    "--type",
    "spec",
    "--strict",
    "--json",
    "--no-interactive",
  ]);

  if (result.status !== 0) {
    failures.push(formatFailure(["validate", spec, "--type", "spec"], result));
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log(
  `OpenSpec validation passed: ${changes.length} change(s), ${specs.length} spec(s).`,
);
