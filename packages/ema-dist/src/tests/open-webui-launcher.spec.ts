import fs from "node:fs/promises";
import { describe, expect, test } from "vitest";

const nodeTemplatePath = new URL(
  "../templates/open-webui.mjs",
  import.meta.url,
);
const stagePath = new URL("../stage.ts", import.meta.url);
const rustLauncherPath = new URL("../../rust/launcher.rs", import.meta.url);
const rustSetupPath = new URL("../../rust/setup.rs", import.meta.url);

describe("WebUI opener launchers", () => {
  test("stage writes the Rust launcher directly without shell or cmd wrappers", async () => {
    const source = await fs.readFile(stagePath, "utf8");

    expect(source).toContain('buildRustBinary(platform, "ema-launcher")');
    expect(source).not.toContain("start.sh");
    expect(source).not.toContain("configure.sh");
    expect(source).not.toContain("open-webui.sh");
    expect(source).not.toContain("start.cmd");
    expect(source).not.toContain("configure.cmd");
    expect(source).not.toContain("open-webui.cmd");
  });

  test("stage bundles a launcher for Next.js standalone server output with Vite", async () => {
    const source = await fs.readFile(stagePath, "utf8");

    expect(source).toContain("copyNextStandaloneApp");
    expect(source).toContain("bundleNextServerEntry");
    expect(source).toContain("bundleNextServerChunks");
    expect(source).toContain("patchNextServerRequireHook");
    expect(source).toContain("inlineNextServerCommonJsModules");
    expect(source).toContain("ReactServerDOMWebpackServer");
    expect(source).toContain('moduleName === "critters"');
    expect(source).toContain('moduleName === "@opentelemetry/api"');
    expect(source).toContain("entry: options.serverPath");
    expect(source).toContain('path.join(appRoot, ".next")');
    expect(source).toContain('path.join(appRoot, "public")');
    expect(source).toContain("noExternal: true");
    expect(source).toContain("transformMixedEsModules: true");
    expect(source).toContain('entryFileNames: "[name].js"');
    expect(source).toContain(
      "fileName: () => path.basename(options.outputPath)",
    );
    expect(source).not.toContain("writeFlattenedServerEntry");
    expect(source).not.toContain("copyStandaloneNodeModules");
    expect(source).not.toContain("replaceWithSymlink");
    expect(source).not.toContain("sourceMappingURL=server.js.map");
    expect(source).not.toContain("createRequire(serverPath)(serverPath)");
  });

  test("bundled Node opener still checks Chrome-style locations before default-browser fallback", async () => {
    const source = await fs.readFile(nodeTemplatePath, "utf8");

    expect(source).toContain("process.env.CHROME_PATH");
    expect(source).toContain("process.env.LIGHTHOUSE_CHROMIUM_PATH");
    expect(source).toContain("findChromeLikeExecutable");
    expect(source).toContain('await import("default-browser")');
    expect(source.indexOf("findChromeLikeExecutable")).toBeLessThan(
      source.indexOf("getDefaultBrowser"),
    );
  });

  test("Rust launcher calls the portable open-webui.mjs through Node", async () => {
    const source = await fs.readFile(rustLauncherPath, "utf8");

    expect(source).toContain('unwrap_or_else(|| "start".to_string())');
    expect(source).toContain('"open-webui.mjs"');
    expect(source).toContain("resolve_node");
    expect(source).toContain("Command::new(&node_bin)");
  });

  test("Rust setup creates shortcuts that call ema-launcher directly", async () => {
    const source = await fs.readFile(rustSetupPath, "utf8");

    expect(source).toContain('call \\"{}\\"');
    expect(source).toContain("exec ./ema-launcher");
    expect(source).not.toContain("start.sh");
    expect(source).not.toContain("start.cmd");
  });

  test("Rust setup embeds and extracts a zstd-compressed payload", async () => {
    const source = await fs.readFile(rustSetupPath, "utf8");

    expect(source).toContain("include_bytes!");
    expect(source).toContain("setup-payload.tar.zst");
    expect(source).toContain("ruzstd::decoding::StreamingDecoder");
    expect(source).toContain("tar::Archive");
  });

  test("stage bundles default-browser into the launcher runtime with Vite", async () => {
    const source = await fs.readFile(stagePath, "utf8");

    expect(source).toContain('path.join(root, "launcher")');
    expect(source).toContain("viteBuild");
    expect(source).toContain("noExternal: true");
    expect(source).toContain('fileName: () => "open-webui.mjs"');
    expect(source).not.toContain("copyNodePackageClosure");
  });
});
