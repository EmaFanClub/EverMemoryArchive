/** MCP tool loader with real MCP client integration. */

import fs from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { Tool, ToolResult } from "./base";

/** Wrapper for MCP tools. */
export class MCPTool extends Tool {
  _name: string;
  _description: string;
  _parameters: Record<string, any>;
  _session: any;

  constructor(options: {
    name: string;
    description: string;
    parameters: Record<string, any>;
    session: any;
  }) {
    super();
    this._name = options.name;
    this._description = options.description;
    this._parameters = options.parameters;
    this._session = options.session;
  }

  get name(): string {
    return this._name;
  }

  get description(): string {
    return this._description;
  }

  get parameters(): Record<string, any> {
    return this._parameters;
  }

  async execute(kwargs: Record<string, any>): Promise<ToolResult> {
    /** Execute MCP tool via the session. */
    try {
      const result = await this._session.callTool(this._name, {
        arguments: kwargs,
      });

      // MCP tool results are a list of content items
      const contentParts: string[] = [];
      if (result?.content) {
        for (const item of result.content) {
          if ("text" in item) {
            contentParts.push(item.text);
          } else {
            contentParts.push(item.toString());
          }
        }
      }

      const contentStr = contentParts.join("\n");
      const isError = result?.isError ?? false;

      return new ToolResult({
        success: !isError,
        content: contentStr,
        error: isError ? "Tool returned error" : null,
      });
    } catch (error) {
      return new ToolResult({
        success: false,
        content: "",
        error: `MCP tool execution failed: ${(error as Error).message}`,
      });
    }
  }
}

class MCPServerConnection {
  /** Manages connection to a single MCP server. */
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  session: any | null;
  transport: any | null;
  tools: MCPTool[];

  constructor(options: {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string> | null;
  }) {
    this.name = options.name;
    this.command = options.command;
    this.args = options.args;
    this.env = options.env ?? {};
    this.session = null;
    this.transport = null;
    this.tools = [];
  }

  async connect(): Promise<boolean> {
    /** Connect to the MCP server using proper async context management. */
    try {
      // Prepare transport
      const transport = new StdioClientTransport({
        command: this.command,
        args: this.args,
        env: Object.keys(this.env).length ? this.env : undefined,
      });

      const session = new (Client as any)({
        transport,
      });

      // Connect the session
      if (typeof session.connect === "function") {
        await session.connect();
      } else if (typeof session.initialize === "function") {
        await session.initialize();
      }

      this.session = session;
      this.transport = transport;

      // List available tools
      const toolsList = (await (session.listTools?.() ??
        session.list_tools?.())) ?? { tools: [] };

      // Wrap each tool
      for (const tool of toolsList.tools ?? []) {
        // Convert MCP tool schema to our format
        const parameters = tool.inputSchema ?? tool.input_schema ?? {};

        const mcpTool = new MCPTool({
          name: tool.name,
          description: tool.description ?? "",
          parameters,
          session,
        });
        this.tools.push(mcpTool);
      }

      console.log(
        `✓ Connected to MCP server '${this.name}' - loaded ${this.tools.length} tools`,
      );
      for (const tool of this.tools) {
        const desc =
          tool.description.length > 60
            ? tool.description.slice(0, 60)
            : tool.description;
        console.log(`  - ${tool.name}: ${desc}...`);
      }
      return true;
    } catch (error) {
      console.log(
        `✗ Failed to connect to MCP server '${this.name}': ${(error as Error).message}`,
      );
      await this.disconnect();
      return false;
    }
  }

  async disconnect(): Promise<void> {
    /** Properly disconnect from the MCP server. */
    try {
      if (this.session?.close) {
        await this.session.close();
      } else if (this.transport?.close) {
        await this.transport.close();
      }
    } catch {
      // Swallow errors during cleanup
    } finally {
      this.session = null;
      this.transport = null;
    }
  }
}

// Global connections registry
const _mcpConnections: MCPServerConnection[] = [];

export async function loadMcpToolsAsync(
  configPath: string = "mcp.json",
): Promise<Tool[]> {
  /**
   * Load MCP tools from config file.
   *
   * This function:
   * 1. Reads the MCP config file
   * 2. Starts MCP server processes
   * 3. Connects to each server
   * 4. Fetches tool definitions
   * 5. Wraps them as Tool objects
   *
   * Args:
   *     configPath: Path to MCP configuration file (default: "mcp.json")
   *
   * Returns:
   *     List of Tool objects representing MCP tools
   */
  const configFile = path.resolve(configPath);

  try {
    await fs.promises.access(configFile);
  } catch {
    console.log(`MCP config not found: ${configPath}`);
    return [];
  }

  try {
    const rawConfig = await fs.promises.readFile(configFile, "utf-8");
    const config = JSON.parse(rawConfig);

    const mcpServers = config?.mcpServers ?? {};

    if (!mcpServers || !Object.keys(mcpServers).length) {
      console.log("No MCP servers configured");
      return [];
    }

    const allTools: Tool[] = [];

    // Connect to each enabled server
    for (const [serverName, serverConfig] of Object.entries<any>(mcpServers)) {
      if (serverConfig?.disabled) {
        console.log(`Skipping disabled server: ${serverName}`);
        continue;
      }

      const command = serverConfig?.command;
      const args = serverConfig?.args ?? [];
      const env = serverConfig?.env ?? {};

      if (!command) {
        console.log(`No command specified for server: ${serverName}`);
        continue;
      }

      const connection = new MCPServerConnection({
        name: serverName,
        command,
        args,
        env,
      });
      const success = await connection.connect();

      if (success) {
        _mcpConnections.push(connection);
        allTools.push(...connection.tools);
      }
    }

    console.log(`\nTotal MCP tools loaded: ${allTools.length}`);
    return allTools;
  } catch (error) {
    console.log(`Error loading MCP config: ${(error as Error).message}`);
    return [];
  }
}

export async function cleanupMcpConnections(): Promise<void> {
  /** Clean up all MCP connections. */
  for (const connection of _mcpConnections) {
    await connection.disconnect();
  }
  _mcpConnections.length = 0;
}
