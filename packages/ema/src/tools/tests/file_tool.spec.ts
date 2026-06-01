import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ActorWorkspaceService } from "../../workspace/actor_workspace";
import { FileTool } from "../file_tool";
import type { ToolContext, ToolResult } from "../base";

function parseContent(result: ToolResult) {
  expect(result.success).toBe(true);
  return JSON.parse(result.content ?? "{}");
}

describe("FileTool", () => {
  let workspaceDir: string;
  let tool: FileTool;
  let context: ToolContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ema-file-tool-"));
    tool = new FileTool(new ActorWorkspaceService({ workspaceDir }));
    context = {
      actorId: 3,
      server: {} as ToolContext["server"],
    };
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test("writes, appends, and reads text files with normalized paths", async () => {
    const written = parseContent(
      await tool.execute(
        {
          operation: "write",
          path: "/notes/today.md",
          mode: "overwrite",
          content: "hello",
        },
        context,
      ),
    );
    expect(written).toMatchObject({
      operation: "write",
      path: "notes/today.md",
      mode: "overwrite",
      size: 5,
    });
    expect(written.sha256).toEqual(expect.any(String));

    parseContent(
      await tool.execute(
        {
          operation: "write",
          path: "./notes/today.md",
          mode: "append",
          content: " world",
        },
        context,
      ),
    );

    const read = parseContent(
      await tool.execute(
        { operation: "read", path: "notes/today.md" },
        context,
      ),
    );
    expect(read).toMatchObject({
      operation: "read",
      path: "notes/today.md",
      type: "text",
      size: 11,
      content: "hello world",
      truncated: false,
    });
    expect(read.sha256).toEqual(expect.any(String));
  });

  test("creates directories and lists workspace entries", async () => {
    const created = parseContent(
      await tool.execute({ operation: "mkdir", path: "docs/archive" }, context),
    );
    expect(created).toMatchObject({
      operation: "mkdir",
      path: "docs/archive",
      created: true,
    });

    const repeated = parseContent(
      await tool.execute(
        { operation: "mkdir", path: "/docs/archive" },
        context,
      ),
    );
    expect(repeated.created).toBe(false);

    const listed = parseContent(
      await tool.execute(
        {
          operation: "list",
          path: ".",
          recursive: true,
          max_entries: 10,
        },
        context,
      ),
    );
    expect(listed).toMatchObject({
      operation: "list",
      path: ".",
      truncated: false,
    });
    const entries = listed.entries as Array<Record<string, unknown>>;
    expect(entries.map((entry) => entry.path)).toEqual([
      "docs",
      "docs/archive",
    ]);
    for (const entry of entries) {
      expect(entry.modifiedAt).toEqual(expect.any(String));
      expect(entry.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(entry).not.toHaveProperty("mtime");
    }
  });

  test("truncates large text reads", async () => {
    parseContent(
      await tool.execute(
        {
          operation: "write",
          path: "notes/long.txt",
          mode: "overwrite",
          content: "abcdef",
        },
        context,
      ),
    );

    const read = parseContent(
      await tool.execute(
        {
          operation: "read",
          path: "notes/long.txt",
          max_bytes: 3,
        },
        context,
      ),
    );
    expect(read).toMatchObject({
      content: "abc",
      truncated: true,
      size: 6,
    });
  });

  test("rejects overwrite when expected sha256 does not match", async () => {
    parseContent(
      await tool.execute(
        {
          operation: "write",
          path: "notes/today.md",
          mode: "overwrite",
          content: "original",
        },
        context,
      ),
    );

    const result = await tool.execute(
      {
        operation: "write",
        path: "notes/today.md",
        mode: "overwrite",
        content: "changed",
        expected_sha256: "not-the-current-hash",
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("sha256");
  });

  test("rejects writing over directories before creating temp files", async () => {
    parseContent(
      await tool.execute({ operation: "mkdir", path: "folder" }, context),
    );

    const result = await tool.execute(
      {
        operation: "write",
        path: "folder",
        mode: "overwrite",
        content: "not a directory",
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("not a file");
    await expect(
      fs.readdir(path.join(workspaceDir, "actor_3", "home")),
    ).resolves.toEqual(["folder"]);
  });

  test("moves files and renames directories without reading content", async () => {
    parseContent(
      await tool.execute(
        {
          operation: "write",
          path: "workspace/gift.md",
          mode: "overwrite",
          content: "gift",
        },
        context,
      ),
    );

    const moved = parseContent(
      await tool.execute(
        {
          operation: "move",
          source_path: "workspace/gift.md",
          target_path: "memories/gift.md",
        },
        context,
      ),
    );
    expect(moved).toMatchObject({
      operation: "move",
      sourcePath: "workspace/gift.md",
      targetPath: "memories/gift.md",
      type: "file",
      overwritten: false,
    });

    await expect(
      fs.stat(
        path.join(workspaceDir, "actor_3", "home", "workspace", "gift.md"),
      ),
    ).rejects.toThrow();
    await expect(
      fs.readFile(
        path.join(workspaceDir, "actor_3", "home", "memories", "gift.md"),
        "utf-8",
      ),
    ).resolves.toBe("gift");

    const renamed = parseContent(
      await tool.execute(
        {
          operation: "move",
          source_path: "memories",
          target_path: "archive",
        },
        context,
      ),
    );
    expect(renamed).toMatchObject({
      operation: "move",
      sourcePath: "memories",
      targetPath: "archive",
      type: "directory",
      overwritten: false,
    });
    await expect(
      fs.readFile(
        path.join(workspaceDir, "actor_3", "home", "archive", "gift.md"),
        "utf-8",
      ),
    ).resolves.toBe("gift");
  });

  test("requires explicit overwrite when moving onto an existing file", async () => {
    parseContent(
      await tool.execute(
        {
          operation: "write",
          path: "draft.md",
          mode: "overwrite",
          content: "draft",
        },
        context,
      ),
    );
    parseContent(
      await tool.execute(
        {
          operation: "write",
          path: "final.md",
          mode: "overwrite",
          content: "final",
        },
        context,
      ),
    );

    const rejected = await tool.execute(
      {
        operation: "move",
        source_path: "draft.md",
        target_path: "final.md",
      },
      context,
    );
    expect(rejected.success).toBe(false);
    expect(rejected.content).toContain("already exists");

    const overwritten = parseContent(
      await tool.execute(
        {
          operation: "move",
          source_path: "draft.md",
          target_path: "final.md",
          overwrite: true,
        },
        context,
      ),
    );
    expect(overwritten).toMatchObject({
      operation: "move",
      sourcePath: "draft.md",
      targetPath: "final.md",
      type: "file",
      overwritten: true,
    });
    await expect(
      fs.readFile(
        path.join(workspaceDir, "actor_3", "home", "final.md"),
        "utf-8",
      ),
    ).resolves.toBe("draft");
  });

  test("dry-runs and recursively deletes single and multiple paths", async () => {
    parseContent(
      await tool.execute(
        {
          operation: "write",
          path: "drafts/old.md",
          mode: "overwrite",
          content: "old",
        },
        context,
      ),
    );

    const dryRun = parseContent(
      await tool.execute(
        {
          operation: "delete",
          path: "drafts",
          recursive: true,
          dry_run: true,
        },
        context,
      ),
    );
    expect(dryRun.results).toEqual([
      {
        path: "drafts",
        status: "would_delete",
        type: "directory",
        recursive: true,
      },
    ]);
    await expect(
      fs.stat(path.join(workspaceDir, "actor_3", "home", "drafts", "old.md")),
    ).resolves.toBeTruthy();

    const removed = parseContent(
      await tool.execute(
        {
          operation: "delete",
          path: ["drafts", "missing.md"],
          recursive: true,
        },
        context,
      ),
    );
    expect(removed.results).toEqual([
      {
        path: "drafts",
        status: "deleted",
        type: "directory",
        recursive: true,
      },
      {
        path: "missing.md",
        status: "not_found",
      },
    ]);
    await expect(
      fs.stat(path.join(workspaceDir, "actor_3", "home", "drafts")),
    ).rejects.toThrow();
  });

  test("requires server and actor id in tool context", async () => {
    await expect(
      tool.execute({ operation: "list", path: "." }),
    ).resolves.toMatchObject({
      success: false,
      content: expect.stringContaining("server"),
    });

    await expect(
      tool.execute({ operation: "list", path: "." }, { server: {} as any }),
    ).resolves.toMatchObject({
      success: false,
      content: expect.stringContaining("actorId"),
    });
  });

  test("is registered without requiring loaded global config at import time", async () => {
    const { baseTools } = await import("../index");

    expect(baseTools.some((item) => item.name === "file_tool")).toBe(true);
  });

  test("exposes provider-compatible object parameters schema", () => {
    const params = tool.parameters;
    const properties = params.properties as Record<string, unknown>;
    const operation = properties.operation as { enum?: string[] };

    expect(params.type).toBe("object");
    expect(params.oneOf).toBeUndefined();
    expect(params.required).toEqual(["operation"]);
    expect(operation.enum).toEqual([
      "list",
      "read",
      "write",
      "mkdir",
      "move",
      "delete",
    ]);
    expect(operation.enum).not.toContain("remove");
    expect(params.required).not.toContain("recursive");
    expect(params.required).not.toContain("dry_run");
    expect(params.required).not.toContain("overwrite");
  });

  test("does not expose real filesystem paths in tool errors", async () => {
    const leakingTool = new FileTool({
      listFiles: async () => {
        throw new Error(`failed to access ${workspaceDir}/actor_3/home`);
      },
    } as unknown as ActorWorkspaceService);

    const result = await leakingTool.execute(
      { operation: "list", path: "." },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.content).not.toContain(workspaceDir);
    expect(result.content).toContain("[path]");
  });
});
