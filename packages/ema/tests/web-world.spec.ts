import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  WebWorld,
  installWebWorkbench,
  installWebChannelProtocolToAgentsMd,
  WEB_CHANNEL_PROTOCOL_START_MARKER,
  WEB_CHANNEL_PROTOCOL_END_MARKER,
  SimpleEmaRouter,
  SimpleEmaInputBatcher,
  formatBatchToXml,
  type EmaCtx,
  type EmaActor,
  type EmaInput,
  type WebOutboundEvent,
  type WebInboundEventPayload,
} from "../src/index.js";

describe("WebWorld (RFC-0001 / node-mw7row3c-pdfz / node-mw7rpkq4-jwez)", () => {
  const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };
  const mockActor: EmaActor = {
    id: "actor-ema-companion",
    name: "Ema",
    session: "session-2026-11-08-test",
    agentId: "emafanclub_ema_dev",
  };

  let router: SimpleEmaRouter;
  let batcher: SimpleEmaInputBatcher;
  let ctx: EmaCtx;

  beforeEach(() => {
    router = new SimpleEmaRouter();
    batcher = new SimpleEmaInputBatcher({
      dbPath: ":memory:",
      debounceMs: 30,
      maxWaitMs: 120,
    });
    ctx = {
      router,
      inputBatcher: batcher,
      registry: {
        register: () => ({ dispose: () => {} }),
        get: () => undefined,
        list: () => [],
      },
    };
  });

  afterEach(() => {
    batcher.dispose();
  });

  describe("1. Lifecycle & Multi-Part Topology", () => {
    it("mounts routes and initializes initial sessions", async () => {
      const world = new WebWorld({
        initialSessions: ["sess_alpha", "sess_beta"],
        dbPath: ":memory:",
        env: mockEnv,
        heartbeatIntervalMs: 0,
      });

      const handle = world.start(ctx);

      const parts = world.listParts();
      expect(parts.length).toBe(2);
      expect(parts.map((p) => p.id)).toContain("web:session:sess_alpha");
      expect(parts.map((p) => p.id)).toContain("web:session:sess_beta");

      const overview = await router.read<{
        world: string;
        activeSessions: number;
        parts: Array<{ id: string }>;
      }>("/world/web");
      expect(overview.world).toBe("web");
      expect(overview.activeSessions).toBe(2);

      handle.dispose();
      await expect(router.read("/world/web")).rejects.toThrow("Route not found");
    });

    it("registers, retrieves, and unregisters session parts dynamically", async () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      const handle = world.start(ctx);

      const part = world.registerPart({
        id: "room_lounge",
        name: "Lounge Chat",
        type: "room",
        clientMetadata: {
          timezone: "Asia/Tokyo",
          viewport: { width: 1920, height: 1080 },
          audioSupport: true,
          uiFocus: "avatar",
        },
      });

      expect(part.id).toBe("web:session:room_lounge");
      expect(part.sessionId).toBe("room_lounge");
      expect(part.type).toBe("room");
      expect(part.clientMetadata?.timezone).toBe("Asia/Tokyo");

      // Retrieve via router
      const retrieved = await router.read<{ id: string; clientMetadata: { uiFocus: string } }>(
        "/world/web/parts/web:session:room_lounge",
      );
      expect(retrieved.id).toBe("web:session:room_lounge");
      expect(retrieved.clientMetadata.uiFocus).toBe("avatar");

      // Retrieve via short session ID
      const retrievedByShortId = await router.read<{ id: string }>(
        "/world/web/sessions/room_lounge",
      );
      expect(retrievedByShortId.id).toBe("web:session:room_lounge");

      // Delete via DELETE HTTP request
      const deleteRes = await router.read<{ success: boolean; sessionId: string }>(
        "/world/web/sessions/room_lounge",
        { method: "DELETE" },
      );
      expect(deleteRes.success).toBe(true);

      // Verify part is gone
      expect(world.getPart("room_lounge")).toBeUndefined();
      await expect(router.read("/world/web/parts/room_lounge")).rejects.toThrow("Part not found");

      handle.dispose();
    });

    it("normalizes part IDs consistently", () => {
      const world = new WebWorld({ dbPath: ":memory:" });
      expect(world.normalizePartId("test1")).toBe("web:session:test1");
      expect(world.normalizePartId("web:test2")).toBe("web:session:test2");
      expect(world.normalizePartId("web:session:test3")).toBe("web:session:test3");
      expect(world.extractSessionId("web:session:test3")).toBe("test3");
      world.dispose();
    });
  });

  describe("2. Inbound Modalities & Client Telemetry (node-mw7row3c-pdfz)", () => {
    it("ingests chat message with sender and client metadata", async () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      const input = world.ingestMessage(
        "sess_chat_1",
        "Hello Ema, will it rain tomorrow?",
        { id: "user:rei", name: "Rei", isOwner: true },
        {
          timezone: "Asia/Tokyo",
          viewport: { width: 1440, height: 900 },
          audioSupport: true,
          uiFocus: "chat",
        },
      );

      expect(input.world).toBe("web");
      expect(input.partId).toBe("web:session:sess_chat_1");
      expect(input.content).toBe("Hello Ema, will it rain tomorrow?");
      expect(input.sender.id).toBe("user:rei");
      expect(input.sender.isOwner).toBe(true);
      expect(input.metadata?.modality).toBe("chat");

      const clientMeta = input.metadata?.clientMetadata as { timezone: string; uiFocus: string };
      expect(clientMeta.timezone).toBe("Asia/Tokyo");
      expect(clientMeta.uiFocus).toBe("chat");

      // Look up message from router
      const lookedUp = await router.read<{ id: string; content: string }>(
        `/world/web/messages/${input.id}`,
      );
      expect(lookedUp.id).toBe(input.id);
      expect(lookedUp.content).toBe("Hello Ema, will it rain tomorrow?");

      world.dispose();
    });

    it("ingests Live2D/3D avatar touch gestures with normalized representation", async () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      const input = world.ingestTouch("sess_touch_1", {
        part: "head",
        gesture: "pat",
        x: 0.52,
        y: 0.18,
        pressure: 0.8,
      });

      expect(input.content).toBe("[Touch: pat on head]");
      expect(input.metadata?.modality).toBe("touch");
      expect((input.metadata?.touch as { part: string; gesture: string }).part).toBe("head");
      expect((input.metadata?.touch as { part: string; gesture: string }).gesture).toBe("pat");

      // Custom text touch event
      const customTouchInput = world.ingest({
        sessionId: "sess_touch_1",
        modality: "touch",
        text: "*gentle poke on cheek*",
        touch: { part: "cheek", gesture: "poke" },
      });
      expect(customTouchInput.content).toBe("*gentle poke on cheek*");

      world.dispose();
    });

    it("ingests client interaction telemetry (visibility, blur/focus, idle)", async () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      const input = world.ingestTelemetry("sess_tel_1", {
        visibility: "hidden",
        windowFocus: "blur",
        idleState: "idle",
        idleDurationMs: 60000,
        activeTab: "background",
      });

      expect(input.content).toContain("[Telemetry:");
      expect(input.content).toContain("visibility=hidden");
      expect(input.content).toContain("focus=blur");
      expect(input.content).toContain("idle=idle (60000ms)");
      expect(input.metadata?.modality).toBe("telemetry");

      world.dispose();
    });

    it("validates malformed inbound inputs", () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      expect(() => {
        world.ingest({ sessionId: "", modality: "chat", text: "hello" });
      }).toThrow("Missing sessionId");

      expect(() => {
        world.ingest({ sessionId: "s1", modality: "chat", text: "   " });
      }).toThrow("Empty text content");

      expect(() => {
        world.ingest({ sessionId: "s1", modality: "touch" });
      }).toThrow("Touch modality requires touch.part and touch.gesture");

      expect(() => {
        world.ingest({ sessionId: "s1", modality: "telemetry" });
      }).toThrow("Telemetry modality requires telemetry payload object");

      expect(() => {
        world.ingest({ sessionId: "s1", modality: "unknown" as never });
      }).toThrow("Unsupported web inbound modality");

      world.dispose();
    });
  });

  describe("3. Transactional Input Batching & XML Coalescing (RFC-0001)", () => {
    it("coalesces burst inputs from same session into atomic batch", async () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      const emittedBatches: Array<ReadonlyArray<EmaInput>> = [];
      batcher.onBatch((batch) => {
        emittedBatches.push(batch);
      });

      // Rapid consecutive events in session A
      world.ingestMessage("sess_burst", "First thought", {
        id: "user:rei",
        name: "Rei",
      });
      world.ingestTouch(
        "sess_burst",
        { part: "head", gesture: "pat" },
        {
          id: "user:rei",
          name: "Rei",
        },
      );
      world.ingestMessage("sess_burst", "Second thought", {
        id: "user:rei",
        name: "Rei",
      });

      expect(emittedBatches.length).toBe(0);

      // Wait for debounce window (30ms) to flush
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(emittedBatches.length).toBe(1);
      const batch = emittedBatches[0];
      expect(batch.length).toBe(3);
      expect(batch[0].partId).toBe("web:session:sess_burst");
      expect(batch[0].content).toBe("First thought");
      expect(batch[1].content).toBe("[Touch: pat on head]");
      expect(batch[2].content).toBe("Second thought");

      // Verify formatted XML payload
      const xml = formatBatchToXml(batch);
      expect(xml).toContain("<Input>");
      expect(xml).toContain("<World>web</World>");
      expect(xml).toContain("<Channel>web:session:sess_burst</Channel>");
      expect(xml).toContain("<Name>Rei</Name>");
      expect(xml).toContain("First thought");
      expect(xml).toContain("[Touch: pat on head]");
      expect(xml).toContain("Second thought");
      expect(xml).toContain("</Input>");

      world.dispose();
    });

    it("partitions concurrent inputs from different web sessions into separate batches", async () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      const emittedBatches: Array<ReadonlyArray<EmaInput>> = [];
      batcher.onBatch((batch) => {
        emittedBatches.push(batch);
      });

      // Session Alpha and Session Beta burst concurrently
      world.ingestMessage("sess_alpha", "Alpha query 1");
      world.ingestMessage("sess_beta", "Beta query 1");
      world.ingestMessage("sess_alpha", "Alpha query 2");

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(emittedBatches.length).toBe(2);

      const alphaBatch = emittedBatches.find((b) => b[0].partId === "web:session:sess_alpha");
      const betaBatch = emittedBatches.find((b) => b[0].partId === "web:session:sess_beta");

      expect(alphaBatch).toBeDefined();
      expect(alphaBatch!.length).toBe(2);
      expect(betaBatch).toBeDefined();
      expect(betaBatch!.length).toBe(1);

      world.dispose();
    });
  });

  describe("4. Router Endpoints on SimpleEmaRouter", () => {
    it("handles HTTP POST /world/web/input and shortcut endpoints", async () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      // Ingest via POST /world/web/input
      const inputPayload: WebInboundEventPayload = {
        sessionId: "sess_http_test",
        modality: "chat",
        text: "Inbound via HTTP POST",
        sender: { id: "user:web_client", name: "Web Client" },
      };

      const res = await router.read<{ success: boolean; eventId: string; partId: string }>(
        "/world/web/input",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(inputPayload),
        },
      );

      expect(res.success).toBe(true);
      expect(res.partId).toBe("web:session:sess_http_test");
      expect(res.eventId).toBeDefined();

      // Post touch via /world/web/sessions/:id/touch
      const touchRes = await router.read<{ success: boolean; partId: string }>(
        "/world/web/sessions/sess_http_test/touch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            touch: { part: "hair", gesture: "stroke" },
          }),
        },
      );
      expect(touchRes.success).toBe(true);
      expect(touchRes.partId).toBe("web:session:sess_http_test");

      // Post telemetry via /world/web/sessions/:id/telemetry
      const telRes = await router.read<{ success: boolean; partId: string }>(
        "/world/web/sessions/sess_http_test/telemetry",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telemetry: { visibility: "visible", windowFocus: "focus" },
          }),
        },
      );
      expect(telRes.success).toBe(true);

      world.dispose();
    });

    it("returns 404 for nonexistent part or message lookups", async () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      await expect(router.read("/world/web/parts/nonexistent")).rejects.toThrow("Part not found");
      await expect(router.read("/world/web/messages/msg-unknown")).rejects.toThrow(
        "Message not found",
      );

      world.dispose();
    });
  });

  describe("5. Outbound Streaming & Action Dispatcher (node-mw7rpkq4-jwez)", () => {
    it("dispatches token-by-token streaming chunks", () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      const received: WebOutboundEvent[] = [];
      world.subscribeSession("sess_stream_1", (ev) => {
        received.push(ev);
      });

      world.interact(ctx, mockActor, "sess_stream_1", "stream_start");
      world.interact(ctx, mockActor, "sess_stream_1", "token", "Hello");
      world.interact(ctx, mockActor, "sess_stream_1", "token", " world!");
      world.interact(ctx, mockActor, "sess_stream_1", "stream_end", "Hello world!");

      expect(received.length).toBe(4);
      expect(received[0].type).toBe("stream_start");
      expect(received[1].type).toBe("token");
      expect(received[1].token).toBe("Hello");
      expect(received[2].token).toBe(" world!");
      expect(received[3].type).toBe("stream_end");
      expect(received[3].fullText).toBe("Hello world!");

      // Sequence numbers should be strictly monotonic
      expect(received.map((r) => r.seqId)).toEqual([1, 2, 3, 4]);

      world.dispose();
    });

    it("dispatches Live2D/3D emotion and expression triggers", () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      const received: WebOutboundEvent[] = [];
      world.subscribeSession("sess_avatar_1", (ev) => {
        received.push(ev);
      });

      world.interact(ctx, mockActor, "sess_avatar_1", "expression", {
        expression: "blushing",
        motion: "nod",
        emotion: {
          valence: 0.85,
          arousal: 0.6,
          stage: "responding",
        },
        durationMs: 3000,
      });

      expect(received.length).toBe(1);
      const ev = received[0];
      expect(ev.type).toBe("expression");
      expect(ev.expression?.expression).toBe("blushing");
      expect(ev.expression?.motion).toBe("nod");
      expect(ev.expression?.emotion?.valence).toBe(0.85);
      expect(ev.expression?.emotion?.arousal).toBe(0.6);
      expect(ev.expression?.emotion?.stage).toBe("responding");
      expect(ev.expression?.durationMs).toBe(3000);

      world.dispose();
    });

    it("dispatches interactive UI cards (memory graph, diary preview, timeline)", () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      const received: WebOutboundEvent[] = [];
      world.subscribeSession("sess_cards", (ev) => {
        received.push(ev);
      });

      // Memory graph card
      world.interact(ctx, mockActor, "sess_cards", "card", {
        type: "memory_graph",
        title: "Current Memory Context",
        nodes: [
          { id: "n1", label: "Meteor Shower", group: "event" },
          { id: "n2", label: "Astronomy", group: "interest" },
        ],
        links: [{ source: "n1", target: "n2", relation: "topic_of" }],
      });

      // Diary preview card
      world.interact(ctx, mockActor, "sess_cards", "card", {
        type: "diary_preview",
        title: "Watching the Stars",
        date: "2026-11-08",
        mood: "happy",
        excerpt: "Today we discussed astronomy together under clear skies.",
        tags: ["milestone", "stars"],
      });

      // Relationship timeline card
      world.interact(ctx, mockActor, "sess_cards", "card", {
        type: "relationship_timeline",
        title: "Our Journey",
        intimacyLevel: 0.45,
        milestones: [
          { date: "2026-11-04", title: "First Met", description: "Created companion archive" },
          { date: "2026-11-08", title: "Stargazing", description: "Shared first night sky plan" },
        ],
      });

      expect(received.length).toBe(3);
      expect(received[0].card?.type).toBe("memory_graph");
      expect(received[1].card?.type).toBe("diary_preview");
      expect(received[2].card?.type).toBe("relationship_timeline");

      world.dispose();
    });

    it("supports structured object interaction payload", () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      const received: WebOutboundEvent[] = [];
      world.subscribeSession("sess_structured", (ev) => {
        received.push(ev);
      });

      world.interact(ctx, mockActor, "sess_structured", {
        type: "reply",
        text: "Coordinated reply with avatar expression",
        expression: {
          expression: "smiling",
          motion: "wave",
        },
      });

      expect(received.length).toBe(1);
      expect(received[0].type).toBe("reply");
      expect(received[0].fullText).toBe("Coordinated reply with avatar expression");
      expect(received[0].expression?.expression).toBe("smiling");
      expect(received[0].expression?.motion).toBe("wave");

      world.dispose();
    });
  });

  describe("6. Client Reconnection & SSE Stream Buffering", () => {
    it("buffers outbound events and replays missed events upon reconnection", () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      // Emit 4 events into session
      world.interact(ctx, mockActor, "sess_reconn", "token", "chunk 1");
      world.interact(ctx, mockActor, "sess_reconn", "token", "chunk 2");
      world.interact(ctx, mockActor, "sess_reconn", "token", "chunk 3");
      world.interact(ctx, mockActor, "sess_reconn", "token", "chunk 4");

      const buffer = world.getEventBuffer("sess_reconn");
      expect(buffer.length).toBe(4);
      expect(buffer.map((b) => b.seqId)).toEqual([1, 2, 3, 4]);

      // Reconnecting client specifies lastEventId = 2; should receive events 3 and 4
      const replayed: WebOutboundEvent[] = [];
      const sub = world.subscribeSession(
        "sess_reconn",
        (ev) => {
          replayed.push(ev);
        },
        2,
      );

      expect(replayed.length).toBe(2);
      expect(replayed[0].seqId).toBe(3);
      expect(replayed[0].token).toBe("chunk 3");
      expect(replayed[1].seqId).toBe(4);
      expect(replayed[1].token).toBe("chunk 4");

      // Further live events arrive immediately
      world.interact(ctx, mockActor, "sess_reconn", "token", "chunk 5");
      expect(replayed.length).toBe(3);
      expect(replayed[2].seqId).toBe(5);

      sub.dispose();
      world.dispose();
    });

    it("serves Web Standard SSE stream with event replay over Hono router", async () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv, heartbeatIntervalMs: 0 });
      world.start(ctx);

      world.interact(ctx, mockActor, "sess_sse_test", "reply", "Existing message in buffer");

      // Connect to SSE stream endpoint via underlying Hono app
      const response = await router.app.request(
        "http://localhost/world/web/stream?session=sess_sse_test&lastEventId=0",
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      const decoder = new TextDecoder();
      let streamText = "";

      // Read initial connection comment & replayed buffer event
      const chunk1 = await reader!.read();
      streamText += decoder.decode(chunk1.value);

      if (!streamText.includes("event: reply")) {
        const chunk2 = await reader!.read();
        streamText += decoder.decode(chunk2.value);
      }

      expect(streamText).toContain(": connected to WebWorld SSE stream");
      expect(streamText).toContain("event: reply");
      expect(streamText).toContain("Existing message in buffer");

      await reader!.cancel();
      world.dispose();
    });

    it("handles periodic heartbeat timer cleanly", async () => {
      const world = new WebWorld({
        dbPath: ":memory:",
        env: mockEnv,
        heartbeatIntervalMs: 20,
      });
      world.start(ctx);

      const received: WebOutboundEvent[] = [];
      const sub = world.subscribeSession("sess_hb", (ev) => {
        received.push(ev);
      });

      // Wait for at least one heartbeat
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(received.some((ev) => ev.type === "heartbeat")).toBe(true);

      sub.dispose();
      world.dispose();
    });
  });

  describe("7. Authentication & Security Invariants (RFC-0001)", () => {
    it("refuses interact without required actor credentials", () => {
      const world = new WebWorld({ dbPath: ":memory:", env: mockEnv });
      world.start(ctx);

      expect(() => {
        world.interact(ctx, null as never, "sess_1", "reply", "test");
      }).toThrow("Missing actor credentials");

      expect(() => {
        world.interact(
          ctx,
          { id: "", name: "Ema", session: "", agentId: "" },
          "sess_1",
          "reply",
          "test",
        );
      }).toThrow("Missing actor credentials");

      world.dispose();
    });

    it("refuses interact without PENGUIN_AGENT_ID identity", () => {
      const world = new WebWorld({
        dbPath: ":memory:",
        env: { PENGUIN_AGENT_ID: "" },
        requireAgentIdentity: true,
      });
      world.start(ctx);

      expect(() => {
        world.interact(ctx, mockActor, "sess_1", "reply", "test");
      }).toThrow("refusing to dispatch without an agent identity");

      world.dispose();
    });
  });

  describe("8. Persistence Across Restarts", () => {
    it("persists sessions across instance restarts when dbPath is provided", () => {
      const dbPath = `/tmp/ema-test-web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`;

      // Instance 1: register sessions and ingest events
      const world1 = new WebWorld({ dbPath, env: mockEnv });
      world1.start(ctx);
      world1.registerPart({
        id: "persisted_session_1",
        name: "Persisted Lounge",
        clientMetadata: { timezone: "Europe/London" },
      });
      world1.ingestMessage("persisted_session_1", "Saved message");
      world1.interact(ctx, mockActor, "persisted_session_1", "reply", "Saved reply");
      world1.dispose();

      // Instance 2: load from same database file
      const world2 = new WebWorld({ dbPath, env: mockEnv });
      world2.start(ctx);

      const part = world2.getPart("persisted_session_1");
      expect(part).toBeDefined();
      expect(part?.name).toBe("Persisted Lounge");
      expect(part?.clientMetadata?.timezone).toBe("Europe/London");

      world2.dispose();

      // Clean up test file
      try {
        import("node:fs").then((fs) => {
          if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        });
      } catch {}
    });
  });

  describe("9. RFC-0002 Social Media Channel Architecture (Chatroom Channel)", () => {
    it("indexes EmaNode and WebChannel primitives and serves them via router", async () => {
      const world = new WebWorld({
        initialSessions: ["default"],
        ownerId: "rei",
        ownerName: "Rei",
        companionId: "aoi_rei",
        companionName: "苍星怜",
        dbPath: ":memory:",
        env: mockEnv,
        heartbeatIntervalMs: 0,
      });
      world.start(ctx);

      const ownerNode = await router.read<{
        id: string;
        world: string;
        node_kind: string;
        name: string;
        channelIds: string[];
      }>("/world/web/nodes/web:person:rei");
      expect(ownerNode.id).toBe("web:person:rei");
      expect(ownerNode.world).toBe("web");
      expect(ownerNode.node_kind).toBe("person");
      expect(ownerNode.name).toBe("Rei");
      expect(ownerNode.channelIds).toContain("web:chatroom:default");

      const botNode = await router.read<{
        id: string;
        node_kind: string;
        name: string;
      }>("/world/web/nodes/web:bot:aoi_rei");
      expect(botNode.id).toBe("web:bot:aoi_rei");
      expect(botNode.node_kind).toBe("bot");
      expect(botNode.name).toBe("苍星怜");

      const channelsRes = await router.read<{
        channels: Array<{ id: string; channel_kind: string; name: string }>;
      }>("/world/web/channels");
      expect(channelsRes.channels.length).toBeGreaterThanOrEqual(1);
      expect(channelsRes.channels[0].id).toBe("web:chatroom:default");
      expect(channelsRes.channels[0].channel_kind).toBe("chatroom");

      const singleChannel = await router.read<{ id: string; channel_kind: string }>(
        "/world/web/channels/web:chatroom:default",
      );
      expect(singleChannel.id).toBe("web:chatroom:default");
      expect(singleChannel.channel_kind).toBe("chatroom");

      world.dispose();
    });

    it("supports RFC-0002 channel reading and action posting (session reads channel & posts reply)", async () => {
      const world = new WebWorld({
        initialSessions: ["default"],
        ownerId: "rei",
        ownerName: "Rei",
        companionId: "aoi_rei",
        companionName: "苍星怜",
        dbPath: ":memory:",
        env: mockEnv,
        heartbeatIntervalMs: 0,
      });
      world.start(ctx);

      // 1. User posts a message into the chatroom channel
      const userPostRes = await router.read<{
        success: boolean;
        item: { id: string; channelId: string; authorNodeId: string; content: string };
      }>("/world/web/channels/web:chatroom:default/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId: "rei",
          senderName: "Rei",
          content: "怜，今晚的夜空很清澈呢。",
        }),
      });
      expect(userPostRes.success).toBe(true);
      expect(userPostRes.item.channelId).toBe("web:chatroom:default");
      expect(userPostRes.item.authorNodeId).toBe("web:person:rei");
      expect(userPostRes.item.content).toBe("怜，今晚的夜空很清澈呢。");

      // 2. Agent session reads the chatroom channel items with temporal envelope
      const channelFeed = await router.read<{
        context: { time: string; timestampMs: number; timezone?: string };
        channel: { id: string; channel_kind: string };
        items: Array<{
          id: string;
          authorNodeId: string;
          content: string;
          createdAt: string;
          fetchedAt: string;
        }>;
      }>("/world/web/channels/web:chatroom:default/items");

      expect(channelFeed.context.time).toBeDefined();
      expect(typeof channelFeed.context.timestampMs).toBe("number");
      expect(channelFeed.channel.id).toBe("web:chatroom:default");
      expect(channelFeed.items.length).toBe(1);
      expect(channelFeed.items[0].content).toBe("怜，今晚的夜空很清澈呢。");
      expect(channelFeed.items[0].createdAt).toContain("ago");

      // 3. Agent session introspects actions and posts reply to the channel via POST /world/web/actions/message.post
      const actionsList = await router.read<{
        actions: Array<{ name: string; description: string }>;
      }>("/world/web/actions");
      expect(actionsList.actions.map((a) => a.name)).toContain("message.post");
      expect(actionsList.actions.map((a) => a.name)).toContain("message.reply");

      const actionDoc = await router.read<{
        name: string;
        parameters: Record<string, { type: string; required: boolean }>;
      }>("/world/web/actions/message.post");
      expect(actionDoc.name).toBe("message.post");
      expect(actionDoc.parameters.message.required).toBe(true);

      const postReplyRes = await router.read<{
        success: boolean;
        action: string;
        channelId: string;
        message: string;
        item: { id: string; authorNodeId: string; content: string; parentItemId?: string };
      }>("/world/web/actions/message.post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: "web:chatroom:default",
          parentItemId: userPostRes.item.id,
          message: "嗯，微风也很舒服。我泡了热茶，一起坐在窗边看星星吧。",
        }),
      });

      expect(postReplyRes.success).toBe(true);
      expect(postReplyRes.action).toBe("message.post");
      expect(postReplyRes.channelId).toBe("web:chatroom:default");
      expect(postReplyRes.item.authorNodeId).toBe("web:bot:aoi_rei");
      expect(postReplyRes.item.content).toBe(
        "嗯，微风也很舒服。我泡了热茶，一起坐在窗边看星星吧。",
      );

      // 4. Verify channel now has both messages in chronological order and item lookup returns replies
      const updatedFeed = await router.read<{
        items: Array<{ id: string; authorNodeId: string; content: string }>;
      }>("/world/web/channels/web:chatroom:default/items");
      expect(updatedFeed.items.length).toBe(2);
      expect(updatedFeed.items[0].authorNodeId).toBe("web:person:rei");
      expect(updatedFeed.items[1].authorNodeId).toBe("web:bot:aoi_rei");

      const itemWithReplies = await router.read<{
        id: string;
        replies: Array<{ id: string; content: string }>;
      }>(`/world/web/items/${userPostRes.item.id}`);
      expect(itemWithReplies.id).toBe(userPostRes.item.id);
      expect(itemWithReplies.replies.length).toBe(1);
      expect(itemWithReplies.replies[0].content).toBe(
        "嗯，微风也很舒服。我泡了热茶，一起坐在窗边看星星吧。",
      );

      world.dispose();
    });
  });

  describe("10. Installable Companion Portal Workbench (installWebWorkbench)", () => {
    it("installs companion_portal workbench and injects RFC-0002 channel protocol into AGENTS.md", () => {
      const tmpAppDataDir = `/tmp/ema-test-workbench-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const agentStateDir = path.join(tmpAppDataDir, "agents", "aoi_rei", "agent_state");
      fs.mkdirSync(agentStateDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentStateDir, "AGENTS.md"),
        "# Aoi Rei\n\nGentle companion.\n",
        "utf8",
      );

      const result = installWebWorkbench({
        agentId: "aoi_rei",
        appDataDir: tmpAppDataDir,
        companionName: "苍星怜",
        ownerName: "Rei",
      });

      expect(result.agentId).toBe("aoi_rei");
      expect(result.workbenchId).toBe("companion_portal");
      expect(result.agentsMdUpdated).toBe(true);
      expect(result.files.length).toBe(5);
      for (const f of result.files) {
        expect(fs.existsSync(f)).toBe(true);
      }

      const updatedAgentsMd = fs.readFileSync(path.join(agentStateDir, "AGENTS.md"), "utf8");
      expect(updatedAgentsMd).toContain(WEB_CHANNEL_PROTOCOL_START_MARKER);
      expect(updatedAgentsMd).toContain(WEB_CHANNEL_PROTOCOL_END_MARKER);
      expect(updatedAgentsMd).toContain("/world/web/channels/web:chatroom:default/items");
      expect(updatedAgentsMd).toContain("/world/web/actions/message.post");

      // Idempotent re-injection
      const secondPass = installWebChannelProtocolToAgentsMd(updatedAgentsMd, {
        dbPath: result.dbPath,
        emaCliPath: result.emaCliPath,
      });
      expect(secondPass.split(WEB_CHANNEL_PROTOCOL_START_MARKER).length - 1).toBe(1);

      fs.rmSync(tmpAppDataDir, { recursive: true, force: true });
    });
  });
});
