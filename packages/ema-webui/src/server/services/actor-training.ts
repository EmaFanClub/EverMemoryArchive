import "server-only";

import path from "node:path";
import {
  ActorTrainer,
  GlobalConfig,
  type ActorDetails,
  type ActorTrainingEvent,
  type ActorTrainingRequest,
  type Server,
} from "ema";
import type {
  ActorTrainingUiState,
  CreateActorTrainingRequest,
} from "../../types/dashboard/v1beta1";
import { toWebActorId } from "../ema-adapter/ids";

const TRAINING_BUFFER_WINDOW_SIZE = 30;
const TRAINING_DIARY_UPDATE_EVERY = 20;
const TRAINING_SAVE_EVERY_STEPS = 1;
const TRAINING_PROGRESS_COMPLETE_PENDING = 0.96;
const TRAINING_PROGRESS_REPLAY_WEIGHT = 0.92;
const INTERRUPTED_TRAINING_MESSAGE = "训练未正常结束，建议删除角色。";
const LOST_PENDING_TRAINING_MESSAGE = "学习数据已丢失，建议删除角色。";

const actorTrainingById = new Map<string, ActorTrainingUiState>();
const pendingActorTrainingById = new Map<
  string,
  {
    roleBook: string;
    training: CreateActorTrainingRequest;
  }
>();
const actorTrainingPublishTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

export function buildActorTrainingRequest({
  actorId,
  roleBook,
  training,
}: {
  actorId: number;
  roleBook: string;
  training: CreateActorTrainingRequest;
}): ActorTrainingRequest {
  const initialRoleBook = roleBook.trim();
  return {
    actorId,
    characterName: training.characterName,
    dataset: {
      description: training.dataset.description,
      ...(initialRoleBook ? { initialRoleBook } : {}),
      inputs: training.dataset.inputs,
    },
    bufferWindowSize: TRAINING_BUFFER_WINDOW_SIZE,
    diaryUpdateEvery: TRAINING_DIARY_UPDATE_EVERY,
    checkpointDir: resolveTrainingCheckpointDir(actorId),
    saveEverySteps: TRAINING_SAVE_EVERY_STEPS,
  };
}

function resolveTrainingCheckpointDir(actorId: number): string {
  return path.join(
    GlobalConfig.system.logsDir,
    "actors",
    `actor_${actorId}`,
    "train",
    "checkpoints",
  );
}

export function getActorTrainingUiState(
  actorId: string,
): ActorTrainingUiState | undefined {
  const training = actorTrainingById.get(actorId);
  if (!training) {
    return undefined;
  }
  return training;
}

export function getPersistedActorTrainingUiState(
  details: ActorDetails,
): ActorTrainingUiState | undefined {
  if (
    details.actor.origin !== "training" ||
    details.actor.trainingStatus !== "failed"
  ) {
    return undefined;
  }
  const updatedAt = details.actor.trainingUpdatedAt ?? Date.now();
  const message = details.actor.trainingErrorMessage?.trim()
    ? details.actor.trainingErrorMessage.trim()
    : INTERRUPTED_TRAINING_MESSAGE;
  return {
    status: "failed",
    characterName: details.roleName,
    description: message,
    errorMessage: message,
    totalMessages: 0,
    processedMessages: 0,
    dayCount: 0,
    startTime: "",
    endTime: "",
    progress: 0,
    startedAt: updatedAt,
    updatedAt,
    estimatedRemainingMs: 0,
    logs: [formatTrainingLogLine(updatedAt, "ERROR", message)],
  };
}

export async function markInterruptedActorTrainingAsFailed(
  server: Server,
  detailsList: ActorDetails[],
): Promise<ActorDetails[]> {
  const now = Date.now();
  await Promise.all(
    detailsList.map(async (details) => {
      if (details.actor.origin !== "training") {
        return;
      }
      const webActorId = toWebActorId(details.actor.id);
      if (
        details.actor.trainingStatus === "running" &&
        !actorTrainingById.has(webActorId)
      ) {
        await markActorTrainingDetailsAsFailed(
          server,
          details,
          INTERRUPTED_TRAINING_MESSAGE,
          now,
        );
        return;
      }
      if (
        details.actor.trainingStatus === "pending" &&
        !actorTrainingById.has(webActorId) &&
        !pendingActorTrainingById.has(webActorId)
      ) {
        await markActorTrainingDetailsAsFailed(
          server,
          details,
          LOST_PENDING_TRAINING_MESSAGE,
          now,
        );
      }
    }),
  );
  return detailsList;
}

