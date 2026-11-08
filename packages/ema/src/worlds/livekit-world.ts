/**
 * @prism-shadow/ema - LiveKitWorld
 *
 * LiveKit WebRTC Realtime Voice Input and Action Adapter for EverMemoryArchive.
 * Conforms to EmaWorld and EmaActor interfaces from RFC-0001.
 *
 * Board Task Associations:
 * - Input Node: node-mw7rot6g-7e0a (LiveKit Voice Input Adapter: WebRTC audio room connection,
 *   Voice Activity Detection (VAD), streaming Speech-to-Text (STT), and conversational turn segmentation).
 * - Action Node: node-mw7rphi1-9468 (LiveKit Voice Action Dispatcher: Realtime streaming Text-to-Speech (TTS),
 *   affective prosody synthesis, audio track publication, and instant user interruption muting).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  EmaWorld,
  type EmaCtx,
  type EmaActor,
  type EmaInput,
  type Disposable,
  type EmaWorldPart,
  type Id,
} from "../interfaces.js";
import { assertAgentIdentity } from "../minimal.js";

/**
 * Representation of an audio or video track within a LiveKit WebRTC room.
 */
export interface LiveKitTrack {
  sid: string;
  kind: "audio" | "video";
  source: "microphone" | "screen_share" | "unknown";
  isMuted: boolean;
  subscribed: boolean;
  frameBuffer?: LiveKitAudioFrame[];
  flushBuffer?: () => void;
}

/**
 * Representation of a human participant or companion actor within a LiveKit room.
 */
