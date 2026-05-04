import fs from "node:fs/promises";
import { describe, expect, test } from "vitest";

const cmdTemplatePath = new URL("../templates/open-webui.cmd", import.meta.url);
const shTemplatePath = new URL("../templates/open-webui.sh", import.meta.url);
const nodeTemplatePath = new URL(
  "../templates/open-webui.mjs",
  import.meta.url,
);
const stagePath = new URL("../stage.ts", import.meta.url);

describe("WebUI opener templates", () => {
  test("Windows wrapper delegates browser logic to the bundled Node opener", async () => {
    const source = await fs.readFile(cmdTemplatePath, "utf8");

    expect(source).toContain(
      '"%NODE_BIN%" "%APP_ROOT%launcher\\open-webui.mjs"',
    );
    expect(source).not.toContain("chrome.exe");
    expect(source).not.toContain('start "" "%URL%"');
  });

  test("POSIX wrapper delegates browser logic to the bundled Node opener", async () => {
    const source = await fs.readFile(shTemplatePath, "utf8");

    expect(source).toContain(
      '"$NODE_BIN" "$APP_ROOT/launcher/open-webui.mjs" "$URL" "$MODE"',
    );
    expect(source).not.toContain("xdg-open");
    expect(source).not.toContain("google-chrome");
  });

  test("Node opener checks Chrome-style locations before default-browser fallback", async () => {
    const source = await fs.readFile(nodeTemplatePath, "utf8");

    expect(source).toContain("process.env.CHROME_PATH");
    expect(source).toContain("process.env.LIGHTHOUSE_CHROMIUM_PATH");
    expect(source).toContain("findChromeLikeExecutable");
    expect(source).toContain('await import("default-browser")');
    expect(source.indexOf("findChromeLikeExecutable")).toBeLessThan(
      source.indexOf("getDefaultBrowser"),
    );
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