async function markActorTrainingDetailsAsFailed(
  server: Server,
  details: ActorDetails,
  message: string,
  updatedAt: number,
) {
  details.actor.trainingStatus = "failed";
  details.actor.trainingErrorMessage = message;
  details.actor.trainingUpdatedAt = updatedAt;
  await server.dbService.actorDB.upsertActor(details.actor);
}

export function removeActorTrainingUiState(
  actorId: string,
  options: { status?: ActorTrainingUiState["status"] } = {},
): boolean {
  const training = actorTrainingById.get(actorId);
  if (options.status && training?.status !== options.status) {
    return false;
  }
  const removedTraining = actorTrainingById.delete(actorId);
  const removedPending = pendingActorTrainingById.delete(actorId);
  const timer = actorTrainingPublishTimers.get(actorId);
  if (timer) {
    clearTimeout(timer);
    actorTrainingPublishTimers.delete(actorId);
  }
  return removedTraining || removedPending || Boolean(timer);
}

export function prepareActorTraining({
  actorId,
  roleBook,
  training,
}: {
  actorId: number;
  roleBook: string;
  training: CreateActorTrainingRequest;
}): ActorTrainingUiState {
  const webActorId = toWebActorId(actorId);
  const preparedAt = Date.now();
  const state = createInitialTrainingState("pending", training, preparedAt);
  pendingActorTrainingById.set(webActorId, {
    roleBook,
    training,
  });
  actorTrainingById.set(webActorId, state);
  return state;
}

export async function startPreparedActorTraining({
  server,
  actorId,
}: {
  server: Server;
  actorId: number;
}): Promise<ActorTrainingUiState> {
  const webActorId = toWebActorId(actorId);
  const existing = actorTrainingById.get(webActorId);
  if (existing?.status === "running") {
    return existing;
  }
  const pending = pendingActorTrainingById.get(webActorId);
  if (!pending) {
    throw new Error("没有可开始的学习任务。");
  }
  pendingActorTrainingById.delete(webActorId);
  await updateActorTrainingStatus({
    server,
    actorId,
    status: "running",
  });
  return startActorTraining({
    server,
    actorId,
    roleBook: pending.roleBook,
    training: pending.training,
  });
}

export function startActorTraining({
  server,
  actorId,
  roleBook,
  training,
}: {
  server: Server;
  actorId: number;
  roleBook: string;
  training: CreateActorTrainingRequest;
}): ActorTrainingUiState {
  const webActorId = toWebActorId(actorId);
  const startedAt = Date.now();
  const initialState = createInitialTrainingState(
    "running",
    training,
    startedAt,
  );
  actorTrainingById.set(webActorId, initialState);

  const request = buildActorTrainingRequest({
    actorId,
    roleBook,
    training,
  });

  void new ActorTrainer(server, undefined, undefined, (event) => {
    handleActorTrainingEvent(server, webActorId, event);
  })
    .train(request)
    .then(() => {
      publishActorTrainingUpdatedNow(server, actorId);
    })
    .catch(async (error: unknown) => {
      const currentState = actorTrainingById.get(webActorId);
      if (currentState?.status === "failed") {
        publishActorTrainingUpdatedNow(server, actorId);
        return;
      }
      const failedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      await updateActorTrainingStatus({
        server,
        actorId,
        status: "failed",
        errorMessage: message,
      });
      const latestState = currentState ?? initialState;
      actorTrainingById.set(webActorId, {
        ...latestState,
        status: "failed",
        errorMessage: message,
        updatedAt: failedAt,
        estimatedRemainingMs: 0,
        logs: appendTrainingLog(
          latestState.logs,
          failedAt,
          "ERROR",
          `训练失败：${message || "未知错误"}`,
        ),
      });
      publishActorTrainingUpdatedNow(server, actorId);
    });

  return initialState;
}

function createInitialTrainingState(
  status: "pending" | "running",
  training: CreateActorTrainingRequest,
  timestamp: number,
): ActorTrainingUiState {
  return {
    status,
    characterName: training.characterName,
    description: training.dataset.description,
    ...(training.sourceFileName
      ? { sourceFileName: training.sourceFileName }
      : {}),
    totalMessages: training.dataset.inputs.length,
    processedMessages: 0,
    dayCount: countTrainingDays(training.dataset.inputs),
    startTime: resolveTrainingStartTime(training.dataset.inputs),
    endTime: resolveTrainingEndTime(training.dataset.inputs),
    progress: 0,
    startedAt: timestamp,
    updatedAt: timestamp,
    estimatedRemainingMs: null,
    logs: [formatTrainingLogLine(timestamp, "INFO", "准备中")],
  };
}

