import { Command, Option } from "clipanion";
import { fetch } from "undici";

const post = async (url: string, body: any) =>
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

export abstract class DbCommand extends Command {
  port = Option.String(`-p,--port`, "3000");
  address = Option.String(`-a,--addr`);

  protected getUrl(): string {
    if (!this.address && !this.port) {
      throw new Error("Either --address or --port must be provided");
    }
    let url = this.address;
    if (!url) {
      url = `http://localhost:${this.port}`;
    }
    return url;
  }
}

export class DbSnapshotCommand extends DbCommand {
  static paths = [[`db`, `snapshot`]];

  static usage = Command.Usage({
    description: "Take a snapshot of the database",
    details: "Takes a snapshot of the database and saves it to a file.",
    examples: [
      ["Take a snapshot of the database", "ema db snapshot"],
      [
        "Take a snapshot of the database with a custom name",
        "ema db snapshot -n my-snapshot",
      ],
    ],
  });

  name = Option.String("-n,--name", "default");

  async execute() {
    const name = this.name;
    const response = await post(`${this.getUrl()}/api/snapshot`, { name });
    const result: any = await response.json();
    if (result && result.fileName) {
      console.log(`Snapshot saved to ${result.fileName}`);
    } else {
      console.error("Failed to save snapshot");
    }
  }
}

export class DbRestoreCommand extends DbCommand {
  static paths = [[`db`, `restore`]];

  static usage = Command.Usage({
    description: "Restore a snapshot of the database",
    details: "Restores a snapshot of the database from a file.",
    examples: [
      ["Restore a snapshot of the database", "ema db restore"],
      [
        "Restore a snapshot of the database with a custom name",
        "ema db restore -n my-snapshot",
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
      console.error("Failed to save snapshot");
    }
  }
}
