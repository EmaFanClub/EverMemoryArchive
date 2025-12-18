/** Test cases for File Tools. */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, beforeEach, afterEach } from "vitest";

import {
  ReadTool,
  WriteTool,
  EditTool,
  truncateTextByTokens,
} from "../../tools/file_tools";

describe("File Tools", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "file-tools-test-"));
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("ReadTool", () => {
    test("should read file with line numbers", async () => {
      console.log("\n=== Testing ReadTool with Line Numbers ===");
      const filePath = path.join(tempDir, "test.txt");
      await fsp.writeFile(filePath, "Hello, World!\nSecond line\nThird line");

      const tool = new ReadTool(tempDir);
      const result = await tool.execute("test.txt");

      expect(result.success).toBe(true);
      expect(result.content).toContain("Hello, World!");
      expect(result.content).toContain("|");
      expect(result.content).toMatch(/\s+1\|Hello, World!/);
      expect(result.content).toMatch(/\s+2\|Second line/);
      expect(result.content).toMatch(/\s+3\|Third line/);
      console.log("✅ ReadTool with line numbers test passed");
    });

    test("should read file with offset and limit", async () => {
      console.log("\n=== Testing ReadTool with Offset and Limit ===");
      const filePath = path.join(tempDir, "test.txt");
      const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
      await fsp.writeFile(filePath, lines.join("\n"));

      const tool = new ReadTool(tempDir);

      // Read lines 5-7 (offset=5, limit=3)
      const result = await tool.execute("test.txt", 5, 3);

      expect(result.success).toBe(true);
      expect(result.content).toContain("Line 5");
      expect(result.content).toContain("Line 6");
      expect(result.content).toContain("Line 7");
      expect(result.content).not.toContain("Line 4");
      expect(result.content).not.toContain("Line 8");
      console.log("✅ ReadTool with offset and limit test passed");
    });

    test("should handle file not found", async () => {
      console.log("\n=== Testing ReadTool File Not Found ===");
      const tool = new ReadTool(tempDir);
      const result = await tool.execute("nonexistent.txt");

      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found");
      console.log("✅ ReadTool file not found test passed");
    });

    test("should handle absolute paths", async () => {
      console.log("\n=== Testing ReadTool with Absolute Path ===");
      const filePath = path.join(tempDir, "absolute.txt");
      await fsp.writeFile(filePath, "Absolute path test");

      const tool = new ReadTool(tempDir);
      const result = await tool.execute(filePath);

      expect(result.success).toBe(true);
      expect(result.content).toContain("Absolute path test");
      console.log("✅ ReadTool absolute path test passed");
    });
  });

  describe("WriteTool", () => {
    test("should write file successfully", async () => {
      console.log("\n=== Testing WriteTool ===");
      const filePath = path.join(tempDir, "write-test.txt");

      const tool = new WriteTool(tempDir);
      const result = await tool.execute("write-test.txt", "Test content");

      expect(result.success).toBe(true);
      expect(result.content).toContain("Successfully wrote");

      const content = await fsp.readFile(filePath, "utf-8");
      expect(content).toBe("Test content");
      console.log("✅ WriteTool test passed");
    });

    test("should overwrite existing file", async () => {
      console.log("\n=== Testing WriteTool Overwrite ===");
      const filePath = path.join(tempDir, "overwrite.txt");
      await fsp.writeFile(filePath, "Old content");

      const tool = new WriteTool(tempDir);
      const result = await tool.execute("overwrite.txt", "New content");

      expect(result.success).toBe(true);

      const content = await fsp.readFile(filePath, "utf-8");
      expect(content).toBe("New content");
      expect(content).not.toContain("Old content");
      console.log("✅ WriteTool overwrite test passed");
    });

    test("should create nested directories", async () => {
      console.log("\n=== Testing WriteTool with Nested Directories ===");
      const nestedPath = path.join(tempDir, "nested", "dir", "file.txt");

      const tool = new WriteTool(tempDir);
      const result = await tool.execute(
        path.join("nested", "dir", "file.txt"),
        "Nested content",
      );

      expect(result.success).toBe(true);
      expect(fs.existsSync(nestedPath)).toBe(true);

      const content = await fsp.readFile(nestedPath, "utf-8");
      expect(content).toBe("Nested content");
      console.log("✅ WriteTool nested directories test passed");
    });

    test("should handle absolute paths", async () => {
      console.log("\n=== Testing WriteTool with Absolute Path ===");
      const filePath = path.join(tempDir, "absolute-write.txt");

      const tool = new WriteTool(tempDir);
      const result = await tool.execute(filePath, "Absolute write test");

      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
      console.log("✅ WriteTool absolute path test passed");
    });
  });

  describe("EditTool", () => {
    test("should edit file successfully", async () => {
      console.log("\n=== Testing EditTool ===");
      const filePath = path.join(tempDir, "edit-test.txt");
      await fsp.writeFile(filePath, "Hello, World!");

      const tool = new EditTool(tempDir);
      const result = await tool.execute("edit-test.txt", "World", "Agent");

      expect(result.success).toBe(true);
      expect(result.content).toContain("Successfully edited");

      const content = await fsp.readFile(filePath, "utf-8");
      expect(content).toBe("Hello, Agent!");
      console.log("✅ EditTool test passed");
    });

    test("should handle multiple occurrences", async () => {
      console.log("\n=== Testing EditTool with Multiple Occurrences ===");
      const filePath = path.join(tempDir, "multi-edit.txt");
      await fsp.writeFile(filePath, "Hello World! Hello World!");

      const tool = new EditTool(tempDir);
      const result = await tool.execute("multi-edit.txt", "Hello", "Hi");

      expect(result.success).toBe(true);

      const content = await fsp.readFile(filePath, "utf-8");
      expect(content).toBe("Hi World! Hi World!");
      console.log("✅ EditTool multiple occurrences test passed");
    });

    test("should handle file not found", async () => {
      console.log("\n=== Testing EditTool File Not Found ===");
      const tool = new EditTool(tempDir);
      const result = await tool.execute("nonexistent.txt", "old", "new");

      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found");
      console.log("✅ EditTool file not found test passed");
    });

    test("should handle text not found", async () => {
      console.log("\n=== Testing EditTool Text Not Found ===");
      const filePath = path.join(tempDir, "no-match.txt");
      await fsp.writeFile(filePath, "Hello, World!");

      const tool = new EditTool(tempDir);
      const result = await tool.execute("no-match.txt", "NonExistent", "new");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Text not found");
      console.log("✅ EditTool text not found test passed");
    });

    test("should preserve indentation", async () => {
      console.log("\n=== Testing EditTool Indentation ===");
      const filePath = path.join(tempDir, "indent.txt");
      const original =
        "    function test() {\n        console.log('test');\n    }";
      await fsp.writeFile(filePath, original);

      const tool = new EditTool(tempDir);
      const result = await tool.execute("indent.txt", "test", "example");

      expect(result.success).toBe(true);

      const content = await fsp.readFile(filePath, "utf-8");
      expect(content).toContain("    function example()");
      expect(content).toContain("        console.log('example')");
      console.log("✅ EditTool indentation test passed");
    });
  });

  describe("truncateTextByTokens", () => {
    test("should not truncate text under limit", () => {
      console.log("\n=== Testing truncateTextByTokens Under Limit ===");
      const text = "Short text";
      const result = truncateTextByTokens(text, 1000);

      expect(result).toBe(text);
      console.log("✅ truncateTextByTokens under limit test passed");
    });

    test("should truncate text over limit", () => {
      console.log("\n=== Testing truncateTextByTokens Over Limit ===");
      // Create a large text that will exceed the token limit
      const longText = "This is a line.\n".repeat(10000);
      const result = truncateTextByTokens(longText, 100);

      expect(result.length).toBeLessThan(longText.length);
      expect(result).toContain("Content truncated");
      console.log("✅ truncateTextByTokens over limit test passed");
    });

    test("should preserve head and tail when truncating", () => {
      console.log("\n=== Testing truncateTextByTokens Head and Tail ===");
      const longText =
        "START LINE\n" + "Middle content.\n".repeat(10000) + "END LINE\n";
      const result = truncateTextByTokens(longText, 100);

      expect(result).toContain("START LINE");
      expect(result).toContain("END LINE");
      expect(result).toContain("Content truncated");
      console.log("✅ truncateTextByTokens head and tail test passed");
    });
  });
});