function handleActorTrainingEvent(
  server: Server,
  webActorId: string,
  event: ActorTrainingEvent,
) {
  const current = actorTrainingById.get(webActorId);
  if (!current) {
    return;
  }
  const now = Date.now();
  const actorId = event.actorId;

  switch (event.type) {
    case "started": {
      actorTrainingById.set(webActorId, {
        ...current,
        totalMessages: event.totalMessages,
        updatedAt: now,
        logs: appendTrainingLog(
          current.logs,
          now,
          "INFO",
          `开始训练，读取 ${event.totalMessages} 条消息，共 ${current.dayCount} 天`,
        ),
      });
      queueActorTrainingUpdated(server, actorId);
      return;
    }
    case "dayStarted": {
      actorTrainingById.set(webActorId, {
        ...current,
        updatedAt: now,
        logs: appendTrainingLog(current.logs, now, "INFO", `开始 ${event.day}`),
      });
      queueActorTrainingUpdated(server, actorId);
      return;
    }
    case "dayCompleted": {
      actorTrainingById.set(webActorId, {
        ...current,
        updatedAt: now,
        logs: appendTrainingLog(current.logs, now, "INFO", `结束 ${event.day}`),
      });
      queueActorTrainingUpdated(server, actorId);
      return;
    }
    case "messageReplayed": {
      const progress = Math.min(
        TRAINING_PROGRESS_REPLAY_WEIGHT,
        (event.messageCount / Math.max(1, event.totalMessages)) *
          TRAINING_PROGRESS_REPLAY_WEIGHT,
      );
      actorTrainingById.set(webActorId, {
        ...current,
        processedMessages: event.messageCount,
        progress,
        updatedAt: now,
      });
      queueActorTrainingUpdated(server, actorId);
      return;
    }
    case "memoryUpdateStarted": {
      const progress = Math.min(
        TRAINING_PROGRESS_REPLAY_WEIGHT,
        (event.messageCount / Math.max(1, event.totalMessages)) *
          TRAINING_PROGRESS_REPLAY_WEIGHT,
      );
      actorTrainingById.set(webActorId, {
        ...current,
        processedMessages: event.messageCount,
        progress: Math.max(current.progress, progress),
        updatedAt: now,
        logs: appendTrainingLog(
          current.logs,
          now,
          "INFO",
          `进度 ${event.messageCount}/${event.totalMessages}，正在整理记忆 ${event.task}`,
        ),
      });
      queueActorTrainingUpdated(server, actorId);
      return;
    }
    case "stepAdvanced": {
      actorTrainingById.set(webActorId, {
        ...current,
        processedMessages: Math.max(
          current.processedMessages,
          event.messageCount,
        ),
        updatedAt: now,
        estimatedRemainingMs: estimateTrainingRemainingMs({
          startedAt: current.startedAt,
          now,
          processedMessages: event.messageCount,
          totalMessages: current.totalMessages,
        }),
      });
      queueActorTrainingUpdated(server, actorId);
      return;
    }
    case "checkpointSaved": {
      actorTrainingById.set(webActorId, {
        ...current,
        progress:
          event.target === "final"
            ? TRAINING_PROGRESS_COMPLETE_PENDING
            : current.progress,
        updatedAt: now,
        logs: appendTrainingLog(
          current.logs,
          now,
          "INFO",
          formatCheckpointLogMessage(event),
        ),
      });
      queueActorTrainingUpdated(server, actorId);
      return;
    }
    case "completed": {
      void updateActorTrainingStatus({
        server,
        actorId,
        status: "completed",
      });
      actorTrainingById.set(webActorId, {
        ...current,
        status: "completed",
        processedMessages: event.messageCount,
        progress: 1,
        updatedAt: now,
        estimatedRemainingMs: 0,
        logs: appendTrainingLog(current.logs, now, "INFO", "训练完成"),
      });
      publishActorTrainingUpdatedNow(server, actorId);
      return;
    }
    case "failed": {
      void updateActorTrainingStatus({
        server,
        actorId,
        status: "failed",
        errorMessage: event.error,
      });
      actorTrainingById.set(webActorId, {
        ...current,
        status: "failed",
        errorMessage: event.error,
        updatedAt: now,
        estimatedRemainingMs: 0,
        logs: appendTrainingLog(
          current.logs,
          now,
          "ERROR",
          `训练失败：${event.error}`,
        ),
      });
      publishActorTrainingUpdatedNow(server, actorId);
      return;
    }
  }
}

