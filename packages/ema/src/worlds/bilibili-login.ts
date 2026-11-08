/**
 * @prism-shadow/ema - Bilibili Playwright QR Code Login Manager
 *
 * Implements automated Bilibili QR code generation, Playwright browser-assisted
 * scan polling, cookie extraction, and session persistence per RFC-0001.
 */

import fs from "node:fs";
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
  /** File path where the QR code image PNG should be saved (default: /tmp/bilibili-login-qrcode.png) */
  outputQrPath?: string;
  /** File path where login cookies/credentials JSON should be saved (default: /tmp/bilibili-cookies.json) */
  cookieSavePath?: string;
  /** Callback when QR code is ready */
  onQrCode?: (info: BilibiliQrCodeInfo) => void;
  /** Callback when scan status changes */
  onStatusChange?: (status: BilibiliScanStatus) => void;
  /** Custom Playwright browser instance if reusing */
  browser?: Browser;
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
  browser: Browser;
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
  const libDir = "/home/rei/.local/share/playwright-libs/usr/lib/x86_64-linux-gnu";
  const fontsConf = "/home/rei/.local/share/playwright-libs/etc/fonts";

  if (fs.existsSync(libDir)) {
    const current = process.env.LD_LIBRARY_PATH || "";
    if (!current.includes(libDir)) {
      process.env.LD_LIBRARY_PATH = current ? `${libDir}:${current}` : libDir;
    }
  }

  if (fs.existsSync(fontsConf) && !process.env.FONTCONFIG_PATH) {
    process.env.FONTCONFIG_PATH = fontsConf;
  }
}

export class BilibiliLoginManager {
  private options: BilibiliLoginOptions;

  constructor(options: BilibiliLoginOptions = {}) {
    this.options = {
      headless: true,
      timeoutMs: 180000,
      pollIntervalMs: 1500,
      outputQrPath: options.outputQrPath ?? "/tmp/bilibili-login-qrcode.png",
      cookieSavePath: options.cookieSavePath ?? "/tmp/bilibili-cookies.json",
      ...options,
    };
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

    const browser =
      this.options.browser ??
      (await chromium.launch({
        headless: this.options.headless ?? true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      }));

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        this.options.userAgent ??
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

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

    const qrImagePath = this.options.outputQrPath ?? "/tmp/bilibili-login-qrcode.png";

    // Save PNG image if base64 dataUrl is present
    if (qrData?.dataUrl) {
      const base64Data = qrData.dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const targetDir = path.dirname(qrImagePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(qrImagePath, Buffer.from(base64Data, "base64"));
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
        if (!this.options.browser) {
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
            // Login confirmed! Extract cookies from Playwright context
            await page.waitForTimeout(1000);
            const cookiesList = await context.cookies();
            const cookieMap: Record<string, string> = {};
            for (const c of cookiesList) {
              cookieMap[c.name] = c.value;
            }

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
                fs.mkdirSync(saveDir, { recursive: true });
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
              );
              result.savedPath = this.options.cookieSavePath;
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
   * High-level one-step helper: generates QR code, prints to console, saves file,
   * and waits for scan completion.
   */
  async login(): Promise<BilibiliAuthResult> {
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
}
