import net from "node:net";

import { z } from "zod";

import { MEDIA_INLINE_LIMIT_BYTES } from "../channel/utils";
import { IMAGE_MIME_TYPES, type ImageMIME } from "../llm/schema";
import { ActorWorkspaceService } from "../workspace/actor_workspace";
import {
  hashBuffer,
  imageMimeTypeForPath,
  normalizeWorkspacePath,
} from "../workspace/utils";
import { Tool } from "./base";
import type { ToolContext, ToolResult } from "./base";

const SAVE_FILE_FETCH_TIMEOUT_MS = 10_000;

const SaveFileSchema = z
  .object({
    source: z.literal("url").optional(),
    url: z.string().min(1),
    path: z.string().min(1).optional(),
    overwrite: z.boolean().optional(),
  })
  .strict();

type SaveFileInput = z.infer<typeof SaveFileSchema>;

const IMAGE_EXTENSIONS: Record<ImageMIME, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff",
};

const SAVE_FILE_DESCRIPTION = `
# save_file

此工具用于把外部图片保存到私人工作区。

## 支持范围

当前只支持从 URL 保存图片。URL 必须是 \`http\` 或 \`https\`，并且返回内容必须是支持的图片类型。

## 参数

- \`url\`：图片 URL。
- \`source\`：可省略；当前只支持 \`url\`。
- \`path\`：可选的工作区虚拟路径。不提供时会自动保存到 \`tmp/\`，临时文件之后可能被清理。
- \`overwrite\`：默认 \`false\`。目标已存在时需要显式设为 \`true\` 才会覆盖。

工具只返回工作区虚拟路径，不会返回真实文件系统路径。保存后如果需要查看图片，可以用 \`file_tool.read\` 读取该路径；如果需要发送图片，使用 \`ema_reply(kind="image", content="返回的路径")\`。
`;

export class SaveFileTool extends Tool {
  private readonly workspace: ActorWorkspaceService;

  constructor(workspace: ActorWorkspaceService = new ActorWorkspaceService()) {
    super();
    this.workspace = workspace;
  }

  name = "save_file";

  description = SAVE_FILE_DESCRIPTION;

  parameters = SaveFileSchema.toJSONSchema();

  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    let payload: SaveFileInput;
    try {
      payload = SaveFileSchema.parse(args);
    } catch (err) {
      return {
        success: false,
        content: `Invalid save_file input: ${(err as Error).message}`,
      };
    }

    const contextError = this.validateContext(context);
    if (contextError) {
      return contextError;
    }

    try {
      const url = parseAllowedImageURL(payload.url);
      const explicitPath = payload.path
        ? normalizeImageTargetPath(payload.path)
        : undefined;
      const downloaded = await downloadImage(url);
      const hash = hashBuffer(downloaded.buffer);
      const targetPath = resolveTargetPath(
        explicitPath,
        downloaded.mimeType,
        hash,
      );
      const written = await this.workspace.writeBinaryFile(
        context!.actorId!,
        targetPath,
        downloaded.buffer,
        {
          overwrite: payload.overwrite ?? false,
          maxBytes: MEDIA_INLINE_LIMIT_BYTES,
        },
      );

      return jsonResult({
        operation: "save_file",
        path: written.path,
        mimeType: downloaded.mimeType,
        size: written.size,
        overwritten: written.overwritten,
      });
    } catch (error) {
      return {
        success: false,
        content: `Save file failed: ${sanitizeFileErrorMessage(error)}`,
      };
    }
  }

  private validateContext(context?: ToolContext): ToolResult | null {
    if (!context?.server) {
      return {
        success: false,
        content: "Missing server in save_file context.",
      };
    }
    if (typeof context.actorId !== "number") {
      return {
        success: false,
        content: "Missing actorId in save_file context.",
      };
    }
    return null;
  }
}

