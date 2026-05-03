import { DryMongoBinary, MongoBinary } from "mongodb-memory-server";

const options = await DryMongoBinary.generateOptions();

try {
  await MongoBinary.download({ ...options, checkMD5: true });
  console.log(
    `MongoDB binary (v${options.version}) downloaded to ${options.downloadDir}`,
  );
} catch (error) {
  console.error("Failed to download MongoDB binary.", {
    error,
    version: options.version,
    downloadDir: options.downloadDir,
  });
  process.exitCode = 1;
}
