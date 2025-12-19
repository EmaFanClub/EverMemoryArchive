import { expect, test, describe } from "vitest";
import { MemFs } from "../fs";

describe("MemFs", () => {
  test("should write and read a file", async () => {
    const fs = new MemFs();
    const path = "/test/file.txt";
    const content = "Hello, World!";

    await fs.write(path, content);
    const result = await fs.read(path);

    expect(result).toBe(content);
  });

  test("should check if a file exists", async () => {
    const fs = new MemFs();
    const path = "/test/file.txt";
    const content = "Hello, World!";

    // File should not exist initially
    expect(await fs.exists(path)).toBe(false);

    // File should exist after writing
    await fs.write(path, content);
    expect(await fs.exists(path)).toBe(true);
  });

  test("should throw error when reading non-existent file", async () => {
    const fs = new MemFs();
    const path = "/test/nonexistent.txt";

    await expect(fs.read(path)).rejects.toThrow(
      "File not found: /test/nonexistent.txt",
    );
  });

  test("should overwrite existing file", async () => {
    const fs = new MemFs();
    const path = "/test/file.txt";
    const content1 = "First content";
    const content2 = "Second content";

    await fs.write(path, content1);
    expect(await fs.read(path)).toBe(content1);

    await fs.write(path, content2);
    expect(await fs.read(path)).toBe(content2);
  });

  test("should handle multiple files independently", async () => {
    const fs = new MemFs();
    const path1 = "/test/file1.txt";
    const path2 = "/test/file2.txt";
    const content1 = "Content 1";
    const content2 = "Content 2";

    await fs.write(path1, content1);
    await fs.write(path2, content2);

    expect(await fs.read(path1)).toBe(content1);
    expect(await fs.read(path2)).toBe(content2);
    expect(await fs.exists(path1)).toBe(true);
    expect(await fs.exists(path2)).toBe(true);
  });
});
