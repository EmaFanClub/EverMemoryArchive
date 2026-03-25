import type { ActorChatInput } from "../actor";
import type { Fs } from "../fs";
import { RealFs } from "../fs";
import type {
  ActorState,
  BufferWriteMessage,
  ShortTermMemory,
} from "../memory/base";
import {
  computeDailyRollupKinds,
  runActorCalendarRollupJob,
  runActorDialogueTickJob,
} from "../scheduler/jobs/actor.job";
import type { Server } from "../server";
import { formatTimestamp, parseTimestamp } from "../utils";
import type {
  ActorTrainingRequest,
  ActorTrainingResult,
  ActorTrainingMessage,
} from "./base";
import type { EmaReply } from "../tools/ema_reply_tool";
import { collapseContents, type TextItem } from "../schema";
import {
  buildTrainingCheckpointSnapshot,
  resolveCheckpointRoot,
  writeCheckpointFile,
} from "./checkpoint";
import { buildSession } from "../channel";

const TRAINING_TIME_FORMAT = "YYYY-MM-DD HH:mm:ss";

interface NormalizedTrainingInput extends ActorChatInput {
  timestamp: number;
  dayKey: string;
  originalIndex: number;
}

/**
 * Offline actor trainer that replays scripted conversations and triggers memory updates.
 */
export class ActorTrainer {
  /**
   * Creates a new actor trainer.
   * @param server - Server instance for database and memory access.
   * @param fs - File system implementation used for checkpoint output.
   */
  constructor(
    private readonly server: Server,
    private readonly fs: Fs = new RealFs(),
  ) {}

  /**
   * Runs a full actor training session from a scripted dataset.
   * @param req - Training request parameters.
   * @returns Summary of the completed training run.
   */
  async train(req: ActorTrainingRequest): Promise<ActorTrainingResult> {
    this.validateRequest(req);
    const actor = await this.server.actorDB.getActor(req.actorId);
    if (!actor) {
      throw new Error(`Actor with ID ${req.actorId} not found.`);
    }

    const trainingSession = this.buildTrainingSession(req.actorId);
    const characterUid = req.characterName.trim();
    const saveEverySteps = req.saveEverySteps ?? 1;
    const checkpointRoot = resolveCheckpointRoot(
      req.checkpointDir,
      trainingSession,
    );
    const conversation = await this.server.createConversation(
      req.actorId,
      trainingSession,
      trainingSession,
      req.dataset.description,
    );
    if (typeof conversation.id !== "number") {
      throw new Error("Conversation ID is missing after training setup.");
    }
    const normalizedInputs = this.normalizeInputs(
      req.dataset.inputs,
      trainingSession,
      conversation.id,
    );
    if (normalizedInputs.length === 0) {
      throw new Error("Training dataset.inputs must not be empty.");
    }

    if (req.dataset.initialRoleBook?.trim()) {
      await this.server.memoryManager.upsertRolePrompt(
        req.actorId,
        req.dataset.initialRoleBook,
      );
    }

    const actorId = req.actorId;
    const conversationId = conversation.id;

    console.log(
      `>>> train start actor=${req.actorId} session=${trainingSession} inputs=${normalizedInputs.length} diaryEvery=${req.diaryUpdateEvery} bufferWindow=${req.bufferWindowSize}`,
    );

    let checkpointId = 0;
    let stepCount = 0;
    let messageCount = 0;
    let pendingDialogueCount = 0;
    let currentDayKey = normalizedInputs[0].dayKey;

    try {
      for (const input of normalizedInputs) {
        if (input.dayKey !== currentDayKey) {
          console.log(
            `>>> day rollover from=${currentDayKey} to=${input.dayKey} messages=${messageCount}`,
          );
          for (const rollupTimestamp of this.buildDailyRollupTimestamps(
            currentDayKey,
            input.dayKey,
          )) {
            await this.runMemoryUpdate(
              actorId,
              conversationId,
              req.bufferWindowSize,
              rollupTimestamp,
              "calendar_rollup",
            );
            ({ checkpointId, stepCount } = await this.advanceStep(
              "calendar-rollup",
              checkpointId,
              stepCount,
              saveEverySteps,
              messageCount,
              actorId,
              conversationId,
              checkpointRoot,
              rollupTimestamp,
              computeDailyRollupKinds(rollupTimestamp),
            ));
          }
          currentDayKey = input.dayKey;
        }

        const message = this.toPersistedMessage(
          input,
          characterUid,
          req.actorId,
        );
        await this.server.memoryManager.persistChatMessage(message);
        await this.server.memoryManager.addToBuffer(
          conversationId,
          message.msgId,
          false,
          input.timestamp,
        );
        messageCount = message.msgId;
        pendingDialogueCount += 1;

        if (pendingDialogueCount >= req.diaryUpdateEvery) {
          await this.runMemoryUpdate(
            actorId,
            conversationId,
            req.bufferWindowSize,
            input.timestamp,
            "dialogue_tick",
          );
          ({ checkpointId, stepCount } = await this.advanceStep(
            "dialogue-tick",
            checkpointId,
            stepCount,
            saveEverySteps,
            messageCount,
            actorId,
            conversationId,
            checkpointRoot,
            input.timestamp,
            ["day"],
          ));
          pendingDialogueCount = 0;
        }
      }
      checkpointId += 1;
      await this.saveCheckpoint(
        "final",
        checkpointId,
        messageCount,
        actorId,
        conversationId,
        checkpointRoot,
      );
      console.log(
        `>>> train completed actor=${req.actorId} conversation=${conversationId} checkpoints=${checkpointId} messages=${messageCount} session=${trainingSession}`,
      );

      return {
        actorId: req.actorId,
        conversationId,
        session: trainingSession,
        checkpointDir: checkpointRoot,
        messageCount,
        checkpointCount: checkpointId,
      };
    } catch (error) {
      console.error(
        `>>> train failed actor=${req.actorId} messages=${messageCount} session=${trainingSession}`,
      );
      try {
        checkpointId += 1;
        await this.saveCheckpoint(
          "final",
          checkpointId,
          messageCount,
          actorId,
          conversationId,
          checkpointRoot,
          (error as Error).message,
        );
      } catch {
        // Ignore secondary checkpoint failures and surface the original error.
      }
      throw error;
    }
  }

