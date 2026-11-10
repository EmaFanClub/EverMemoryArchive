import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  EmaActorRouter,
  DEFAULT_ROUTER_INIT_PROMPT,
  type ActorSessionHost,
  type EmaActorConfig,
  type EmaSingleSessionActorConfig,
  type EmaMultipleAgentActorConfig,
  getActorKind,
  getActorEntrySession,
} from "../src/actor-router.js";
import companionPortalPackage from "../workbenches/companion_portal/index.js";

describe("Actor Router & Multiple-Agent Session Routing", () => {
  describe("1. Interfaces & Helper Functions", () => {
    it("resolves actor kind, defaulting to single-session", () => {
      expect(getActorKind(undefined)).toBe("single-session");
      expect(getActorKind(null)).toBe("single-session");
      expect(getActorKind({})).toBe("single-session");
      expect(getActorKind({ kind: "single-session" })).toBe("single-session");
      expect(getActorKind({ kind: "multiple-agent" })).toBe("multiple-agent");
    });

    it("resolves active entry session for single-session and multiple-agent", () => {
      const single: EmaSingleSessionActorConfig = {
        id: "actor-1",
        name: "Aoi",
        kind: "single-session",
        sessionId: "session-single-123",
      };
      expect(getActorEntrySession(single)).toBe("session-single-123");

      const multi: EmaMultipleAgentActorConfig = {
        id: "actor-2",
        name: "Ema Multi",
        kind: "multiple-agent",
        routerSessionId: "session-router-999",
      };
      expect(getActorEntrySession(multi)).toBe("session-router-999");
    });
  });

  describe("2. EmaActorRouter Lifecycle & Routing Invariants", () => {
    it("provisions single-session actor with preconfigured sessionId", async () => {
      const router = new EmaActorRouter();
      const mockHost: ActorSessionHost = {
        createSession: vi.fn(),
        run: vi.fn(),
      };

      const result = await router.resolveActorSession(
        {
          id: "actor-single",
          name: "Single Actor",
          kind: "single-session",
          sessionId: "session-fixed-100",
        },
        mockHost,
      );

      expect(mockHost.createSession).not.toHaveBeenCalled();
      expect(result.sessionId).toBe("session-fixed-100");
      expect(result.isNew).toBe(false);
      expect(result.isRouter).toBe(false);
      expect(result.actor.kind).toBe("single-session");
      expect(result.actor.session).toBe("session-fixed-100");
    });

    it("provisions single-session actor dynamically if no sessionId configured", async () => {
      const router = new EmaActorRouter();
      const mockHost: ActorSessionHost = {
        createSession: vi.fn().mockResolvedValue({ sessionId: "session-dyn-200" }),
        run: vi.fn(),
      };

      const result = await router.resolveActorSession(
        {
          id: "actor-single-dyn",
          name: "Single Dyn",
          kind: "single-session",
        },
        mockHost,
      );

      expect(mockHost.createSession).toHaveBeenCalledTimes(1);
      expect(result.sessionId).toBe("session-dyn-200");
      expect(result.isNew).toBe(true);
      expect(result.actor.session).toBe("session-dyn-200");
    });

    it("lazy-creates and initializes router session on first message for multiple-agent actor", async () => {
      const router = new EmaActorRouter();
      const runLog: Array<{ sessionId: string; prompt: string }> = [];

      const mockHost: ActorSessionHost = {
        createSession: vi.fn().mockResolvedValue({ sessionId: "session-router-unique-001" }),
        run: vi.fn().mockImplementation(async (sessionId, inputs) => {
          runLog.push({ sessionId, prompt: inputs[0].text });
          return { sessionId, queued: false };
        }),
      };

      const actorConfig: EmaMultipleAgentActorConfig = {
        id: "actor-multi-test",
        name: "Ema Multi-Agent",
        kind: "multiple-agent",
        agentId: "aoi_rei",
        routerAgentId: "aoi_router",
        routerInitPrompt: "Custom Router Init Prompt",
      };

      // 1. Message 1 arrives -> Router session MUST be created and initialized
      const res1 = await router.resolveActorSession(actorConfig, mockHost);

      expect(mockHost.createSession).toHaveBeenCalledTimes(1);
      expect(mockHost.createSession).toHaveBeenCalledWith({ agentId: "aoi_router" });
      expect(res1.sessionId).toBe("session-router-unique-001");
      expect(res1.isNew).toBe(true);
      expect(res1.isRouter).toBe(true);
      expect(res1.initialized).toBe(true);
      expect(res1.actor.session).toBe("session-router-unique-001");
      expect(res1.actor.kind).toBe("multiple-agent");

      // Verify router initialization prompt was executed
      expect(runLog.length).toBe(1);
      expect(runLog[0].sessionId).toBe("session-router-unique-001");
      expect(runLog[0].prompt).toBe("Custom Router Init Prompt");

      // Update config with the active router session
      const updatedConfig: EmaMultipleAgentActorConfig = {
        ...actorConfig,
        routerSessionId: res1.sessionId,
        isInitialized: true,
      };

      // 2. Message 2 arrives -> MUST route to the exact same unique router session
      const res2 = await router.resolveActorSession(updatedConfig, mockHost);

      expect(mockHost.createSession).toHaveBeenCalledTimes(1); // STILL 1, no second session!
      expect(res2.sessionId).toBe("session-router-unique-001");
      expect(res2.isNew).toBe(false);
      expect(res2.isRouter).toBe(true);

      // 3. Message 3 arrives -> MUST route to the exact same unique router session
      const res3 = await router.resolveActorSession(updatedConfig, mockHost);
      expect(mockHost.createSession).toHaveBeenCalledTimes(1);
      expect(res3.sessionId).toBe("session-router-unique-001");
    });

    it("coalesces concurrent message arrivals so only one router session is created", async () => {
      const router = new EmaActorRouter();
      let sessionCounter = 0;

      const mockHost: ActorSessionHost = {
        createSession: vi.fn().mockImplementation(async () => {
          sessionCounter++;
          await new Promise((r) => setTimeout(r, 20)); // simulate slight async delay
          return { sessionId: `session-router-lock-${sessionCounter}` };
        }),
        run: vi.fn().mockResolvedValue({}),
      };

      const actorConfig: EmaMultipleAgentActorConfig = {
        id: "actor-concurrent",
        name: "Concurrent Multi-Agent",
        kind: "multiple-agent",
      };

      // Fire 5 concurrent requests
      const promises = [
        router.resolveActorSession(actorConfig, mockHost),
        router.resolveActorSession(actorConfig, mockHost),
        router.resolveActorSession(actorConfig, mockHost),
        router.resolveActorSession(actorConfig, mockHost),
        router.resolveActorSession(actorConfig, mockHost),
      ];

      const results = await Promise.all(promises);

      expect(mockHost.createSession).toHaveBeenCalledTimes(1);
      for (const res of results) {
        expect(res.sessionId).toBe("session-router-lock-1");
      }
    });
  });

  describe("3. Web UI Companion Portal (WebWorld) End-to-End Routing", () => {
    it("routes Web UI chat submissions to unique router session in multiple-agent mode", async () => {
      const createdSessions: Array<{ agentId?: string; sessionId: string }> = [];
      const promptRunLog: Array<{ sessionId: string; text: string }> = [];
      let sessionCount = 0;

      let workbenchState: Record<string, unknown> = {
        actor: {
          id: "actor-aoi-rei",
          name: "苍星怜",
          kind: "multiple-agent",
          agentId: "aoi_rei",
          routerAgentId: "aoi_router",
          routerInitPrompt: "Initialize Aoi Rei Router Entrypoint",
        },
      };

      const mockWorkbenchHost = {
        listAgents: () => [{ agentId: "aoi_rei" }, { agentId: "aoi_router" }],
        createSession: vi.fn().mockImplementation(async (opts?: { agentId?: string }) => {
          sessionCount++;
          const sessionId = `session-router-${sessionCount}`;
          createdSessions.push({ agentId: opts?.agentId, sessionId });
          return { sessionId };
        }),
        run: vi.fn().mockImplementation(async (sessionId: string, inputs: Array<{ text: string }>) => {
          promptRunLog.push({ sessionId, text: inputs[0].text });
          return { sessionId, queued: false };
        }),
        sessionStatus: vi.fn().mockReturnValue("idle"),
        sessionResult: vi.fn().mockResolvedValue({
          status: "completed",
          text: "收到消息，多Agent路由已就绪！",
          error: null,
        }),
        subscribe: vi.fn().mockReturnValue(() => {}),
        getState: () => workbenchState,
        setState: vi.fn().mockImplementation(async (state: unknown) => {
          workbenchState = state as Record<string, unknown>;
        }),
        log: vi.fn(),
      };

      const moduleInstance = companionPortalPackage.modules.Workbench.create({
        use: { host: mockWorkbenchHost as any },
      });
      const api = moduleInstance.api.main;

      // 1. Initial GET /actor before any message is sent
      const actorStatusBefore = await api.handle({
        method: "GET",
        path: "/actor",
      });
      expect(actorStatusBefore.body).toBeDefined();
      const actorDoc1 = (actorStatusBefore.body as any).actor;
      expect(actorDoc1.kind).toBe("multiple-agent");
      expect(actorDoc1.routerSessionId).toBeUndefined();
      expect((actorStatusBefore.body as any).isReady).toBe(false);

      // Verify that NO session has been created before receiving message
      expect(mockWorkbenchHost.createSession).not.toHaveBeenCalled();

      // 2. User submits Message 1 via Web UI (POST /chat)
      const chatRes1 = await api.handle({
        method: "POST",
        path: "/chat",
        body: { text: "你好呀，苍星怜！" },
      });

      expect(chatRes1.status).toBeUndefined(); // successful 200 equivalent
      const state1 = chatRes1.body as any;
      expect(state1.status).toBe("running");
      expect(state1.actor.kind).toBe("multiple-agent");
      expect(state1.actor.routerSessionId).toBe("session-router-1");
      expect(state1.sessionId).toBe("session-router-1");

      // Verify createSession was called with routerAgentId
      expect(mockWorkbenchHost.createSession).toHaveBeenCalledTimes(1);
      expect(mockWorkbenchHost.createSession).toHaveBeenCalledWith({ agentId: "aoi_router" });

      // Verify that initialization prompt ran first, followed by the user channel turn
      expect(promptRunLog.length).toBe(2);
      expect(promptRunLog[0].sessionId).toBe("session-router-1");
      expect(promptRunLog[0].text).toBe("Initialize Aoi Rei Router Entrypoint");
      expect(promptRunLog[1].sessionId).toBe("session-router-1");
      expect(promptRunLog[1].text).toContain("<Input>");
      expect(promptRunLog[1].text).toContain("<World>web</World>");

      // 3. User submits Message 2 via Web UI (POST /chat)
      const chatRes2 = await api.handle({
        method: "POST",
        path: "/chat",
        body: { text: "今天天气真好，想出去散步吗？" },
      });

      const state2 = chatRes2.body as any;
      // VERIFY INVARIANT: NO new session created!
      expect(mockWorkbenchHost.createSession).toHaveBeenCalledTimes(1);
      expect(state2.actor.routerSessionId).toBe("session-router-1");
      expect(state2.sessionId).toBe("session-router-1");

      // Verify message 2 routed to the exact same unique router session
      expect(promptRunLog.length).toBe(3);
      expect(promptRunLog[2].sessionId).toBe("session-router-1");
      expect(promptRunLog[2].text).toContain("<World>web</World>");

      // 4. User submits Message 3 via Web UI (POST /chat)
      await api.handle({
        method: "POST",
        path: "/chat",
        body: { text: "记得带上伞哦。" },
      });

      // STILL only 1 session created throughout the entire conversational flow
      expect(mockWorkbenchHost.createSession).toHaveBeenCalledTimes(1);
      expect(promptRunLog.length).toBe(4);
      expect(promptRunLog[3].sessionId).toBe("session-router-1");

      // 5. GET /actor now confirms router session is active and ready
      const actorStatusAfter = await api.handle({
        method: "GET",
        path: "/actor",
      });
      const actorDocAfter = (actorStatusAfter.body as any).actor;
      expect(actorDocAfter.kind).toBe("multiple-agent");
      expect(actorDocAfter.routerSessionId).toBe("session-router-1");
      expect(actorDocAfter.isInitialized).toBe(true);
      expect((actorStatusAfter.body as any).entrySessionId).toBe("session-router-1");
      expect((actorStatusAfter.body as any).isReady).toBe(true);

      // 6. POST /actor can dynamically configure actor properties
      const updateRes = await api.handle({
        method: "POST",
        path: "/actor",
        body: { name: "苍星怜 (Router)" },
      });
      expect((updateRes.body as any).success).toBe(true);
      expect((updateRes.body as any).actor.name).toBe("苍星怜 (Router)");

      // 7. POST /reset resets router session so next message provisions a fresh one
      const resetRes = await api.handle({
        method: "POST",
        path: "/reset",
      });
      const resetState = resetRes.body as any;
      expect(resetState.actor.kind).toBe("multiple-agent");
      expect(resetState.actor.routerSessionId).toBeUndefined();
      expect(resetState.actor.isInitialized).toBe(false);
      expect(resetState.sessionId).toBe("");

      // On next chat message, a new router session will be created
      await api.handle({
        method: "POST",
        path: "/chat",
        body: { text: "重启后重新开始！" },
      });

      expect(mockWorkbenchHost.createSession).toHaveBeenCalledTimes(2);
      expect(promptRunLog.length).toBe(6); // + init prompt + channel turn
      expect(promptRunLog[4].sessionId).toBe("session-router-2");
      expect(promptRunLog[5].sessionId).toBe("session-router-2");
    });

    it("routes Web UI chat submissions to single session in single-session mode", async () => {
      let sessionCount = 0;
      let workbenchState: Record<string, unknown> = {
        actor: {
          id: "actor-single",
          name: "苍星怜",
          kind: "single-session",
          agentId: "aoi_rei",
        },
      };

      const mockHost = {
        createSession: vi.fn().mockImplementation(async () => {
          sessionCount++;
          return { sessionId: `session-single-${sessionCount}` };
        }),
        run: vi.fn().mockResolvedValue({ queued: false }),
        sessionStatus: vi.fn().mockReturnValue("idle"),
        sessionResult: vi.fn().mockResolvedValue({ status: "completed", text: "OK" }),
        subscribe: vi.fn().mockReturnValue(() => {}),
        getState: () => workbenchState,
        setState: vi.fn().mockImplementation(async (state: unknown) => {
          workbenchState = state as Record<string, unknown>;
        }),
        log: vi.fn(),
      };

      const moduleInstance = companionPortalPackage.modules.Workbench.create({
        use: { host: mockHost as any },
      });
      const api = moduleInstance.api.main;

      // GET /status initializes single session
      const getStatusRes = await api.handle({ method: "GET", path: "/status" });
      const state = getStatusRes.body as any;
      expect(state.actor.kind).toBe("single-session");
      expect(state.sessionId).toBe("session-single-1");
      expect(mockHost.createSession).toHaveBeenCalledTimes(1);

      // POST /chat uses the existing single session
      await api.handle({
        method: "POST",
        path: "/chat",
        body: { text: "单会话测试" },
      });

      expect(mockHost.createSession).toHaveBeenCalledTimes(1);
    });
  });
});
