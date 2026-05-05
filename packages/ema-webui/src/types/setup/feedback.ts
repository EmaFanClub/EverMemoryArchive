import type {
  SetupCheckErrorCode,
  SetupDiagnosticValue,
  SetupDiagnostics,
  SetupDryRunResponse,
  SetupServiceCheckResponse,
  SetupValidationIssue,
} from "./v1beta1";

export interface CheckFeedback {
  summary: string;
  detail: string | null;
  code: string | null;
  technicalDetail: string | null;
  meta: Array<{
    label: string;
    value: string;
  }>;
}

const errorSummaries: Record<SetupCheckErrorCode, string> = {
  INVALID_CONFIG: "配置项还不完整",
  UNSUPPORTED: "当前模式暂不可用",
  LLM_PROVIDER_ERROR: "LLM 供应商返回错误",
  LLM_NETWORK_ERROR: "LLM 服务请求超时",
  EMBEDDING_PROVIDER_ERROR: "Embedding 供应商返回错误",
  EMBEDDING_NETWORK_ERROR: "Embedding 服务请求超时",
  CHECK_FAILED: "检查未通过",
};

export const fieldLabels: Record<string, string> = {
  llm: "LLM 服务配置",
  "llm.provider": "LLM 供应商",
  "llm.model": "LLM 模型名称",
  "llm.baseUrl": "LLM Base URL",
  "llm.apiKey": "LLM ApiKey",
  "llm.project": "LLM Vertex AI 项目",
  "llm.location": "LLM Vertex AI 区域",
  "llm.credentialsFile": "LLM Vertex AI 凭据 JSON",
  embedding: "Embedding 服务配置",
  "embedding.model": "Embedding 模型名称",
  "embedding.baseUrl": "Embedding Base URL",
  "embedding.apiKey": "Embedding ApiKey",
  "embedding.project": "Embedding Vertex AI 项目",
  "embedding.location": "Embedding Vertex AI 区域",
  "embedding.credentialsFile": "Embedding Vertex AI 凭据 JSON",
  "owner.name": "名称",
  "owner.accessToken": "访问 Token",
  "owner.qq": "QQ 号",
};

function diagnosticText(
  value: SetupDiagnosticValue | undefined,
): string | null {
  if (Array.isArray(value)) {
    const text = value.map(String).filter(Boolean).join("、");
    return text || null;
  }
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function diagnosticList(value: SetupDiagnosticValue | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }
  const text = diagnosticText(value);
  return text ? [text] : [];
}

export function formatFieldPath(path: string) {
  return fieldLabels[path] ?? path;
}

function validationDetailFromIssues(issues: SetupValidationIssue[]) {
  if (issues.length === 0) {
    return null;
  }

  const unsupported = issues.filter((issue) => issue.code === "unsupported");
  if (unsupported.length > 0) {
    return `暂不可用：${unsupported
      .map((issue) => formatFieldPath(issue.path))
      .join("、")}`;
  }

  return `涉及字段：${issues
    .map((issue) => formatFieldPath(issue.path))
    .join("、")}`;
}

function validationDetailFromDiagnostics(details: SetupDiagnostics) {
  const paths = diagnosticList(details.issuePaths);
  if (paths.length === 0) {
    return null;
  }

  return `涉及字段：${paths.map(formatFieldPath).join("、")}`;
}

function technicalDetailFromDiagnostics(details: SetupDiagnostics) {
  const driverName = diagnosticText(details.driverErrorName);
  const driverMessage = diagnosticText(details.driverErrorMessage);
  if (driverName || driverMessage) {
    return [driverName, driverMessage].filter(Boolean).join(" · ");
  }

  const httpStatus = diagnosticText(details.httpStatus);
  const providerType = diagnosticText(details.providerErrorType);
  const providerCode = diagnosticText(details.providerErrorCode);
  const providerMessage = diagnosticText(details.providerErrorMessage);
  if (httpStatus || providerType || providerCode || providerMessage) {
    return [
      httpStatus ? `HTTP ${httpStatus}` : null,
      providerType,
      providerCode,
      providerMessage,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const networkName = diagnosticText(details.networkErrorName);
  const networkMessage = diagnosticText(details.networkErrorMessage);
  if (networkName || networkMessage) {
    return [networkName, networkMessage].filter(Boolean).join(" · ");
  }

  return validationDetailFromDiagnostics(details);
}

export function checkFeedbackFromResponse(
  response: SetupServiceCheckResponse,
): CheckFeedback {
  if (response.ok) {
    return {
      summary: "检查通过",
      detail: null,
      code: null,
      technicalDetail: null,
      meta: [{ label: "耗时", value: `${response.check.durationMs} ms` }],
    };
  }

  const error = response.check.error;
  const details = error?.details ?? {};
  const code = error?.code ?? "CHECK_FAILED";
  const technicalDetail =
    technicalDetailFromDiagnostics(details) ??
    technicalDetailFromDiagnostics(response.check.diagnostics);

  return {
    summary: errorSummaries[code],
    detail: null,
    code,
    technicalDetail,
    meta: [{ label: "耗时", value: `${response.check.durationMs} ms` }],
  };
}

export function localFeedback(
  summary: string,
  detail: string | null,
  code = "CLIENT_VALIDATION",
): CheckFeedback {
  return {
    summary,
    detail,
    code,
    technicalDetail: null,
    meta: [],
  };
}

export function transportFailureFeedback(error: unknown): CheckFeedback {
  return {
    summary: "请求异常",
    detail:
      error instanceof Error && error.message
        ? error.message
        : "请求没有返回可解析的错误信息。",
    code: "REQUEST_FAILED",
    technicalDetail: null,
    meta: [],
  };
}

export function dryRunFailureFeedback(
  result: SetupDryRunResponse,
): CheckFeedback {
  const detail =
    validationDetailFromIssues(result.validation.issues) ??
    "配置生成计划被服务端标记为 blocked。";

  return {
    summary: "配置生成计划未就绪",
    detail,
    code: "DRY_RUN_BLOCKED",
    technicalDetail: null,
    meta: [
      { label: "状态", value: result.status },
      { label: "问题数", value: String(result.validation.issues.length) },
    ],
  };
}