async function downloadImage(
  url: URL,
): Promise<{ buffer: Buffer; mimeType: ImageMIME }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    SAVE_FILE_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`URL responded with status ${response.status}.`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MEDIA_INLINE_LIMIT_BYTES
    ) {
      throw new Error(`image exceeds ${MEDIA_INLINE_LIMIT_BYTES} bytes.`);
    }

    const mimeType = resolveImageMimeType(response, url);
    if (!mimeType) {
      throw new Error("URL did not return a supported image.");
    }

    const buffer = await readLimitedResponseBody(
      response,
      MEDIA_INLINE_LIMIT_BYTES,
    );

    return { buffer, mimeType };
  } finally {
    clearTimeout(timer);
  }
}

function parseAllowedImageURL(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("url must be a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("url must use http or https.");
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error("url host is not allowed.");
  }
  return url;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.+$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    return isBlockedIPv4(host);
  }
  if (ipVersion === 6) {
    if (host.startsWith("::ffff:")) {
      const mapped = parseIPv4MappedIPv6(host);
      return mapped !== null && isBlockedIPv4(mapped);
    }
    return (
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:")
    );
  }
  return false;
}

function isBlockedIPv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function parseIPv4MappedIPv6(host: string): string | null {
  const mapped = host.slice("::ffff:".length);
  if (net.isIP(mapped) === 4) {
    return mapped;
  }

  const groups = mapped.split(":");
  if (groups.length !== 2) {
    return null;
  }
  const values = groups.map((group) => Number.parseInt(group, 16));
  if (
    values.some(
      (value) => !Number.isInteger(value) || value < 0 || value > 0xffff,
    )
  ) {
    return null;
  }

  const [high, low] = values;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function resolveImageMimeType(response: Response, url: URL): ImageMIME | null {
  const contentType = response.headers.get("content-type");
  const headerMime = normalizeImageMime(contentType);
  if (headerMime) {
    return headerMime;
  }

  const rawMime = normalizeMimeText(contentType);
  if (rawMime && rawMime !== "application/octet-stream") {
    return null;
  }
  return imageMimeTypeForPath(url.pathname);
}

function normalizeImageMime(value: string | null): ImageMIME | null {
  const mime = normalizeMimeText(value);
  const normalized = mime === "image/jpg" ? "image/jpeg" : mime;
  if (!normalized) {
    return null;
  }
  return (IMAGE_MIME_TYPES as readonly string[]).includes(normalized)
    ? (normalized as ImageMIME)
    : null;
}

function normalizeMimeText(value: string | null): string | null {
  return value?.split(";")[0]?.trim().toLowerCase() || null;
}

async function readLimitedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    const chunk = Buffer.from(value);
    totalBytes += chunk.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`image exceeds ${maxBytes} bytes.`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks, totalBytes);
}

function normalizeImageTargetPath(modelPath: string): string {
  const normalized = normalizeWorkspacePath(modelPath);
  if (!imageMimeTypeForPath(normalized)) {
    throw new Error("path must use a supported image extension.");
  }
  return normalized;
}

function resolveTargetPath(
  normalizedPath: string | undefined,
  mimeType: ImageMIME,
  sha256: string,
): string {
  if (!normalizedPath) {
    return `tmp/${sha256.slice(0, 12)}${IMAGE_EXTENSIONS[mimeType]}`;
  }

  const pathMime = imageMimeTypeForPath(normalizedPath);
  if (!pathMime) {
    throw new Error("path must use a supported image extension.");
  }
  if (pathMime !== mimeType) {
    throw new Error(
      "path image extension does not match downloaded MIME type.",
    );
  }
  return normalizedPath;
}

function jsonResult(value: unknown): ToolResult {
  return {
    success: true,
    content: JSON.stringify(value),
  };
}

function sanitizeFileErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /(?:[A-Za-z]:)?[\\/](?:[^\\/ \t\r\n"'`]+[\\/])*[^\\/ \t\r\n"'`]+/g,
    "[path]",
  );
}
