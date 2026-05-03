import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const MONGO_DB_NAME = "ema";

const HELP = `
Usage:
  pnpm webui -- --mongo <mongodb-uri>
  pnpm webui -- --prod --mongo <mongodb-uri>
  pnpm webui -- --dev
  pnpm webui -- --dev --mongo <mongodb-uri>

Options:
  --dev             Run EMA in development mode.
  --prod            Run EMA in production mode. This is the default.
  --mongo <uri>     Remote MongoDB URI. Required in production mode.
  --host <host>     Host passed to Next.js.
  --port <port>     Port passed to Next.js.
  --help            Show this help.
`;

type Mode = "dev" | "prod";

function main() {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  const { values } = parseArgs({
    args,
    options: {
      dev: { type: "boolean", default: false },
      prod: { type: "boolean", default: false },
      mongo: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(HELP.trimStart());
    return;
  }

  if (values.dev && values.prod) {
    fail("--dev and --prod cannot be used together.");
  }

  const mode: Mode = values.dev ? "dev" : "prod";
  const mongoUri = values.mongo?.trim() ?? "";
  if (mode === "prod" && !mongoUri) {
    fail("Production mode requires --mongo <uri>.");
  }

  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const dataRoot = path.join(repoRoot, ".ema");
  mkdirSync(path.join(dataRoot, "logs"), { recursive: true });
  mkdirSync(path.join(dataRoot, "workspace"), { recursive: true });

  const nextScript = mode === "dev" ? "dev" : "start";
  const nextArgs = ["--filter", "ema-webui", nextScript];
  if (values.host) {
    nextArgs.push("--", "--hostname", values.host);
  }
  if (values.port) {
    if (!values.host) {
      nextArgs.push("--");
    }
    nextArgs.push("--port", values.port);
  }

  const env = {
    ...process.env,
    // Internal handoff values for the child EMA server process.
    EMA_SERVER_MODE: mode,
    EMA_SERVER_MONGO_KIND: mode === "dev" && !mongoUri ? "memory" : "remote",
    EMA_SERVER_MONGO_URI: mongoUri,
    EMA_SERVER_MONGO_DB: MONGO_DB_NAME,
    EMA_SERVER_DATA_ROOT: dataRoot,
  };

  const child = spawn(pnpmCommand(), nextArgs, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

function fail(message: string): never {
  process.stderr.write(`EMA WebUI startup error: ${message}\n\n${HELP}`);
  process.exit(1);
}

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

main();
