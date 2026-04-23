import { GlobalConfig } from "../../config/index";
import { MemFs } from "../../shared/fs";

/** Loads the example GlobalConfig into an in-memory filesystem for tests. */
export async function loadTestGlobalConfig(
  fs: MemFs = new MemFs(),
): Promise<MemFs> {
  GlobalConfig.resetForTests();
  await fs.write(GlobalConfig.configPath, GlobalConfig.example);
  await fs.write(GlobalConfig.devSeedPath, GlobalConfig.devSeedExample);
  await GlobalConfig.load(fs);
  return fs;
}