export interface LiveKitParticipant {
  id: string;
  identity: string;
  name: string;
  isSpeaking: boolean;
  isMuted: boolean;
  tracks: LiveKitTrack[];
  joinedAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Representation of a LiveKit WebRTC audio room (World Part).
 */
export interface LiveKitRoom {
  id: string;
  name: string;
  state: "connected" | "connecting" | "disconnected" | "reconnecting";
  participants: Map<string, LiveKitParticipant>;
  publishedTracks: Map<string, LiveKitTrack>;
  activeSpeaker?: string | null;
}

/**
 * Streaming transcription token emitted by speech-to-text (STT).
 */
export interface LiveKitTranscriptToken {
  text: string;
  startTimeMs: number;
  endTimeMs: number;
  confidence: number;
  isFinal: boolean;
}

/**
 * Affective prosody configuration for voice synthesis.
 */
export interface LiveKitAffectiveProsody {
  valence?: number;
  arousal?: number;
  energy?: number;
  pitch?: number;
  speakingRate?: number;
  warmth?: number;
  breathiness?: number;
  style?: "normal" | "whisper" | "soothing" | "cheerful" | "serious";
}

/**
 * Resolved and normalized affective prosody attributes.
 */
export interface ResolvedAffectiveProsody extends Required<LiveKitAffectiveProsody> {
  isNightPhaseOrLowEnergy: boolean;
}

/**
 * Audio frame published to or ingested from WebRTC audio tracks.
 */
export interface LiveKitAudioFrame {
  pcmData: Uint8Array;
  format: "pcm" | "opus";
  timestampMs: number;
  durationMs: number;
  wordTimestamps?: Array<{ word: string; startMs: number; endMs: number }>;
}

/**
 * Active companion text-to-speech (TTS) synthesis session.
 */
export interface LiveKitTtsSession {
  id: string;
  text: string;
  roomId: string;
  state: "synthesizing" | "speaking" | "interrupted" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  interruptedAt?: number;
  prosody: ResolvedAffectiveProsody;
  publishedFrames: number;
  wordLogs: Array<{ word: string; timestampMs: number }>;
  abortController: AbortController;
}

/**
 * Synchronized transcript entry for speech history tracking.
 */
export interface LiveKitTranscriptRecord {
  id: string;
  roomId: string;
  speaker: string;
  isCompanion: boolean;
  text: string;
  timestamp: number;
  durationMs?: number;
  interrupted?: boolean;
  interruptedAt?: number;
  words?: Array<{ word: string; startMs: number; endMs: number }>;
  prosody?: ResolvedAffectiveProsody;
  metadata?: Record<string, unknown>;
}

/**
 * Options for configuring LiveKitWorld.
 */
export interface LiveKitWorldOptions {
  /** Array of monitored LiveKit room IDs/names (Parts), e.g. ["room:lounge"] */
  rooms?: string[];
  /** SQLite database path for persistent seen state and transcript logs */
  dbPath?: string;
  /** Legacy alias for dbPath or JSON migration source */
  stateFile?: string;
  /** Default affective prosody baseline */
  defaultProsody?: LiveKitAffectiveProsody;
  /** Optional custom TTS synthesizer */
  ttsSynthesizer?: (
    text: string,
    prosody: ResolvedAffectiveProsody,
    signal: AbortSignal,
  ) => Promise<LiveKitAudioFrame[]> | LiveKitAudioFrame[];
  /** Optional custom audio frame dispatcher */
  audioSender?: (roomId: string, frame: LiveKitAudioFrame) => Promise<void> | void;
  /** Optional delay between published frames (ms, default: 0) */
  frameIntervalMs?: number;
  /** Environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>;
  /** If true, mounts routes without starting active timers */
  passive?: boolean;
}

/**
 * Resolves affective prosody based on valence, arousal, energy, and style.
 * Modulates pitch, speaking rate, warmth, and breathiness dynamically.
 * Automatically activates whisper/soothing style for low-energy or night phase.
 */
export function resolveAffectiveProsody(
  input: LiveKitAffectiveProsody = {},
  fallback: LiveKitAffectiveProsody = {},
): ResolvedAffectiveProsody {
  const valence = input.valence ?? fallback.valence ?? 0.0;
  const arousal = input.arousal ?? fallback.arousal ?? 0.5;
  const energy = input.energy ?? fallback.energy ?? 0.5;

  let style = input.style ?? fallback.style ?? "normal";
  let pitch = input.pitch ?? fallback.pitch ?? 1.0;
  let speakingRate = input.speakingRate ?? fallback.speakingRate ?? 1.0;
  let warmth = input.warmth ?? fallback.warmth ?? 0.5;
  let breathiness = input.breathiness ?? fallback.breathiness ?? 0.2;

  const isNightPhaseOrLowEnergy = energy < 0.3 || style === "whisper" || style === "soothing";

  if (isNightPhaseOrLowEnergy) {
    if (style !== "soothing") {
      style = "whisper";
    }
    breathiness = Math.max(breathiness, 0.7);
    speakingRate = Math.min(speakingRate, 0.88);
    pitch = Math.min(pitch, 0.94);
    warmth = Math.max(warmth, 0.65);
  } else if (valence >= 0.5 && arousal >= 0.6) {
    if (style === "normal") style = "cheerful";
    pitch = Math.max(pitch, 1.1);
    speakingRate = Math.max(speakingRate, 1.12);
    warmth = Math.max(warmth, 0.6);
  } else if (valence <= -0.3) {
    if (style === "normal") style = "serious";
    pitch = Math.min(pitch, 0.92);
    speakingRate = Math.min(speakingRate, 0.95);
  }

  return {
    valence,
    arousal,
    energy,
    pitch,
    speakingRate,
    warmth,
    breathiness,
    style,
    isNightPhaseOrLowEnergy,
  };
}

export class LiveKitWorld extends EmaWorld {
  private rooms: Map<string, LiveKitRoom> = new Map();
  private env: Record<string, string | undefined>;
  private dbPath?: string;
  private defaultProsody: LiveKitAffectiveProsody;
  private ttsSynthesizer?: LiveKitWorldOptions["ttsSynthesizer"];
  private audioSender?: LiveKitWorldOptions["audioSender"];
  private frameIntervalMs: number;
  private passive: boolean;

  private active = false;
  private isCompanionSpeaking = false;
  private activeTtsSession: LiveKitTtsSession | null = null;
  private interruptionCount = 0;

  private messageHistory: Map<string, EmaInput> = new Map();
  private transcriptLog: LiveKitTranscriptRecord[] = [];
  private seenIds: Set<string> = new Set();

  private db: DatabaseSync | null = null;
  private insertSeenStmt: StatementSync | null = null;
  private insertTranscriptStmt: StatementSync | null = null;
  private updateInterruptedStmt: StatementSync | null = null;

  private activeCtx: EmaCtx | null = null;

