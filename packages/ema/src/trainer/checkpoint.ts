import * as path from "node:path";

import type { Fs } from "../fs";
import type { Server } from "../server";
import type {
  ActorTrainingCheckpoint,
  ActorTrainingCheckpointSnapshot,
} from "./base";

/**
 * Resolves the checkpoint root directory for a training run.
 * @param checkpointDir - Caller-provided checkpoint directory.
 * @param trainingSession - Generated training session identifier.
 * @returns Resolved checkpoint root directory.
 */
export function resolveCheckpointRoot(
  checkpointDir: string,
  trainingSession: string,
): string {
  return path.join(checkpointDir.trim(), trainingSession);
}

/**
 * Builds the output file path for a training checkpoint artifact.
 * @param checkpointRoot - Resolved checkpoint root directory.
 * @param target - Sequential checkpoint identifier or the final checkpoint marker.
 * @returns Absolute or relative path for the checkpoint file.
 */
export function buildCheckpointFilePath(
  checkpointRoot: string,
  target: number | "final",
): string {
  const fileName =
    target === "final" ? "final.json" : `checkpoint-${target}.json`;
  return path.join(checkpointRoot, fileName);
}

/**
 * Builds a serializable memory snapshot for training checkpoints.
 * @param server - Server instance for database access.
 * @param actorId - Actor identifier to snapshot.
 * @returns Snapshot payload for the actor.
 */
export async function buildTrainingCheckpointSnapshot(
  server: Server,
  actorId: number,
): Promise<ActorTrainingCheckpointSnapshot> {
  const actor = await server.dbService.actorDB.getActor(actorId);
  if (!actor) {
    throw new Error(`Actor with ID ${actorId} not found.`);
  }
  const [role, personality, activity, day, month, year, longTerm] =
    await Promise.all([
      server.dbService.roleDB.getRole(actor.roleId),
      server.dbService.personalityDB.getPersonality(actorId),
      server.dbService.shortTermMemoryDB.listShortTermMemories({
        actorId,
        kind: "activity",
        sort: "asc",
      }),
      server.dbService.shortTermMemoryDB.listShortTermMemories({
        actorId,
        kind: "day",
        sort: "asc",
      }),
      server.dbService.shortTermMemoryDB.listShortTermMemories({
        actorId,
        kind: "month",
        sort: "asc",
      }),
      server.dbService.shortTermMemoryDB.listShortTermMemories({
        actorId,
        kind: "year",
        sort: "asc",
      }),
      server.dbService.longTermMemoryDB.listLongTermMemories({ actorId }),
    ]);

  return {
    roleBook: role?.prompt ?? "None.",
    personalityMemory: personality?.memory ?? "None.",
    shortTermMemory: {
      activity,
      day,
      month,
      year,
    },
    longTermMemory: longTerm,
  };
}

/**
 * Writes a checkpoint artifact for the current training run.
 * @param fs - File system abstraction used by the trainer.
 * @param checkpointRoot - Resolved checkpoint root directory.
 * @param target - Sequential checkpoint identifier or the final checkpoint marker.
 * @param checkpoint - Checkpoint payload to persist.
 * @returns Written file path.
 */
export async function writeCheckpointFile(
  fs: Fs,
  checkpointRoot: string,
  target: number | "final",
  checkpoint: ActorTrainingCheckpoint,
): Promise<string> {
  const filePath = buildCheckpointFilePath(checkpointRoot, target);
  await fs.write(filePath, JSON.stringify(checkpoint, null, 2));
  return filePath;
}
