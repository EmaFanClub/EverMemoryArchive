/** Session Note Tool - Let agent record and recall important information.
 *
 * This tool allows the agent to:
 * - Record key points and important information during sessions
 * - Recall previously recorded notes
 * - Maintain context across agent execution chains
 */

import fs from "node:fs";
import path from "node:path";

import { Tool, ToolResult } from "./base";

export class SessionNoteTool extends Tool {
  memoryFile: string;

  constructor(memoryFile: string = "./workspace/.agent_memory.json") {
    /**
     * Initialize session note tool.
     *
     * Args:
     *     memoryFile: Path to the note storage file
     */
    super();
    this.memoryFile = path.resolve(memoryFile);
    // Lazy loading: file and directory are only created when first note is recorded
  }

  get name(): string {
    return "record_note";
  }

  get description(): string {
    return (
      "Record important information as session notes for future reference. " +
      "Use this to record key facts, user preferences, decisions, or context " +
      "that should be recalled later in the agent execution chain. Each note is timestamped."
    );
  }

  get parameters(): Record<string, any> {
    return {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "The information to record as a note. Be concise but specific.",
        },
        category: {
          type: "string",
          description:
            "Optional category/tag for this note (e.g., 'user_preference', 'project_info', 'decision')",
        },
      },
      required: ["content"],
    };
  }

  async _loadFromFile(): Promise<any[]> {
    /** Load notes from file.
     *
     * Returns empty list if file doesn't exist (lazy loading).
     */
    try {
      const raw = await fs.promises.readFile(this.memoryFile, "utf-8");
      return JSON.parse(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return [];
      }
      return [];
    }
  }

  async _saveToFile(notes: any[]): Promise<void> {
    /** Save notes to file.
     *
     * Creates parent directory and file if they don't exist (lazy initialization).
     */
    // Ensure parent directory exists when actually saving
    await fs.promises.mkdir(path.dirname(this.memoryFile), { recursive: true });
    await fs.promises.writeFile(
      this.memoryFile,
      JSON.stringify(notes, null, 2),
      "utf-8",
    );
  }

  async execute(
    content: string,
    category: string = "general",
  ): Promise<ToolResult> {
    /** Record a session note.
     *
     * Args:
     *     content: The information to record
     *     category: Category/tag for this note
     *
     * Returns:
     *     ToolResult with success status
     */
    try {
      // Load existing notes
      const notes = await this._loadFromFile();

      // Add new note with timestamp
      const note = {
        timestamp: new Date().toISOString(),
        category,
        content,
      };
      notes.push(note);

      // Save back to file
      await this._saveToFile(notes);

      return new ToolResult({
        success: true,
        content: `Recorded note: ${content} (category: ${category})`,
      });
    } catch (error) {
      return new ToolResult({
        success: false,
        content: "",
        error: `Failed to record note: ${(error as Error).message}`,
      });
    }
  }
}

export class RecallNoteTool extends Tool {
  memoryFile: string;

  constructor(memoryFile: string = "./workspace/.agent_memory.json") {
    /**
     * Initialize recall note tool.
     *
     * Args:
     *     memoryFile: Path to the note storage file
     */
    super();
    this.memoryFile = path.resolve(memoryFile);
  }

  get name(): string {
    return "recall_notes";
  }

  get description(): string {
    return (
      "Recall all previously recorded session notes. " +
      "Use this to retrieve important information, context, or decisions " +
      "from earlier in the session or previous agent execution chains."
    );
  }

  get parameters(): Record<string, any> {
    return {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Optional: filter notes by category",
        },
      },
    };
  }

  async execute(category: string | null = null): Promise<ToolResult> {
    /** Recall session notes.
     *
     * Args:
     *     category: Optional category filter
     *
     * Returns:
     *     ToolResult with notes content
     */
    try {
      let notes: any[];
      try {
        notes = JSON.parse(
          await fs.promises.readFile(this.memoryFile, "utf-8"),
        ) as any[];
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
          return new ToolResult({
            success: true,
            content: "No notes recorded yet.",
          });
        }
        throw error;
      }

      if (!notes?.length) {
        return new ToolResult({
          success: true,
          content: "No notes recorded yet.",
        });
      }

      // Filter by category if specified
      let filteredNotes = notes;
      if (category) {
        filteredNotes = notes.filter((n) => n?.category === category);
        if (!filteredNotes.length) {
          return new ToolResult({
            success: true,
            content: `No notes found in category: ${category}`,
          });
        }
      }

      // Format notes for display
      const formatted: string[] = [];
      filteredNotes.forEach((note, idx) => {
        const timestamp = note?.timestamp ?? "unknown time";
        const cat = note?.category ?? "general";
        const noteContent = note?.content ?? "";
        formatted.push(
          `${idx + 1}. [${cat}] ${noteContent}\n   (recorded at ${timestamp})`,
        );
      });

      const result = "Recorded Notes:\n" + formatted.join("\n");

      return new ToolResult({ success: true, content: result });
    } catch (error) {
      return new ToolResult({
        success: false,
        content: "",
        error: `Failed to recall notes: ${(error as Error).message}`,
      });
    }
  }
}
