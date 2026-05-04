import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WAIT_TIMEOUT_MS = 30_000;
const WAIT_INTERVAL_MS = 500;
const URL = process.argv[2];
const MODE = normalizeMode(process.argv[3] || "webview");

if (!URL || MODE === "none") {
  process.exit(0);
}

if (!(await waitForWebui(URL))) {
  process.exit(0);
}

const opened = await openWebui(URL, MODE);
if (!opened) {
  console.error(`No browser opener was found. Open ${URL} manually.`);
}

function normalizeMode(mode) {
  if (/^browser$/i.test(mode)) return "browser";
  if (/^webview$/i.test(mode) || mode === "") return "webview";
  if (/^none$/i.test(mode)) return "none";
  console.error(`Unknown EMA_OPEN_MODE "${mode}"; falling back to webview.`);
  return "webview";
}

async function waitForWebui(url) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status < 500) {
        return true;
      }
    } catch {
      // Keep waiting until the server starts accepting connections.
    }
    await sleep(WAIT_INTERVAL_MS);
  }
  return false;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function openWebui(url, mode) {
  const explicitPath = await firstExistingPath([
    process.env.EMA_BROWSER_PATH,
    process.env.CHROME_PATH,
    process.env.LIGHTHOUSE_CHROMIUM_PATH,
  ]);
  if (explicitPath && launchExecutable(explicitPath, url, mode === "webview")) {
    return true;
  }

  if (mode === "webview") {
    const chrome = await findChromeLikeExecutable();
    if (chrome && launchExecutable(chrome, url, true)) {
      return true;
    }
  }

  const browser = await getDefaultBrowser();
  if (browser) {
    if (await launchDefaultBrowser(browser, url, mode === "webview")) {
      return true;
    }
  }

  const knownBrowser = await findKnownBrowserExecutable(browser);
  if (knownBrowser && launchExecutable(knownBrowser, url, false)) {
    return true;
  }

  return openWithSystemDefault(url);
}

async function getDefaultBrowser() {
  try {
    const { default: defaultBrowser } = await import("default-browser");
    return await defaultBrowser();
  } catch {
    return null;
  }
}

async function launchDefaultBrowser(browser, url, appMode) {
  if (appMode) {
    const chrome = await findKnownBrowserExecutable(browser, {
      chromeLikeOnly: true,
    });
    if (chrome && launchExecutable(chrome, url, true)) {
      return true;
    }
  }

  if (process.platform === "win32") {
    const fromProgId = await resolveWindowsProgIdExecutable(browser.id);
    if (fromProgId && launchExecutable(fromProgId, url, false)) {
      return true;
    }
    const known = await findKnownBrowserExecutable(browser);
    return Boolean(known && launchExecutable(known, url, false));
  }

  if (process.platform === "darwin") {
    if (browser.id && launchCommand("open", ["-b", browser.id, url])) {
      return true;
    }
    if (browser.name && launchCommand("open", ["-a", browser.name, url])) {
      return true;
    }
  }

  if (process.platform === "linux") {
    const desktopExecutable = await resolveLinuxDesktopExecutable(browser.id);
    if (desktopExecutable && launchExecutable(desktopExecutable, url, false)) {
      return true;
    }
  }

  return false;
}

function launchExecutable(executablePath, url, appMode) {
  const args =
    appMode && supportsAppMode(executablePath) ? [`--app=${url}`] : [url];
  return launchCommand(executablePath, args);
}

