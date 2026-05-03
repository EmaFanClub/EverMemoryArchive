import { describe, expect, test } from "vitest";

import { collapseContentsToText, expandContentsForModel } from "../schema";

describe("collapseContentsToText", () => {
  test("uses inline data text when media is collapsed", () => {
    expect(
      collapseContentsToText([
        { type: "text", text: "hello" },
        {
          type: "inline_data",
          mimeType: "image/png",
          data: "base64-data",
          text: "[图片]",
        },
      ]),
    ).toEqual([
      { type: "text", text: "hello" },
      { type: "text", text: "[图片]（image/png）" },
    ]);
  });

  test("falls back to MIME text when inline data has no text", () => {
    expect(
      collapseContentsToText([
        {
          type: "inline_data",
          mimeType: "application/pdf",
          data: "base64-data",
        },
      ]),
    ).toEqual([{ type: "text", text: "（application/pdf）" }]);
  });
});

describe("expandContentsForModel", () => {
  test("adds media text before preserving inline data", () => {
    expect(
      expandContentsForModel([
        { type: "text", text: "hello" },
        {
          type: "inline_data",
          mimeType: "image/png",
          data: "base64-data",
          text: "[图片]",
        },
      ]),
    ).toEqual([
      { type: "text", text: "hello" },
      { type: "text", text: "[图片]（image/png）" },
      {
        type: "inline_data",
        mimeType: "image/png",
        data: "base64-data",
        text: "[图片]",
      },
    ]);
  });
});
