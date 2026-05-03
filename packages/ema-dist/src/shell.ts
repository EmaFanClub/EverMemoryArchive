import { spawn } from "node:child_process";

export interface ExecOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly quiet?: boolean;
  readonly allowFailure?: boolean;
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export async function execFile(
  command: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      if (!options.quiet) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      if (!options.quiet) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code: code ?? 0,
      };
      if (result.code !== 0 && !options.allowFailure) {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with exit code ${
              result.code
            }\n${result.stderr}`,
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}

export async function capture(
  command: string,
  args: readonly string[],
  options: Omit<ExecOptions, "quiet"> = {},
): Promise<string> {
  const result = await execFile(command, args, { ...options, quiet: true });
  return result.stdout.trim();
}

export async function commandExists(command: string): Promise<boolean> {
  const probe =
    process.platform === "win32"
      ? await execFile("where", [command], {
          quiet: true,
          allowFailure: true,
        })
      : await execFile("which", [command], {
          quiet: true,
          allowFailure: true,
        });
  return probe.code === 0;
}
