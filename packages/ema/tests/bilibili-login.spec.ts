import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  BilibiliLoginManager,
  ensurePlaywrightEnvironment,
  BilibiliWorld,
  type BilibiliQrCodeInfo,
  type BilibiliScanStatus,
} from "../src/index.js";

describe("BilibiliLoginManager - Playwright QR Code Login", () => {
  const testQrPath = "/tmp/test-bilibili-qr.png";
  const testCookiePath = "/tmp/test-bilibili-cookies.json";

  afterEach(() => {
    try {
      if (fs.existsSync(testQrPath)) fs.unlinkSync(testQrPath);
      if (fs.existsSync(testCookiePath)) fs.unlinkSync(testCookiePath);
    } catch {}
  });

  it("sets up Playwright environment variables correctly", () => {
    ensurePlaywrightEnvironment();
    expect(process.env.LD_LIBRARY_PATH).toBeDefined();
    expect(process.env.LD_LIBRARY_PATH).toContain("playwright-libs");
    expect(process.env.FONTCONFIG_PATH).toBeDefined();
  });

  it("generates QR code image, terminal ASCII QR, and login session using Playwright", async () => {
    const manager = new BilibiliLoginManager({
      headless: true,
      outputQrPath: testQrPath,
      cookieSavePath: testCookiePath,
    });

    let reportedInfo: BilibiliQrCodeInfo | null = null;
    manager["options"].onQrCode = (info) => {
      reportedInfo = info;
    };

    const session = await manager.createLoginSession();

    expect(session).toBeDefined();
    expect(session.info).toBeDefined();
    expect(session.info.qrcodeKey).toBeTruthy();
    expect(session.info.qrcodeUrl).toContain("bilibili.com");
    expect(session.info.qrImagePath).toBe(testQrPath);
    expect(session.info.terminalQr.length).toBeGreaterThan(0);

    // Verify QR code PNG was written to disk
    expect(fs.existsSync(testQrPath)).toBe(true);
    const stat = fs.statSync(testQrPath);
    expect(stat.size).toBeGreaterThan(100);

    // Verify callback
    expect(reportedInfo).not.toBeNull();
    expect(reportedInfo?.qrcodeKey).toBe(session.info.qrcodeKey);

    await session.close();
  }, 45000);

  it("handles status transitions and handles expired QR code (86038)", async () => {
    const manager = new BilibiliLoginManager({
      headless: true,
      outputQrPath: testQrPath,
      cookieSavePath: testCookiePath,
      pollIntervalMs: 100,
    });

    const statusUpdates: BilibiliScanStatus[] = [];
    manager["options"].onStatusChange = (status) => {
      statusUpdates.push(status);
    };

    const session = await manager.createLoginSession();

    // Mock global fetch for qrcode/poll to simulate status progression: 86101 -> 86090 -> 86038
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes("qrcode/poll")) {
        callCount++;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              code: 0,
              data: { code: 86101, message: "未扫码" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } else if (callCount === 2) {
          return new Response(
            JSON.stringify({
              code: 0,
              data: { code: 86090, message: "扫码未确认" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } else {
          return new Response(
            JSON.stringify({
              code: 0,
              data: { code: 86038, message: "二维码已失效" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
      }
      return originalFetch(url, init);
    });

    try {
      const result = await session.waitForScan(5000);
      expect(result.success).toBe(false);
      expect(result.message).toContain("86038");

      expect(statusUpdates.length).toBeGreaterThanOrEqual(3);
      expect(statusUpdates.some((s) => s.status === "not_scanned")).toBe(true);
      expect(statusUpdates.some((s) => s.status === "scanned_waiting_confirm")).toBe(true);
      expect(statusUpdates.some((s) => s.status === "expired")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      await session.close();
    }
  }, 45000);

  it("handles successful scan, extracts cookies, and persists credentials", async () => {
    const manager = new BilibiliLoginManager({
      headless: true,
      outputQrPath: testQrPath,
      cookieSavePath: testCookiePath,
      pollIntervalMs: 50,
    });

    const session = await manager.createLoginSession();

    // Mock cookies on context
    vi.spyOn(session.context, "cookies").mockResolvedValue([
      { name: "SESSDATA", value: "sess-test-token-123", domain: ".bilibili.com", path: "/" } as any,
      { name: "bili_jct", value: "csrf-token-abc", domain: ".bilibili.com", path: "/" } as any,
      { name: "DedeUserID", value: "888777666", domain: ".bilibili.com", path: "/" } as any,
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (typeof url === "string" && url.includes("qrcode/poll")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: { code: 0, message: "登录成功" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (typeof url === "string" && url.includes("web-interface/nav")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: { isLogin: true, mid: 888777666, uname: "EmaTestMaster" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return originalFetch(url, init);
    });

    try {
      const result = await session.waitForScan(5000);
      expect(result.success).toBe(true);
      expect(result.uid).toBe("888777666");
      expect(result.uname).toBe("EmaTestMaster");
      expect(result.sessData).toBe("sess-test-token-123");
      expect(result.biliJct).toBe("csrf-token-abc");
      expect(result.cookieString).toContain("SESSDATA=sess-test-token-123");

      // Verify cookies JSON file saved to disk
      expect(fs.existsSync(testCookiePath)).toBe(true);
      const savedContent = JSON.parse(fs.readFileSync(testCookiePath, "utf8"));
      expect(savedContent.uid).toBe("888777666");
      expect(savedContent.uname).toBe("EmaTestMaster");
      expect(savedContent.cookies.SESSDATA).toBe("sess-test-token-123");
    } finally {
      globalThis.fetch = originalFetch;
      await session.close();
    }
  }, 45000);

  it("verifies saved session cookies via BilibiliLoginManager.verifySession", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: { isLogin: true, mid: 12345678, uname: "ActiveUser" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const validCheck = await BilibiliLoginManager.verifySession("SESSDATA=valid_token");
    expect(validCheck.valid).toBe(true);
    expect(validCheck.uid).toBe("12345678");
    expect(validCheck.uname).toBe("ActiveUser");

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: -101,
          data: { isLogin: false },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const invalidCheck = await BilibiliLoginManager.verifySession("SESSDATA=expired");
    expect(invalidCheck.valid).toBe(false);

    globalThis.fetch = originalFetch;
  });

  it("exposes static login helper on BilibiliWorld", () => {
    expect(typeof BilibiliWorld.login).toBe("function");
    expect(typeof BilibiliWorld.createLoginSession).toBe("function");
  });
});
