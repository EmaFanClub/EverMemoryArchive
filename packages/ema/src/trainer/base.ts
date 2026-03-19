import type { LongTermMemoryEntity, ShortTermMemoryEntity } from "../db/base";

/**
 * One raw script line provided by the caller for actor training.
 */
export interface ActorTrainingMessage {
  /**
   * Speaker display name in the source script.
   */
  name: string;
  /**
   * Timestamp text in `YYYY-MM-DD HH:mm:ss` format.
   */
  time: string;
  /**
   * Spoken line content.
   */
  content: string;
}

/**
 * Training dataset for a single actor training run.
 */
export interface TrainDataset {
  /**
   * Initial role book markdown written before replay starts.
   */
  initialRoleBook?: string;
  /**
   * Description of the conversation source/context for this dataset.
   */
  description: string;
  /**
   * Ordered or unordered raw script lines to replay.
   */
  inputs: ActorTrainingMessage[];
}

/**
 * Request parameters for actor training.
 */
export interface ActorTrainingRequest {
  /**
   * Actor participating in training.
   */
  actorId: number;
  /**
   * Character name in the dataset that should be treated as the actor itself.
   */
  characterName: string;
  /**
   * Training dataset to replay.
   */
  dataset: TrainDataset;
  /**
   * Buffer size used when constructing memory-update prompts during training.
   */
  bufferWindowSize: number;
  /**
   * Number of replayed messages between diary update triggers.
   */
  diaryUpdateEvery: number;
  /**
   * Checkpoint output directory.
   */
  checkpointDir: string;
  /**
   * Save one numbered checkpoint for every N completed memory-update steps.
   * Defaults to 1.
   */
  saveEverySteps?: number;
}

/**
 * Snapshot payload written to training checkpoint files.
 */
export interface ActorTrainingCheckpointSnapshot {
  /**
   * Latest role book markdown.
   */
  roleBook: string;
  /**
   * Latest personality memory markdown.
   */
  personalityMemory: string;
  /**
   * All short-term memory buckets grouped by granularity.
   */
  shortTermMemory: Record<
    ShortTermMemoryEntity["kind"],
    ShortTermMemoryEntity[]
  >;
  /**
   * All current long-term memories for the actor.
   */
  longTermMemory: LongTermMemoryEntity[];
}

/**
 * File payload written for each training checkpoint.
 */
export interface ActorTrainingCheckpoint {
  /**
   * Sequential checkpoint identifier starting from 1.
   */
  id: number;
  /**
   * Total number of replayed messages when this checkpoint was created.
   */
  messageCount: number;
  /**
   * Actor memory snapshot captured at this checkpoint.
   */
  snapshot: ActorTrainingCheckpointSnapshot;
  /**
   * Optional error message for failed checkpoints.
   */
  error?: string;
}

/**
 * Final result returned after a training run finishes.
 */
export interface ActorTrainingResult {
  /**
   * Actor that completed training.
   */
  actorId: number;
  /**
   * Conversation used to store replayed messages.
   */
  conversationId: number;
  /**
   * Generated training session identifier.
   */
  session: string;
  /**
   * Resolved checkpoint root directory.
   */
  checkpointDir: string;
  /**
   * Total number of replayed messages.
   */
  messageCount: number;
  /**
   * Total number of written checkpoints.
   */
  checkpointCount: number;
}
