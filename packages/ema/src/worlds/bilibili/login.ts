/**
 * @prism-shadow/ema - Bilibili Playwright QR Code Login Manager
 *
 * Implements automated Bilibili QR code generation, Playwright browser-assisted
 * scan polling, cookie extraction, and session persistence per RFC-0001.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import qrcodeTerminal from "qrcode-terminal";

export interface BilibiliLoginOptions {
  /** Headless mode for Playwright browser (default: true) */
  headless?: boolean;
  /** Timeout in ms to wait for scan and login confirmation (default: 180000 = 3 min) */
  timeoutMs?: number;
  /** Polling interval in ms for checking scan status (default: 1500ms) */
  pollIntervalMs?: number;
  /** File path where the QR code image PNG should be saved (default: .bilibili-login-qrcode.png in cwd) */
  outputQrPath?: string;
  /** File path where login cookies/credentials JSON should be saved (default: bilibili-cookies.json in cwd) */
  cookieSavePath?: string;
  /** File path where Playwright standard storageState should be saved (default: bilibili-storage-state.json) */
  storageStatePath?: string;
  /** Persistent browser profile directory (default: .bilibili-profile) */
  userDataDir?: string;
  /** Callback when QR code is ready */
  onQrCode?: (info: BilibiliQrCodeInfo) => void;
  /** Callback when scan status changes */
  onStatusChange?: (status: BilibiliScanStatus) => void;
  /** Custom Playwright browser instance if reusing */
  browser?: Browser;
  /** Custom Playwright browser context if reusing */
  context?: BrowserContext;
  /** User agent string for Playwright */
  userAgent?: string;
}

export interface BilibiliQrCodeInfo {
  qrcodeKey: string;
  qrcodeUrl: string;
  qrImagePath: string;
  qrDataUrl?: string;
  terminalQr: string;
  expiresAt: number;
}

export interface BilibiliScanStatus {
  code: number;
  status: "not_scanned" | "scanned_waiting_confirm" | "success" | "expired" | "unknown";
  message: string;
}

export interface BilibiliPublishDynamicOptions {
  /** Headless mode for Playwright browser (default: true) */
  headless?: boolean;
  /** Persistent browser profile directory (default: .bilibili-profile) */
  userDataDir?: string;
  /** File path where Playwright standard storageState is saved (default: bilibili-storage-state.json) */
  storageStatePath?: string;
  /** Maximum timeout in ms (default: 45000) */
  timeoutMs?: number;
  /** User agent string for Playwright */
  userAgent?: string;
  /** Optional custom context for testing / mocking */
  context?: BrowserContext;
}

export interface BilibiliPublishDynamicResult {
  success: boolean;
  dynamicId?: string;
  url?: string;
  message?: string;
}

export interface BilibiliAuthResult {
  success: boolean;
  uid?: string;
  uname?: string;
  sessData?: string;
  biliJct?: string;
  cookies: Record<string, string>;
  cookieString: string;
  savedPath?: string;
  message?: string;
}

export interface BilibiliLoginSession {
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  info: BilibiliQrCodeInfo;
  waitForScan: (timeoutMs?: number) => Promise<BilibiliAuthResult>;
  close: () => Promise<void>;
}

/**
 * Ensures shared library paths and fontconfig configuration are available for Playwright Chromium.
 */
export function ensurePlaywrightEnvironment(): void {
  const baseDir =
    process.env.PLAYWRIGHT_LIBS_DIR ||
    path.join(os.homedir(), ".local", "share", "playwright-libs");
  const libDir = path.join(baseDir, "usr", "lib", "x86_64-linux-gnu");
  const fontsConf = path.join(baseDir, "etc", "fonts");
  const usrShare = path.join(baseDir, "usr", "share");

  if (fs.existsSync(libDir)) {
    const current = process.env.LD_LIBRARY_PATH || "";
    if (!current.includes(libDir)) {
      process.env.LD_LIBRARY_PATH = current ? `${libDir}:${current}` : libDir;
    }
  }

  if (fs.existsSync(fontsConf) && !process.env.FONTCONFIG_PATH) {
    process.env.FONTCONFIG_PATH = fontsConf;
  }

  if (fs.existsSync(path.join(usrShare, "fonts")) && !process.env.XDG_DATA_HOME) {
    process.env.XDG_DATA_HOME = usrShare;
  }
}

export class BilibiliLoginManager {
  private options: BilibiliLoginOptions;

