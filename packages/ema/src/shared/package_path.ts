import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveEmaSourcePath(...segments: string[]): string {
  const workspaceRoot = resolveWorkspaceRoot();
  if (workspaceRoot) {
    return path.join(workspaceRoot, "packages", "ema", "src", ...segments);
  }
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ...segments,
  );
}

function resolveWorkspaceRoot(): string | null {
  const configuredRoot = process.env.EMA_WORKSPACE_ROOT?.trim();
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }

  let current = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
