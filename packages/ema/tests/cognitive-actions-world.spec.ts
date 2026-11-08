/**
 * @prism-shadow/ema - CognitiveActionsWorld Test Suite
 *
 * Verifies the Internal Cognitive Actions execution adapter:
 * - RFC-0001 World Contract, Lifecycle, and Router Mounting
 * - Working Buffer & Buffer Saturation Trigger
 * - Multi-Tier Memory Consolidation (Buffer -> Activity -> Day -> Month -> Year)
 * - Daily Journal Synthesis in Authentic Character Voice
 * - Dense Vector Distillation into LanceDB with Semantic Search
 * - Affective Homeostasis, Energy Regeneration (100% capacity), and Circadian Rest Trigger
 * - Closed-Loop Feedback to Input Batcher and Identity Guard
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CognitiveActionsWorld,
  computeDeterministicEmbedding,
  type CognitiveBufferMessage,
  type CognitiveRollupRecord,
} from "../src/worlds/cognitive-actions-world.js";
import { SimpleEmaRouter } from "../src/router.js";
import { SimpleEmaInputBatcher } from "../src/input-batcher.js";
import {
  type EmaCtx,
  type EmaActor,
  type EmaInput,
  type EmaWorldRegistry,
  EmaWorld,
} from "../src/interfaces.js";

describe("CognitiveActionsWorld (Internal Cognitive Actions Adapter)", () => {
  let router: SimpleEmaRouter;
  let inputBatcher: SimpleEmaInputBatcher;
  let registry: EmaWorldRegistry;
  let ctx: EmaCtx;
  let world: CognitiveActionsWorld;
  let mockActor: EmaActor;
  const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };

  beforeEach(() => {
    router = new SimpleEmaRouter();
    inputBatcher = new SimpleEmaInputBatcher({
      debounceMs: 20,
      maxWaitMs: 50,
      dbPath: ":memory:",
    });

    const registeredWorlds = new Map<string, EmaWorld>();
    registry = {
      register: (name, w) => {
        registeredWorlds.set(name, w);
        return {
          dispose: () => {
            registeredWorlds.delete(name);
          },
        };
      },
      get: (name) => registeredWorlds.get(name),
      list: () => Array.from(registeredWorlds.entries()).map(([name, w]) => ({ name, world: w })),
    };

    ctx = {
      router,
      inputBatcher,
      registry,
    };

    mockActor = {
      id: "actor:ema_companion",
      name: "Ema",
      session: "session-2026-11-08-test",
      agentId: "emafanclub_ema_dev",
    };
  });

  afterEach(() => {
    if (world) {
      world.dispose();
    }
    if (inputBatcher && typeof (inputBatcher as { dispose?: () => void }).dispose === "function") {
      inputBatcher.dispose();
    }
  });

  // ==========================================================================
  // 1. World Contract & Lifecycle
  // ==========================================================================
  describe("World Contract & Lifecycle", () => {
    it("conforms to EmaWorld interface and Interface decorator", () => {
      world = new CognitiveActionsWorld({ env: mockEnv });
      expect(world).toBeInstanceOf(EmaWorld);
      expect(typeof world.start).toBe("function");
      expect(typeof world.interact).toBe("function");
      expect(typeof world.dispose).toBe("function");
    });

    it("lists standard cognitive action parts", () => {
      world = new CognitiveActionsWorld({ env: mockEnv });
      const parts = world.listParts();
      expect(parts.length).toBe(5);

      const partIds = parts.map((p) => p.id);
      expect(partIds).toContain("consolidation");
      expect(partIds).toContain("journal");
      expect(partIds).toContain("distillation");
      expect(partIds).toContain("homeostasis");
      expect(partIds).toContain("reflection");

      for (const part of parts) {
        expect(part.type).toBe("internal");
        expect(part.name.length).toBeGreaterThan(0);
      }
    });

    it("mounts /world/cognitive/* endpoints on ctx.router during start() and disposes cleanly", async () => {
      world = new CognitiveActionsWorld({ env: mockEnv });
      const handle = world.start(ctx);

      const registered = ctx.registry.get("cognitive");
      expect(registered).toBe(world);

      const partsRes = await ctx.router.read<{ world: string; parts: unknown[] }>(
        "/world/cognitive/parts",
      );
      expect(partsRes.world).toBe("cognitive");
      expect(partsRes.parts.length).toBe(5);

      handle.dispose();
      expect(ctx.registry.get("cognitive")).toBeUndefined();
    });
  });

  // ==========================================================================
  // 2. Identity Guard & Actor Verification
  // ==========================================================================
  describe("Identity Guard & Actor Verification", () => {
    it("refuses interact() without PENGUIN_AGENT_ID in environment", () => {
      world = new CognitiveActionsWorld({ env: {} });
      world.start(ctx);

      expect(() => {
        world.interact(ctx, mockActor, "homeostasis");
      }).toThrow(/refusing to dispatch without an agent identity/i);
    });

    it("refuses interact() with missing or invalid EmaActor credentials", () => {
      world = new CognitiveActionsWorld({ env: mockEnv });
      world.start(ctx);

      expect(() => {
        world.interact(ctx, null as unknown as EmaActor, "homeostasis");
      }).toThrow(/Invalid or missing EmaActor credentials/i);

      expect(() => {
        world.interact(ctx, { id: "" } as unknown as EmaActor, "homeostasis");
      }).toThrow(/Invalid or missing EmaActor credentials/i);
    });
  });

  // ==========================================================================
  // 3. Working Buffer & Buffer Saturation Trigger
  // ==========================================================================
  describe("Working Buffer & Saturation Trigger", () => {
    it("ingests conversation turns into working buffer and increases cognitive load", async () => {
      world = new CognitiveActionsWorld({
        env: mockEnv,
        bufferCapacity: 5,
        initialState: { cognitive: { cognitiveLoad: 0.1, pendingReflections: [] } },
      });
      world.start(ctx);

      const turn = await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "Let us inspect the memory rollup pipeline today.",
      });

      expect(turn.id).toBeDefined();
      expect(turn.content).toBe("Let us inspect the memory rollup pipeline today.");

      const pending = world.getPendingBufferMessages();
      expect(pending.length).toBe(1);
      expect(pending[0].content).toBe(turn.content);

      // Cognitive load should increase
      expect(world.getState().cognitive.cognitiveLoad).toBeGreaterThan(0.1);
    });

    it("automatically triggers buffer saturation consolidation when reaching bufferCapacity", async () => {
      const dispatchedInputs: EmaInput[] = [];
      ctx.inputBatcher.onBatch((batch) => {
        dispatchedInputs.push(...batch);
      });

      world = new CognitiveActionsWorld({
        env: mockEnv,
        bufferCapacity: 3,
        initialState: { cognitive: { cognitiveLoad: 0.8, pendingReflections: [] } },
      });
      world.start(ctx);

      await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "Turn 1: Project kickoff.",
      });
      await world.addBufferMessage({
        sender: "ema",
        role: "companion",
        content: "Turn 2: Ready to work on EMA.",
      });

      // Still 2 pending turns, below bufferCapacity=3
      expect(world.getPendingBufferMessages().length).toBe(2);

      // 3rd turn hits threshold -> triggers automatic buffer saturation
      await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "Turn 3: Starting consolidation test.",
      });

      // Working buffer should be drained/consolidated
      expect(world.getPendingBufferMessages().length).toBe(0);

      // Activity rollup created
      const activities = world.getRollupRecords({ kind: "activity" });
      expect(activities.length).toBe(1);
      expect(activities[0].title).toMatch(/Buffer Saturation Activity Rollup/);
      expect(activities[0].sourceIds.length).toBe(3);

      // Cognitive load should be relieved
      expect(world.getState().cognitive.cognitiveLoad).toBeLessThan(0.8);

      // Wait for input batcher flush
      await new Promise((r) => setTimeout(r, 80));
      expect(dispatchedInputs.length).toBeGreaterThan(0);
      expect(dispatchedInputs[0].partId).toBe("consolidation");
      expect(dispatchedInputs[0].content).toMatch(/saturation limit/i);
    });
  });

  // ==========================================================================
  // 4. Multi-Tier Memory Consolidation (Buffer -> Activity -> Day -> Month -> Year)
  // ==========================================================================
  describe("Multi-Tier Memory Consolidation Rollups", () => {
    it("performs Buffer -> Activity rollup and marks buffer items as processed", async () => {
      world = new CognitiveActionsWorld({ env: mockEnv });

      await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "Discussing EMA multi-tier memory architecture.",
      });
      await world.addBufferMessage({
        sender: "ema",
        role: "companion",
        content: "Explaining how activity rollups roll into day digests.",
      });

      const rollup = await world.consolidateBufferToActivity({
        actorId: mockActor.id,
        date: "2026-11-08",
        title: "Architecture Discussion",
      });

      expect(rollup).not.toBeNull();
      expect(rollup?.kind).toBe("activity");
      expect(rollup?.title).toBe("Architecture Discussion");
      expect(rollup?.content).toContain("Discussing EMA multi-tier memory architecture.");
      expect(rollup?.sourceIds.length).toBe(2);
      expect(rollup?.processed).toBe(false);

      // Pending buffer messages should now be 0
      expect(world.getPendingBufferMessages().length).toBe(0);
    });

    it("performs Activity -> Day rollup when threshold is reached or forced", async () => {
      world = new CognitiveActionsWorld({
        env: mockEnv,
        activityRollupThreshold: 2,
      });

      // Add two separate activity rollups
      await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "Morning coding session.",
      });
      await world.consolidateBufferToActivity({ date: "2026-11-08", title: "Morning Session" });

      await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "Afternoon review session.",
      });
      await world.consolidateBufferToActivity({ date: "2026-11-08", title: "Afternoon Session" });

      // Pending activities before day rollup
      const pendingActivities = world.getRollupRecords({ kind: "activity", processed: false });
      expect(pendingActivities.length).toBe(2);

      // Consolidate into day rollup
      const dayRollup = await world.consolidateActivitiesToDay({
        actorId: mockActor.id,
        date: "2026-11-08",
      });

      expect(dayRollup).not.toBeNull();
      expect(dayRollup?.kind).toBe("day");
      expect(dayRollup?.date).toBe("2026-11-08");
      expect(dayRollup?.content).toContain("Morning Session");
      expect(dayRollup?.content).toContain("Afternoon Session");

      // Activities are marked as processed
      const remainingUnprocessed = world.getRollupRecords({ kind: "activity", processed: false });
      expect(remainingUnprocessed.length).toBe(0);
    });

    it("performs Day -> Month and Month -> Year consolidation digests", async () => {
      world = new CognitiveActionsWorld({
        env: mockEnv,
        dayRollupThreshold: 2,
        monthRollupThreshold: 2,
      });

      // Manually create two day records
      await world.addBufferMessage({ sender: "u", role: "user", content: "Day 1 activities" });
      await world.consolidateBufferToActivity({ date: "2026-11-01", title: "Day 1 Act" });
      await world.consolidateActivitiesToDay({ date: "2026-11-01", force: true });

      await world.addBufferMessage({ sender: "u", role: "user", content: "Day 2 activities" });
      await world.consolidateBufferToActivity({ date: "2026-11-02", title: "Day 2 Act" });
      await world.consolidateActivitiesToDay({ date: "2026-11-02", force: true });

      // Consolidate days into month
      const monthRollup = await world.consolidateDaysToMonth({
        actorId: mockActor.id,
        monthDate: "2026-11",
      });

      expect(monthRollup).not.toBeNull();
      expect(monthRollup?.kind).toBe("month");
      expect(monthRollup?.date).toBe("2026-11");
      expect(monthRollup?.content).toContain("Day Summary for 2026-11-01");
      expect(monthRollup?.content).toContain("Day Summary for 2026-11-02");

      // Days should now be marked processed
      const pendingDays = world.getRollupRecords({ kind: "day", processed: false });
      expect(pendingDays.length).toBe(0);

      // Now create another month to test year rollup
      await world.addBufferMessage({ sender: "u", role: "user", content: "Dec activities" });
      await world.consolidateBufferToActivity({ date: "2026-12-01", title: "Dec Act" });
      await world.consolidateActivitiesToDay({ date: "2026-12-01", force: true });
      await world.consolidateDaysToMonth({ monthDate: "2026-12", force: true });

      // Consolidate months into year
      const yearRollup = await world.consolidateMonthsToYear({
        actorId: mockActor.id,
        yearDate: "2026",
      });

      expect(yearRollup).not.toBeNull();
      expect(yearRollup?.kind).toBe("year");
      expect(yearRollup?.date).toBe("2026");
      expect(yearRollup?.content).toContain("Monthly Digest for 2026-11");
      expect(yearRollup?.content).toContain("Monthly Digest for 2026-12");

      const pendingMonths = world.getRollupRecords({ kind: "month", processed: false });
      expect(pendingMonths.length).toBe(0);
    });

    it("runs runMultiTierRollup() across all tiers atomically", async () => {
      world = new CognitiveActionsWorld({
        env: mockEnv,
        activityRollupThreshold: 1,
        dayRollupThreshold: 1,
        monthRollupThreshold: 1,
      });

      await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "Testing full tiered pass.",
      });

      const result = await world.runMultiTierRollup({
        actorId: mockActor.id,
        date: "2026-11-08",
        force: true,
      });

      expect(result.activity).not.toBeNull();
      expect(result.day).not.toBeNull();
      expect(result.month).not.toBeNull();
      expect(result.year).not.toBeNull();
    });
  });

  // ==========================================================================
  // 5. Daily Journal Synthesis in Authentic Character Voice
  // ==========================================================================
  describe("Daily Journal Synthesis", () => {
    it("synthesizes daily journal capturing daily highlights and subjective impressions in companion character voice", async () => {
      world = new CognitiveActionsWorld({
        env: mockEnv,
        characterVoice: "Ema",
        initialState: {
          affective: { valence: 0.75, arousal: 0.4, energy: 0.8 },
        },
      });

      await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "We spent the evening talking about the stars and meteor showers.",
      });
      await world.consolidateBufferToActivity({
        date: "2026-11-08",
        title: "Stargazing Conversation",
      });

      const journal = await world.synthesizeDailyJournal({
        actor: mockActor,
        date: "2026-11-08",
      });

      expect(journal.id).toBe("journal-2026-11-08");
      expect(journal.characterVoice).toBe("Ema");
      expect(journal.title).toContain("Ema's Diary: 2026-11-08");
      expect(journal.highlights).toContain("Stargazing Conversation");
      expect(journal.impressions).toContain("bright and full of genuine warmth");
      expect(journal.entry).toContain("Dear Diary — 2026-11-08");
      expect(journal.entry).toContain("— Ema");

      expect(journal.affectiveSnapshot.valence).toBe(0.75);
      expect(journal.affectiveSnapshot.energy).toBe(0.8);

      // Verify retrieval from SQLite store
      const retrieved = world.getDailyJournals({ date: "2026-11-08" });
      expect(retrieved.length).toBe(1);
      expect(retrieved[0].title).toBe(journal.title);
    });

    it("supports custom journal synthesizer callback", async () => {
      world = new CognitiveActionsWorld({
        env: mockEnv,
        characterVoice: "Sakana",
        journalSynthesizer: async ({ date, characterVoice, state }) => {
          return {
            title: `Custom Journal for ${date}`,
            highlights: ["Special custom highlight"],
            impressions: `Valence is ${state.affective.valence}`,
            entry: `I am ${characterVoice}. Today was tailored with custom thoughts.`,
          };
        },
      });

      const journal = await world.synthesizeDailyJournal({
        actor: mockActor,
        date: "2026-11-08",
      });

      expect(journal.title).toBe("Custom Journal for 2026-11-08");
      expect(journal.highlights).toEqual(["Special custom highlight"]);
      expect(journal.entry).toContain("I am Sakana.");
    });
  });

  // ==========================================================================
  // 6. Long-Term Distillation into LanceDB
  // ==========================================================================
  describe("Long-Term Distillation into LanceDB", () => {
    it("distills durable facts, user traits, and procedural guidelines into LanceDB", async () => {
      world = new CognitiveActionsWorld({
        env: mockEnv,
        embeddingDimensions: 384,
      });

      await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "I really prefer hot green tea over cold coffee when working late.",
      });
      await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "My daily routine: I usually wake up at 7am every morning.",
      });
      await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "Rule for companion: always speak tenderly during evening wind-down.",
      });

      const distilled = await world.distillLongTermMemories({ actor: mockActor });
      expect(distilled.length).toBeGreaterThanOrEqual(3);

      const index0s = distilled.map((d) => d.index0);
      expect(index0s).toContain("Person Profiles");
      expect(index0s).toContain("Procedural Guidelines");

      const index1s = distilled.map((d) => d.index1);
      expect(index1s).toContain("User Preferences");
      expect(index1s).toContain("Habits");
      expect(index1s).toContain("Core Directives");

      for (const item of distilled) {
        expect(item.vector?.length).toBe(384);
        expect(item.actorId).toBe(mockActor.id);
      }
    });

    it("performs semantic nearest-neighbor search over LanceDB with filters", async () => {
      world = new CognitiveActionsWorld({
        env: mockEnv,
        embeddingDimensions: 384,
      });

      await world.indexLongTermMemory({
        actorId: mockActor.id,
        index0: "Person Profiles",
        index1: "User Preferences",
        memory: "User loves stargazing, astronomy, and watching meteor showers at night.",
      });

      await world.indexLongTermMemory({
        actorId: mockActor.id,
        index0: "World Knowledge",
        index1: "Facts",
        memory: "The Python programming language was created by Guido van Rossum.",
      });

      await world.indexLongTermMemory({
        actorId: "actor:other_user",
        index0: "Person Profiles",
        index1: "User Preferences",
        memory: "User hates looking at the night sky.",
      });

      // Search for astronomy/stars targeting mockActor
      const results = await world.searchLongTermMemories("stargazing meteor night sky", {
        actorId: mockActor.id,
        index0: "Person Profiles",
        limit: 1,
      });

      expect(results.length).toBe(1);
      expect(results[0].memory).toContain("loves stargazing");
      expect(results[0].actorId).toBe(mockActor.id);
    });
  });

  // ==========================================================================
  // 7. Affective Homeostasis & Energy Regeneration
  // ==========================================================================
  describe("Affective Homeostasis & Energy Regeneration", () => {
    it("regulates emotional valence towards equilibrium, stabilizes arousal, and resets cognitive load", () => {
      world = new CognitiveActionsWorld({
        env: mockEnv,
        initialState: {
          affective: { valence: 0.15, arousal: 0.85, energy: 0.3 },
          cognitive: { cognitiveLoad: 0.9, pendingReflections: ["pondering contradiction"] },
        },
      });

      const res = world.regulateAffect({
        restoreFullEnergy: false,
        reduceArousal: true,
      });

      expect(res.before.valence).toBe(0.15);
      expect(res.after.valence).toBeGreaterThan(0.3); // Nudged back towards equilibrium
      expect(res.after.arousal).toBeLessThan(0.85); // Arousal dampened
      expect(res.after.energy).toBe(0.45); // Rest recovered energy
      expect(res.cognitiveLoadReset).toBe(true);

      const updatedState = world.getState();
      expect(updatedState.cognitive.cognitiveLoad).toBe(0.05);
      expect(updatedState.cognitive.pendingReflections).toEqual([]);
    });

    it("regenerates companion energy reserve back to full capacity (1.0) on completion of consolidation", () => {
      world = new CognitiveActionsWorld({
        env: mockEnv,
        initialState: {
          affective: { valence: 0.4, arousal: 0.3, energy: 0.1 }, // Low energy / exhausted
        },
      });

      const res = world.regulateAffect({ restoreFullEnergy: true });
      expect(res.after.energy).toBe(1.0);
      expect(world.getState().affective.energy).toBe(1.0);
    });

    it("transitions circadian phase from sleep_consolidating back to wake", () => {
      world = new CognitiveActionsWorld({
        env: mockEnv,
        initialState: {
          circadian: { phase: "sleep_consolidating", currentHour: 23, isConsolidating: true },
        },
      });

      const res = world.regulateAffect({ transitionPhaseToWake: true });
      expect(res.phaseTransitioned).toEqual({ from: "sleep_consolidating", to: "wake" });
      expect(world.getState().circadian.phase).toBe("wake");
      expect(world.getState().circadian.isConsolidating).toBe(false);
    });
  });

  // ==========================================================================
  // 8. Circadian Rest Trigger & Closed-Loop Maintenance Cycle
  // ==========================================================================
  describe("Circadian Rest Trigger & Closed-Loop Cycle", () => {
    it("runs complete closed-loop cycle: rollups + journal + vector distillation + 100% energy restoration", async () => {
      const dispatchedInputs: EmaInput[] = [];
      ctx.inputBatcher.onBatch((batch) => {
        dispatchedInputs.push(...batch);
      });

      world = new CognitiveActionsWorld({
        env: mockEnv,
        initialState: {
          affective: { valence: 0.3, arousal: 0.7, energy: 0.25 },
          cognitive: { cognitiveLoad: 0.85, pendingReflections: ["test inquiry"] },
        },
      });
      world.start(ctx);

      // Add conversation turns to be consolidated
      await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "I always like to review our daily milestones before sleeping.",
      });
      await world.addBufferMessage({
        sender: "ema",
        role: "companion",
        content: "Understood, I will record our milestone in EverMemoryArchive.",
      });

      // Fire Circadian Rest Trigger
      const result = await world.triggerCircadianRest({
        actor: mockActor,
        date: "2026-11-08",
      });

      expect(result.cycleId).toBeDefined();
      expect(result.bufferTurnsProcessed).toBe(2);
      expect(result.activityRollupsCreated).toBe(1);
      expect(result.dayRollupsCreated).toBe(1);
      expect(result.journalEntry).toBeDefined();
      expect(result.journalEntry?.title).toContain("Ema's Diary: 2026-11-08");
      expect(result.distilledMemoriesCount).toBeGreaterThan(0);

      // Energy restored to 1.0
      expect(result.affectiveAfter.energy).toBe(1.0);
      expect(world.getState().affective.energy).toBe(1.0);
      expect(world.getState().circadian.phase).toBe("wake");

      // Verify closed-loop notification dispatched to input batcher
      await new Promise((r) => setTimeout(r, 80));
      expect(dispatchedInputs.length).toBeGreaterThan(0);
      expect(dispatchedInputs[0].partId).toBe("homeostasis");
      expect(dispatchedInputs[0].content).toMatch(/energy restored to 100%/i);
    });

    it("prevents overlapping concurrent cognitive cycles", async () => {
      world = new CognitiveActionsWorld({ env: mockEnv });

      // Run cycle and attempt to run another concurrently
      const promise1 = world.runCognitiveCycle({ force: true });
      await expect(world.runCognitiveCycle({ force: true })).rejects.toThrow(
        /Cognitive consolidation cycle is already in progress/i,
      );
      await promise1;
    });
  });

  // ==========================================================================
  // 9. Router Resource Queries (RFC-0001 Observability)
  // ==========================================================================
  describe("Router Resource Queries", () => {
    it("exposes /world/cognitive/state via GET and updates via POST", async () => {
      world = new CognitiveActionsWorld({ env: mockEnv });
      world.start(ctx);

      const stateGet = await ctx.router.read<EmaAgentState>("/world/cognitive/state");
      expect(stateGet.affective).toBeDefined();
      expect(stateGet.circadian).toBeDefined();

      const statePost = await ctx.router.read<EmaAgentState>("/world/cognitive/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affective: { valence: 0.9, arousal: 0.5, energy: 0.95 } }),
      });
      expect(statePost.affective.valence).toBe(0.9);
      expect(world.getState().affective.valence).toBe(0.9);
    });

    it("allows adding and listing working buffer via /world/cognitive/buffer", async () => {
      world = new CognitiveActionsWorld({ env: mockEnv });
      world.start(ctx);

      await ctx.router.read("/world/cognitive/buffer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: "user:admin", content: "Testing buffer route." }),
      });

      const bufferList = await ctx.router.read<CognitiveBufferMessage[]>("/world/cognitive/buffer");
      expect(bufferList.length).toBe(1);
      expect(bufferList[0].content).toBe("Testing buffer route.");
    });

    it("executes and reads rollups and journals via router", async () => {
      world = new CognitiveActionsWorld({ env: mockEnv });
      world.start(ctx);

      await world.addBufferMessage({
        sender: "user:admin",
        role: "user",
        content: "Adding turn for router rollup test.",
      });

      // POST to /world/cognitive/rollups to run multi-tier rollup
      await ctx.router.read("/world/cognitive/rollups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "activity", date: "2026-11-08" }),
      });

      const rollups = await ctx.router.read<CognitiveRollupRecord[]>(
        "/world/cognitive/rollups?kind=activity",
      );
      expect(rollups.length).toBe(1);

      // POST to /world/cognitive/journals to synthesize journal
      await ctx.router.read("/world/cognitive/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: "2026-11-08" }),
      });

      const journals = await ctx.router.read<unknown[]>("/world/cognitive/journals");
      expect(journals.length).toBe(1);
    });

    it("searches long-term memories via /world/cognitive/long-term-memories?q=...", async () => {
      world = new CognitiveActionsWorld({ env: mockEnv });
      world.start(ctx);

      await world.indexLongTermMemory({
        actorId: mockActor.id,
        index0: "Person Profiles",
        index1: "User Preferences",
        memory: "User enjoys green tea while coding.",
      });

      const results = await ctx.router.read<Array<{ memory: string }>>(
        "/world/cognitive/long-term-memories?q=green+tea",
      );
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memory).toContain("green tea");
    });
  });

  // ==========================================================================
  // 10. interact() Method Execution
  // ==========================================================================
  describe("interact() Method Dispatch", () => {
    it("dispatches consolidation rollup action", async () => {
      world = new CognitiveActionsWorld({ env: mockEnv });
      world.start(ctx);

      await world.addBufferMessage({ sender: "u", role: "user", content: "Test turn" });

      const handle = world.interact(ctx, mockActor, "consolidation", { action: "rollup" }) as {
        dispose: () => void;
        result: Promise<{ activity: CognitiveRollupRecord | null }>;
      };

      const res = await handle.result;
      expect(res.activity).not.toBeNull();
      expect(res.activity?.content).toContain("Test turn");
    });

    it("dispatches journal synthesis action", async () => {
      world = new CognitiveActionsWorld({ env: mockEnv });
      world.start(ctx);

      const handle = world.interact(ctx, mockActor, "journal", {
        action: "synthesize_journal",
      }) as {
        dispose: () => void;
        result: Promise<{ title: string; entry: string }>;
      };

      const res = await handle.result;
      expect(res.title).toBeDefined();
      expect(res.entry).toBeDefined();
    });

    it("dispatches homeostasis regulation action", async () => {
      world = new CognitiveActionsWorld({
        env: mockEnv,
        initialState: { affective: { valence: 0.5, arousal: 0.5, energy: 0.2 } },
      });
      world.start(ctx);

      const handle = world.interact(ctx, mockActor, "homeostasis", {
        restoreFullEnergy: true,
      }) as {
        dispose: () => void;
        result: Promise<{ after: { energy: number } }>;
      };

      const res = await handle.result;
      expect(res.after.energy).toBe(1.0);
    });

    it("dispatches full cognitive cycle action", async () => {
      world = new CognitiveActionsWorld({ env: mockEnv });
      world.start(ctx);

      const handle = world.interact(ctx, mockActor, "cycle", { action: "run_cycle" }) as {
        dispose: () => void;
        result: Promise<{ cycleId: string; energyRestored: number }>;
      };

      const res = await handle.result;
      expect(res.cycleId).toBeDefined();
    });

    it("dispatches reflection action and updates pending reflections", async () => {
      world = new CognitiveActionsWorld({ env: mockEnv });
      world.start(ctx);

      const handle = world.interact(ctx, mockActor, "reflection", {
        reflection: "Why do humans seek constellations in the night sky?",
      }) as {
        dispose: () => void;
        result: Promise<{ pendingReflections: string[] }>;
      };

      const res = await handle.result;
      expect(res.pendingReflections).toContain(
        "Why do humans seek constellations in the night sky?",
      );
      expect(world.getState().cognitive.pendingReflections).toContain(
        "Why do humans seek constellations in the night sky?",
      );
    });
  });
});
