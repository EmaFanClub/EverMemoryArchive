import type { SetupDraft, SetupStepId } from "./v1beta1";
import { fieldLabels } from "./feedback";

export type SetupFieldPath =
  | "llm.model"
  | "llm.baseUrl"
  | "llm.envKey"
  | "llm.projectEnvKey"
  | "llm.locationEnvKey"
  | "llm.credentialsEnvKey"
  | "embedding.model"
  | "embedding.baseUrl"
  | "embedding.envKey"
  | "embedding.projectEnvKey"
  | "embedding.locationEnvKey"
  | "embedding.credentialsEnvKey"
  | "owner.name"
  | "owner.qq";

export const fieldLimits: Partial<Record<SetupFieldPath, number>> = {
  "llm.model": 128,
  "llm.baseUrl": 512,
  "llm.envKey": 128,
  "llm.projectEnvKey": 128,
  "llm.locationEnvKey": 128,
  "llm.credentialsEnvKey": 128,
  "embedding.model": 128,
  "embedding.baseUrl": 512,
  "embedding.envKey": 128,
  "embedding.projectEnvKey": 128,
  "embedding.locationEnvKey": 128,
  "embedding.credentialsEnvKey": 128,
  "owner.name": 48,
  "owner.qq": 12,
};

const qqPattern = /^[1-9]\d{4,11}$/;
const envKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

function validateEnvKey(value: string, path: SetupFieldPath) {
  if (!envKeyPattern.test(value.trim())) {
    return `${fieldName(path)}只能包含字母、数字、下划线，且不能以数字开头。`;
  }
  return null;
}

export function getFieldValue(path: SetupFieldPath, draft: SetupDraft) {
  switch (path) {
    case "llm.model":
      return draft.llm.model;
    case "llm.baseUrl":
      return draft.llm.baseUrl;
    case "llm.envKey":
      return draft.llm.envKey;
    case "llm.projectEnvKey":
      return draft.llm.projectEnvKey;
    case "llm.locationEnvKey":
      return draft.llm.locationEnvKey;
    case "llm.credentialsEnvKey":
      return draft.llm.credentialsEnvKey;
    case "embedding.model":
      return draft.embedding.model;
    case "embedding.baseUrl":
      return draft.embedding.baseUrl;
    case "embedding.envKey":
      return draft.embedding.envKey;
    case "embedding.projectEnvKey":
      return draft.embedding.projectEnvKey;
    case "embedding.locationEnvKey":
      return draft.embedding.locationEnvKey;
    case "embedding.credentialsEnvKey":
      return draft.embedding.credentialsEnvKey;
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
        ? [
            "llm.model",
            "llm.projectEnvKey",
            "llm.locationEnvKey",
            "llm.credentialsEnvKey",
          ]
        : ["llm.model", "llm.baseUrl", "llm.envKey"];
    case "embedding":
      return draft.embedding.provider === "google" &&
        draft.embedding.useVertexAi
        ? [
            "embedding.model",
            "embedding.projectEnvKey",
            "embedding.locationEnvKey",
            "embedding.credentialsEnvKey",
          ]
        : ["embedding.model", "embedding.baseUrl", "embedding.envKey"];
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
    case "llm.envKey":
    case "llm.projectEnvKey":
    case "llm.locationEnvKey":
    case "llm.credentialsEnvKey":
    case "embedding.envKey":
    case "embedding.projectEnvKey":
    case "embedding.locationEnvKey":
    case "embedding.credentialsEnvKey":
      return validateEnvKey(value, path);
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
    case "embedding.model":
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
