import { z } from "zod";

import type { ReadFileResult } from "../workspace/base";
import { ActorWorkspaceService } from "../workspace/actor_workspace";
import { Tool } from "./base";
import type { ToolContext, ToolResult } from "./base";

const ListFileSchema = z
  .object({
    operation: z.literal("list"),
    path: z.string().optional(),
    recursive: z.boolean().optional(),
    max_entries: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const ReadFileSchema = z
  .object({
    operation: z.literal("read"),
    path: z.string().min(1),
    max_bytes: z
      .number()
      .int()
      .min(1)
      .max(256 * 1024)
      .optional(),
  })
  .strict();

const WriteFileSchema = z
  .object({
    operation: z.literal("write"),
    path: z.string().min(1),
    mode: z.enum(["overwrite", "append"]),
    content: z.string(),
    expected_sha256: z.string().optional(),
  })
  .strict();

const MkdirSchema = z
  .object({
    operation: z.literal("mkdir"),
    path: z.string().min(1),
  })
  .strict();

const MoveFileSchema = z
  .object({
    operation: z.literal("move"),
    source_path: z.string().min(1),
    target_path: z.string().min(1),
    overwrite: z.boolean().optional(),
  })
  .strict();

const DeleteFileSchema = z
  .object({
    operation: z.literal("delete"),
    path: z.union([
      z.string().min(1),
      z.array(z.string().min(1)).min(1).max(50),
    ]),
    recursive: z.boolean().optional(),
    dry_run: z.boolean().optional(),
  })
  .strict();

const FileToolSchema = z.discriminatedUnion("operation", [
  ListFileSchema,
  ReadFileSchema,
  WriteFileSchema,
  MkdirSchema,
  MoveFileSchema,
  DeleteFileSchema,
]);

type FileToolInput = z.infer<typeof FileToolSchema>;

const FILE_TOOL_DESCRIPTION = `
# file_tool

此工具用于管理私人工作区中的文件。

## 路径

路径是角色工作区内的虚拟路径，不是真实文件系统路径。工作区根目录写作 \`.\`；\`/\`、\`.\` 和 \`./\` 都表示该根目录。\`notes/today.md\`、\`/notes/today.md\` 和 \`./notes/today.md\` 指向同一个文件，返回结果中会统一显示为 \`notes/today.md\`。

不安全路径会被拒绝，包括 \`..\`、重复斜杠、反斜杠和符号链接。工具不会返回真实文件系统路径。

## 操作

- \`list\`：列出目录内容。
- \`read\`：读取文本文件，或读取图片/二进制文件的元数据；图片较小时会附带预览。
- \`write\`：覆盖或追加写入 UTF-8 文本。
- \`mkdir\`：创建目录。
- \`move\`：移动或重命名文件、目录。
- \`delete\`：删除一个或多个文件、目录。

## 注意事项

1. \`write\` 只支持文本内容，模式为 \`overwrite\` 或 \`append\`。
2. \`move\` 的目标路径默认不能已存在；如需覆盖同名文件，设置 \`overwrite=true\`。目录不能被覆盖。
3. \`delete.path\` 可以是单个路径，也可以是路径数组。默认只删除文件和空目录；删除非空目录需要设置 \`recursive=true\`。
4. 如果不确定删除结果，先使用 \`dry_run=true\` 查看将要删除的路径。
`;

export class FileTool extends Tool {
  private readonly workspace: ActorWorkspaceService;

  constructor(workspace: ActorWorkspaceService = new ActorWorkspaceService()) {
    super();
    this.workspace = workspace;
  }

  name = "file_tool";

  description = FILE_TOOL_DESCRIPTION;

  parameters = FileToolSchema.toJSONSchema();

  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    let payload: FileToolInput;
    try {
      payload = FileToolSchema.parse(args);
    } catch (err) {
      return {
        success: false,
        content: `Invalid file_tool input: ${(err as Error).message}`,
      };
    }

    const contextError = this.validateContext(context);
    if (contextError) {
      return contextError;
    }
    const actorId = context!.actorId!;

    try {
      switch (payload.operation) {
        case "list":
          return jsonResult(
            await this.workspace.listFiles(actorId, payload.path ?? ".", {
              recursive: payload.recursive ?? false,
              maxEntries: payload.max_entries,
            }),
          );
        case "read":
          return this.readResult(
            await this.workspace.readFile(actorId, payload.path, {
              maxBytes: payload.max_bytes,
            }),
          );
        case "write":
          return jsonResult(
            await this.workspace.writeFile(actorId, payload.path, {
              mode: payload.mode,
              content: payload.content,
              expectedSha256: payload.expected_sha256,
            }),
          );
        case "mkdir":
          return jsonResult(await this.workspace.mkdir(actorId, payload.path));
        case "move":
          return jsonResult(
            await this.workspace.movePath(
              actorId,
              payload.source_path,
              payload.target_path,
              {
                overwrite: payload.overwrite ?? false,
              },
            ),
          );
        case "delete":
          return jsonResult(
            await this.workspace.deleteFiles(
              actorId,
              normalizeDeletePaths(payload.path),
              {
                recursive: payload.recursive ?? false,
                dryRun: payload.dry_run ?? false,
              },
            ),
          );
      }
    } catch (error) {
      return {
        success: false,
        content: `File operation failed: ${sanitizeFileErrorMessage(error)}`,
      };
    }
  }

  private validateContext(context?: ToolContext): ToolResult | null {
    if (!context?.server) {
      return {
        success: false,
        content: "Missing server in file_tool context.",
      };
    }
    if (typeof context.actorId !== "number") {
      return {
        success: false,
        content: "Missing actorId in file_tool context.",
      };
    }
    return null;
  }

  private readResult(result: ReadFileResult): ToolResult {
    const { images, ...content } = result;
    return {
      success: true,
      content: JSON.stringify(content),
      ...(images?.length ? { images } : {}),
    };
  }
}

function jsonResult(value: unknown): ToolResult {
  return {
    success: true,
    content: JSON.stringify(value),
  };
}

function normalizeDeletePaths(pathValue: string | string[]): string[] {
  return Array.isArray(pathValue) ? pathValue : [pathValue];
}

function sanitizeFileErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /(?:[A-Za-z]:)?[\\/](?:[^\\/ \t\r\n"'`]+[\\/])*[^\\/ \t\r\n"'`]+/g,
    "[path]",
  );
}
