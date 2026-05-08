import { describe, expect, test } from "vitest";

import { parseCreateActorTrainingDataset } from "./training-dataset";

describe("parseCreateActorTrainingDataset", () => {
  test("accepts required description and inputs with extra fields", () => {
    const result = parseCreateActorTrainingDataset({
      description: "ATRI route",
      initialRoleBook: "legacy field is ignored by the UI uploader",
      inputs: [
        {
          name: "亚托莉",
          time: "2024-01-01 10:00:00",
          content: "早上好。",
        },
        {
          name: "夏生",
          time: "2024-01-01 10:01:00",
          content: "早上好。",
        },
        {
          name: "亚托莉",
          time: "2024-01-03 23:59:00",
          content: "我会帮忙的。",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.stats.totalMessages).toBe(3);
    expect(result.stats.dayCount).toBe(2);
    expect(result.stats.startTime).toBe("2024-01-01 10:00:00");
    expect(result.stats.endTime).toBe("2024-01-03 23:59:00");
    expect(result.stats.primaryCharacterName).toBe("亚托莉");
    expect(result.stats.characters).toEqual([
      { name: "亚托莉", messageCount: 2 },
      { name: "夏生", messageCount: 1 },
    ]);
  });

  test("rejects datasets missing required fields", () => {
    const result = parseCreateActorTrainingDataset({
      description: "ATRI route",
    });

    expect(result).toEqual({
      ok: false,
      message: "回放数据集必须包含 description 和 inputs 字段。",
    });
  });

  test("rejects invalid message time", () => {
    const result = parseCreateActorTrainingDataset({
      description: "ATRI route",
      inputs: [
        {
          name: "亚托莉",
          time: "2024-13-01 10:00:00",
          content: "早上好。",
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      message: "第 1 条消息的 time 必须是有效的 YYYY-MM-DD HH:mm:ss。",
    });
  });
});
