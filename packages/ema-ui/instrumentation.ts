import { getServer } from "@/app/api/shared-server";
import { loadPlugins } from "@/plugin";

getServer().then(loadPlugins);
