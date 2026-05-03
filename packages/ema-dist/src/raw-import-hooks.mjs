import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const RAW_QUERY = "?raw";

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.endsWith(RAW_QUERY)) {
    return nextResolve(specifier, context);
  }

  const resolved = await nextResolve(
    specifier.slice(0, -RAW_QUERY.length),
    context,
  );
  return {
    shortCircuit: true,
    url: `${resolved.url}${RAW_QUERY}`,
  };
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(RAW_QUERY)) {
    return nextLoad(url, context);
  }

  const source = await fs.readFile(
    fileURLToPath(url.slice(0, -RAW_QUERY.length)),
    "utf8",
  );
  return {
    format: "module",
    shortCircuit: true,
    source: `export default ${JSON.stringify(source)};`,
  };
}
