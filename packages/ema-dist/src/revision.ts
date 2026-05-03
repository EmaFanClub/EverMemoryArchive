import { capture, execFile } from "./shell";
import { workspaceRoot } from "./paths";

export async function resolveRevision(): Promise<string> {
  const cwd = workspaceRoot();
  const tagResult = await execFile(
    "git",
    ["describe", "--tags", "--match", "v[0-9]*", "--abbrev=0", "HEAD"],
    { cwd, quiet: true, allowFailure: true },
  );
  const baseTag = tagResult.code === 0 ? tagResult.stdout.trim() : "v0.0.0";
  const hash = await capture("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd,
  });
  const exactTagResult = await execFile(
    "git",
    ["describe", "--exact-match", "--tags", "--match", "v[0-9]*", "HEAD"],
    { cwd, quiet: true, allowFailure: true },
  );
  const dirty = (
    await capture("git", ["status", "--short"], {
      cwd,
    })
  ).length;

  if (exactTagResult.code === 0 && exactTagResult.stdout.trim() === baseTag) {
    return dirty ? `${baseTag}-${hash}-dirty` : baseTag;
  }
  return dirty ? `${baseTag}-${hash}-dirty` : `${baseTag}-${hash}`;
}
