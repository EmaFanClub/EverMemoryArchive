import type {
  ActorLlmCheckResponse,
  ActorSettingsCheckErrorCode,
  ActorSettingsDiagnosticValue,
  ActorSettingsDiagnostics,
} from "./v1beta1";

export interface DashboardCheckFeedback {
  summary: string;
  detail: string | null;
  code: string | null;
  technicalDetail: string | null;
  meta: Array<{
    label: string;
    value: string;
  }>;
}

const actorSettingsErrorSummaries: Record<ActorSettingsCheckErrorCode, string> =
  {
    INVALID_CONFIG: "配置项还不完整",
    UNSUPPORTED: "当前模式暂不可用",
    LLM_PROVIDER_ERROR: "LLM 供应商返回错误",
    LLM_NETWORK_ERROR: "LLM 服务请求超时",
    EMBEDDING_PROVIDER_ERROR: "Embedding 供应商返回错误",
    EMBEDDING_NETWORK_ERROR: "Embedding 服务请求超时",
    CHECK_FAILED: "检查未通过",
  };

function diagnosticText(value: ActorSettingsDiagnosticValue | undefined) {
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

function technicalDetailFromDiagnostics(details: ActorSettingsDiagnostics) {
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

  return null;
}

export function actorLlmCheckFeedbackFromResponse(
  response: ActorLlmCheckResponse,
): DashboardCheckFeedback {
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
  const code = error?.code ?? "CHECK_FAILED";
  const technicalDetail =
    technicalDetailFromDiagnostics(error?.details ?? {}) ??
    technicalDetailFromDiagnostics(response.check.diagnostics);

  return {
    summary: actorSettingsErrorSummaries[code],
    detail: null,
    code,
    technicalDetail,
    meta: [{ label: "耗时", value: `${response.check.durationMs} ms` }],
  };
}

export function localDashboardFeedback(
  summary: string,
  detail: string | null,
  code = "CLIENT_VALIDATION",
): DashboardCheckFeedback {
  return {
    summary,
    detail,
    code,
    technicalDetail: null,
    meta: [],
  };
}

export function dashboardTransportFailureFeedback(
  error: unknown,
): DashboardCheckFeedback {
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
