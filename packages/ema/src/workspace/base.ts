import type { ImageItem, ImageMIME } from "../llm/schema";

export type WorkspaceEntryType = "file" | "directory" | "other";

export interface ActorWorkspaceServiceOptions {
  workspaceDir?: string;
}

export interface ResolvedWorkspacePath {
  actorId: number;
  virtualPath: string;
  realPath: string;
  homeRoot: string;
  homeRootReal: string;
}

export interface ResolvedActorStickerRoot {
  actorId: number;
  actorRoot: string;
  stickerRoot: string;
  stickerRootReal: string;
}

export interface ResolveWorkspacePathOptions {
  allowRoot?: boolean;
  mustExist?: boolean;
}

export interface WorkspaceEntry {
  path: string;
  type: WorkspaceEntryType;
  size?: number;
  modifiedAt: string;
}

export interface ListFilesResult {
  operation: "list";
  path: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
}

export interface ReadFileResult {
  operation: "read";
  path: string;
  type: "text" | "image" | "binary";
  size: number;
  sha256: string;
  mimeType?: string;
  content?: string;
  truncated?: boolean;
  images?: ImageItem[];
}

export interface ReadImageDataFileResult {
  path: string;
  size: number;
  sha256: string;
  mimeType: ImageMIME;
  data: Buffer;
}

export interface WriteFileResult {
  operation: "write";
  path: string;
  mode: "overwrite" | "append";
  size: number;
  sha256: string;
}

export interface WriteBinaryFileResult {
  path: string;
  size: number;
  sha256: string;
  overwritten: boolean;
}

export interface MkdirResult {
  operation: "mkdir";
  path: string;
  created: boolean;
}

export interface MovePathResult {
  operation: "move";
  sourcePath: string;
  targetPath: string;
  type: WorkspaceEntryType;
  overwritten: boolean;
}

export type DeleteFileStatus =
  | "deleted"
  | "would_delete"
  | "not_found"
  | "rejected";

export interface DeleteFileItemResult {
  path: string;
  status: DeleteFileStatus;
  type?: WorkspaceEntryType;
  recursive?: boolean;
  reason?: string;
}

export interface DeleteFilesResult {
  operation: "delete";
  results: DeleteFileItemResult[];
}
