import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import {
  QQLoginManager,
  SnowlumaLoginManager,
  ensureQQPlaywrightEnvironment,
  type QQQrCodeInfo,
  type QQScanStatus,
} from "../src/index.js";

describe("QQLoginManager - QR Code & Gateway Login (RFC-0001 / RFC-0002)", () => {
  const testQrPath = "/tmp/test-qq-qr.png";
  const testCredsPath = "/tmp/test-qq-credentials.json";

  afterEach(() => {
    try {
      if (fs.existsSync(testQrPath)) fs.unlinkSync(testQrPath);
      if (fs.existsSync(testCredsPath)) fs.unlinkSync(testCredsPath);
    } catch {}
  });

  it("exports SnowlumaLoginManager as an alias of QQLoginManager", () => {
    expect(SnowlumaLoginManager).toBe(QQLoginManager);
  });

  it("sets up Playwright environment variables correctly", () => {
    ensureQQPlaywrightEnvironment();
    expect(process.env.LD_LIBRARY_PATH).toBeDefined();
    expect(process.env.FONTCONFIG_PATH).toBeDefined();
  });

  it("generates QR code image, terminal ASCII QR, and login session", async () => {
    let capturedInfo: QQQrCodeInfo | null = null;

    const manager = new QQLoginManager({
      outputQrPath: testQrPath,
      credentialsSavePath: testCredsPath,
      onQrCode: (info) => {
        capturedInfo = info;
      },
      qrCodeFetcher: async () => ({
        qrcodeKey: "test-qq-key-123",
        qrcodeUrl: "https://qm.qq.com/cgi-bin/qm/qr?k=test-qq-key-123",
        qrDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      }),
    });

    const session = await manager.createLoginSession();

    expect(session).toBeDefined();
    expect(session.info).toBeDefined();
    expect(session.info.qrcodeKey).toBe("test-qq-key-123");
    expect(session.info.qrcodeUrl).toContain("test-qq-key-123");
    expect(session.info.qrImagePath).toBe(testQrPath);
    expect(session.info.terminalQr.length).toBeGreaterThan(0);

    // Verify QR code PNG was written to disk
    expect(fs.existsSync(testQrPath)).toBe(true);

    // Verify callback was invoked
    expect(capturedInfo).not.toBeNull();
    expect(capturedInfo?.qrcodeKey).toBe("test-qq-key-123");

    await session.close();
  });

  it("handles status transitions and successful scan confirmation", async () => {
    let pollCount = 0;
    const statusHistory: QQScanStatus[] = [];

    const manager = new QQLoginManager({
      outputQrPath: testQrPath,
      credentialsSavePath: testCredsPath,
      pollIntervalMs: 50,
      onStatusChange: (status) => {
        statusHistory.push(status);
      },
      qrCodeFetcher: async () => ({
        qrcodeKey: "test-key-progression",
        qrcodeUrl: "https://qm.qq.com/cgi-bin/qm/qr?k=test-key-progression",
      }),
      statusPoller: async () => {
        pollCount++;
        if (pollCount === 1) {
          return { code: 66, status: "not_scanned", message: "未扫码" };
        } else if (pollCount === 2) {
          return { code: 67, status: "scanned_waiting_confirm", message: "已扫码，等待确认" };
        } else {
          return {
            code: 0,
            status: "success",
            message: "登录成功",
            uin: "100001",
            nickname: "Ema Bot",
            token: "qq-test-token-xyz",
          };
        }
      },
    });

    const session = await manager.createLoginSession();
    const result = await session.waitForScan(5000);

    expect(result.success).toBe(true);
    expect(result.uin).toBe("100001");
    expect(result.nickname).toBe("Ema Bot");
    expect(result.token).toBe("qq-test-token-xyz");

    // Verify status transitions recorded
    expect(statusHistory.length).toBeGreaterThanOrEqual(3);
    expect(statusHistory.map((s) => s.status)).toContain("not_scanned");
    expect(statusHistory.map((s) => s.status)).toContain("scanned_waiting_confirm");
    expect(statusHistory.map((s) => s.status)).toContain("success");

    // Verify credentials persisted to disk
    expect(fs.existsSync(testCredsPath)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(testCredsPath, "utf8"));
    expect(persisted.uin).toBe("100001");
    expect(persisted.token).toBe("qq-test-token-xyz");

    await session.close();
  });

  it("handles QR code expiration (code 65 / expired)", async () => {
    const manager = new QQLoginManager({
      outputQrPath: testQrPath,
      credentialsSavePath: testCredsPath,
      pollIntervalMs: 50,
      qrCodeFetcher: async () => ({
        qrcodeKey: "test-expired-key",
        qrcodeUrl: "https://qm.qq.com/cgi-bin/qm/qr?k=test-expired-key",
      }),
      statusPoller: async () => ({
        code: 65,
        status: "expired",
        message: "二维码已过期",
      }),
    });

    const session = await manager.createLoginSession();
    const result = await session.waitForScan(2000);

    expect(result.success).toBe(false);
    expect(result.message).toContain("expired");

    await session.close();
  });

  it("checks existing credentials and verifies active session", async () => {
    // Write valid credentials to disk
    fs.writeFileSync(
      testCredsPath,
      JSON.stringify({
        uin: "998877",
        nickname: "SavedTester",
        token: "saved-token-abc",
      }),
      "utf8",
    );

    const manager = new QQLoginManager({
      credentialsSavePath: testCredsPath,
    });

    const existing = await manager.checkExistingSession();
    expect(existing).not.toBeNull();
    expect(existing?.success).toBe(true);
    expect(existing?.uin).toBe("998877");
    expect(existing?.nickname).toBe("SavedTester");
  });

  it("verifies gateway session with verifySession static method", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/get_login_info")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            data: { user_id: 888888, nickname: "GatewayUser" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    });

    try {
      const verified = await QQLoginManager.verifySession(
        { token: "mock-token" },
        "http://localhost:5700",
      );
      expect(verified.valid).toBe(true);
      expect(verified.uin).toBe("888888");
      expect(verified.nickname).toBe("GatewayUser");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
