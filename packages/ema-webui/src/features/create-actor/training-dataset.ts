export interface CreateActorTrainingMessage {
  name: string;
  time: string;
  content: string;
}

export interface CreateActorTrainingDataset {
  description: string;
  inputs: CreateActorTrainingMessage[];
}

export interface CreateActorTrainingDatasetCharacterStats {
  name: string;
  messageCount: number;
}

export interface CreateActorTrainingDatasetStats {
  totalMessages: number;
  dayCount: number;
  startTime: string;
  endTime: string;
  characters: CreateActorTrainingDatasetCharacterStats[];
  primaryCharacterName: string;
}

export type CreateActorTrainingDatasetParseResult =
  | {
      ok: true;
      dataset: CreateActorTrainingDataset;
      stats: CreateActorTrainingDatasetStats;
    }
  | {
      ok: false;
      message: string;
    };

const TRAINING_TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export function parseCreateActorTrainingDataset(
  value: unknown,
): CreateActorTrainingDatasetParseResult {
  if (!isRecord(value) || Array.isArray(value)) {
    return fail("回放数据集必须是 JSON 对象。");
  }

  if (!("description" in value) || !("inputs" in value)) {
    return fail("回放数据集必须包含 description 和 inputs 字段。");
  }

  if (typeof value.description !== "string" || !value.description.trim()) {
    return fail("description 必须是非空字符串。");
  }

  if (!Array.isArray(value.inputs) || value.inputs.length === 0) {
    return fail("inputs 必须是非空数组。");
  }

  const inputs: CreateActorTrainingMessage[] = [];
  for (const [index, input] of value.inputs.entries()) {
    const rowNumber = index + 1;
    if (!isRecord(input) || Array.isArray(input)) {
      return fail(`第 ${rowNumber} 条消息必须是对象。`);
    }
    if (typeof input.name !== "string" || !input.name.trim()) {
      return fail(`第 ${rowNumber} 条消息的 name 必须是非空字符串。`);
    }
    if (typeof input.time !== "string" || !isValidTrainingTime(input.time)) {
      return fail(
        `第 ${rowNumber} 条消息的 time 必须是有效的 YYYY-MM-DD HH:mm:ss。`,
      );
    }
    if (typeof input.content !== "string" || !input.content.trim()) {
      return fail(`第 ${rowNumber} 条消息的 content 必须是非空字符串。`);
    }
    inputs.push({
      name: input.name.trim(),
      time: input.time,
      content: input.content.trim(),
    });
  }

  const dataset = {
    description: value.description.trim(),
    inputs,
  };
  return {
    ok: true,
    dataset,
    stats: buildCreateActorTrainingDatasetStats(inputs),
  };
}

function buildCreateActorTrainingDatasetStats(
  inputs: CreateActorTrainingMessage[],
): CreateActorTrainingDatasetStats {
  const sortedInputs = [...inputs].sort((left, right) =>
    left.time.localeCompare(right.time),
  );
  const dayKeys = new Set<string>();
  const characterOrder: string[] = [];
  const characterCounts = new Map<string, number>();

  for (const input of inputs) {
    dayKeys.add(input.time.slice(0, 10));
    if (!characterCounts.has(input.name)) {
      characterOrder.push(input.name);
      characterCounts.set(input.name, 0);
    }
    characterCounts.set(input.name, (characterCounts.get(input.name) ?? 0) + 1);
  }

  const characters = characterOrder
    .map((name) => ({
      name,
      messageCount: characterCounts.get(name) ?? 0,
    }))
    .sort((left, right) => right.messageCount - left.messageCount);

  return {
    totalMessages: inputs.length,
    dayCount: dayKeys.size,
    startTime: sortedInputs[0]?.time ?? "",
    endTime: sortedInputs.at(-1)?.time ?? "",
    characters,
    primaryCharacterName: characters[0]?.name ?? "",
  };
}

function isValidTrainingTime(value: string): boolean {
  const match = TRAINING_TIME_RE.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const date = new Date(year, month - 1, day, hour, minute, second);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute &&
    date.getSeconds() === second
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function fail(message: string): CreateActorTrainingDatasetParseResult {
  return { ok: false, message };
}