  constructor(options: BilibiliLoginOptions = {}) {
    this.options = {
      headless: true,
      timeoutMs: 180000,
      pollIntervalMs: 1500,
      outputQrPath:
        options.outputQrPath ?? path.resolve(process.cwd(), ".bilibili-login-qrcode.png"),
      cookieSavePath:
        options.cookieSavePath ?? path.resolve(process.cwd(), "bilibili-cookies.json"),
      storageStatePath:
        options.storageStatePath ?? path.resolve(process.cwd(), "bilibili-storage-state.json"),
      userDataDir: options.userDataDir,
      ...options,
    };
  }

  /**
   * Checks if an existing persistent browser profile or storageState is already authenticated.
   */
  async checkExistingSession(): Promise<BilibiliAuthResult | null> {
    // 1. Check storageState file if present
    if (this.options.storageStatePath && fs.existsSync(this.options.storageStatePath)) {
      const state = JSON.parse(fs.readFileSync(this.options.storageStatePath, "utf8"));
      if (Array.isArray(state.cookies)) {
        const cookieMap: Record<string, string> = {};
        for (const c of state.cookies) {
          cookieMap[c.name] = c.value;
        }
        if (cookieMap["SESSDATA"] && cookieMap["DedeUserID"]) {
          const check = await BilibiliLoginManager.verifySession(cookieMap);
          if (check.valid) {
            const cookieString = Object.entries(cookieMap)
              .map(([k, v]) => `${k}=${v}`)
              .join("; ");
            return {
              success: true,
              uid: check.uid,
              uname: check.uname,
              sessData: cookieMap["SESSDATA"],
              biliJct: cookieMap["bili_jct"],
              cookies: cookieMap,
              cookieString,
              savedPath: this.options.storageStatePath,
              message: "Active authenticated session found in storageState.",
            };
          }
        }
      }
    }

    // 2. Check cookieSavePath if present
    if (this.options.cookieSavePath && fs.existsSync(this.options.cookieSavePath)) {
      const saved = JSON.parse(fs.readFileSync(this.options.cookieSavePath, "utf8"));
      if (saved.cookies?.SESSDATA && (saved.cookies?.DedeUserID || saved.uid)) {
        const check = await BilibiliLoginManager.verifySession(saved.cookies);
        if (check.valid) {
          return {
            success: true,
            uid: check.uid,
            uname: check.uname,
            sessData: saved.cookies.SESSDATA,
            biliJct: saved.cookies.bili_jct,
            cookies: saved.cookies,
            cookieString: saved.cookieString,
            savedPath: this.options.cookieSavePath,
            message: "Active authenticated session found in saved cookies.",
          };
        }
      }
    }

    return null;
  }

