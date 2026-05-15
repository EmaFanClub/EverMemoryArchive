import { describe, expect, test } from "vitest";

import {
  collapseContentsToText,
  expandContentsForModel,
  isImageUrlItem,
  isToolCall,
  isToolResult,
} from "../schema";

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

  test("uses image URL text when URL media is collapsed", () => {
    expect(
      collapseContentsToText([
        {
          type: "image_url",
          url: "https://example.test/image.png",
          text: "[图片]",
        },
      ]),
    ).toEqual([{ type: "text", text: "[图片]（image_url）" }]);
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

describe("AgentHub schema helpers", () => {
  test("detects image URL, tool call, and tool result content", () => {
    expect(
      isImageUrlItem({
        type: "image_url",
        url: "https://example.test/image.png",
      }),
    ).toBe(true);
    expect(
      isToolCall({
        type: "tool_call",
        toolCallId: "call-1",
        name: "get_time",
        arguments: {},
      }),
    ).toBe(true);
    expect(
      isToolResult({
        type: "tool_result",
        toolCallId: "call-1",
        name: "get_time",
        result: { text: '{"success":true}' },
      }),
    ).toBe(true);
  });
});
