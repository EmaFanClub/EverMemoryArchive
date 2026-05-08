import { describe, expect, test, vi } from "vitest";
import path from "node:path";

vi.mock("server-only", () => ({}));
const actorTrainerTrain = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock("ema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ema")>();
  return {
    ...actual,
    ActorTrainer: class {
      train() {
        return actorTrainerTrain();
      }
    },
  };
});

import { createBootstrapConfig, GlobalConfig } from "ema";
import type { ActorDetails, Server } from "ema";
import {
  buildActorTrainingRequest,
  estimateTrainingRemainingMs,
  getPersistedActorTrainingUiState,
  markInterruptedActorTrainingAsFailed,
  prepareActorTraining,
  removeActorTrainingUiState,
  startActorTraining,
} from "./actor-training";

describe("actor training service helpers", () => {
  test("builds an ActorTrainer request from the create actor training payload", async () => {
    const dataRoot = path.join(process.cwd(), ".ema-webui-training-test");
    GlobalConfig.resetForTests();
    await GlobalConfig.load(undefined, {
      bootstrap: createBootstrapConfig({
        mode: "dev",
        mongoKind: "memory",
        dataRoot,
      }),
    });

    const request = buildActorTrainingRequest({
      actorId: 12,
      roleBook: "初始角色书",
      training: {
        characterName: "亚托莉",
        sourceFileName: "atori.json",
        dataset: {
          description: "ATRI route",
          inputs: [
            {
              name: "夏生",
              time: "2024-01-01 10:00:00",
              content: "早上好。",
            },
            {
              name: "亚托莉",
              time: "2024-01-01 10:01:00",
              content: "早上好。",
            },
          ],
        },
      },
    });

    expect(request).toEqual({
      actorId: 12,
      characterName: "亚托莉",
      dataset: {
        description: "ATRI route",
        initialRoleBook: "初始角色书",
        inputs: [
          {
            name: "夏生",
            time: "2024-01-01 10:00:00",
            content: "早上好。",
          },
          {
            name: "亚托莉",
            time: "2024-01-01 10:01:00",
            content: "早上好。",
          },
        ],
      },
      bufferWindowSize: 30,
      diaryUpdateEvery: 20,
      checkpointDir: path.join(
        dataRoot,
        "logs",
        "actors",
        "actor_12",
        "train",
        "checkpoints",
      ),
      saveEverySteps: 1,
    });
  });

  test("does not estimate remaining time before a replay batch completes", () => {
    expect(
      estimateTrainingRemainingMs({
        startedAt: 1_000,
        now: 2_000,
        processedMessages: 0,
        totalMessages: 2_000,
      }),
    ).toBeNull();
  });

  test("estimates remaining time after a completed replay batch", () => {
    expect(
      estimateTrainingRemainingMs({
        startedAt: 1_000,
        now: 2_000,
        processedMessages: 20,
        totalMessages: 2_000,
      }),
    ).toBe(99_000);
  });

  test("builds a failed UI state from persisted interrupted training", () => {
    const state = getPersistedActorTrainingUiState(
      createActorDetails({
        origin: "training",
        trainingStatus: "failed",
        trainingErrorMessage: "训练未正常结束，建议删除角色。",
        trainingUpdatedAt: 1_700_000_000_000,
      }),
    );

    expect(state).toEqual(
      expect.objectContaining({
        status: "failed",
        characterName: "测试角色",
        description: "训练未正常结束，建议删除角色。",
        errorMessage: "训练未正常结束，建议删除角色。",
        totalMessages: 0,
        processedMessages: 0,
        estimatedRemainingMs: 0,
      }),
    );
    expect(state?.logs[0]).toContain("ERROR");
    expect(state?.logs[0]).toContain("训练未正常结束，建议删除角色。");
  });

  test("marks running training actors as failed after interruption", async () => {
    const upsertActor = vi.fn(async () => 1);
    const server = {
      dbService: {
        actorDB: {
          upsertActor,
        },
      },
    } as unknown as Server;
    const interrupted = createActorDetails({
      id: 1,
      origin: "training",
      trainingStatus: "running",
    });
    const blank = createActorDetails({
      id: 3,
      origin: "blank",
    });

    await markInterruptedActorTrainingAsFailed(server, [interrupted, blank]);

    expect(interrupted.actor.trainingStatus).toBe("failed");
    expect(interrupted.actor.trainingErrorMessage).toBe(
      "训练未正常结束，建议删除角色。",
    );
    expect(typeof interrupted.actor.trainingUpdatedAt).toBe("number");
    expect(blank.actor.trainingStatus).toBeUndefined();
    expect(upsertActor).toHaveBeenCalledTimes(1);
    expect(upsertActor).toHaveBeenCalledWith(interrupted.actor);
  });

  test("marks pending training actors as failed when the payload is lost", async () => {
    const upsertActor = vi.fn(async () => 1);
    const server = {
      dbService: {
        actorDB: {
          upsertActor,
        },
      },
    } as unknown as Server;
    const pending = createActorDetails({
      id: 5,
      origin: "training",
      trainingStatus: "pending",
    });

    await markInterruptedActorTrainingAsFailed(server, [pending]);

    expect(pending.actor.trainingStatus).toBe("failed");
    expect(pending.actor.trainingErrorMessage).toBe(
      "学习数据已丢失，建议删除角色。",
    );
    expect(upsertActor).toHaveBeenCalledTimes(1);
    expect(upsertActor).toHaveBeenCalledWith(pending.actor);
  });

  test("does not mark pending actors as failed while the payload exists in memory", async () => {
    const upsertActor = vi.fn(async () => 1);
    const server = {
      dbService: {
        actorDB: {
          upsertActor,
        },
      },
    } as unknown as Server;
    const pending = createActorDetails({
      id: 6,
      origin: "training",
      trainingStatus: "pending",
    });

    prepareActorTraining({
      actorId: pending.actor.id,
      roleBook: "",
      training: createTrainingPayload(),
    });

    await markInterruptedActorTrainingAsFailed(server, [pending]);

    expect(pending.actor.trainingStatus).toBe("pending");
    expect(pending.actor.trainingErrorMessage).toBeUndefined();
    expect(upsertActor).not.toHaveBeenCalled();
  });

  test("does not mark running actors as failed while training state exists in memory", async () => {
    const upsertActor = vi.fn(async () => 1);
    const server = {
      dbService: {
        actorDB: {
          upsertActor,
        },
      },
    } as unknown as Server;
    const active = createActorDetails({
      id: 4,
      origin: "training",
      trainingStatus: "running",
    });

    startActorTraining({
      server,
      actorId: active.actor.id,
      roleBook: "",
      training: createTrainingPayload(),
    });

    await markInterruptedActorTrainingAsFailed(server, [active]);

    expect(active.actor.trainingStatus).toBe("running");
    expect(active.actor.trainingErrorMessage).toBeUndefined();
    expect(upsertActor).not.toHaveBeenCalled();
  });

  test("persists failed status when training rejects before emitting an event", async () => {
    actorTrainerTrain.mockRejectedValueOnce(new Error("训练启动失败"));
    const upsertActor = vi.fn(async () => 1);
    const server = {
      dbService: {
        actorDB: {
          async getActor() {
            return {
              id: 7,
              roleId: 1,
              enabled: false,
              origin: "training",
              trainingStatus: "running",
            };
          },
          upsertActor,
        },
      },
      controller: {
        actor: {
          async get() {
            return null;
          },
        },
      },
      bus: {
        publish: vi.fn(),
        createEvent: vi.fn((event) => event),
      },
    } as unknown as Server;

    startActorTraining({
      server,
      actorId: 7,
      roleBook: "",
      training: createTrainingPayload(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(upsertActor).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        trainingStatus: "failed",
        trainingErrorMessage: "训练启动失败",
      }),
    );
  });

  test("removes in-memory training state and pending payload", () => {
    prepareActorTraining({
      actorId: 8,
      roleBook: "",
      training: createTrainingPayload(),
    });

    expect(removeActorTrainingUiState("8", { status: "completed" })).toBe(
      false,
    );
    expect(removeActorTrainingUiState("8")).toBe(true);
    expect(removeActorTrainingUiState("8")).toBe(false);
  });
});

function createTrainingPayload() {
  return {
    characterName: "测试角色",
    dataset: {
      description: "测试数据",
      inputs: [
        {
          name: "测试角色",
          time: "2024-01-01 10:00:00",
          content: "早上好。",
        },
      ],
    },
  };
}

function createActorDetails(
  actor: Partial<ActorDetails["actor"]>,
): ActorDetails {
  return {
    actor: {
      id: 1,
      roleId: 1,
      enabled: false,
      ...actor,
    },
    roleName: "测试角色",
    rolePrompt: "",
    runtime: {
      actorId: actor.id ?? 1,
      enabled: false,
      status: "offline",
      transition: null,
      updatedAt: 1_700_000_000_000,
    },
  };
}