function launchCommand(command, args) {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function supportsAppMode(executablePath) {
  const basename = path.basename(executablePath).toLowerCase();
  return [
    "chrome",
    "chrome.exe",
    "chromium",
    "chromium-browser",
    "chromium.exe",
    "google-chrome",
    "google-chrome-stable",
    "google-chrome-beta",
    "google-chrome-unstable",
    "msedge",
    "msedge.exe",
    "microsoft-edge",
    "microsoft-edge-stable",
    "brave",
    "brave.exe",
    "brave-browser",
    "vivaldi",
    "vivaldi.exe",
  ].includes(basename);
}

async function findChromeLikeExecutable() {
  return firstExistingPath(await chromeLikeCandidates());
}

async function findKnownBrowserExecutable(browser, options = {}) {
  const families = browserFamilies(browser, options);
  const candidates = [];
  for (const family of families) {
    candidates.push(...(await browserCandidates(family)));
  }
  return firstExistingPath(candidates);
}

function browserFamilies(browser, options) {
  const text = `${browser?.id || ""} ${browser?.name || ""}`.toLowerCase();
  const families = [];

  if (text.includes("chrome") || text.includes("chromium")) {
    families.push("chrome");
  }
  if (text.includes("edge") || text.includes("msedge")) {
    families.push("edge");
  }
  if (text.includes("brave")) {
    families.push("brave");
  }
  if (text.includes("vivaldi")) {
    families.push("vivaldi");
  }
  if (!options.chromeLikeOnly && text.includes("firefox")) {
    families.push("firefox");
  }

  if (families.length > 0) {
    return families;
  }
  return options.chromeLikeOnly
    ? ["chrome", "edge", "brave", "vivaldi"]
    : ["chrome", "edge", "brave", "vivaldi", "firefox"];
}

async function chromeLikeCandidates() {
  const candidates = [];
  for (const family of ["chrome", "edge", "brave", "vivaldi", "chromium"]) {
    candidates.push(...(await browserCandidates(family)));
  }
  return candidates;
}

async function browserCandidates(family) {
  switch (process.platform) {
    case "win32":
      return windowsBrowserCandidates(family);
    case "darwin":
      return darwinBrowserCandidates(family);
    default:
      return linuxBrowserCandidates(family);
  }
}

async function windowsBrowserCandidates(family) {
  const local = process.env.LOCALAPPDATA;
  const programFiles = process.env.PROGRAMFILES;
  const programFilesX86 = process.env["PROGRAMFILES(X86)"];

  const paths = {
    chrome: [
      path.join(local || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(
        local || "",
        "Google",
        "Chrome SxS",
        "Application",
        "chrome.exe",
      ),
      path.join(
        programFiles || "",
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
      path.join(
        programFilesX86 || "",
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
      ...(await windowsAppPathCandidates("chrome.exe")),
      ...(await commandCandidates("chrome.exe")),
    ],
    chromium: [
      path.join(local || "", "Chromium", "Application", "chrome.exe"),
      path.join(programFiles || "", "Chromium", "Application", "chrome.exe"),
      path.join(programFilesX86 || "", "Chromium", "Application", "chrome.exe"),
      ...(await windowsAppPathCandidates("chromium.exe")),
      ...(await commandCandidates("chromium.exe")),
    ],
    edge: [
      path.join(local || "", "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(
        programFiles || "",
        "Microsoft",
        "Edge",
        "Application",
        "msedge.exe",
      ),
      path.join(
        programFilesX86 || "",
        "Microsoft",
        "Edge",
        "Application",
        "msedge.exe",
      ),
      ...(await windowsAppPathCandidates("msedge.exe")),
      ...(await commandCandidates("msedge.exe")),
    ],
    brave: [
      path.join(
        local || "",
        "BraveSoftware",
        "Brave-Browser",
        "Application",
        "brave.exe",
      ),
      path.join(
        programFiles || "",
        "BraveSoftware",
        "Brave-Browser",
        "Application",
        "brave.exe",
      ),
      path.join(
        programFilesX86 || "",
        "BraveSoftware",
        "Brave-Browser",
        "Application",
        "brave.exe",
      ),
      ...(await windowsAppPathCandidates("brave.exe")),
      ...(await commandCandidates("brave.exe")),
    ],
    vivaldi: [
      path.join(local || "", "Vivaldi", "Application", "vivaldi.exe"),
      path.join(programFiles || "", "Vivaldi", "Application", "vivaldi.exe"),
      path.join(programFilesX86 || "", "Vivaldi", "Application", "vivaldi.exe"),
      ...(await windowsAppPathCandidates("vivaldi.exe")),
      ...(await commandCandidates("vivaldi.exe")),
    ],
    firefox: [
      path.join(programFiles || "", "Mozilla Firefox", "firefox.exe"),
      path.join(programFilesX86 || "", "Mozilla Firefox", "firefox.exe"),
      ...(await windowsAppPathCandidates("firefox.exe")),
      ...(await commandCandidates("firefox.exe")),
    ],
  };

  return paths[family] || [];
}

async function windowsAppPathCandidates(executableName) {
  const result = [];
  for (const hive of ["HKCU", "HKLM"]) {
    const value = await queryWindowsRegistryDefault(
      `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
    );
    if (value) {
      result.push(expandWindowsEnv(value));
    }
  }
  return result;
}

async function resolveWindowsProgIdExecutable(progId) {
  if (!progId) {
    return null;
  }

  for (const root of ["HKCU\\Software\\Classes", "HKCR"]) {
    const command = await queryWindowsRegistryDefault(
      `${root}\\${progId}\\shell\\open\\command`,
    );
    const executable = command && extractWindowsExecutable(command);
    if (executable && (await isExecutable(executable))) {
      return executable;
    }
  }
  return null;
}

async function queryWindowsRegistryDefault(key) {
  try {
    const { stdout } = await execFileAsync("reg", ["query", key, "/ve"], {
      windowsHide: true,
    });
    for (const line of stdout.split(/\r?\n/u)) {
      const match = line.match(/^\s+\(Default\)\s+REG_\w+\s+(.+?)\s*$/iu);
      if (match) {
        return match[1];
      }
    }
  } catch {
    return null;
  }
  return null;
}

function extractWindowsExecutable(command) {
  const expanded = expandWindowsEnv(command);
  return (
    expanded.match(/^\s*"([^"]+?\.exe)"/iu)?.[1] ||
    expanded.match(/^\s*([^\s"]+?\.exe)/iu)?.[1] ||
    null
  );
}

function expandWindowsEnv(value) {
  return value.replace(/%([^%]+)%/gu, (token, name) => {
    const key = Object.keys(process.env).find(
      (environmentKey) => environmentKey.toLowerCase() === name.toLowerCase(),
    );
    return key ? process.env[key] || "" : token;
  });
}

async function darwinBrowserCandidates(family) {
  const home = os.homedir();
  const paths = {
    chrome: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(
        home,
        "Applications",
        "Google Chrome.app",
        "Contents",
        "MacOS",
        "Google Chrome",
      ),
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      path.join(
        home,
        "Applications",
        "Google Chrome Canary.app",
        "Contents",
        "MacOS",
        "Google Chrome Canary",
      ),
    ],
    chromium: [
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      path.join(
        home,
        "Applications",
        "Chromium.app",
        "Contents",
        "MacOS",
        "Chromium",
      ),
    ],
    edge: [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      path.join(
        home,
        "Applications",
        "Microsoft Edge.app",
        "Contents",
        "MacOS",
        "Microsoft Edge",
      ),
    ],
    brave: [
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      path.join(
        home,
        "Applications",
        "Brave Browser.app",
        "Contents",
        "MacOS",
        "Brave Browser",
      ),
    ],
    vivaldi: [
      "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
      path.join(
        home,
        "Applications",
        "Vivaldi.app",
        "Contents",
        "MacOS",
        "Vivaldi",
      ),
    ],
    firefox: [
      "/Applications/Firefox.app/Contents/MacOS/firefox",
      path.join(
        home,
        "Applications",
        "Firefox.app",
        "Contents",
        "MacOS",
        "firefox",
      ),
    ],
  };
  return [...(paths[family] || []), ...(await commandCandidates(family))];
}

async function linuxBrowserCandidates(family) {
  const commands = {
    chrome: [
      "google-chrome-stable",
      "google-chrome",
      "google-chrome-beta",
      "google-chrome-unstable",
    ],
    chromium: ["chromium", "chromium-browser"],
    edge: ["microsoft-edge-stable", "microsoft-edge", "msedge"],
    brave: ["brave-browser", "brave"],
    vivaldi: ["vivaldi-stable", "vivaldi"],
    firefox: ["firefox"],
  };
  const candidates = [];
  for (const command of commands[family] || []) {
    candidates.push(...(await commandCandidates(command)));
  }
  return candidates;
}

async function resolveLinuxDesktopExecutable(desktopId) {
  if (!desktopId) {
    return null;
  }

  const home = os.homedir();
  const dataDirs = [
    process.env.XDG_DATA_HOME &&
      path.join(process.env.XDG_DATA_HOME, "applications"),
    path.join(home, ".local", "share", "applications"),
    ...`${process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share"}`
      .split(":")
      .map((dir) => path.join(dir, "applications")),
  ].filter(Boolean);

  const ids = desktopId.endsWith(".desktop")
    ? [desktopId]
    : [desktopId, `${desktopId}.desktop`];
  for (const dataDir of dataDirs) {
    for (const id of ids) {
      const desktopFile = path.join(dataDir, id);
      const execLine = await readDesktopExecLine(desktopFile);
      const command = execLine && parseDesktopExecCommand(execLine);
      const executable = command && (await resolveCommand(command));
      if (executable) {
        return executable;
      }
    }
  }
  return null;
}

async function readDesktopExecLine(filePath) {
  try {
    const source = await readFile(filePath, "utf8");
    return source
      .split(/\r?\n/u)
      .find((line) => /^Exec=/u.test(line))
      ?.slice("Exec=".length);
  } catch {
    return null;
  }
}

function parseDesktopExecCommand(execLine) {
  const cleaned = execLine.replace(/%[fFuUdDnNickvm]/gu, "").trim();
  if (cleaned.startsWith('"')) {
    return cleaned.match(/^"([^"]+)"/u)?.[1] || null;
  }
  return cleaned.split(/\s+/u)[0] || null;
}

async function openWithSystemDefault(url) {
  if (process.platform === "win32") {
    return launchCommand("cmd", ["/c", "start", "", url]);
  }
  if (process.platform === "darwin") {
    return launchCommand("open", [url]);
  }

  const opener =
    (await resolveCommand("xdg-open")) || (await resolveCommand("gio"));
  if (!opener) {
    return false;
  }
  return path.basename(opener) === "gio"
    ? launchCommand(opener, ["open", url])
    : launchCommand(opener, [url]);
}

async function commandCandidates(command) {
  const resolved = await resolveCommand(command);
  return resolved ? [resolved] : [];
}

async function resolveCommand(command) {
  if (!command) {
    return null;
  }
  if (path.isAbsolute(command)) {
    return (await isExecutable(command)) ? command : null;
  }

  const lookup = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(lookup, [command], {
      windowsHide: true,
    });
    for (const candidate of stdout.split(/\r?\n/u)) {
      const trimmed = candidate.trim();
      if (trimmed && (await isExecutable(trimmed))) {
        return trimmed;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function firstExistingPath(candidates) {
  for (const candidate of candidates.flat().filter(Boolean)) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function isExecutable(filePath) {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