  constructor(options: LiveKitWorldOptions = {}) {
    super();
    this.env = options.env ?? process.env;
    this.passive = options.passive ?? false;
    this.defaultProsody = options.defaultProsody ?? {
      valence: 0.0,
      arousal: 0.5,
      energy: 0.5,
    };
    this.ttsSynthesizer = options.ttsSynthesizer;
    this.audioSender = options.audioSender;
    this.frameIntervalMs = options.frameIntervalMs ?? 0;

    // Resolve SQLite database path
    if (options.dbPath) {
      this.dbPath = options.dbPath;
    } else if (options.stateFile) {
      this.dbPath = options.stateFile.endsWith(".json")
        ? `${options.stateFile.replace(/\.json$/, "")}.sqlite`
        : options.stateFile;
    } else {
      this.dbPath = "/tmp/ema-minimal-workspace/ema-state.sqlite";
    }

    this.initSqlite();

    // Initialize configured rooms
    const initialRooms = options.rooms ?? ["room:default"];
    for (const r of initialRooms) {
      this.joinRoom(r);
    }
  }

  private initSqlite(): void {
    if (!this.dbPath) return;
    try {
      if (this.dbPath !== ":memory:") {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS livekit_seen_turns (
          id TEXT PRIMARY KEY,
          room_id TEXT,
          participant_id TEXT,
          timestamp INTEGER
        );
        CREATE TABLE IF NOT EXISTS livekit_transcripts (
          id TEXT PRIMARY KEY,
          room_id TEXT,
          speaker TEXT,
          content TEXT,
          is_companion INTEGER,
          interrupted INTEGER,
          timestamp INTEGER,
          metadata TEXT
        );
      `);
      this.insertSeenStmt = this.db.prepare(
        "INSERT OR IGNORE INTO livekit_seen_turns (id, room_id, participant_id, timestamp) VALUES (?, ?, ?, ?)",
      );
      this.insertTranscriptStmt = this.db.prepare(
        "INSERT OR REPLACE INTO livekit_transcripts (id, room_id, speaker, content, is_companion, interrupted, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      this.updateInterruptedStmt = this.db.prepare(
        "UPDATE livekit_transcripts SET interrupted = 1 WHERE id = ?",
      );
    } catch (err) {
      console.error("[LiveKitWorld] Failed to initialize SQLite database:", err);
    }
  }

  private saveSeenTurn(id: string, roomId: string, participantId: string): void {
    if (!this.db || !this.insertSeenStmt) return;
    try {
      this.insertSeenStmt.run(id, roomId, participantId, Date.now());
    } catch (err) {
      console.error("[LiveKitWorld] Failed to save seen turn to SQLite:", err);
    }
  }

  private saveTranscriptRecord(record: LiveKitTranscriptRecord): void {
    if (!this.db || !this.insertTranscriptStmt) return;
    try {
      this.insertTranscriptStmt.run(
        record.id,
        record.roomId,
        record.speaker,
        record.text,
        record.isCompanion ? 1 : 0,
        record.interrupted ? 1 : 0,
        record.timestamp,
        record.metadata ? JSON.stringify(record.metadata) : null,
      );
    } catch (err) {
      console.error("[LiveKitWorld] Failed to save transcript record to SQLite:", err);
    }
  }

  /**
   * Starts the world lifecycle: initializes network listeners,
   * mounts resource routes on ctx.router, and connects input ingestion.
   */
  start(ctx: EmaCtx): Disposable {
    this.active = true;
    this.activeCtx = ctx;

    // Mount Router Endpoints for LiveKit WebRTC Voice World
    const routeHandle = ctx.router.serve(
      "/world/livekit/*",
      (routeCtx) => {
        const rawSubpath = routeCtx.path.replace(/^\/world\/livekit\/?/, "");
        const subpath = decodeURIComponent(rawSubpath);

        // 1. Root and Parts listing
        if (subpath === "" || subpath === "parts") {
          return {
            world: "livekit",
            parts: this.listParts(),
          };
        }

        // 2. Global status
        if (subpath === "status") {
          return {
            world: "livekit",
            active: this.active,
            connectedRooms: this.rooms.size,
            isCompanionSpeaking: this.isCompanionSpeaking,
            activeTtsSession: this.activeTtsSession
              ? {
                  id: this.activeTtsSession.id,
                  roomId: this.activeTtsSession.roomId,
                  text: this.activeTtsSession.text,
                  state: this.activeTtsSession.state,
                  prosody: this.activeTtsSession.prosody,
                  publishedFrames: this.activeTtsSession.publishedFrames,
                  startedAt: this.activeTtsSession.startedAt,
                }
              : null,
            interruptionCount: this.interruptionCount,
          };
        }

        // 3. Transcript synchronization log
        if (subpath === "transcript") {
          return this.getTranscriptLog();
        }

        // 4. Message lookup by ID
        if (subpath.startsWith("messages/")) {
          const id = subpath.replace(/^messages\//, "");
          const msg = this.messageHistory.get(id);
          if (!msg) {
            throw new Error(`Message not found: ${id}`);
          }
          return msg;
        }

        // 5. Part lookup
        if (subpath.startsWith("parts/")) {
          const rawPartId = subpath.replace(/^parts\//, "");
          const partId = rawPartId.startsWith("room:") ? rawPartId : `room:${rawPartId}`;
          const part = this.listParts().find((p) => p.id === partId);
          if (!part) {
            throw new Error(`Part not found: ${rawPartId}`);
          }
          return part;
        }

        // 6. Rooms listing
        if (subpath === "rooms") {
          return this.listRooms().map((room) => ({
            id: room.id,
            name: room.name,
            state: room.state,
            participantCount: room.participants.size,
            activeSpeaker: room.activeSpeaker,
            publishedTrackCount: room.publishedTracks.size,
          }));
        }

        // 7. Detailed Room routing (/world/livekit/rooms/:id/...)
        const roomMatch = subpath.match(/^rooms\/([^/]+)(?:\/(participants|tracks)(?:\/(.+))?)?$/);
        if (roomMatch) {
          const rawRoomId = roomMatch[1];
          const roomId = rawRoomId.startsWith("room:") ? rawRoomId : `room:${rawRoomId}`;
          const room = this.rooms.get(roomId);
          if (!room) {
            throw new Error(`Room not found: ${rawRoomId}`);
          }

          const section = roomMatch[2];
          const subId = roomMatch[3];

          if (!section) {
            return {
              id: room.id,
              name: room.name,
              state: room.state,
              activeSpeaker: room.activeSpeaker,
              participants: Array.from(room.participants.values()).map((p) => ({
                id: p.id,
                identity: p.identity,
                name: p.name,
                isSpeaking: p.isSpeaking,
                isMuted: p.isMuted,
                tracks: p.tracks,
              })),
              publishedTracks: Array.from(room.publishedTracks.values()),
            };
          }

          if (section === "participants") {
            if (!subId) {
              return Array.from(room.participants.values());
            }
            const p =
              room.participants.get(subId) ||
              room.participants.get(`user:${subId}`) ||
              Array.from(room.participants.values()).find((item) => item.identity === subId);
            if (!p) {
              throw new Error(`Participant not found: ${subId}`);
            }
            return p;
          }

          if (section === "tracks") {
            return Array.from(room.publishedTracks.values());
          }
        }

        return {
          world: "livekit",
          parts: this.listParts(),
        };
      },
      "LiveKit WebRTC voice world resource router",
    );

    return {
      dispose: () => {
        this.active = false;
        this.activeCtx = null;
        routeHandle.dispose();
        this.dispose();
      },
    };
  }

  /**
   * Closes database handles, stops pending speech, and cleans up resources.
   */
  dispose(): void {
    this.active = false;
    this.haltTtsSession("world_disposed");

    if (this.db) {
      try {
        this.insertSeenStmt = null;
        this.insertTranscriptStmt = null;
        this.updateInterruptedStmt = null;
        this.db.close();
      } catch (err) {
        console.error("[LiveKitWorld] Error closing SQLite database:", err);
      }
      this.db = null;
    }
  }

  /**
   * Interacts with a specific part (room) of the world on behalf of an EMA Actor.
   * Enforces strict agent identity verification before any dispatch.
   */
  interact(ctx: EmaCtx, actor: EmaActor, id: Id, ...args: unknown[]): Disposable {
    assertAgentIdentity(this.env);

    const roomId = id.startsWith("room:") ? id : `room:${id}`;
    const room = this.rooms.get(roomId) ?? this.joinRoom(roomId);

    let action = "speak";
    let text = "";
    let prosody: LiveKitAffectiveProsody | undefined;

    if (args.length > 0) {
      const first = args[0];
      if (typeof first === "string") {
        if (first === "interrupt") {
          action = "interrupt";
        } else if (first === "mute") {
          action = "mute";
        } else if (first === "unmute") {
          action = "unmute";
        } else if (first === "reply" && typeof args[1] === "string") {
          action = "speak";
          text = args[1];
        } else {
          action = "speak";
          text = first;
        }
      } else if (typeof first === "object" && first !== null) {
        const obj = first as Record<string, unknown>;
        action = String(obj.action || "speak");
        text = String(obj.text || obj.message || "");
        if (obj.prosody && typeof obj.prosody === "object") {
          prosody = obj.prosody as LiveKitAffectiveProsody;
        }
      }
    }

    if (action === "interrupt") {
      this.haltTtsSession("actor_interrupt", actor.id);
      return { dispose: () => {} };
    }

    if (action === "mute" || action === "unmute") {
      const companionTrackSid = `TR_companion_${room.name}`;
      const track = room.publishedTracks.get(companionTrackSid);
      if (track) {
        track.isMuted = action === "mute";
      }
      return { dispose: () => {} };
    }

    if (!text) {
      throw new Error("No speech text provided for voice interaction");
    }

    const sessionPromise = this.speak(roomId, text, { prosody, actor });

    return {
      dispose: () => {
        sessionPromise
          .then((sess) => {
            if (this.activeTtsSession === sess && sess.state === "speaking") {
              this.haltTtsSession("interaction_disposed", actor.id);
            }
          })
          .catch(() => {});
      },
    };
  }

  /**
   * Lists all registered LiveKit audio room parts.
   */
  listParts(): EmaWorldPart[] {
    return Array.from(this.rooms.values()).map((room) => ({
      id: room.id,
      type: "room",
      name: room.name,
      memberCount: room.participants.size,
    }));
  }

  /**
   * Lists all active room objects.
   */
  listRooms(): LiveKitRoom[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Retrieves a room by ID.
   */
  getRoom(roomId: string): LiveKitRoom | undefined {
    const normalized = roomId.startsWith("room:") ? roomId : `room:${roomId}`;
    return this.rooms.get(normalized);
  }

  /**
   * Joins or creates a LiveKit WebRTC room and registers default companion audio track.
   */
  joinRoom(roomId: string, name?: string): LiveKitRoom {
    const normalizedId = roomId.startsWith("room:") ? roomId : `room:${roomId}`;
    let room = this.rooms.get(normalizedId);
    if (!room) {
      const roomName = name || normalizedId.replace(/^room:/, "");
      const companionTrackSid = `TR_companion_${roomName}`;

      const track: LiveKitTrack = {
        sid: companionTrackSid,
        kind: "audio",
        source: "microphone",
        isMuted: false,
        subscribed: true,
        frameBuffer: [],
        flushBuffer: () => {
          track.frameBuffer = [];
        },
      };

      room = {
        id: normalizedId,
        name: roomName,
        state: "connected",
        participants: new Map(),
        publishedTracks: new Map([[companionTrackSid, track]]),
        activeSpeaker: null,
      };

      this.rooms.set(normalizedId, room);
    }
    return room;
  }

  /**
   * Leaves and disconnects a LiveKit room.
   */
  leaveRoom(roomId: string): void {
    const normalizedId = roomId.startsWith("room:") ? roomId : `room:${roomId}`;
    const room = this.rooms.get(normalizedId);
    if (room) {
      room.state = "disconnected";
      this.rooms.delete(normalizedId);
    }
  }

  /**
   * Adds or updates a participant in a room.
   */
  addParticipant(
    roomId: string,
    participant: Partial<LiveKitParticipant> & { id: string },
  ): LiveKitParticipant {
    const room = this.joinRoom(roomId);
    const existing = room.participants.get(participant.id);
    const fullParticipant: LiveKitParticipant = {
      id: participant.id,
      identity: participant.identity || participant.id.replace(/^user:/, ""),
      name: participant.name || participant.identity || participant.id,
      isSpeaking: participant.isSpeaking ?? false,
      isMuted: participant.isMuted ?? false,
      tracks: participant.tracks ?? [
        {
          sid: `TR_${participant.id.replace(/[^a-zA-Z0-9]/g, "_")}_mic`,
          kind: "audio",
          source: "microphone",
          isMuted: participant.isMuted ?? false,
          subscribed: true,
        },
      ],
      joinedAt: participant.joinedAt ?? Date.now(),
      metadata: participant.metadata,
    };
    room.participants.set(participant.id, fullParticipant);
    return fullParticipant;
  }

  /**
   * Removes a participant from a room.
   */
  removeParticipant(roomId: string, participantId: string): void {
    const room = this.getRoom(roomId);
    if (room) {
      room.participants.delete(participantId);
      if (room.activeSpeaker === participantId) {
        room.activeSpeaker = null;
      }
    }
  }

  /**
   * Updates a participant's microphone mute status.
   */
  setParticipantMute(roomId: string, participantId: string, isMuted: boolean): void {
    const room = this.getRoom(roomId);
    const p = room?.participants.get(participantId);
    if (p) {
      p.isMuted = isMuted;
      for (const track of p.tracks) {
        if (track.kind === "audio") {
          track.isMuted = isMuted;
        }
      }
    }
  }

  /**
   * Updates speaking state, triggering VAD speech onset or completion.
   */
  setParticipantSpeaking(roomId: string, participantId: string, isSpeaking: boolean): void {
    const room = this.getRoom(roomId);
    const p = room?.participants.get(participantId);
    if (p) {
      p.isSpeaking = isSpeaking;
      if (isSpeaking) {
        this.handleVadSpeechStart(roomId, participantId);
      } else if (room && room.activeSpeaker === participantId) {
        room.activeSpeaker = null;
      }
    }
  }

  /**
   * Handles Voice Activity Detection (VAD) speech onset.
   * If companion is currently speaking, triggers instant muting and interruption!
   */
  handleVadSpeechStart(roomId: string, participantId: string): void {
    const room = this.getRoom(roomId);
    if (room) {
      room.activeSpeaker = participantId;
      const p = room.participants.get(participantId);
      if (p) {
        p.isSpeaking = true;
      }
    }

    // Instant interruption: if companion is vocalizing, immediately halt TTS and flush audio buffer
    if (
      this.isCompanionSpeaking ||
      (this.activeTtsSession &&
        (this.activeTtsSession.state === "speaking" ||
          this.activeTtsSession.state === "synthesizing"))
    ) {
      this.haltTtsSession("user_speech_interruption", participantId);
    }
  }

  /**
   * Handles VAD speech completion, coalescing speech tokens and enqueuing EmaInput.
   */
  async handleVadSpeechEnd(
    roomId: string,
    participantId: string,
    finalizedText: string,
    options: {
      acousticTimestamp?: number;
      durationMs?: number;
      tokens?: LiveKitTranscriptToken[];
    } = {},
  ): Promise<EmaInput> {
    const normalizedRoomId = roomId.startsWith("room:") ? roomId : `room:${roomId}`;
    const room = this.joinRoom(normalizedRoomId);

    const participant =
      room.participants.get(participantId) ||
      this.addParticipant(normalizedRoomId, { id: participantId });

    participant.isSpeaking = false;
    if (room.activeSpeaker === participantId) {
      room.activeSpeaker = null;
    }

    const trimmed = finalizedText.trim();
    if (!trimmed) {
      throw new Error("Cannot emit speech turn with empty transcript text");
    }

    const turnId = `lk-turn-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const timestamp = options.acousticTimestamp ?? Date.now();

    this.seenIds.add(turnId);
    this.saveSeenTurn(turnId, normalizedRoomId, participantId);

    const input: EmaInput = {
      id: turnId,
      world: "livekit",
      partId: normalizedRoomId,
      sender: {
        id: participant.id,
        name: participant.name || participant.identity || participant.id,
        isOwner: participant.id === "user:admin" || Boolean(participant.metadata?.isOwner),
      },
      content: trimmed,
      timestamp,
      metadata: {
        roomId: normalizedRoomId,
        participantId: participant.id,
        acousticTimestamp: timestamp,
        durationMs: options.durationMs ?? 0,
        tokens: options.tokens,
        isVoice: true,
      },
    };

    // Maintain capacity capped message history
    if (this.messageHistory.size >= 200) {
      const oldest = this.messageHistory.keys().next().value;
      if (oldest) this.messageHistory.delete(oldest);
    }
    this.messageHistory.set(turnId, input);

    // Record in transcript log
    const transcriptRecord: LiveKitTranscriptRecord = {
      id: turnId,
      roomId: normalizedRoomId,
      speaker: participant.id,
      isCompanion: false,
      text: trimmed,
      timestamp,
      durationMs: options.durationMs,
      interrupted: false,
      metadata: input.metadata,
    };
    this.transcriptLog.push(transcriptRecord);
    this.saveTranscriptRecord(transcriptRecord);

    // Transactional input batching: push to runtime inputBatcher
    if (this.activeCtx) {
      this.activeCtx.inputBatcher.push(input);
    }

    return input;
  }

  /**
   * Simulates an end-to-end user voice turn (VAD onset -> speech -> VAD end -> STT finalization).
   */
  async simulateUserSpeech(
    roomId: string,
    participantId: string,
    text: string,
    options: {
      acousticTimestamp?: number;
      durationMs?: number;
      tokens?: LiveKitTranscriptToken[];
    } = {},
  ): Promise<EmaInput> {
    this.handleVadSpeechStart(roomId, participantId);
    return this.handleVadSpeechEnd(roomId, participantId, text, options);
  }

  /**
   * Simulates streaming audio chunk ingestion into VAD/STT pipeline.
   */
  async simulateInboundAudio(
    roomId: string,
    participantId: string,
    chunk: Uint8Array,
    options: {
      isFinal?: boolean;
      text?: string;
      acousticTimestamp?: number;
      durationMs?: number;
    } = {},
  ): Promise<EmaInput | null> {
    this.handleVadSpeechStart(roomId, participantId);
    if (options.isFinal && options.text) {
      return this.handleVadSpeechEnd(roomId, participantId, options.text, options);
    }
    return null;
  }

  /**
   * Dispatches text-to-speech (TTS) audio synthesis with affective prosody modulation.
   */
  async speak(
    roomId: string,
    text: string,
    options: {
      prosody?: LiveKitAffectiveProsody;
      actor?: EmaActor;
    } = {},
  ): Promise<LiveKitTtsSession> {
    const normalizedRoomId = roomId.startsWith("room:") ? roomId : `room:${roomId}`;
    const room = this.joinRoom(normalizedRoomId);

    // Halt any previous active speech session before starting a new one
    if (this.activeTtsSession && this.activeTtsSession.state === "speaking") {
      this.haltTtsSession("superseded_by_new_speech");
    }

    const resolvedProsody = resolveAffectiveProsody(options.prosody, this.defaultProsody);
    const sessionId = `lk-tts-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const abortController = new AbortController();

    const session: LiveKitTtsSession = {
      id: sessionId,
      text,
      roomId: normalizedRoomId,
      state: "synthesizing",
      startedAt: Date.now(),
      prosody: resolvedProsody,
      publishedFrames: 0,
      wordLogs: [],
      abortController,
    };

    this.activeTtsSession = session;
    this.isCompanionSpeaking = true;

    // Initial transcript record registered immediately
    const transcriptRecord: LiveKitTranscriptRecord = {
      id: sessionId,
      roomId: normalizedRoomId,
      speaker: options.actor?.id || "companion:ema",
      isCompanion: true,
      text,
      timestamp: session.startedAt,
      prosody: resolvedProsody,
      words: [],
      interrupted: false,
    };
    this.transcriptLog.push(transcriptRecord);

    // Generate or synthesize frames
    let frames: LiveKitAudioFrame[] = [];
    try {
      if (this.ttsSynthesizer) {
        frames = await this.ttsSynthesizer(text, resolvedProsody, abortController.signal);
      } else {
        frames = this.generateSyntheticAudioFrames(text, resolvedProsody);
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        session.state = "interrupted";
        return session;
      }
      session.state = "failed";
      this.isCompanionSpeaking = false;
      this.activeTtsSession = null;
      throw err;
    }

    if (abortController.signal.aborted) {
      session.state = "interrupted";
      return session;
    }

    session.state = "speaking";

    // Track companion published audio track
    const companionTrackSid = `TR_companion_${room.name}`;
    const track = room.publishedTracks.get(companionTrackSid);

    // Yield to event loop so callers can observe active speaking state or trigger interruption
    await new Promise((r) => setImmediate(r));

    if (abortController.signal.aborted || (session.state as string) === "interrupted") {
      session.state = "interrupted";
      this.isCompanionSpeaking = false;
      if (this.activeTtsSession === session) {
        this.activeTtsSession = null;
      }
      return session;
    }

    // Publish frames sequentially
    for (const frame of frames) {
      if (abortController.signal.aborted || (session.state as string) === "interrupted") {
        break;
      }

      if (this.frameIntervalMs > 0) {
        await new Promise((r) => setTimeout(r, this.frameIntervalMs));
      }

      if (abortController.signal.aborted || (session.state as string) === "interrupted") {
        break;
      }

      if (track && track.frameBuffer) {
        track.frameBuffer.push(frame);
      }

      if (this.audioSender) {
        try {
          await this.audioSender(normalizedRoomId, frame);
        } catch (sendErr) {
          console.error("[LiveKitWorld] Error dispatching audio frame:", sendErr);
        }
      }

      session.publishedFrames++;

      if (frame.wordTimestamps) {
        for (const w of frame.wordTimestamps) {
          session.wordLogs.push({ word: w.word, timestampMs: Date.now() });
          transcriptRecord.words?.push(w);
        }
      }
    }

    if (abortController.signal.aborted || (session.state as string) === "interrupted") {
      session.state = "interrupted";
      this.isCompanionSpeaking = false;
      if (this.activeTtsSession === session) {
        this.activeTtsSession = null;
      }
    } else {
      session.state = "completed";
      session.completedAt = Date.now();
      this.isCompanionSpeaking = false;
      if (this.activeTtsSession === session) {
        this.activeTtsSession = null;
      }
    }

    this.saveTranscriptRecord(transcriptRecord);
    return session;
  }

  /**
   * Instantly halts active TTS synthesis and flushes published audio buffers upon user interruption.
   */
  haltTtsSession(reason: string, triggeredBy?: string): void {
    if (
      !this.activeTtsSession ||
      (this.activeTtsSession.state !== "speaking" && this.activeTtsSession.state !== "synthesizing")
    ) {
      this.isCompanionSpeaking = false;
      return;
    }

    const session = this.activeTtsSession;
    session.state = "interrupted";
    session.interruptedAt = Date.now();
    session.abortController.abort(
      new Error(`Interrupted: ${reason} by ${triggeredBy || "unknown"}`),
    );

    this.isCompanionSpeaking = false;
    this.interruptionCount++;

    // Flush audio frame buffers in room
    const room = this.rooms.get(session.roomId);
    if (room) {
      const companionTrackSid = `TR_companion_${room.name}`;
      const track = room.publishedTracks.get(companionTrackSid);
      if (track && track.flushBuffer) {
        track.flushBuffer();
      }
    }

    // Update transcript log with interruption status
    const record = this.transcriptLog.find((r) => r.id === session.id);
    if (record) {
      record.interrupted = true;
      record.interruptedAt = session.interruptedAt;
      this.saveTranscriptRecord(record);
      if (this.updateInterruptedStmt) {
        try {
          this.updateInterruptedStmt.run(session.id);
        } catch {}
      }
    }

    this.activeTtsSession = null;
  }

  /**
   * Generates synthetic audio frames with word timestamps for testing and standalone operation.
   */
  private generateSyntheticAudioFrames(
    text: string,
    prosody: ResolvedAffectiveProsody,
  ): LiveKitAudioFrame[] {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const frames: LiveKitAudioFrame[] = [];

    // Scale word duration inversely by speaking rate
    const baseWordMs = Math.round(260 / Math.max(0.2, prosody.speakingRate));
    let currentOffset = 0;

    for (const word of words) {
      const durationMs = Math.max(120, baseWordMs);
      const startMs = currentOffset;
      const endMs = currentOffset + durationMs;
      currentOffset = endMs;

      // Generate synthetic 16kHz PCM data (silence or simple waveform)
      const sampleCount = Math.round((durationMs * 16000) / 1000);
      const pcmData = new Uint8Array(sampleCount * 2);

      frames.push({
        pcmData,
        format: "pcm",
        timestampMs: startMs,
        durationMs,
        wordTimestamps: [{ word, startMs, endMs }],
      });
    }

    return frames;
  }

  /**
   * Returns active TTS session if companion is vocalizing.
   */
  getActiveTtsSession(): LiveKitTtsSession | null {
    return this.activeTtsSession;
  }

  /**
   * Returns count of user interruption events handled.
   */
  getInterruptionCount(): number {
    return this.interruptionCount;
  }

  /**
   * Returns whether companion is currently speaking.
   */
  isSpeaking(): boolean {
    return this.isCompanionSpeaking;
  }

  /**
   * Returns the synchronized transcript record log.
   */
  getTranscriptLog(): ReadonlyArray<LiveKitTranscriptRecord> {
    return [...this.transcriptLog];
  }
}
