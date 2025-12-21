import { Command, Option } from "clipanion";
import { fetch } from "undici";

/**
 * Base command for snapshot (server) commands
 */
abstract class SnapshotCommand extends Command {
  port = Option.String(`-p,--port`);
  address = Option.String(`-a,--addr`);

  protected getUrl(): string {
    if (this.address && this.port) {
      throw new Error("--address and --port cannot be provided together");
    }
    let url = this.address;
    if (!url) {
      url = `http://localhost:${this.port || "3000"}`;
    }
    return url;
  }
}

/**
 * Convenience function for CLI to POST a JSON body to a URL
 *
 * @param url - The URL to post to
 * @param body - The JSON body to post
 * @returns The response from the server
 */
const post = async (url: string, body: Record<string, unknown>) => {
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error(`Failed to communicate with the server at ${url}: ${error}`);
    console.error(
      `Hint: run "pnpm dev" or "pnpm build && pnpm start" to start a local server`,
    );
    process.exit(1);
  }
};

/**
 * Create a snapshot of the server
 */
export class SnapshotCreateCommand extends SnapshotCommand {
  static paths = [
    [`snapshot`, "create"],
    [`snapshot`, "c"],
  ];

  static usage = Command.Usage({
    description: "Create a snapshot of the server",
    details: `Create a snapshot of the server. When running in development mode, the server will restore the "default" snapshot after starting.`,
    examples: [
      [
        "Create a default snapshot of the server (named 'default')",
        "ema snapshot c",
      ],
      [
        "Create a snapshot of the server with a custom name",
        "ema snapshot c -n my-snapshot",
      ],
    ],
  });

  name = Option.String("-n,--name", "default");

  async execute() {
    const name = this.name;
    const response = await post(`${this.getUrl()}/api/snapshot`, { name });
    const result: any = await response.json();
    if (result && result.fileName) {
      console.log(`Snapshot created: ${result.fileName}`);
    } else {
      console.error("Failed to create snapshot");
    }
  }
}

/**
 * Restore a snapshot of the server
 */
export class SnapshotRestoreCommand extends SnapshotCommand {
  static paths = [
    [`snapshot`, `restore`],
    [`snapshot`, `r`],
  ];

  static usage = Command.Usage({
    description: "Restore a snapshot of the server",
    details: `Request the server to restore a snapshot by name. When running in development mode, the server will restore the "default" snapshot after starting.`,
    examples: [
      [
        "Restore a default snapshot of the server (named 'default')",
        "ema snapshot r",
      ],
      [
        "Restore a snapshot of the server with a custom name",
        "ema snapshot r -n my-snapshot",
      ],
    ],
  });

  name = Option.String("-n,--name", "default");

  async execute() {
    const name = this.name;
    const response = await post(`${this.getUrl()}/api/snapshot/restore`, {
      name,
    });
    const result: any = await response.json();
    if (result && result.message) {
      console.log(`Snapshot restored: ${result.message}`);
    } else {
      console.error("Failed to restore snapshot");
    }
  }
}
