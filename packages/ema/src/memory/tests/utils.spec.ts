import { describe, expect, test } from "vitest";

import { buildPromptFromBufferMessage, isAllowedIndex1 } from "../utils";

describe("memory utils", () => {
  test("人物画像 allows self as index1", () => {
    expect(isAllowedIndex1("人物画像", "self")).toBe(true);
  });

  test("formats keep_silence actor messages as hidden self actions", () => {
    const prompt = buildPromptFromBufferMessage(
      {
        kind: "actor",
        msgId: 42,
        keep_silence: true,
        think:
          "群里这轮没有明确问我，继续接话会刷屏；如果后面有人点名或提出具体问题，再参与。",
        contents: [],
        time: new Date(2026, 4, 18, 18, 30, 0).getTime(),
      } as any,
      null,
    );

    expect(prompt).toBe(
      '- [2026-05-18 18:30:00][speaker="self" msg_id="42" action="keep_silence" think="群里这轮没有明确问我，继续接话会刷屏；如果后面有人点名或提出具体问题，再参与。"]',
    );
  });
});