  /**
   * Initializes Playwright, loads the Bilibili login page, intercepts the QR code,
   * saves the QR code PNG to disk, formats a terminal ASCII QR code, and returns
   * a handle to monitor scan confirmation.
   */
  async createLoginSession(): Promise<BilibiliLoginSession> {
    ensurePlaywrightEnvironment();

    let capturedKey = "";
    let capturedUrl = "";

    let context: BrowserContext;
    let browser: Browser | undefined = this.options.browser;

    if (this.options.context) {
      context = this.options.context;
    } else if (this.options.userDataDir) {
      const profileDir = path.resolve(this.options.userDataDir);
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }
      context = await chromium.launchPersistentContext(profileDir, {
        headless: this.options.headless ?? true,
        viewport: { width: 1280, height: 800 },
        userAgent:
          this.options.userAgent ??
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
    } else {
      if (!browser) {
        browser = await chromium.launch({
          headless: this.options.headless ?? true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
          ],
        });
      }
      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          this.options.userAgent ??
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
    }

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    // Listen for Bilibili passport QR code generation API response
    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("qrcode/generate")) {
        try {
          const json = await res.json();
          if (json?.data) {
            capturedKey = json.data.qrcode_key || capturedKey;
            capturedUrl = json.data.url || capturedUrl;
          }
        } catch {}
      }
    });

    try {
      await page.goto("https://passport.bilibili.com/login", {
        waitUntil: "networkidle",
        timeout: 30000,
      });
    } catch {
      // In case networkidle times out on background analytics, fallback to domcontentloaded
      await page.goto("https://passport.bilibili.com/login", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForTimeout(2000);
    }

    // If API response was not captured by interceptor, generate directly via API
    if (!capturedKey || !capturedUrl) {
      try {
        const apiRes = await fetch(
          "https://passport.bilibili.com/x/passport-login/web/qrcode/generate",
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Referer: "https://passport.bilibili.com/login",
            },
          },
        );
        const apiJson = (await apiRes.json()) as {
          code: number;
          data?: { qrcode_key: string; url: string };
        };
        if (apiJson.code === 0 && apiJson.data) {
          capturedKey = apiJson.data.qrcode_key;
          capturedUrl = apiJson.data.url;
        }
      } catch (apiErr) {
        console.error("[BilibiliLoginManager] Failed to fetch qrcode generate API:", apiErr);
      }
    }

    // Extract QR code image (data URL or canvas) from Playwright page
    const qrData = await page.evaluate(() => {
      const img = document.querySelector(
        'img[alt="Scan me!"], .qrcode-login img, [class*="qrcode"] img',
      ) as HTMLImageElement | null;
      if (img && img.src && img.src.startsWith("data:image")) {
        return { dataUrl: img.src };
      }
      const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
      if (canvas) {
        return { dataUrl: canvas.toDataURL("image/png") };
      }
      return null;
    });

    const qrImagePath =
      this.options.outputQrPath ?? path.resolve(process.cwd(), ".bilibili-login-qrcode.png");

    // Save PNG image if base64 dataUrl is present
    if (qrData?.dataUrl) {
      const base64Data = qrData.dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const targetDir = path.dirname(qrImagePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(qrImagePath, Buffer.from(base64Data, "base64"), { mode: 0o600 });
    }

    // Format terminal ASCII QR code
    let terminalQr = "";
    if (capturedUrl) {
      const q = (qrcodeTerminal as any).default || qrcodeTerminal;
      q.generate(capturedUrl, { small: true }, (qrStr: string) => {
        terminalQr = qrStr;
      });
    }

    const info: BilibiliQrCodeInfo = {
      qrcodeKey: capturedKey,
      qrcodeUrl: capturedUrl,
      qrImagePath,
      qrDataUrl: qrData?.dataUrl,
      terminalQr,
      expiresAt: Date.now() + 180000,
    };

    if (this.options.onQrCode) {
      this.options.onQrCode(info);
    }

    let isClosed = false;
    const close = async () => {
      if (isClosed) return;
      isClosed = true;
      try {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        if (!this.options.browser && browser) {
          await browser.close().catch(() => {});
        }
      } catch {}
    };

    const waitForScan = async (timeoutMs?: number): Promise<BilibiliAuthResult> => {
      const maxWait = timeoutMs ?? this.options.timeoutMs ?? 180000;
      const pollInterval = this.options.pollIntervalMs ?? 1500;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait && !isClosed) {
        try {
          const pollUrl = `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(
            capturedKey,
          )}`;
          const pollRes = await fetch(pollUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Referer: "https://passport.bilibili.com/login",
            },
          });
          const pollJson = (await pollRes.json()) as {
            code: number;
            data?: {
              code: number;
              message: string;
              url?: string;
              refresh_token?: string;
            };
          };

          const dataCode = pollJson?.data?.code ?? pollJson.code;
          const dataMessage = pollJson?.data?.message || "Unknown";

          let statusType: BilibiliScanStatus["status"] = "unknown";
          if (dataCode === 86101) statusType = "not_scanned";
          else if (dataCode === 86090) statusType = "scanned_waiting_confirm";
          else if (dataCode === 0) statusType = "success";
          else if (dataCode === 86038) statusType = "expired";

          if (this.options.onStatusChange) {
            this.options.onStatusChange({
              code: dataCode,
              status: statusType,
              message: dataMessage,
            });
          }

          if (dataCode === 0) {
            // Login confirmed! Extract cookies from response headers and Playwright context
            const cookieMap: Record<string, string> = {};

            // 1. Extract from poll response Set-Cookie headers
            const setCookieHeaders =
              typeof pollRes.headers.getSetCookie === "function"
                ? pollRes.headers.getSetCookie()
                : [];
            for (const sc of setCookieHeaders) {
              const [nv] = sc.split(";");
              if (nv) {
                const [name, ...val] = nv.split("=");
                if (name && val.length > 0) {
                  cookieMap[name.trim()] = val.join("=").trim();
                }
              }
            }

            // 2. If poll response returned cross-domain authentication URL, navigate to settle session
            if (pollJson?.data?.url) {
              try {
                await page.goto(pollJson.data.url, { waitUntil: "domcontentloaded", timeout: 15000 });
              } catch {}
            }

            // 3. Extract cookies from Playwright context and merge
            await page.waitForTimeout(1000);
            try {
              const cookiesList = await context.cookies();
              for (const c of cookiesList) {
                cookieMap[c.name] = c.value;
              }
            } catch {}

            const cookieString = Object.entries(cookieMap)
              .map(([k, v]) => `${k}=${v}`)
              .join("; ");

            const uid = cookieMap["DedeUserID"];
            const sessData = cookieMap["SESSDATA"];
            const biliJct = cookieMap["bili_jct"];

            // Fetch user display name
            let uname = `User_${uid || "bilibili"}`;
            try {
              const userRes = await fetch("https://api.bilibili.com/x/web-interface/nav", {
                headers: {
                  Cookie: cookieString,
                  "User-Agent":
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  Referer: "https://www.bilibili.com",
                },
              });
              const userJson = (await userRes.json()) as {
                code: number;
                data?: { uname?: string };
              };
              if (userJson.code === 0 && userJson.data?.uname) {
                uname = userJson.data.uname;
              }
            } catch {}

            const result: BilibiliAuthResult = {
              success: true,
              uid,
              uname,
              sessData,
              biliJct,
              cookies: cookieMap,
              cookieString,
              message: "Bilibili QR code login succeeded.",
            };

            // Save cookies to disk if configured
            if (this.options.cookieSavePath) {
              const saveDir = path.dirname(this.options.cookieSavePath);
              if (!fs.existsSync(saveDir)) {
                fs.mkdirSync(saveDir, { recursive: true, mode: 0o700 });
              }
              fs.writeFileSync(
                this.options.cookieSavePath,
                JSON.stringify(
                  {
                    uid,
                    uname,
                    savedAt: new Date().toISOString(),
                    cookies: cookieMap,
                    cookieString,
                  },
                  null,
                  2,
                ),
                { mode: 0o600 },
              );
              result.savedPath = this.options.cookieSavePath;
            }

            // Save standard Playwright storageState if configured
            if (this.options.storageStatePath) {
              const stateDir = path.dirname(this.options.storageStatePath);
              if (!fs.existsSync(stateDir)) {
                fs.mkdirSync(stateDir, { recursive: true });
              }
              try {
                const cookiesToAdd = [];
                for (const [name, value] of Object.entries(cookieMap)) {
                  cookiesToAdd.push({
                    name,
                    value,
                    domain: ".bilibili.com",
                    path: "/",
                  });
                }
                if (cookiesToAdd.length > 0 && typeof context.addCookies === "function") {
                  await context.addCookies(cookiesToAdd).catch(() => {});
                }
                await context.storageState({ path: this.options.storageStatePath });
              } catch {}
            }

            await close();
            return result;
          }

          if (dataCode === 86038) {
            await close();
            return {
              success: false,
              cookies: {},
              cookieString: "",
              message: "QR code expired (86038). Please generate a new code.",
            };
          }
        } catch (err) {
          console.error("[BilibiliLoginManager] Polling check error:", err);
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      await close();
      return {
        success: false,
        cookies: {},
        cookieString: "",
        message: `Login timed out after ${maxWait}ms.`,
      };
    };

    return {
      browser,
      context,
      page,
      info,
      waitForScan,
      close,
    };
  }

  /**
   * High-level one-step helper: checks for existing session or persistent profile,
   * generates QR code, prints to console, saves file, and waits for scan completion.
   */
  async login(): Promise<BilibiliAuthResult> {
    const existing = await this.checkExistingSession();
    if (existing) {
      console.log("\n==========================================");
      console.log("   Bilibili Login (RFC-0001 - Active)");
      console.log("==========================================");
      console.log("Active authenticated session found!");
      console.log(`Welcome back, ${existing.uname} (UID: ${existing.uid})`);
      return existing;
    }

    const session = await this.createLoginSession();
    console.log("\n==========================================");
    console.log("   Bilibili QR Code Login (RFC-0001)");
    console.log("==========================================");
    console.log(`Scan URL:   ${session.info.qrcodeUrl}`);
    console.log(`Image File: ${session.info.qrImagePath}`);
    console.log("\nScan the QR code below with the Bilibili mobile app:\n");
    console.log(session.info.terminalQr);
    console.log("Waiting for mobile app scan confirmation...");

    return session.waitForScan();
  }

  /**
   * Verifies whether an existing saved cookie file or string is valid and active.
   */
  static async verifySession(
    cookieInput: string | Record<string, string>,
  ): Promise<{ valid: boolean; uid?: string; uname?: string }> {
    const cookieString =
      typeof cookieInput === "string"
        ? cookieInput
        : Object.entries(cookieInput)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ");

    try {
      const res = await fetch("https://api.bilibili.com/x/web-interface/nav", {
        headers: {
          Cookie: cookieString,
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://www.bilibili.com",
        },
      });
      const data = (await res.json()) as {
        code: number;
        data?: { isLogin: boolean; mid: number; uname: string };
      };

      if (data.code === 0 && data.data?.isLogin) {
        return {
          valid: true,
          uid: String(data.data.mid),
          uname: data.data.uname,
        };
      }
      return { valid: false };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Publishes a feed dynamic post via Playwright browser automation
   * using the persistent browser profile or storageState.
   */
  async publishDynamic(
    text: string,
    options?: Partial<BilibiliPublishDynamicOptions>,
  ): Promise<BilibiliPublishDynamicResult> {
    return publishBilibiliDynamic(text, {
      headless: this.options.headless,
      userDataDir: this.options.userDataDir,
      storageStatePath: this.options.storageStatePath,
      userAgent: this.options.userAgent,
      context: this.options.context,
      ...options,
    });
  }
}

/**
 * Publishes a dynamic post on Bilibili using Playwright browser automation
 * to conform with risk-control and Wbi signing requirements.
 */
export async function publishBilibiliDynamic(
  text: string,
  options: BilibiliPublishDynamicOptions = {},
): Promise<BilibiliPublishDynamicResult> {
  ensurePlaywrightEnvironment();

  if (!text || !text.trim()) {
    return {
      success: false,
      message: "Dynamic text content cannot be empty.",
    };
  }

  const profileDir = path.resolve(options.userDataDir ?? ".bilibili-profile");
  const storageStatePath = path.resolve(
    options.storageStatePath ?? path.resolve(process.cwd(), "bilibili-storage-state.json"),
  );

  let browser: Browser | null = null;
  let context: BrowserContext;
  let ownsContext = false;

  if (options.context) {
    context = options.context;
  } else if (storageStatePath && fs.existsSync(storageStatePath)) {
    ownsContext = true;
    browser = await chromium.launch({
      headless: options.headless ?? true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    context = await browser.newContext({
      storageState: storageStatePath,
      viewport: { width: 1280, height: 800 },
      locale: "zh-CN",
      userAgent:
        options.userAgent ??
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
  } else {
    ownsContext = true;
    context = await chromium.launchPersistentContext(profileDir, {
      headless: options.headless ?? true,
      viewport: { width: 1280, height: 800 },
      locale: "zh-CN",
      userAgent:
        options.userAgent ??
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }

  try {
    if (!browser && storageStatePath && fs.existsSync(storageStatePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(storageStatePath, "utf8"));
        if (Array.isArray(state.cookies) && state.cookies.length > 0) {
          await context.addCookies(state.cookies);
        }
      } catch {}
    }

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    await page.setExtraHTTPHeaders({
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    });

    let capturedDynId = "";
    let capturedCode = -1;
    let capturedMessage = "";

    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("/dynamic/feed/create/dyn")) {
        try {
          const json = await res.json();
          capturedCode = json.code;
          capturedMessage = json.message || "";
          if (json.code === 0 && (json.data?.dyn_id_str || json.data?.dyn_id)) {
            capturedDynId = String(json.data.dyn_id_str || json.data.dyn_id);
          }
        } catch {}
      }
    });

    await page.goto("https://t.bilibili.com", {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs ?? 45000,
    });

    const editor = page.locator(".bili-rich-textarea__inner");
    await editor.waitFor({ state: "visible", timeout: 20000 });

    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(200);

    await page.keyboard.type(text.trim());
    await page.waitForTimeout(500);

    const publishBtn = page.locator(".bili-dyn-publishing__action.launcher");
    await publishBtn.click();
    await page.waitForTimeout(1000);

    // If first-time specification modal appears, confirm it
    const confirmBtn = page.locator(
      ".bili-dyn-specification-popup__btn.bili-button.primary:has-text('确认并发送')",
    );
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Wait for submission response or feed update
    const timeoutAt = Date.now() + (options.timeoutMs ?? 30000);
    while (Date.now() < timeoutAt) {
      if (capturedDynId) break;
      await page.waitForTimeout(800);
    }

    // Save back updated storage state
    if (storageStatePath) {
      try {
        await context.storageState({ path: storageStatePath });
      } catch {}
    }

    if (capturedDynId) {
      return {
        success: true,
        dynamicId: capturedDynId,
        url: `https://t.bilibili.com/${capturedDynId}`,
        message: "Dynamic published successfully.",
      };
    }

    if (capturedCode === 0) {
      return {
        success: true,
        message: "Dynamic published successfully.",
      };
    }

    return {
      success: false,
      message: capturedMessage || "Failed to publish dynamic (no confirmation response).",
    };
  } finally {
    if (ownsContext) {
      await context.close().catch(() => {});
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}
