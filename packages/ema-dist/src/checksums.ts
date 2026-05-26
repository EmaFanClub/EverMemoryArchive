import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return hash.digest("hex");
}

export async function writeSha256File(filePath: string): Promise<string> {
  const digest = await sha256File(filePath);
  const checksumPath = `${filePath}.sha256`;
  await fs.writeFile(
    checksumPath,
    `${digest}  ${path.basename(filePath)}\n`,
    "utf8",
  );
  return checksumPath;
}
