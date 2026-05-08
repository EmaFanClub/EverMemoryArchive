import {
  CREATE_ACTOR_SLEEP_DEFAULT_END,
  CREATE_ACTOR_SLEEP_DEFAULT_START,
  type CreateActorSourceId,
  type MbtiAxis,
} from "./constants";
import type {
  CreateActorTrainingDataset,
  CreateActorTrainingDatasetStats,
} from "./training-dataset";

export interface CreateActorDraft {
  actorName: string;
  roleBook: string;
  mbtiAxes: Record<MbtiAxis, string>;
  selectedTraits: string[];
  sleepStart: number;
  sleepEnd: number;
  trainingDataset: CreateActorTrainingDataset | null;
  trainingDatasetStats: CreateActorTrainingDatasetStats | null;
  trainingDatasetFileName: string;
  trainingDatasetFileSize: number;
  trainingDatasetError: string | null;
}

export type CreateActorDrafts = Record<CreateActorSourceId, CreateActorDraft>;

export function createInitialCreateActorDrafts(): CreateActorDrafts {
  return {
    blank: createEmptyCreateActorDraft(),
    import: createEmptyCreateActorDraft(),
    history: createEmptyCreateActorDraft(),
  };
}

export function patchCreateActorDraft(
  drafts: CreateActorDrafts,
  source: CreateActorSourceId,
  patch:
    | Partial<CreateActorDraft>
    | ((draft: CreateActorDraft) => Partial<CreateActorDraft>),
): CreateActorDrafts {
  const currentDraft = drafts[source];
  const patchValue = typeof patch === "function" ? patch(currentDraft) : patch;
  return {
    ...drafts,
    [source]: {
      ...currentDraft,
      ...patchValue,
    },
  };
}

function createEmptyCreateActorDraft(): CreateActorDraft {
  return {
    actorName: "",
    roleBook: "",
    mbtiAxes: {
      EI: "E",
      SN: "N",
      TF: "T",
      JP: "J",
    },
    selectedTraits: [],
    sleepStart: CREATE_ACTOR_SLEEP_DEFAULT_START,
    sleepEnd: CREATE_ACTOR_SLEEP_DEFAULT_END,
    trainingDataset: null,
    trainingDatasetStats: null,
    trainingDatasetFileName: "",
    trainingDatasetFileSize: 0,
    trainingDatasetError: null,
  };
}
