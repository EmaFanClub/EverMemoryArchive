import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SimpleEmaRouter,
  SimpleEmaInputBatcher,
  formatBatchToXml,
  LiveKitWorld,
  resolveAffectiveProsody,
  createLiveKitPrototype,
  type EmaCtx,
  type EmaActor,
  type EmaInput,
  type EmaWorldRegistry,
  type LiveKitAudioFrame,
} from "../src/index.js";

describe("LiveKitWorld - RFC-0001 & Board Tasks (node-mw7rot6g-7e0a & node-mw7rphi1-9468)", () => {
  let router: SimpleEmaRouter;
  let inputBatcher: SimpleEmaInputBatcher;
  let registry: EmaWorldRegistry;
  let ctx: EmaCtx;
  let actor: EmaActor;
  const testEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };

  beforeEach(() => {
    router = new SimpleEmaRouter();
    inputBatcher = new SimpleEmaInputBatcher({
      dbPath: ":memory:",
      debounceMs: 50,
      maxWaitMs: 150,
    });
    const worldsMap = new Map<string, unknown>();
    registry = {
      register: (name, world) => {
        worldsMap.set(name, world);
        return { dispose: () => worldsMap.delete(name) };
      },
      get: (name) => worldsMap.get(name) as any,
      list: () => [...worldsMap.entries()].map(([name, world]) => ({ name, world: world as any })),
    };
    ctx = { router, inputBatcher, registry };
    actor = {
      id: "actor:companion-ema",
      name: "Ema Voice Companion",
      session: "session-2026-11-08-voice-001",
      agentId: "emafanclub_ema_dev",
    };
  });

  describe("1. Architecture & RFC-0001 Invariants", () => {
    it("starts lifecycle, registers routes under /world/livekit/*, and disposes cleanly", async () => {
      const world = new LiveKitWorld({
        rooms: ["room:lounge", "room:studio"],
        dbPath: ":memory:",
        env: testEnv,
      });

      const handle = world.start(ctx);

      const routes = router.listRoutes();
      expect(routes.some((r) => r.prefix === "/world/livekit/*")).toBe(true);

      const partsRes = await router.read<{
        world: string;
        parts: Array<{ id: string; type: string }>;
      }>("/world/livekit/parts");
      expect(partsRes.world).toBe("livekit");
      expect(partsRes.parts.length).toBe(2);
      expect(partsRes.parts.map((p) => p.id)).toContain("room:lounge");
      expect(partsRes.parts.map((p) => p.id)).toContain("room:studio");

      handle.dispose();

      await expect(router.read("/world/livekit/parts")).rejects.toThrow("Route not found");
    });

    it("enforces strict agent identity assertion on interact (refuses dispatch without PENGUIN_AGENT_ID)", () => {
      const world = new LiveKitWorld({
        rooms: ["room:default"],
        dbPath: ":memory:",
        env: {}, // Missing PENGUIN_AGENT_ID
      });

      world.start(ctx);

      expect(() => {
        world.interact(ctx, actor, "room:default", "Hello from companion");
      }).toThrow("refusing to dispatch without an agent identity");

      world.dispose();
    });

    it("allows interact when operating agent identity is verified", () => {
      const world = new LiveKitWorld({
        rooms: ["room:default"],
        dbPath: ":memory:",
        env: testEnv,
      });

      world.start(ctx);

      expect(() => {
        const handle = world.interact(ctx, actor, "room:default", "Hello voice room!");
        handle.dispose();
      }).not.toThrow();

      world.dispose();
    });
  });

  describe("2. Input Node: LiveKit Voice Input Adapter (node-mw7rot6g-7e0a)", () => {
    it("manages rooms and participant topology with mute and audio track tracking", async () => {
      const world = new LiveKitWorld({
        rooms: ["room:lobby"],
        dbPath: ":memory:",
        env: testEnv,
      });
      world.start(ctx);

      // Join an additional room
      const meetingRoom = world.joinRoom("room:meeting", "Meeting Room");
      expect(meetingRoom.id).toBe("room:meeting");
      expect(meetingRoom.name).toBe("Meeting Room");

      // Add participants to meeting room
      const alice = world.addParticipant("room:meeting", {
        id: "user:alice",
        name: "Alice",
        identity: "alice",
        isMuted: false,
      });
      expect(alice.isSpeaking).toBe(false);
      expect(alice.tracks.length).toBeGreaterThan(0);
      expect(alice.tracks[0].kind).toBe("audio");

      // Update microphone mute state
      world.setParticipantMute("room:meeting", "user:alice", true);
      expect(alice.isMuted).toBe(true);
      expect(alice.tracks[0].isMuted).toBe(true);

      // Inspect via router endpoints
      const roomDetail = await router.read<{
        id: string;
        participants: Array<{ id: string; isMuted: boolean }>;
        publishedTracks: Array<{ sid: string }>;
      }>("/world/livekit/rooms/room:meeting");
      expect(roomDetail.id).toBe("room:meeting");
      expect(roomDetail.participants.length).toBe(1);
      expect(roomDetail.participants[0].id).toBe("user:alice");
      expect(roomDetail.participants[0].isMuted).toBe(true);
      expect(roomDetail.publishedTracks.length).toBeGreaterThan(0);

      world.dispose();
    });

    it("detects VAD speech onset, updates active speaker, and updates speaking state", async () => {
      const world = new LiveKitWorld({
        rooms: ["room:lounge"],
        dbPath: ":memory:",
        env: testEnv,
      });
      world.start(ctx);

      world.addParticipant("room:lounge", { id: "user:bob", name: "Bob", identity: "bob" });

      world.setParticipantSpeaking("room:lounge", "user:bob", true);

      const room = world.getRoom("room:lounge");
      expect(room?.activeSpeaker).toBe("user:bob");
      const bob = room?.participants.get("user:bob");
      expect(bob?.isSpeaking).toBe(true);

      world.setParticipantSpeaking("room:lounge", "user:bob", false);
      expect(room?.activeSpeaker).toBeNull();
      expect(bob?.isSpeaking).toBe(false);

      world.dispose();
    });

    it("segments conversational turns from STT, attaches acoustic metadata, and enqueues EmaInput", async () => {
      const world = new LiveKitWorld({
        rooms: ["room:lounge"],
        dbPath: ":memory:",
        env: testEnv,
      });
      world.start(ctx);

      const pushedInputs: EmaInput[] = [];
      inputBatcher.onBatch((batch) => {
        pushedInputs.push(...batch);
      });

      const input = await world.simulateUserSpeech(
        "room:lounge",
        "user:carol",
        "Can you remember our conversation from yesterday?",
        {
          acousticTimestamp: 1793910050000,
          durationMs: 2400,
          tokens: [
            { text: "Can", startTimeMs: 0, endTimeMs: 300, confidence: 0.98, isFinal: true },
            { text: "you", startTimeMs: 300, endTimeMs: 500, confidence: 0.99, isFinal: true },
            {
              text: "remember",
              startTimeMs: 500,
              endTimeMs: 1200,
              confidence: 0.97,
              isFinal: true,
            },
          ],
        },
      );

      expect(input.world).toBe("livekit");
      expect(input.partId).toBe("room:lounge");
      expect(input.sender.id).toBe("user:carol");
      expect(input.content).toBe("Can you remember our conversation from yesterday?");
      expect(input.timestamp).toBe(1793910050000);
      expect(input.metadata?.acousticTimestamp).toBe(1793910050000);
      expect(input.metadata?.durationMs).toBe(2400);

      // Verify message is queryable via router
      const retrievedMsg = await router.read<EmaInput>(`/world/livekit/messages/${input.id}`);
      expect(retrievedMsg.id).toBe(input.id);
      expect(retrievedMsg.content).toBe(input.content);

      // Wait for input batcher debounce flush
      await new Promise((r) => setTimeout(r, 120));
      expect(pushedInputs.length).toBe(1);
      expect(pushedInputs[0].id).toBe(input.id);

      world.dispose();
    });

    it("ingests streaming audio chunk and finalizes turn when marked final", async () => {
      const world = new LiveKitWorld({
        rooms: ["room:default"],
        dbPath: ":memory:",
        env: testEnv,
      });
      world.start(ctx);

      const dummyChunk = new Uint8Array([0x12, 0x34, 0x56, 0x78]);

      // Interim chunk without final flag
      const interim = await world.simulateInboundAudio("room:default", "user:dan", dummyChunk, {
        isFinal: false,
      });
      expect(interim).toBeNull();
      expect(world.getRoom("room:default")?.activeSpeaker).toBe("user:dan");

      // Final chunk with transcribed text
      const finalInput = await world.simulateInboundAudio("room:default", "user:dan", dummyChunk, {
        isFinal: true,
        text: "Good morning companion!",
      });
      expect(finalInput).not.toBeNull();
      expect(finalInput?.content).toBe("Good morning companion!");
      expect(finalInput?.sender.id).toBe("user:dan");

      world.dispose();
    });

    it("coalesces bursty speech turns transactionally into structured XML payload", async () => {
      const world = new LiveKitWorld({
        rooms: ["room:default"],
        dbPath: ":memory:",
        env: testEnv,
      });
      world.start(ctx);

      const capturedBatches: ReadonlyArray<EmaInput>[] = [];
      inputBatcher.onBatch((batch) => {
        capturedBatches.push(batch);
      });

      // User sends two rapid utterances in succession
      await world.simulateUserSpeech("room:default", "user:eva", "Is the stars visible tonight?");
      await world.simulateUserSpeech("room:default", "user:eva", "And what about the temperature?");

      // Wait for debounce window (50ms)
      await new Promise((r) => setTimeout(r, 120));

      expect(capturedBatches.length).toBe(1);
      expect(capturedBatches[0].length).toBe(2);

      const xml = formatBatchToXml(capturedBatches[0]);
      expect(xml).toContain("<World>livekit</World>");
      expect(xml).toContain("<Channel>room:default</Channel>");
      expect(xml).toContain("Is the stars visible tonight?");
      expect(xml).toContain("And what about the temperature?");

      world.dispose();
    });
  });

  describe("3. Action Node: LiveKit Voice Action Dispatcher (node-mw7rphi1-9468)", () => {
    describe("Affective Prosody Modulation", () => {
      it("resolves default baseline prosody when no overrides are given", () => {
        const prosody = resolveAffectiveProsody();
        expect(prosody.valence).toBe(0.0);
        expect(prosody.arousal).toBe(0.5);
        expect(prosody.energy).toBe(0.5);
        expect(prosody.pitch).toBe(1.0);
        expect(prosody.speakingRate).toBe(1.0);
        expect(prosody.style).toBe("normal");
        expect(prosody.isNightPhaseOrLowEnergy).toBe(false);
      });

      it("automatically triggers whisper style and high breathiness for low-energy / night phase", () => {
        const lowEnergy = resolveAffectiveProsody({ energy: 0.2 });
        expect(lowEnergy.isNightPhaseOrLowEnergy).toBe(true);
        expect(lowEnergy.style).toBe("whisper");
        expect(lowEnergy.breathiness).toBeGreaterThanOrEqual(0.7);
        expect(lowEnergy.speakingRate).toBeLessThan(1.0);
        expect(lowEnergy.pitch).toBeLessThan(1.0);
        expect(lowEnergy.warmth).toBeGreaterThanOrEqual(0.65);

        const explicitWhisper = resolveAffectiveProsody({ style: "whisper" });
        expect(explicitWhisper.isNightPhaseOrLowEnergy).toBe(true);
        expect(explicitWhisper.style).toBe("whisper");
      });

      it("modulates pitch and speaking rate upward for cheerful high valence & arousal state", () => {
        const cheerful = resolveAffectiveProsody({ valence: 0.8, arousal: 0.7, energy: 0.8 });
        expect(cheerful.style).toBe("cheerful");
        expect(cheerful.pitch).toBeGreaterThanOrEqual(1.1);
        expect(cheerful.speakingRate).toBeGreaterThanOrEqual(1.1);
      });

      it("modulates pitch and speaking rate downward for serious negative valence state", () => {
        const serious = resolveAffectiveProsody({ valence: -0.6, arousal: 0.4, energy: 0.5 });
        expect(serious.style).toBe("serious");
        expect(serious.pitch).toBeLessThan(1.0);
        expect(serious.speakingRate).toBeLessThan(1.0);
      });
    });

    describe("Streaming TTS & Audio Track Publishing", () => {
      it("synthesizes frames, populates published audio track buffer, and records word logs", async () => {
        const dispatchedFrames: LiveKitAudioFrame[] = [];
        const world = new LiveKitWorld({
          rooms: ["room:lounge"],
          dbPath: ":memory:",
          env: testEnv,
          audioSender: async (_roomId, frame) => {
            dispatchedFrames.push(frame);
          },
        });
        world.start(ctx);

        const speechText = "The stars are glowing brightly in the quiet sky.";
        const session = await world.speak("room:lounge", speechText, {
          prosody: { valence: 0.4, arousal: 0.3, energy: 0.6 },
          actor,
        });

        expect(session.state).toBe("completed");
        expect(session.publishedFrames).toBeGreaterThan(0);
        expect(dispatchedFrames.length).toBe(session.publishedFrames);
        expect(session.wordLogs.length).toBeGreaterThan(0);

        // Verify audio track buffer on room
        const room = world.getRoom("room:lounge");
        const track = room?.publishedTracks.get("TR_companion_lounge");
        expect(track?.frameBuffer?.length).toBe(session.publishedFrames);

        // Verify transcript log
        const transcript = world.getTranscriptLog();
        expect(transcript.length).toBe(1);
        expect(transcript[0].speaker).toBe(actor.id);
        expect(transcript[0].text).toBe(speechText);
        expect(transcript[0].interrupted).toBe(false);
        expect(transcript[0].words?.length).toBeGreaterThan(0);

        world.dispose();
      });

      it("supports custom pluggable TTS synthesizer engine", async () => {
        const mockSynthesizer = vi.fn(async (text: string, prosody) => {
          return [
            {
              pcmData: new Uint8Array([1, 2, 3]),
              format: "pcm" as const,
              timestampMs: 0,
              durationMs: 200,
              wordTimestamps: [{ word: text, startMs: 0, endMs: 200 }],
            },
          ];
        });

        const world = new LiveKitWorld({
          rooms: ["room:default"],
          dbPath: ":memory:",
          env: testEnv,
          ttsSynthesizer: mockSynthesizer,
        });
        world.start(ctx);

        const session = await world.speak("room:default", "Custom synthesized voice test");
        expect(mockSynthesizer).toHaveBeenCalled();
        expect(session.publishedFrames).toBe(1);
        expect(session.wordLogs[0].word).toBe("Custom synthesized voice test");

        world.dispose();
      });

      it("dispatches voice action via interact() with prosody payload", async () => {
        const world = new LiveKitWorld({
          rooms: ["room:studio"],
          dbPath: ":memory:",
          env: testEnv,
        });
        world.start(ctx);

        const handle = world.interact(ctx, actor, "room:studio", {
          action: "speak",
          text: "I am happy to hear your voice again.",
          prosody: { valence: 0.7, arousal: 0.6, energy: 0.8 },
        });

        // Let async speech settle
        await new Promise((r) => setTimeout(r, 20));

        const transcript = world.getTranscriptLog();
        expect(transcript.length).toBe(1);
        expect(transcript[0].text).toBe("I am happy to hear your voice again.");
        expect(transcript[0].prosody?.style).toBe("cheerful");

        handle.dispose();
        world.dispose();
      });

      it("handles mute and unmute actions on companion microphone track", () => {
        const world = new LiveKitWorld({
          rooms: ["room:studio"],
          dbPath: ":memory:",
          env: testEnv,
        });
        world.start(ctx);

        world.interact(ctx, actor, "room:studio", "mute");
        const room = world.getRoom("room:studio");
        const track = room?.publishedTracks.get("TR_companion_studio");
        expect(track?.isMuted).toBe(true);

        world.interact(ctx, actor, "room:studio", "unmute");
        expect(track?.isMuted).toBe(false);

        world.dispose();
      });
    });

    describe("Instant Interruption Muting & Duplex Control", () => {
      it("instantly mutes TTS, flushes pending frame buffer, and yields floor when user speaks mid-utterance", async () => {
        const world = new LiveKitWorld({
          rooms: ["room:lounge"],
          dbPath: ":memory:",
          env: testEnv,
          // Custom synthesizer that produces multiple frames over time
          ttsSynthesizer: async (_text, _prosody, signal) => {
            const frames: LiveKitAudioFrame[] = [];
            for (let i = 0; i < 10; i++) {
              if (signal.aborted) break;
              frames.push({
                pcmData: new Uint8Array(320),
                format: "pcm",
                timestampMs: i * 200,
                durationMs: 200,
                wordTimestamps: [{ word: `word${i}`, startMs: i * 200, endMs: (i + 1) * 200 }],
              });
            }
            return frames;
          },
        });
        world.start(ctx);

        // Start long companion speech
        const speechPromise = world.speak(
          "room:lounge",
          "word0 word1 word2 word3 word4 word5 word6 word7 word8 word9",
        );

        expect(world.isSpeaking()).toBe(true);
        expect(world.getActiveTtsSession()).not.toBeNull();

        // While companion is vocalizing, human user begins speaking (VAD speech onset)
        world.handleVadSpeechStart("room:lounge", "user:frank");

        // Instant interruption check:
        expect(world.isSpeaking()).toBe(false);
        expect(world.getActiveTtsSession()).toBeNull();
        expect(world.getInterruptionCount()).toBe(1);

        const session = await speechPromise;
        expect(session.state).toBe("interrupted");
        expect(session.interruptedAt).toBeDefined();

        // Verify audio track buffer in room was flushed
        const room = world.getRoom("room:lounge");
        const track = room?.publishedTracks.get("TR_companion_lounge");
        expect(track?.frameBuffer?.length).toBe(0);

        // Verify transcript log reflects interruption
        const transcript = world.getTranscriptLog();
        const companionRecord = transcript.find((r) => r.isCompanion);
        expect(companionRecord?.interrupted).toBe(true);
        expect(companionRecord?.interruptedAt).toBeDefined();

        world.dispose();
      });

      it("supports manual interruption trigger via interact() action 'interrupt'", async () => {
        const world = new LiveKitWorld({
          rooms: ["room:lounge"],
          dbPath: ":memory:",
          env: testEnv,
        });
        world.start(ctx);

        // Simulate speaking state
        world.interact(ctx, actor, "room:lounge", "reply", "A very long message being spoken...");
        expect(world.isSpeaking()).toBe(true);

        // Trigger explicit interrupt action
        world.interact(ctx, actor, "room:lounge", "interrupt");
        expect(world.isSpeaking()).toBe(false);

        world.dispose();
      });
    });
  });

  describe("4. EmaRouter Endpoints Observability", () => {
    it("exposes full WebRTC room, participant, and track topology via router read()", async () => {
      const world = new LiveKitWorld({
        rooms: ["room:observatory"],
        dbPath: ":memory:",
        env: testEnv,
      });
      world.start(ctx);

      world.addParticipant("room:observatory", {
        id: "user:grace",
        name: "Grace",
        identity: "grace",
        isMuted: false,
      });

      // Read rooms list
      const rooms =
        await router.read<Array<{ id: string; participantCount: number }>>("/world/livekit/rooms");
      expect(rooms.length).toBe(1);
      expect(rooms[0].id).toBe("room:observatory");
      expect(rooms[0].participantCount).toBe(1);

      // Read participant roster
      const participants = await router.read<Array<{ id: string; name: string }>>(
        "/world/livekit/rooms/room:observatory/participants",
      );
      expect(participants.length).toBe(1);
      expect(participants[0].name).toBe("Grace");

      // Read single participant
      const singleParticipant = await router.read<{ id: string; identity: string }>(
        "/world/livekit/rooms/room:observatory/participants/user:grace",
      );
      expect(singleParticipant.identity).toBe("grace");

      // Read audio tracks
      const tracks = await router.read<Array<{ sid: string; kind: string }>>(
        "/world/livekit/rooms/room:observatory/tracks",
      );
      expect(tracks.length).toBeGreaterThan(0);
      expect(tracks[0].kind).toBe("audio");

      // Read global status
      const status = await router.read<{
        world: string;
        connectedRooms: number;
        isCompanionSpeaking: boolean;
        interruptionCount: number;
      }>("/world/livekit/status");
      expect(status.world).toBe("livekit");
      expect(status.connectedRooms).toBe(1);
      expect(status.isCompanionSpeaking).toBe(false);
      expect(status.interruptionCount).toBe(0);

      world.dispose();
    });

    it("throws appropriate error when querying unknown room, participant, or message", async () => {
      const world = new LiveKitWorld({
        rooms: ["room:default"],
        dbPath: ":memory:",
        env: testEnv,
      });
      world.start(ctx);

      await expect(router.read("/world/livekit/rooms/room:nonexistent")).rejects.toThrow(
        "Room not found",
      );

      await expect(
        router.read("/world/livekit/rooms/room:default/participants/user:ghost"),
      ).rejects.toThrow("Participant not found");

      await expect(router.read("/world/livekit/messages/nonexistent-msg")).rejects.toThrow(
        "Message not found",
      );

      world.dispose();
    });

    it("reads synchronized transcript log via /world/livekit/transcript", async () => {
      const world = new LiveKitWorld({
        rooms: ["room:lounge"],
        dbPath: ":memory:",
        env: testEnv,
      });
      world.start(ctx);

      await world.simulateUserSpeech("room:lounge", "user:heidi", "Hello companion!");
      await world.speak("room:lounge", "Hello Heidi, welcome back!");

      const transcript = await router.read<
        Array<{ speaker: string; text: string; isCompanion: boolean }>
      >("/world/livekit/transcript");

      expect(transcript.length).toBe(2);
      expect(transcript[0].speaker).toBe("user:heidi");
      expect(transcript[0].text).toBe("Hello companion!");
      expect(transcript[0].isCompanion).toBe(false);

      expect(transcript[1].isCompanion).toBe(true);
      expect(transcript[1].text).toBe("Hello Heidi, welcome back!");

      world.dispose();
    });
  });

  describe("5. End-to-End Voice Prototype Integration (createLiveKitPrototype)", () => {
    it("coalesces voice input, formats XML, invokes LLM, and dispatches spoken voice reply", async () => {
      let capturedXml = "";
      const prototype = createLiveKitPrototype({
        rooms: ["room:main"],
        stateFile: ":memory:",
        env: testEnv,
        batcherOptions: { debounceMs: 40, maxWaitMs: 120 },
        llmInvoker: async (xml) => {
          capturedXml = xml;
          return "I hear your voice clearly through LiveKit WebRTC!";
        },
      });

      // User speaks into room
      await prototype.world.simulateUserSpeech(
        "room:main",
        "user:ivan",
        "Is voice WebRTC connected?",
      );

      // Wait for debounce and turn execution chain
      await new Promise((r) => setTimeout(r, 120));

      expect(capturedXml).toContain("<World>livekit</World>");
      expect(capturedXml).toContain("<Channel>room:main</Channel>");
      expect(capturedXml).toContain("Is voice WebRTC connected?");

      // Check that companion vocalized response in room
      const transcript = prototype.world.getTranscriptLog();
      expect(transcript.length).toBe(2); // 1 user input + 1 companion spoken response
      expect(transcript[1].isCompanion).toBe(true);
      expect(transcript[1].text).toBe("I hear your voice clearly through LiveKit WebRTC!");

      prototype.dispose();
    });
  });
});