  private validateRequest(req: ActorTrainingRequest): void {
    if (!Number.isInteger(req.actorId) || req.actorId <= 0) {
      throw new Error("actorId must be a positive integer.");
    }
    if (req.characterName.trim().length === 0) {
      throw new Error("characterName must not be empty.");
    }
    if (req.dataset.description.trim().length === 0) {
      throw new Error("dataset.description must not be empty.");
    }
    if (!Number.isInteger(req.bufferWindowSize) || req.bufferWindowSize <= 0) {
      throw new Error("bufferWindowSize must be a positive integer.");
    }
    if (!Number.isInteger(req.diaryUpdateEvery) || req.diaryUpdateEvery <= 0) {
      throw new Error("diaryUpdateEvery must be a positive integer.");
    }
    if (
      req.saveEverySteps !== undefined &&
      (!Number.isInteger(req.saveEverySteps) || req.saveEverySteps <= 0)
    ) {
      throw new Error("saveEverySteps must be a positive integer.");
    }
  }

  private normalizeInputs(
    inputs: ActorTrainingMessage[],
    trainingSession: string,
    conversationId: number,
  ): NormalizedTrainingInput[] {
    return inputs
      .map((input, index) => {
        const name = input.name.trim();
        const content = input.content.trim();
        if (name.length === 0) {
          throw new Error(`dataset.inputs[${index}].name must not be empty.`);
        }
        if (content.length === 0) {
          throw new Error(
            `dataset.inputs[${index}].content must not be empty.`,
          );
        }
        const timestamp = parseTimestamp(TRAINING_TIME_FORMAT, input.time);
        return {
          kind: "chat" as const,
          conversationId,
          msgId: 0,
          channelMessageId: `${conversationId}:${index + 1}`,
          time: timestamp,
          speaker: {
            session: trainingSession,
            uid: name,
            name,
          },
          inputs: [{ type: "text" as const, text: content }],
          timestamp,
          dayKey: input.time.slice(0, 10),
          originalIndex: index,
        };
      })
      .sort((left, right) => {
        if (left.timestamp !== right.timestamp) {
          return left.timestamp - right.timestamp;
        }
        return left.originalIndex - right.originalIndex;
      })
      .map((item, index) => ({
        ...item,
        msgId: index + 1,
        channelMessageId: `${conversationId}:${index + 1}`,
      }));
  }

  private buildTrainingSession(actorId: number): string {
    return buildSession("train", "group", `${actorId}-${Date.now()}`);
  }

  private toPersistedMessage(
    input: NormalizedTrainingInput,
    characterUid: string,
    actorId: number,
  ): BufferWriteMessage {
    if (input.speaker.uid !== characterUid) {
      return input;
    }
    const reply: EmaReply = {
      think: "",
      expression: "普通",
      action: "无",
      contents: this.stringifyInputContents(input.inputs),
    };
    return {
      kind: "chat",
      actorId,
      conversationId: input.conversationId,
      msgId: input.msgId,
      session: input.speaker.session,
      ema_reply: reply,
      time: input.timestamp,
    };
  }

  private stringifyInputContents(
    inputs: NormalizedTrainingInput["inputs"],
  ): string {
    return (collapseContents(inputs, false) as TextItem[])
      .map((part) => part.text)
      .join(" ")
      .replaceAll("\n", " ");
  }

