import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionNoteTool, RecallNoteTool } from "../../tools/note_tool";
import * as fs from "fs/promises";
import * as path from "path";

describe("Note Tools", () => {
  const testMemoryFile = path.join(__dirname, "test_memory.json");
  let sessionNoteTool: SessionNoteTool;
  let recallNoteTool: RecallNoteTool;

  beforeEach(async () => {
    sessionNoteTool = new SessionNoteTool(testMemoryFile);
    recallNoteTool = new RecallNoteTool(testMemoryFile);
  });

  afterEach(async () => {
    // Clean up test file
    try {
      await fs.unlink(testMemoryFile);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("SessionNoteTool", () => {
    it("should have correct name and description", () => {
      expect(sessionNoteTool.name).toBe("record_note");
      expect(sessionNoteTool.description).toContain("Record");
    });

    it("should save a new note", async () => {
      const content = "This is a test note content";
      const category = "test";

      const result = await sessionNoteTool.execute(content, category);

      expect(result.success).toBe(true);
      expect(result.content).toContain("Recorded note");
      expect(result.content).toContain(content);
    });

    it("should create note with timestamp", async () => {
      const content = "Timestamped note";

      const result = await sessionNoteTool.execute(content);
      expect(result.success).toBe(true);
    });

    it("should save note with default category", async () => {
      const content = "Note without category";

      const result = await sessionNoteTool.execute(content);

      expect(result.success).toBe(true);
      expect(result.content).toContain("general");
    });

    it("should handle special characters in content", async () => {
      const content = "Test: Note (with) [special] {chars}!";

      const result = await sessionNoteTool.execute(content);

      expect(result.success).toBe(true);
      expect(result.content).toContain(content);
    });

    it("should handle empty content", async () => {
      const content = "";

      const result = await sessionNoteTool.execute(content);

      expect(result.success).toBe(true);
    });

    it("should handle multi-line content", async () => {
      const content = "Line 1\nLine 2\nLine 3\n\nLine 5";

      const result = await sessionNoteTool.execute(content);

      expect(result.success).toBe(true);
      expect(result.content).toContain("Line 1");
    });

    it("should have required parameters schema", () => {
      const params = sessionNoteTool.parameters;
      expect(params.type).toBe("object");
      expect(params.properties).toHaveProperty("content");
      expect(params.required).toContain("content");
    });

    it("should save multiple notes without conflict", async () => {
      await sessionNoteTool.execute("Content 1");
      await sessionNoteTool.execute("Content 2");
      const result = await sessionNoteTool.execute("Content 3");

      expect(result.success).toBe(true);
    });
  });

  describe("RecallNoteTool", () => {
    beforeEach(async () => {
      // Create some test notes
      await sessionNoteTool.execute(
        "Discussed project timeline and milestones",
        "meeting",
      );
      await sessionNoteTool.execute(
        "Reviewed PR #123: Fixed authentication bug",
        "code_review",
      );
      await sessionNoteTool.execute("New UI mockups for dashboard", "design");
    });

    it("should have correct name and description", () => {
      expect(recallNoteTool.name).toBe("recall_notes");
      expect(recallNoteTool.description).toContain("Recall");
    });

    it("should recall notes by category", async () => {
      const result = await recallNoteTool.execute("meeting");

      expect(result.success).toBe(true);
      expect(result.content).toContain("project timeline");
    });

    it("should recall all notes without category filter", async () => {
      const result = await recallNoteTool.execute(null);

      expect(result.success).toBe(true);
      expect(result.content).toContain("Recorded Notes");
    });

    it("should return message when no notes found", async () => {
      const result = await recallNoteTool.execute("nonexistentcategory");

      expect(result.success).toBe(true);
      expect(result.content).toContain("No notes found");
    });

    it("should handle empty notes file", async () => {
      // Delete memory file
      await fs.unlink(testMemoryFile).catch(() => {});

      const result = await recallNoteTool.execute(null);

      expect(result.success).toBe(true);
      expect(result.content).toContain("No notes");
    });

    it("should format notes with timestamps", async () => {
      const result = await recallNoteTool.execute(null);

      expect(result.success).toBe(true);
      expect(result.content).toContain("recorded at");
    });

    it("should have parameters schema", () => {
      const params = recallNoteTool.parameters;
      expect(params.type).toBe("object");
      expect(params.properties).toHaveProperty("category");
    });
  });

  describe("Integration tests", () => {
    it("should save and then recall note", async () => {
      const content = "This is an integration test for note tools";
      const category = "test";

      // Save note
      const saveResult = await sessionNoteTool.execute(content, category);
      expect(saveResult.success).toBe(true);

      // Recall note
      const recallResult = await recallNoteTool.execute(category);
      expect(recallResult.success).toBe(true);
      expect(recallResult.content).toContain(content);
    });

    it("should handle multiple save and recall operations", async () => {
      // Save multiple notes
      await sessionNoteTool.execute("Complete feature A", "task");
      await sessionNoteTool.execute("Review feature B", "task");
      await sessionNoteTool.execute("Fix issue in feature A", "bugfix");

      // Recall notes by category
      const taskResult = await recallNoteTool.execute("task");

      expect(taskResult.success).toBe(true);
      expect(taskResult.content).toContain("feature A");
      expect(taskResult.content).toContain("feature B");

      // Recall all notes
      const allResult = await recallNoteTool.execute(null);
      expect(allResult.success).toBe(true);
      expect(allResult.content).toContain("task");
      expect(allResult.content).toContain("bugfix");
    });
  });
});