async function updateActorTrainingStatus({
  server,
  actorId,
  status,
  errorMessage,
}: {
  server: Server;
  actorId: number;
  status: "running" | "completed" | "failed";
  errorMessage?: string;
}): Promise<void> {
  const actor = await server.dbService.actorDB.getActor(actorId);
  if (!actor) {
    return;
  }
  const actorToPersist = { ...actor };
  if (status !== "failed") {
    delete actorToPersist.trainingErrorMessage;
  }
  await server.dbService.actorDB.upsertActor({
    ...actorToPersist,
    origin: "training",
    trainingStatus: status,
    trainingUpdatedAt: Date.now(),
    ...(errorMessage ? { trainingErrorMessage: errorMessage } : {}),
  });
}

function appendTrainingLog(
  logs: string[],
  timestamp: number,
  level: "INFO" | "ERROR",
  message: string,
) {
  return [...logs, formatTrainingLogLine(timestamp, level, message)].slice(
    -200,
  );
}

function formatTrainingLogLine(
  timestamp: number,
  level: "INFO" | "ERROR",
  message: string,
) {
  return `[${formatTrainingLogTime(timestamp)}] ${level.padEnd(5, " ")} ${message}`;
}

function formatTrainingLogTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatCheckpointLogMessage(
  event: Extract<ActorTrainingEvent, { type: "checkpointSaved" }>,
) {
  if (event.error) {
    return `保存失败检查点 checkpoint-${event.id}`;
  }
  if (event.target === "final") {
    return "保存最终检查点 final";
  }
  return `保存检查点 checkpoint-${event.target}`;
}

export function estimateTrainingRemainingMs({
  startedAt,
  now,
  processedMessages,
  totalMessages,
}: {
  startedAt: number;
  now: number;
  processedMessages: number;
  totalMessages: number;
}): number | null {
  if (processedMessages <= 0 || totalMessages <= 0) {
    return null;
  }
  const elapsed = Math.max(0, now - startedAt);
  const progress = Math.min(1, processedMessages / totalMessages);
  if (progress <= 0) {
    return null;
  }
  return Math.max(0, Math.round((elapsed / progress) * (1 - progress)));
}

function countTrainingDays(
  inputs: CreateActorTrainingRequest["dataset"]["inputs"],
) {
  return new Set(inputs.map((input) => input.time.slice(0, 10))).size;
}

function resolveTrainingStartTime(
  inputs: CreateActorTrainingRequest["dataset"]["inputs"],
) {
  return (
    [...inputs].sort((left, right) => left.time.localeCompare(right.time))[0]
      ?.time ?? ""
  );
}

function resolveTrainingEndTime(
  inputs: CreateActorTrainingRequest["dataset"]["inputs"],
) {
  return (
    [...inputs]
      .sort((left, right) => left.time.localeCompare(right.time))
      .at(-1)?.time ?? ""
  );
}

async function publishActorTrainingUpdated(
  server: Server,
  actorId: number,
): Promise<void> {
  const details = await server.controller.actor.get(actorId);
  if (!details) {
    return;
  }
  server.bus.publish(
    server.bus.createEvent({
      type: "actor.updated",
      actorId,
      data: details,
    }),
  );
}

function queueActorTrainingUpdated(server: Server, actorId: number): void {
  const webActorId = toWebActorId(actorId);
  if (actorTrainingPublishTimers.has(webActorId)) {
    return;
  }
  const timer = setTimeout(() => {
    actorTrainingPublishTimers.delete(webActorId);
    void publishActorTrainingUpdated(server, actorId);
  }, 500);
  actorTrainingPublishTimers.set(webActorId, timer);
}

function publishActorTrainingUpdatedNow(server: Server, actorId: number): void {
  const webActorId = toWebActorId(actorId);
  const timer = actorTrainingPublishTimers.get(webActorId);
  if (timer) {
    clearTimeout(timer);
    actorTrainingPublishTimers.delete(webActorId);
  }
  void publishActorTrainingUpdated(server, actorId);
}