  private buildNextDayRollupTimestamp(dayKey: string): number {
    const nextDay = parseTimestamp(TRAINING_TIME_FORMAT, `${dayKey} 00:05:00`);
    return nextDay + 24 * 60 * 60 * 1000;
  }

  private buildDailyRollupTimestamps(
    fromDayKey: string,
    toDayKey: string,
  ): number[] {
    const timestamps: number[] = [];
    let nextRollupTimestamp = this.buildNextDayRollupTimestamp(fromDayKey);
    const endTimestamp = parseTimestamp(
      TRAINING_TIME_FORMAT,
      `${toDayKey} 00:05:00`,
    );
    while (nextRollupTimestamp <= endTimestamp) {
      timestamps.push(nextRollupTimestamp);
      nextRollupTimestamp += 24 * 60 * 60 * 1000;
    }
    return timestamps;
  }

  private async buildTrainingActorState(
    actorId: number,
    conversationId: number,
    bufferWindowSize: number,
  ): Promise<ActorState> {
    const [memoryDay, memoryWeek, memoryMonth, memoryYear, buffer] =
      await Promise.all([
        this.server.memoryManager.getShortTermMemory(actorId, "day", 1),
        this.server.memoryManager.getShortTermMemory(actorId, "week", 1),
        this.server.memoryManager.getShortTermMemory(actorId, "month", 1),
        this.server.memoryManager.getShortTermMemory(actorId, "year", 1),
        this.server.memoryManager.getBuffer(conversationId, bufferWindowSize),
      ]);
    return {
      memoryDay: memoryDay[0] ?? { kind: "day", memory: "None." },
      memoryWeek: memoryWeek[0] ?? { kind: "week", memory: "None." },
      memoryMonth: memoryMonth[0] ?? { kind: "month", memory: "None." },
      memoryYear: memoryYear[0] ?? { kind: "year", memory: "None." },
      buffer,
    };
  }

  private async runMemoryUpdate(
    actorId: number,
    conversationId: number,
    bufferWindowSize: number,
    triggeredAt: number,
    task: "dialogue_tick" | "calendar_rollup",
  ): Promise<void> {
    if (task === "dialogue_tick") {
      await runActorDialogueTickJob(this.server, {
        actorId,
        conversationId,
        actorState: await this.buildTrainingActorState(
          actorId,
          conversationId,
          bufferWindowSize,
        ),
        triggeredAt,
      });
      return;
    }
    await runActorCalendarRollupJob(this.server, {
      actorId,
      triggeredAt,
    });
  }

  private async saveCheckpoint(
    target: number | "final",
    id: number,
    messageCount: number,
    actorId: number,
    conversationId: number,
    checkpointRoot: string,
    error?: string,
    stepCount?: number,
  ): Promise<void> {
    const snapshot = await buildTrainingCheckpointSnapshot(
      this.server,
      actorId,
    );
    await writeCheckpointFile(this.fs, checkpointRoot, target, {
      id,
      messageCount,
      snapshot,
      ...(error ? { error } : {}),
    });
    console.log(
      target === "final"
        ? error
          ? `>>> checkpoint saved target=final step=${stepCount ?? "n/a"} messages=${messageCount} error=${error}`
          : `>>> checkpoint saved target=final step=${stepCount ?? "n/a"} messages=${messageCount}`
        : `>>> checkpoint saved target=${id} step=${stepCount ?? "n/a"} messages=${messageCount}`,
    );
  }

  private async advanceStep(
    updateType: string,
    checkpointId: number,
    stepCount: number,
    saveEverySteps: number,
    messageCount: number,
    actorId: number,
    conversationId: number,
    checkpointRoot: string,
    triggeredAt: number,
    updateKinds: ShortTermMemory["kind"][],
  ): Promise<{ checkpointId: number; stepCount: number }> {
    const nextStepCount = stepCount + 1;
    const kinds = updateKinds.join(",");
    const gameTime = formatTimestamp(TRAINING_TIME_FORMAT, triggeredAt);
    console.log(
      `>>> step=${nextStepCount} messages=${messageCount} update=${updateType} kinds=[${kinds}] gameTime=${gameTime}`,
    );
    if (nextStepCount % saveEverySteps !== 0) {
      return {
        checkpointId,
        stepCount: nextStepCount,
      };
    }
    const nextCheckpointId = checkpointId + 1;
    await this.saveCheckpoint(
      nextCheckpointId,
      nextCheckpointId,
      messageCount,
      actorId,
      conversationId,
      checkpointRoot,
      undefined,
      nextStepCount,
    );
    return {
      checkpointId: nextCheckpointId,
      stepCount: nextStepCount,
    };
  }
}
