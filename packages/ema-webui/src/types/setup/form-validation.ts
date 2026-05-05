import {
  VERTEX_CREDENTIALS_JSON_LIMIT,
  type SetupDraft,
  type SetupStepId,
} from "./v1beta1";
import { fieldLabels } from "./feedback";

export type SetupFieldPath =
  | "llm.model"
  | "llm.baseUrl"
  | "llm.apiKey"
  | "llm.project"
  | "llm.location"
  | "llm.credentialsFile"
  | "embedding.model"
  | "embedding.baseUrl"
  | "embedding.apiKey"
  | "embedding.project"
  | "embedding.location"
  | "embedding.credentialsFile"
  | "owner.name"
  | "owner.qq";

export const fieldLimits: Partial<Record<SetupFieldPath, number>> = {
  "llm.model": 128,
  "llm.baseUrl": 512,
  "llm.apiKey": 512,
  "llm.project": 128,
  "llm.location": 128,
  "llm.credentialsFile": VERTEX_CREDENTIALS_JSON_LIMIT,
  "embedding.model": 128,
  "embedding.baseUrl": 512,
  "embedding.apiKey": 512,
  "embedding.project": 128,
  "embedding.location": 128,
  "embedding.credentialsFile": VERTEX_CREDENTIALS_JSON_LIMIT,
  "owner.name": 48,
  "owner.qq": 12,
};

const qqPattern = /^[1-9]\d{4,11}$/;

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function fieldName(path: SetupFieldPath) {
  return fieldLabels[path] ?? path;
}

function required(value: string, path: SetupFieldPath) {
  return value.trim() ? null : `请填写${fieldName(path)}。`;
}

function maxLength(value: string, path: SetupFieldPath) {
  const limit = fieldLimits[path];
  if (!limit || value.trim().length <= limit) {
    return null;
  }
  return `${fieldName(path)}不能超过 ${limit} 个字符。`;
}

function validateHttpUrl(value: string, path: SetupFieldPath) {
  if (!isHttpUrl(value.trim())) {
    return `${fieldName(path)}需要是 http 或 https 地址。`;
  }
  return null;
}

function validateJsonObject(value: string, path: SetupFieldPath) {
  try {
    const parsed = JSON.parse(value.trim());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return `${fieldName(path)}需要是有效的 JSON 对象。`;
    }
  } catch {
    return `${fieldName(path)}需要是有效的 JSON 对象。`;
  }
  return null;
}

export function getFieldValue(path: SetupFieldPath, draft: SetupDraft) {
  switch (path) {
    case "llm.model":
      return draft.llm.model;
    case "llm.baseUrl":
      return draft.llm.baseUrl;
    case "llm.apiKey":
      return draft.llm.apiKey;
    case "llm.project":
      return draft.llm.project;
    case "llm.location":
      return draft.llm.location;
    case "llm.credentialsFile":
      return draft.llm.credentialsFile;
    case "embedding.model":
      return draft.embedding.model;
    case "embedding.baseUrl":
      return draft.embedding.baseUrl;
    case "embedding.apiKey":
      return draft.embedding.apiKey;
    case "embedding.project":
      return draft.embedding.project;
    case "embedding.location":
      return draft.embedding.location;
    case "embedding.credentialsFile":
      return draft.embedding.credentialsFile;
    case "owner.name":
      return draft.owner.name;
    case "owner.qq":
      return draft.owner.qq;
  }
}

export function getStepFieldPaths(
  stepId: SetupStepId,
  draft: SetupDraft,
): SetupFieldPath[] {
  switch (stepId) {
    case "llm":
      if (
        draft.llm.provider === "anthropic" ||
        (draft.llm.provider === "openai" && draft.llm.mode !== "responses")
      ) {
        return [];
      }
      return draft.llm.provider === "google" && draft.llm.useVertexAi
        ? ["llm.model", "llm.project", "llm.location", "llm.credentialsFile"]
        : ["llm.model", "llm.baseUrl", "llm.apiKey"];
    case "embedding":
      return draft.embedding.provider === "google" &&
        draft.embedding.useVertexAi
        ? [
            "embedding.model",
            "embedding.project",
            "embedding.location",
            "embedding.credentialsFile",
          ]
        : ["embedding.model", "embedding.baseUrl", "embedding.apiKey"];
    case "owner":
      return ["owner.name", "owner.qq"];
    case "review":
      return [];
  }
}

export function validateSetupField(path: SetupFieldPath, draft: SetupDraft) {
  const value = getFieldValue(path, draft);
  const optional = path === "owner.qq";

  if (!optional) {
    const requiredError = required(value, path);
    if (requiredError) {
      return requiredError;
    }
  } else if (!value.trim()) {
    return null;
  }

  const lengthError = maxLength(value, path);
  if (lengthError) {
    return lengthError;
  }

  switch (path) {
    case "llm.baseUrl":
    case "embedding.baseUrl":
      return validateHttpUrl(value, path);
    case "llm.credentialsFile":
    case "embedding.credentialsFile":
      return validateJsonObject(value, path);
    case "owner.name":
      if (/\r|\n/.test(value)) {
        return "名称不能包含换行。";
      }
      return null;
    case "owner.qq":
      if (!qqPattern.test(value.trim())) {
        return "QQ 号需要是 5 到 12 位数字，且不能以 0 开头。";
      }
      return null;
    case "llm.model":
    case "llm.apiKey":
    case "llm.project":
    case "llm.location":
    case "embedding.model":
    case "embedding.apiKey":
    case "embedding.project":
    case "embedding.location":
      return null;
  }
}

export function getStepValidationErrors(
  stepId: SetupStepId,
  draft: SetupDraft,
) {
  return getStepFieldPaths(stepId, draft).flatMap((path) => {
    const error = validateSetupField(path, draft);
    return error ? [{ path, error }] : [];
  });
}
