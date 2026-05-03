import { describe, expect, test } from "vitest";

import { isAllowedIndex1 } from "../utils";

describe("memory utils", () => {
  test("人物画像 allows self as index1", () => {
    expect(isAllowedIndex1("人物画像", "self")).toBe(true);
  });
});
