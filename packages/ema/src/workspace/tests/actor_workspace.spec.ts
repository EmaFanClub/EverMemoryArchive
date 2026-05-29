import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ActorWorkspaceService } from "../actor_workspace";
import { normalizeWorkspacePath } from "../utils";

describe("ActorWorkspaceService", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ema-workspace-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test("normalizes model paths to actor-home relative paths", () => {
    expect(normalizeWorkspacePath("/")).toBe(".");
    expect(normalizeWorkspacePath(".")).toBe(".");
    expect(normalizeWorkspacePath("./")).toBe(".");
    expect(normalizeWorkspacePath("notes/today.md")).toBe("notes/today.md");
    expect(normalizeWorkspacePath("/notes/today.md")).toBe("notes/today.md");
    expect(normalizeWorkspacePath("./notes/today.md")).toBe("notes/today.md");
  });

  test.each([
    "",
    "notes//today.md",
    "../a.md",
    "/../a.md",
    "./../a.md",
    "notes/../a.md",
    "notes/./a.md",
    "a\\b.txt",
    "~/a.md",
    "bad\0path",
  ])("rejects unsafe model path %j", (modelPath) => {
    expect(() => normalizeWorkspacePath(modelPath)).toThrow();
  });

  test("resolves missing targets inside the actor home directory", async () => {
    const service = new ActorWorkspaceService({ workspaceDir });

    const resolved = await service.resolvePath(7, "/notes/today.md", {
      allowRoot: false,
    });

    expect(resolved.virtualPath).toBe("notes/today.md");
    expect(resolved.realPath).toBe(
      path.join(workspaceDir, "actor_7", "home", "notes", "today.md"),
    );
    await expect(
      fs.stat(path.join(workspaceDir, "actor_7", "home")),
    ).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  test("rejects existing symlink targets", async () => {
    const service = new ActorWorkspaceService({ workspaceDir });
    const home = path.join(workspaceDir, "actor_1", "home");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "ema-outside-"));
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(outside, "secret.txt"), "secret", "utf-8");
    await fs.symlink(path.join(outside, "secret.txt"), path.join(home, "link"));

    await expect(
      service.resolvePath(1, "link", { allowRoot: false, mustExist: true }),
    ).rejects.toThrow(/symlink/i);

    await fs.rm(outside, { recursive: true, force: true });
  });

  test("rejects symlink parents for missing targets", async () => {
    const service = new ActorWorkspaceService({ workspaceDir });
    const home = path.join(workspaceDir, "actor_1", "home");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "ema-outside-"));
    await fs.mkdir(home, { recursive: true });
    await fs.symlink(outside, path.join(home, "link"), "dir");

    await expect(
      service.resolvePath(1, "link/new.txt", { allowRoot: false }),
    ).rejects.toThrow(/symlink/i);

    await fs.rm(outside, { recursive: true, force: true });
  });

  test("rejects symlink parents even when they point inside actor home", async () => {
    const service = new ActorWorkspaceService({ workspaceDir });
    const home = path.join(workspaceDir, "actor_1", "home");
    await fs.mkdir(path.join(home, "real"), { recursive: true });
    await fs.writeFile(path.join(home, "real", "file.txt"), "inside", "utf-8");
    await fs.symlink(path.join(home, "real"), path.join(home, "link"), "dir");

    await expect(
      service.resolvePath(1, "link/file.txt", {
        allowRoot: false,
        mustExist: true,
      }),
    ).rejects.toThrow(/symlink/i);
  });

  test("rejects symlink actor home roots", async () => {
    const service = new ActorWorkspaceService({ workspaceDir });
    const actorRoot = path.join(workspaceDir, "actor_1");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "ema-outside-"));
    await fs.mkdir(actorRoot, { recursive: true });
    await fs.writeFile(path.join(outside, "secret.txt"), "secret", "utf-8");
    await fs.symlink(outside, path.join(actorRoot, "home"), "dir");

    await expect(service.readFile(1, "secret.txt")).rejects.toThrow(/symlink/i);

    await fs.rm(outside, { recursive: true, force: true });
  });

  test("does not read entire large text files into memory", async () => {
    const service = new ActorWorkspaceService({ workspaceDir });
    const home = path.join(workspaceDir, "actor_1", "home");
    const filePath = path.join(home, "large.txt");
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(filePath, "a".repeat(512 * 1024), "utf-8");

    const originalReadFile = fs.readFile;
    fs.readFile = (async (
      target: Parameters<typeof fs.readFile>[0],
      ...args
    ) => {
      if (target === filePath) {
        throw new Error("full file read should not be used");
      }
      return originalReadFile(target, ...args);
    }) as typeof fs.readFile;

    try {
      await expect(
        service.readFile(1, "large.txt", { maxBytes: 16 }),
      ).resolves.toMatchObject({
        operation: "read",
        path: "large.txt",
        type: "text",
        size: 512 * 1024,
        content: "a".repeat(16),
        truncated: true,
      });
    } finally {
      fs.readFile = originalReadFile;
    }
  });

  test("cleans up overwrite temp files when rename fails", async () => {
    const service = new ActorWorkspaceService({ workspaceDir });
    const home = path.join(workspaceDir, "actor_1", "home");
    await fs.mkdir(home, { recursive: true });

    const originalRename = fs.rename;
    fs.rename = (async (oldPath: Parameters<typeof fs.rename>[0], newPath) => {
      if (String(oldPath).includes(".tmp-")) {
        throw new Error(`rename failed for ${String(newPath)}`);
      }
      return originalRename(oldPath, newPath);
    }) as typeof fs.rename;

    try {
      await expect(
        service.writeFile(1, "notes.txt", {
          mode: "overwrite",
          content: "draft",
        }),
      ).rejects.toThrow(/rename failed/);
    } finally {
      fs.rename = originalRename;
    }

    await expect(fs.readdir(home)).resolves.toEqual([]);
  });

  test("writes binary files and requires explicit overwrite", async () => {
    const service = new ActorWorkspaceService({ workspaceDir });
    const content = Buffer.from([0, 255, 1, 254]);

    const written = await service.writeBinaryFile(1, "images/raw.bin", content);

    expect(written).toMatchObject({
      path: "images/raw.bin",
      size: content.byteLength,
      overwritten: false,
    });
    expect(written.sha256).toEqual(expect.any(String));
    await expect(
      fs.readFile(
        path.join(workspaceDir, "actor_1", "home", "images", "raw.bin"),
      ),
    ).resolves.toEqual(content);

    await expect(
      service.writeBinaryFile(1, "images/raw.bin", Buffer.from([1])),
    ).rejects.toThrow(/already exists/);

    const overwritten = await service.writeBinaryFile(
      1,
      "images/raw.bin",
      Buffer.from([2]),
      { overwrite: true },
    );
    expect(overwritten).toMatchObject({
      path: "images/raw.bin",
      size: 1,
      overwritten: true,
    });
    await expect(
      fs.readFile(
        path.join(workspaceDir, "actor_1", "home", "images", "raw.bin"),
      ),
    ).resolves.toEqual(Buffer.from([2]));
  });

  test("reads image data for outbound sending", async () => {
    const service = new ActorWorkspaceService({ workspaceDir });
    const content = Buffer.from("fake-image");
    await service.writeBinaryFile(1, "images/cat.png", content);

    const image = await service.readImageDataFile(1, "/images/cat.png");

    expect(image).toMatchObject({
      path: "images/cat.png",
      size: content.byteLength,
      mimeType: "image/png",
    });
    expect(image.data).toEqual(content);
    expect(image.sha256).toEqual(expect.any(String));
  });

  test("rejects non-image files for outbound sending", async () => {
    const service = new ActorWorkspaceService({ workspaceDir });
    await service.writeFile(1, "notes/cat.txt", {
      mode: "overwrite",
      content: "not an image",
    });

    await expect(service.readImageDataFile(1, "notes/cat.txt")).rejects.toThrow(
      /image/i,
    );
  });

  test("serializes writes against ancestor directory deletes", async () => {
    const service = new ActorWorkspaceService({ workspaceDir });
    await service.writeFile(1, "drafts/old.md", {
      mode: "overwrite",
      content: "old",
    });

    const draftsPath = path.join(workspaceDir, "actor_1", "home", "drafts");
    let releaseDelete!: () => void;
    const deleteCanContinue = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const originalRm = fs.rm;
    const deleteStarted = new Promise<void>((resolve) => {
      fs.rm = (async (
        target: Parameters<typeof fs.rm>[0],
        options?: Parameters<typeof fs.rm>[1],
      ) => {
        if (target === draftsPath) {
          resolve();
          await deleteCanContinue;
        }
        return originalRm(target, options);
      }) as typeof fs.rm;
    });

    const deletePromise = service.deleteFiles(1, ["drafts"], {
      recursive: true,
    });
    await deleteStarted;
    const writePromise = service.writeFile(1, "drafts/new.md", {
      mode: "overwrite",
      content: "new",
    });

    releaseDelete();
    try {
      await Promise.all([deletePromise, writePromise]);
    } finally {
      fs.rm = originalRm;
    }

    await expect(
      fs.readFile(path.join(draftsPath, "new.md"), "utf-8"),
    ).resolves.toBe("new");
  });

  test("serializes mutations across service instances", async () => {
    const deleteService = new ActorWorkspaceService({ workspaceDir });
    const writeService = new ActorWorkspaceService({ workspaceDir });
    await deleteService.writeFile(1, "drafts/old.md", {
      mode: "overwrite",
      content: "old",
    });

    const draftsPath = path.join(workspaceDir, "actor_1", "home", "drafts");
    let releaseDelete!: () => void;
    const deleteCanContinue = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const originalRm = fs.rm;
    const deleteStarted = new Promise<void>((resolve) => {
      fs.rm = (async (
        target: Parameters<typeof fs.rm>[0],
        options?: Parameters<typeof fs.rm>[1],
      ) => {
        if (target === draftsPath) {
          resolve();
          await deleteCanContinue;
        }
        return originalRm(target, options);
      }) as typeof fs.rm;
    });

    const deletePromise = deleteService.deleteFiles(1, ["drafts"], {
      recursive: true,
    });
    await deleteStarted;
    const writePromise = writeService.writeFile(1, "drafts/new.md", {
      mode: "overwrite",
      content: "new",
    });

    releaseDelete();
    try {
      await Promise.all([deletePromise, writePromise]);
    } finally {
      fs.rm = originalRm;
    }

    await expect(
      fs.readFile(path.join(draftsPath, "new.md"), "utf-8"),
    ).resolves.toBe("new");
  });

  test("serializes writes against ancestor directory moves", async () => {
    const service = new ActorWorkspaceService({ workspaceDir });
    await service.writeFile(1, "drafts/old.md", {
      mode: "overwrite",
      content: "old",
    });

    const home = path.join(workspaceDir, "actor_1", "home");
    const draftsPath = path.join(home, "drafts");
    const archivePath = path.join(home, "archive");
    let releaseMove!: () => void;
    const moveCanContinue = new Promise<void>((resolve) => {
      releaseMove = resolve;
    });
    const originalRename = fs.rename;
    const moveStarted = new Promise<void>((resolve) => {
      fs.rename = (async (
        oldPath: Parameters<typeof fs.rename>[0],
        newPath: Parameters<typeof fs.rename>[1],
      ) => {
        if (oldPath === draftsPath && newPath === archivePath) {
          resolve();
          await moveCanContinue;
        }
        return originalRename(oldPath, newPath);
      }) as typeof fs.rename;
    });

    const movePromise = service.movePath(1, "drafts", "archive");
    await moveStarted;
    const writePromise = service.writeFile(1, "drafts/new.md", {
      mode: "overwrite",
      content: "new",
    });

    releaseMove();
    try {
      await Promise.all([movePromise, writePromise]);
    } finally {
      fs.rename = originalRename;
    }

    await expect(
      fs.readFile(path.join(draftsPath, "new.md"), "utf-8"),
    ).resolves.toBe("new");
    await expect(
      fs.readFile(path.join(archivePath, "old.md"), "utf-8"),
    ).resolves.toBe("old");
  });
});
