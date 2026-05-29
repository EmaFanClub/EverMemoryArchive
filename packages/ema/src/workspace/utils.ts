import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { ImageMIME } from "../llm/schema";
import type { WorkspaceEntryType } from "./base";

export function normalizeWorkspacePath(modelPath: string): string {
  if (typeof modelPath !== "string") {
    throw new Error("path must be a string.");
  }
  if (modelPath.length === 0) {
    throw new Error("path must not be empty.");
  }
  if (modelPath.includes("\0")) {
    throw new Error("path must not contain NUL characters.");
  }
  if (modelPath.includes("\\")) {
    throw new Error("path must not contain backslashes.");
  }
  if (modelPath.includes("~")) {
    throw new Error("path must not contain '~'.");
  }
  if (modelPath === "/" || modelPath === "." || modelPath === "./") {
    return ".";
  }
  if (modelPath.includes("//")) {
    throw new Error("path must not contain repeated slashes.");
  }

  let normalized = modelPath;
  if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  } else if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  if (normalized.length === 0) {
    return ".";
  }

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new Error("path must not contain empty segments.");
    }
    if (segment === "." || segment === "..") {
      throw new Error("path must not contain '.' or '..' segments.");
    }
  }
  return segments.join("/");
}

export function joinVirtualPath(parent: string, child: string): string {
  return parent === "." ? child : `${parent}/${child}`;
}

export function workspaceEntryType(
  stat: Awaited<ReturnType<typeof fs.lstat>>,
): WorkspaceEntryType {
  if (stat.isDirectory()) {
    return "directory";
  }
  if (stat.isFile()) {
    return "file";
  }
  return "other";
}

export function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return hash.digest("hex");
}

export async function scanFile(
  filePath: string,
  maxPrefixBytes: number,
): Promise<{ sha256: string; prefix: Buffer; isUtf8: boolean }> {
  const hash = crypto.createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: Buffer[] = [];
  let collectedBytes = 0;
  let isUtf8 = true;

  for await (const rawChunk of createReadStream(filePath)) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    hash.update(chunk);

    if (isUtf8) {
      try {
        decoder.decode(chunk, { stream: true });
      } catch {
        isUtf8 = false;
      }
    }

    if (collectedBytes < maxPrefixBytes) {
      const remainingBytes = maxPrefixBytes - collectedBytes;
      const prefixChunk = chunk.subarray(0, remainingBytes);
      chunks.push(prefixChunk);
      collectedBytes += prefixChunk.byteLength;
    }
  }

  if (isUtf8) {
    try {
      decoder.decode();
    } catch {
      isUtf8 = false;
    }
  }

  return {
    sha256: hash.digest("hex"),
    prefix: Buffer.concat(chunks),
    isUtf8,
  };
}

export function decodeUtf8Prefix(buffer: Buffer): string {
  const minLength = Math.max(0, buffer.length - 3);
  for (let length = buffer.length; length >= minLength; length -= 1) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, length),
      );
    } catch {
      // A valid UTF-8 file can be truncated in the middle of one code point.
    }
  }
  return "";
}

export function imageMimeTypeForPath(filePath: string): ImageMIME | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    default:
      return null;
  }
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function workspacePathsConflict(left: string, right: string): boolean {
  return (
    left === "." ||
    right === "." ||
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}
