/**
 * @prism-shadow/ema - QQ Authorization & Decoupled Reverse Proxy Gateway Tests
 *
 * Verifies:
 * 1. Decoupled Snowluma / OneBot 11 Reverse Proxy Gateway:
 *    - Connects to remote or reverse-proxied gateway address without local login
 *    - Forwards custom headers and Bearer auth tokens
 *    - Verifies inbound webhook HMAC-SHA1 signatures (X-Signature: sha1=...)
 *    - Auto-discovers bot user ID and nickname via /get_login_info
 *    - Gateway health status reporting
 * 2. Config Authorization (Friends & Groups query & speak restrictions):
 *    - Inbound message/poke rejection for unauthorized users and groups
 *    - Outbound speak (interact & actions) rejection for unauthorized users and groups
 *    - Channel and part query isolation (unauthorized entities are hidden and return 403)
 *    - Dynamic authorization mutations and status inspection
 *    - Environment variables fallback configuration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import {
  QQWorld,
  SnowlumaWorld,
  QQAuthorizationManager,
  QQAuthorizationError,
  createOneBotHttpCaller,
  verifyOneBotWebhookSignature,
  queryGatewayLoginInfo,
  queryGatewayHealth,
  normalizeQQUserId,
  normalizeQQGroupId,
  SimpleEmaRouter,
  type EmaCtx,
  type EmaActor,
  type OneBotEvent,
  type OneBotApiCall,
  type OneBotApiResponse,
} from "../src/index.js";

describe("QQ World - Decoupled Remote / Reverse Proxy Gateway", () => {
  it("normalizes and dispatches HTTP API calls to a reverse-proxied gateway with custom headers and auth", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown = null;

    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body || "{}"));

      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "ok",
          retcode: 0,
          data: { message_id: 12345678 },
          echo: capturedBody.echo,
        }),
      } as Response;
    });

    vi.stubGlobal("fetch", mockFetch);

    try {
      const caller = createOneBotHttpCaller({
        gatewayUrl: "https://snowluma.proxy.domain/api/v1/",
        gatewayToken: "secret_proxy_bearer_token",
        gatewayHeaders: {
          "X-Forwarded-For": "10.0.0.1",
          "X-Proxy-Cluster": "ap-east-1",
        },
      });

      const res = await caller({
        action: "send_private_msg",
        params: { user_id: 888888, message: "Hello from reverse proxy!" },
        echo: "test-echo-1",
      });

      expect(res.status).toBe("ok");
      expect(res.retcode).toBe(0);
      expect((res.data as any).message_id).toBe(12345678);
      expect(capturedUrl).toBe("https://snowluma.proxy.domain/api/v1/send_private_msg");
      expect(capturedHeaders["Authorization"]).toBe("Bearer secret_proxy_bearer_token");
      expect(capturedHeaders["X-Proxy-Cluster"]).toBe("ap-east-1");
      expect(capturedBody.user_id).toBe(888888);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("verifies webhook HMAC-SHA1 signatures from reverse-proxied gateways", () => {
    const secret = "my_snowluma_webhook_secret_key";
    const body = JSON.stringify({
      post_type: "message",
      message_type: "private",
      user_id: 123456,
      message: "hello",
    });

    const validHmac = crypto.createHmac("sha1", secret).update(body).digest("hex");
    const validHeader = `sha1=${validHmac}`;

    expect(verifyOneBotWebhookSignature(body, validHeader, secret)).toBe(true);

    // Invalid signature
    const invalidHeader = `sha1=deadbeef1234567890abcdef1234567890abcdef`;
    expect(verifyOneBotWebhookSignature(body, invalidHeader, secret)).toBe(false);

    // Missing signature header
    expect(verifyOneBotWebhookSignature(body, undefined, secret)).toBe(false);

    // Malformed header prefix
    expect(verifyOneBotWebhookSignature(body, `sha256=${validHmac}`, secret)).toBe(false);

    // No secret configured (permissive)
    expect(verifyOneBotWebhookSignature(body, undefined, undefined)).toBe(true);
  });

  it("queries gateway health and auto-discovers login info on remote gateway", async () => {
    const mockCaller = vi.fn(async (call: OneBotApiCall): Promise<OneBotApiResponse> => {
      if (call.action === "get_login_info") {
        return {
          status: "ok",
          retcode: 0,
          data: { user_id: 99887766, nickname: "EmaRemoteBot" },
        };
      }
      if (call.action === "get_status") {
        return {
          status: "ok",
          retcode: 0,
          data: { online: true, good: true },
        };
      }
      if (call.action === "get_version_info") {
        return {
          status: "ok",
          retcode: 0,
          data: { app_name: "Snowluma-Proxy", app_version: "2.5.0" },
        };
      }
      return { status: "failed", retcode: -1 };
    });

    const loginInfo = await queryGatewayLoginInfo(mockCaller);
    expect(loginInfo?.userId).toBe("99887766");
    expect(loginInfo?.nickname).toBe("EmaRemoteBot");

    const health = await queryGatewayHealth(mockCaller);
    expect(health.connected).toBe(true);
    expect(health.online).toBe(true);
    expect(health.appName).toBe("Snowluma-Proxy");
    expect(health.appVersion).toBe("2.5.0");
  });

  it("runs QQWorld completely decoupled from local login when configured with remote gateway", async () => {
    const router = new SimpleEmaRouter();
    const ctx: EmaCtx = {
      router,
      inputBatcher: { push: vi.fn(), onBatch: vi.fn(() => ({ dispose: vi.fn() })) },
      registry: { register: vi.fn(() => ({ dispose: vi.fn() })), get: vi.fn(), list: vi.fn() },
    };

    const mockApiCaller = vi.fn(async (call: OneBotApiCall): Promise<OneBotApiResponse> => {
      if (call.action === "get_status") {
        return {
          status: "ok",
          retcode: 0,
          data: { online: true, good: true },
        };
      }
      if (call.action === "get_version_info") {
        return {
          status: "ok",
          retcode: 0,
          data: { app_name: "ReverseProxyGateway", app_version: "1.0" },
        };
      }
      return { status: "ok", retcode: 0, data: {} };
    });

    const world = new QQWorld({
      gatewayUrl: "https://my-reverse-proxy.internal:8080/snowluma",
      gatewayToken: "token-abc-123",
      apiCaller: mockApiCaller,
      selfId: "333444",
      passive: true,
    });

    const handle = world.start(ctx);
    try {
      expect(world.getGatewayUrl()).toBe("https://my-reverse-proxy.internal:8080/snowluma");

      // Verify router gateway status query returns decoupled connection info
      const statusRes = (await router.read("/world/qq/gateway/status")) as any;
      expect(statusRes.world).toBe("qq");
      expect(statusRes.connected).toBe(true);
      expect(statusRes.mode).toBe("remote_gateway");
      expect(statusRes.selfId).toBe("333444");
      expect(statusRes.appName).toBe("ReverseProxyGateway");
    } finally {
      handle.dispose();
      world.dispose();
    }
  });
});

describe("QQ World - Authorization Guardrails (Config Authorization)", () => {
  it("normalizes user and group identifiers correctly", () => {
    expect(normalizeQQUserId("user:qq:123456")).toBe("123456");
    expect(normalizeQQUserId("qq:person:789012")).toBe("789012");
    expect(normalizeQQUserId("private:999")).toBe("999");
    expect(normalizeQQUserId("dm:888")).toBe("888");
    expect(normalizeQQUserId(555)).toBe("555");

    expect(normalizeQQGroupId("qq:group:654321")).toBe("654321");
    expect(normalizeQQGroupId("group:112233")).toBe("112233");
    expect(normalizeQQGroupId(445566)).toBe("445566");
  });

  it("enforces allowedUsers and allowedGroups in QQAuthorizationManager", () => {
    const auth = new QQAuthorizationManager({
      enabled: true,
      allowedUsers: ["1001", "1002"],
      allowedGroups: ["2001"],
      adminUsers: ["9999"],
      defaultPolicy: "deny",
    });

    // Users
    expect(auth.isAuthorizedUser("1001")).toBe(true);
    expect(auth.isAuthorizedUser("1002")).toBe(true);
    expect(auth.isAuthorizedUser("user:qq:1001")).toBe(true);
    expect(auth.isAuthorizedUser("1003")).toBe(false);
    expect(auth.isAuthorizedUser("9999")).toBe(true); // admin

    // Groups
    expect(auth.isAuthorizedGroup("2001")).toBe(true);
    expect(auth.isAuthorizedGroup("group:2001")).toBe(true);
    expect(auth.isAuthorizedGroup("2002")).toBe(false);
  });

  it("blocks inbound events from unauthorized friends and groups", async () => {
    const pushedInputs: any[] = [];
    const ctx: EmaCtx = {
      router: new SimpleEmaRouter(),
      inputBatcher: {
        push: (input) => pushedInputs.push(input),
        onBatch: vi.fn(() => ({ dispose: vi.fn() })),
      },
      registry: { register: vi.fn(() => ({ dispose: vi.fn() })), get: vi.fn(), list: vi.fn() },
    };

    const world = new QQWorld({
      selfId: "100001",
      allowedUsers: ["friend_123"],
      allowedGroups: ["group_456"],
      passive: true,
      env: { PENGUIN_AGENT_ID: "emafanclub_ema_dev" },
    });

    const handle = world.start(ctx);
    try {
      // 1. Authorized private message -> ingested
      const allowedMsg: OneBotEvent = {
        post_type: "message",
        message_type: "private",
        user_id: "friend_123",
        message: "Hello authorized friend",
      };
      const res1 = await world.ingestEvent(allowedMsg);
      expect(res1).not.toBeNull();
      expect(res1?.content).toBe("Hello authorized friend");

      // 2. Unauthorized private message -> rejected with QQAuthorizationError
      const unauthorizedMsg: OneBotEvent = {
        post_type: "message",
        message_type: "private",
        user_id: "stranger_999",
        message: "Hello stranger",
      };
      await expect(world.ingestEvent(unauthorizedMsg)).rejects.toThrow(QQAuthorizationError);

      // 3. Authorized group message -> ingested
      const allowedGroupMsg: OneBotEvent = {
        post_type: "message",
        message_type: "group",
        group_id: "group_456",
        user_id: "any_member_777",
        message: "Hello authorized group",
      };
      const res3 = await world.ingestEvent(allowedGroupMsg);
      expect(res3).not.toBeNull();
      expect(res3?.content).toBe("Hello authorized group");

      // 4. Unauthorized group message -> rejected
      const unauthorizedGroupMsg: OneBotEvent = {
        post_type: "message",
        message_type: "group",
        group_id: "secret_group_888",
        user_id: "any_member",
        message: "Hello unauthorized group",
      };
      await expect(world.ingestEvent(unauthorizedGroupMsg)).rejects.toThrow(QQAuthorizationError);

      // 5. Unauthorized poke -> rejected
      const unauthorizedPoke: OneBotEvent = {
        post_type: "notice",
        notice_type: "notify",
        sub_type: "poke",
        target_id: "100001",
        user_id: "stranger_999",
      };
      await expect(world.ingestEvent(unauthorizedPoke)).rejects.toThrow(QQAuthorizationError);
    } finally {
      handle.dispose();
      world.dispose();
    }
  });

  it("refuses speaking/interact to unauthorized friends and groups", async () => {
    const ctx: EmaCtx = {
      router: new SimpleEmaRouter(),
      inputBatcher: { push: vi.fn(), onBatch: vi.fn(() => ({ dispose: vi.fn() })) },
      registry: { register: vi.fn(() => ({ dispose: vi.fn() })), get: vi.fn(), list: vi.fn() },
    };

    const world = new QQWorld({
      selfId: "100001",
      allowedUsers: ["friend_123"],
      allowedGroups: ["group_456"],
      passive: true,
      env: { PENGUIN_AGENT_ID: "emafanclub_ema_dev" },
    });

    const actor: EmaActor = {
      id: "actor-1",
      name: "Ema Dev",
      agentId: "emafanclub_ema_dev",
      session: "sess-1",
    };

    const handle = world.start(ctx);
    try {
      // 1. Authorized private speak -> succeeds
      expect(() => {
        world.interact(ctx, actor, "private:friend_123", { text: "Hello friend" });
      }).not.toThrow();

      // 2. Unauthorized private speak -> throws QQAuthorizationError
      expect(() => {
        world.interact(ctx, actor, "private:stranger_999", { text: "Hello stranger" });
      }).toThrow(QQAuthorizationError);

      // 3. Authorized group speak -> succeeds
      expect(() => {
        world.interact(ctx, actor, "group:group_456", { text: "Hello group" });
      }).not.toThrow();

      // 4. Unauthorized group speak -> throws QQAuthorizationError
      expect(() => {
        world.interact(ctx, actor, "group:random_group_777", { text: "Hello unauthorized group" });
      }).toThrow(QQAuthorizationError);

      // 5. Proactive greeting refused for unauthorized user
      const greetRes = await world.sendProactiveGreeting(
        ctx,
        actor,
        "stranger_999",
        "wake",
      );
      expect(greetRes.sent).toBe(false);
      expect(greetRes.reason).toBe("unauthorized_user");
    } finally {
      handle.dispose();
      world.dispose();
    }
  });

  it("isolates channel and part query endpoints, hiding and blocking unauthorized entities", async () => {
    const router = new SimpleEmaRouter();
    const ctx: EmaCtx = {
      router,
      inputBatcher: { push: vi.fn(), onBatch: vi.fn(() => ({ dispose: vi.fn() })) },
      registry: { register: vi.fn(() => ({ dispose: vi.fn() })), get: vi.fn(), list: vi.fn() },
    };

    const world = new QQWorld({
      selfId: "100001",
      groups: ["group_allowed", "group_forbidden"],
      privateUsers: ["user_allowed", "user_forbidden"],
      allowedUsers: ["user_allowed"],
      allowedGroups: ["group_allowed"],
      passive: true,
      env: { PENGUIN_AGENT_ID: "emafanclub_ema_dev" },
    });

    const handle = world.start(ctx);
    try {
      // 1. /channels lists ONLY authorized channels
      const channelsRes = (await router.read("/world/qq/channels")) as any;
      const chIds = channelsRes.channels.map((c: any) => c.id);
      expect(chIds).toContain("qq:group:group_allowed");
      expect(chIds).toContain("qq:private:user_allowed");
      expect(chIds).not.toContain("qq:group:group_forbidden");
      expect(chIds).not.toContain("qq:private:user_forbidden");

      // 2. /parts lists ONLY authorized parts
      const partsRes = (await router.read("/world/qq/parts")) as any;
      const partIds = partsRes.parts.map((p: any) => p.id);
      expect(partIds).toContain("group:group_allowed");
      expect(partIds).toContain("private:user_allowed");
      expect(partIds).not.toContain("group:group_forbidden");
      expect(partIds).not.toContain("private:user_forbidden");

      // 3. Directly querying forbidden channel items throws authorization error
      await expect(
        router.read("/world/qq/channels/qq:group:group_forbidden/items"),
      ).rejects.toThrow(/forbidden|not authorized/);

      await expect(
        router.read("/world/qq/channels/qq:private:user_forbidden/items"),
      ).rejects.toThrow(/forbidden|not authorized/);

      // 4. Querying allowed channel items succeeds
      const allowedItemsRes = (await router.read(
        "/world/qq/channels/qq:group:group_allowed/items",
      )) as any;
      expect(allowedItemsRes.channel.id).toBe("qq:group:group_allowed");
      expect(Array.isArray(allowedItemsRes.items)).toBe(true);

      // 5. Directly querying forbidden part throws authorization error
      await expect(router.read("/world/qq/parts/group:group_forbidden")).rejects.toThrow(
        /forbidden|not authorized/,
      );

      // 6. Action post to unauthorized target throws authorization error
      await expect(
        router.read("/world/qq/actions/message.send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetId: "group:group_forbidden",
            message: "Unauthorized test",
          }),
        }),
      ).rejects.toThrow(/refused|forbidden|not authorized/);
    } finally {
      handle.dispose();
      world.dispose();
    }
  });

  it("supports dynamic authorization mutations via API and methods", async () => {
    const router = new SimpleEmaRouter();
    const ctx: EmaCtx = {
      router,
      inputBatcher: { push: vi.fn(), onBatch: vi.fn(() => ({ dispose: vi.fn() })) },
      registry: { register: vi.fn(() => ({ dispose: vi.fn() })), get: vi.fn(), list: vi.fn() },
    };

    const world = new QQWorld({
      selfId: "100001",
      allowedUsers: ["initial_user"],
      allowedGroups: ["initial_group"],
      passive: true,
      env: { PENGUIN_AGENT_ID: "emafanclub_ema_dev" },
    });

    const handle = world.start(ctx);
    try {
      expect(world.isAuthorizedUser("new_friend")).toBe(false);
      expect(world.isAuthorizedGroup("new_group")).toBe(false);

      // Dynamically authorize via methods
      world.authorizeUser("new_friend");
      world.authorizeGroup("new_group");
      expect(world.isAuthorizedUser("new_friend")).toBe(true);
      expect(world.isAuthorizedGroup("new_group")).toBe(true);

      // Revoke
      world.revokeUser("new_friend");
      expect(world.isAuthorizedUser("new_friend")).toBe(false);

      // Query authorization status via router endpoint
      const authStatus = (await router.read("/world/qq/authorization")) as any;
      expect(authStatus.enabled).toBe(true);
      expect(authStatus.allowedGroups).toContain("new_group");

      // Dynamically authorize via POST /world/qq/authorization
      await router.read("/world/qq/authorization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowedUsers: ["api_authorized_user"],
          allowedGroups: ["api_authorized_group"],
        }),
      });

      expect(world.isAuthorizedUser("api_authorized_user")).toBe(true);
      expect(world.isAuthorizedGroup("api_authorized_group")).toBe(true);
    } finally {
      handle.dispose();
      world.dispose();
    }
  });

  it("reads authorization configuration from environment variables", () => {
    const customEnv = {
      EMA_QQ_ALLOWED_USERS: "env_user_1, env_user_2",
      EMA_QQ_ALLOWED_GROUPS: "env_group_1, env_group_2",
      EMA_QQ_ADMIN_USERS: "env_admin_1",
    };

    const auth = new QQAuthorizationManager(undefined, customEnv);
    expect(auth.isEnabled()).toBe(true);
    expect(auth.isAuthorizedUser("env_user_1")).toBe(true);
    expect(auth.isAuthorizedUser("env_user_2")).toBe(true);
    expect(auth.isAuthorizedUser("unauthorized_user")).toBe(false);

    expect(auth.isAuthorizedGroup("env_group_1")).toBe(true);
    expect(auth.isAuthorizedGroup("env_group_2")).toBe(true);
    expect(auth.isAuthorizedGroup("unauthorized_group")).toBe(false);

    expect(auth.isAdmin("env_admin_1")).toBe(true);
    expect(auth.isAuthorizedUser("env_admin_1")).toBe(true);
  });
});
