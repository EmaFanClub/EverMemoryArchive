import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { MEDIA_INLINE_LIMIT_BYTES } from "../../channel/utils";
import { ActorWorkspaceService } from "../../workspace/actor_workspace";
import { SaveFileTool } from "../save_file_tool";
import type { ToolContext, ToolResult } from "../base";

function parseContent(result: ToolResult) {
  expect(result.success).toBe(true);
  return JSON.parse(result.content ?? "{}");
}

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function mockFetchResponse(
  body: Buffer,
  headers: Record<string, string> = { "content-type": "image/png" },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 200, headers })),
  );
}

describe("SaveFileTool", () => {
  let workspaceDir: string;
  let tool: SaveFileTool;
  let context: ToolContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ema-save-file-"));
    tool = new SaveFileTool(new ActorWorkspaceService({ workspaceDir }));
    context = {
      actorId: 3,
      server: {} as ToolContext["server"],
    };
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test("downloads image URLs to a temporary default workspace path", async () => {
    const body = Buffer.from("fake-png");
    const hash = sha256(body);
    mockFetchResponse(body, { "content-type": "image/png" });

    const saved = parseContent(
      await tool.execute({ url: "https://example.com/cat.png" }, context),
    );

    expect(saved).toEqual({
      operation: "save_file",
      path: `tmp/${hash.slice(0, 12)}.png`,
      mimeType: "image/png",
      size: body.byteLength,
      overwritten: false,
    });
    await expect(
      fs.readFile(
        path.join(
          workspaceDir,
          "actor_3",
          "home",
          "tmp",
          `${hash.slice(0, 12)}.png`,
        ),
      ),
    ).resolves.toEqual(body);
  });

  test("saves to explicit paths and requires overwrite for existing files", async () => {
    mockFetchResponse(Buffer.from("first"), { "content-type": "image/jpeg" });

    const first = parseContent(
      await tool.execute(
        {
          source: "url",
          url: "https://example.com/photo.jpg",
          path: "images/photo.jpg",
        },
        context,
      ),
    );
    expect(first).toMatchObject({
      path: "images/photo.jpg",
      mimeType: "image/jpeg",
      overwritten: false,
    });

    mockFetchResponse(Buffer.from("second"), { "content-type": "image/jpeg" });
    const rejected = await tool.execute(
      {
        url: "https://example.com/photo.jpg",
        path: "images/photo.jpg",
      },
      context,
    );
    expect(rejected.success).toBe(false);
    expect(rejected.content).toContain("already exists");

    const overwritten = parseContent(
      await tool.execute(
        {
          url: "https://example.com/photo.jpg",
          path: "images/photo.jpg",
          overwrite: true,
        },
        context,
      ),
    );
    expect(overwritten).toMatchObject({
      path: "images/photo.jpg",
      mimeType: "image/jpeg",
      overwritten: true,
    });
    await expect(
      fs.readFile(
        path.join(workspaceDir, "actor_3", "home", "images", "photo.jpg"),
        "utf-8",
      ),
    ).resolves.toBe("second");
  });

  test("rejects non-image responses and non-image target paths", async () => {
    mockFetchResponse(Buffer.from("not-image"), {
      "content-type": "text/plain",
    });

    const nonImage = await tool.execute(
      { url: "https://example.com/file.txt" },
      context,
    );
    expect(nonImage.success).toBe(false);
    expect(nonImage.content).toContain("supported image");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const badPath = await tool.execute(
      {
        url: "https://example.com/cat.png",
        path: "notes/cat.txt",
      },
      context,
    );
    expect(badPath.success).toBe(false);
    expect(badPath.content).toContain("image extension");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects blocked URL hosts before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const localhost = await tool.execute(
      { url: "http://localhost/cat.png" },
      context,
    );
    expect(localhost.success).toBe(false);
    expect(localhost.content).toContain("host is not allowed");

    const dottedLocalhost = await tool.execute(
      { url: "http://localhost./cat.png" },
      context,
    );
    expect(dottedLocalhost.success).toBe(false);
    expect(dottedLocalhost.content).toContain("host is not allowed");

    const ipv6Loopback = await tool.execute(
      { url: "http://[::1]/cat.png" },
      context,
    );
    expect(ipv6Loopback.success).toBe(false);
    expect(ipv6Loopback.content).toContain("host is not allowed");

    const ipv4MappedLoopback = await tool.execute(
      { url: "http://[::ffff:127.0.0.1]/cat.png" },
      context,
    );
    expect(ipv4MappedLoopback.success).toBe(false);
    expect(ipv4MappedLoopback.content).toContain("host is not allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects images larger than the inline media limit", async () => {
    mockFetchResponse(Buffer.alloc(MEDIA_INLINE_LIMIT_BYTES + 1), {
      "content-type": "image/png",
    });

    const result = await tool.execute(
      { url: "https://example.com/large.png" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("image exceeds");
  });

  test("does not trust URL image extensions when content type is non-image", async () => {
    mockFetchResponse(Buffer.from("not-image"), {
      "content-type": "text/plain",
    });

    const result = await tool.execute(
      { url: "https://example.com/cat.png" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("supported image");
  });

  test("does not expose real filesystem paths in tool errors", async () => {
    const leakingTool = new SaveFileTool({
      writeBinaryFile: async () => {
        throw new Error(`failed to write ${workspaceDir}/actor_3/home/cat.png`);
      },
    } as unknown as ActorWorkspaceService);
    mockFetchResponse(Buffer.from("fake-png"), {
      "content-type": "image/png",
    });

    const result = await leakingTool.execute(
      { url: "https://example.com/cat.png" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.content).not.toContain(workspaceDir);
    expect(result.content).toContain("[path]");
  });

  test("requires server and actor id in tool context", async () => {
    await expect(
      tool.execute({ url: "https://example.com/cat.png" }),
    ).resolves.toMatchObject({
      success: false,
      content: expect.stringContaining("server"),
    });

    await expect(
      tool.execute(
        { url: "https://example.com/cat.png" },
        { server: {} as any },
      ),
    ).resolves.toMatchObject({
      success: false,
      content: expect.stringContaining("actorId"),
    });
  });

  test("is registered without requiring loaded global config at import time", async () => {
    const { baseTools } = await import("../index");

    expect(baseTools.some((item) => item.name === "save_file")).toBe(true);
  });
});
