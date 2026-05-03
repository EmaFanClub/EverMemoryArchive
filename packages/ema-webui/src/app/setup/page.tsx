"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

import { APP_VERSION_BADGE } from "@/app-version";
import {
  embeddingDefaults,
  initialDraft,
  isStepComplete,
  llmDefaults,
  setupSteps,
  type SetupDraft,
  type SetupServiceCheckResponse,
  type SetupStepId,
} from "@/types/setup/v1beta1";
import { commitSetup, runSetupCheck, runSetupDryRun } from "@/transport/setup";
import {
  checkFeedbackFromResponse,
  dryRunFailureFeedback,
  localFeedback,
  transportFailureFeedback,
  type CheckFeedback,
} from "@/types/setup/feedback";
import { getOwnerStatus } from "@/transport/auth";
import {
  fieldLimits,
  getStepFieldPaths,
  getStepValidationErrors,
  validateSetupField,
  type SetupFieldPath,
} from "@/types/setup/form-validation";

type StepMotion = "forward" | "backward";
type TestStatus = "idle" | "testing" | "success" | "failed";
type FinalCheckStatus =
  | "idle"
  | "llm"
  | "embedding"
  | "finalize"
  | "success"
  | "failed";
type FinalReviewStepId = Exclude<
  FinalCheckStatus,
  "idle" | "success" | "failed"
>;
type FinalFailedStepId = FinalReviewStepId;
type PrimaryFeedback = "success" | "failed" | null;

interface TestState {
  status: TestStatus;
  feedback: CheckFeedback | null;
}

const llmModelOptions: Record<SetupDraft["llm"]["provider"], string[]> = {
  google: ["gemini-3.1-flash-lite-preview", "gemini-3.1-pro-preview"],
  openai: [],
  anthropic: [],
};

const embeddingModelOptions: Record<
  SetupDraft["embedding"]["provider"],
  string[]
> = {
  google: ["gemini-embedding-001"],
  openai: ["text-embedding-3-large"],
};

const finalReviewSteps: Array<{
  id: FinalReviewStepId;
  title: string;
}> = [
  { id: "llm", title: "默认 LLM" },
  { id: "embedding", title: "默认 Embedding" },
  { id: "finalize", title: "生成配置" },
];

const finalStepOrder: Record<FinalReviewStepId, number> = {
  llm: 0,
  embedding: 1,
  finalize: 2,
};

const DASHBOARD_FIRST_LOGIN_STORAGE_KEY = "ema-webui-dashboard-first-login-v1";

function trimTerminalPunctuation(value: string | null) {
  return value?.replace(/[。.!！?？]+$/u, "") ?? null;
}

function testStateFromCheck(response: SetupServiceCheckResponse): TestState {
  return {
    status: response.ok ? "success" : "failed",
    feedback: checkFeedbackFromResponse(response),
  };
}

function Field({
  label,
  hint,
  error,
  optional = false,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        <span
          className={optional ? styles.optionalMarker : styles.requiredMarker}
        >
          {optional ? "可选" : "必填"}
        </span>
      </span>
      {children}
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
      {error ? (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function ModelSelect({
  value,
  options,
  error,
  onChange,
  onBlur,
}: {
  value: string;
  options: string[];
  error?: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={styles.modelSelect}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          nextTarget instanceof Node &&
          event.currentTarget.contains(nextTarget)
        ) {
          return;
        }
        setOpen(false);
        onBlur();
      }}
    >
      <button
        type="button"
        className={`${styles.modelSelectButton} ${
          !value ? styles.modelSelectPlaceholder : ""
        } ${open ? styles.modelSelectButtonOpen : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-invalid={error ? "true" : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            event.currentTarget.blur();
          }
        }}
      >
        <span>{value || "选择模型"}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div
          className={styles.modelSelectMenu}
          role="listbox"
          aria-label="选择模型"
        >
          {options.map((model) => (
            <button
              key={model}
              type="button"
              role="option"
              aria-selected={value === model}
              className={`${styles.modelSelectOption} ${
                value === model ? styles.modelSelectOptionActive : ""
              }`}
              onClick={() => {
                onChange(model);
                setOpen(false);
              }}
            >
              <span>{model}</span>
              {value === model ? <Check aria-hidden="true" /> : null}
            </button>
          ))}
          <span
            className={`${styles.modelSelectOption} ${styles.modelSelectOptionDisabled}`}
            role="option"
            aria-selected="false"
            aria-disabled="true"
          >
            <span>更多模型敬请期待</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function CheckFeedbackDetails({
  feedback,
}: {
  feedback: CheckFeedback | null;
}) {
  if (
    !feedback ||
    (!feedback.detail &&
      !feedback.technicalDetail &&
      !feedback.code &&
      feedback.meta.length === 0)
  ) {
    return null;
  }

  return (
    <div className={styles.errorDetails} role="alert">
      <div className={styles.errorDetailsHeader}>
        <span>错误</span>
        {feedback.code ? <code>{feedback.code}</code> : null}
      </div>
      {feedback.detail ? (
        <p className={styles.errorDetailText}>{feedback.detail}</p>
      ) : null}
      {feedback.technicalDetail ? (
        <div className={styles.errorTechnicalCard}>
          {feedback.technicalDetail}
        </div>
      ) : null}
      {feedback.meta.length > 0 ? (
        <dl className={styles.errorMeta}>
          {feedback.meta.map((item) => (
            <div key={`${item.label}:${item.value}`}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function ServiceTestButton({
  status,
  disabled,
  onClick,
}: {
  status: TestStatus;
  disabled?: boolean;
  onClick: () => void;
}) {
  const isTesting = status === "testing";
  const label =
    status === "testing"
      ? "正在测试连接"
      : status === "success"
        ? "连接正常"
        : status === "failed"
          ? "重新测试连接"
          : "测试连接状态";

  return (
    <button
      type="button"
      className={`${styles.serviceTestButton} ${
        status === "success" ? styles.serviceTestButtonSuccess : ""
      } ${status === "failed" ? styles.serviceTestButtonFailed : ""}`}
      disabled={disabled || isTesting}
      onClick={onClick}
      aria-live="polite"
    >
      {isTesting ? (
        <LoaderCircle aria-hidden="true" />
      ) : status === "success" ? (
        <Check aria-hidden="true" />
      ) : status === "failed" ? (
        <X aria-hidden="true" />
      ) : null}
      <span>{label}</span>
    </button>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const stepErrorRef = useRef<HTMLDivElement | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepMotion, setStepMotion] = useState<StepMotion>("forward");
  const [draft, setDraft] = useState<SetupDraft>(initialDraft);
  const [touchedFields, setTouchedFields] = useState<
    Partial<Record<SetupFieldPath, boolean>>
  >({});
  const llmTestRun = useRef(0);
  const embeddingTestRun = useRef(0);
  const [llmTest, setLlmTest] = useState<TestState>({
    status: "idle",
    feedback: null,
  });
  const [embeddingTest, setEmbeddingTest] = useState<TestState>({
    status: "idle",
    feedback: null,
  });
  const [finalCheck, setFinalCheck] = useState<FinalCheckStatus>("idle");
  const [finalFailedStep, setFinalFailedStep] =
    useState<FinalFailedStepId | null>(null);
  const [finalFeedback, setFinalFeedback] = useState<CheckFeedback | null>(
    null,
  );
  const [finalAttempt, setFinalAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [primaryFeedback, setPrimaryFeedback] = useState<PrimaryFeedback>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const step = setupSteps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === setupSteps.length - 1;
  const isFinalTesting =
    finalCheck === "llm" ||
    finalCheck === "embedding" ||
    finalCheck === "finalize";
  const currentStepComplete = isStepComplete(step.id, draft);
  const currentStepErrors = getStepValidationErrors(step.id, draft);
  const currentStepValid = currentStepErrors.length === 0;
  const currentStepNeedsManualCheck =
    (step.id === "llm" && llmTest.status !== "success") ||
    (step.id === "embedding" && embeddingTest.status !== "success");
  const finalProgress =
    finalCheck === "success"
      ? "66.666%"
      : finalCheck === "failed"
        ? finalFailedStep === "finalize"
          ? "66.666%"
          : finalFailedStep === "embedding"
            ? "33.333%"
            : "0%"
        : finalCheck === "embedding"
          ? "33.333%"
          : finalCheck === "llm"
            ? "6%"
            : finalCheck === "finalize"
              ? "66.666%"
              : "0%";
  const finalTrackStyle = {
    "--final-progress": finalProgress,
    "--final-line-background":
      finalCheck === "success" || finalCheck === "failed"
        ? "var(--success)"
        : finalCheck === "finalize"
          ? "linear-gradient(90deg, var(--success) 0 50%, var(--accent) 50% 100%)"
          : finalCheck === "embedding"
            ? "linear-gradient(90deg, var(--success) 0 50%, var(--accent) 50% 100%)"
            : "var(--accent)",
    "--final-line-shadow":
      finalCheck === "success" || finalCheck === "failed"
        ? "color-mix(in srgb, var(--success) 20%, transparent)"
        : "color-mix(in srgb, var(--accent) 20%, transparent)",
  } as CSSProperties;
  const getFinalStepState = (
    id: (typeof finalReviewSteps)[number]["id"],
  ): "pending" | "testing" | "done" | "failed" => {
    if (finalCheck === "failed") {
      if (id === finalFailedStep) {
        return "failed";
      }
      if (
        finalFailedStep &&
        finalStepOrder[id] < finalStepOrder[finalFailedStep]
      ) {
        return "done";
      }
      return "pending";
    }
    if (finalCheck === "success") {
      return "done";
    }
    if (finalCheck === id) {
      return "testing";
    }
    if (
      finalCheck !== "idle" &&
      finalStepOrder[id] < finalStepOrder[finalCheck]
    ) {
      return "done";
    }
    return "pending";
  };
  const primaryDisabled =
    busy ||
    primaryFeedback !== null ||
    !currentStepComplete ||
    !currentStepValid ||
    currentStepNeedsManualCheck ||
    (step.id === "review" &&
      finalCheck !== "success" &&
      finalCheck !== "failed");
  const actionHint = getActionHint();
  const displayActionHint = trimTerminalPunctuation(actionHint);

  function scrollStepErrorIntoView() {
    window.requestAnimationFrame(() => {
      stepErrorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  function renderPrimaryButtonContent() {
    if (primaryFeedback === "success") {
      return <Check aria-label="检查通过" />;
    }
    if (primaryFeedback === "failed") {
      return <X aria-label="检查失败" />;
    }
    if (busy) {
      return <LoaderCircle aria-label="检查中" />;
    }
    if (isLastStep && finalCheck === "failed") {
      return "重新检查";
    }
    if (isLastStep) {
      return "开始使用";
    }
    return "下一步";
  }

  useEffect(() => {
    let cancelled = false;

    const redirectIfSetupDone = async () => {
      try {
        const status = await getOwnerStatus();
        if (!cancelled && status.ownerReady) {
          router.replace("/dashboard");
        }
      } catch {
        // Setup should remain reachable if status cannot be resolved.
      }
    };

    void redirectIfSetupDone();

    const handlePageShow = () => {
      void redirectIfSetupDone();
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [router]);

  useEffect(() => {
    if (
      setupSteps[currentStep].id !== "review" ||
      !isStepComplete("review", draft)
    ) {
      return;
    }

    let cancelled = false;

    const runFinalCheck = async () => {
      setBusy(true);
      setFinalFailedStep(null);
      setFinalFeedback(null);
      setNotice(null);

      try {
        setFinalCheck("finalize");
        const result = await runSetupDryRun(draft);
        if (!result.ok) {
          setFinalFailedStep("finalize");
          setFinalFeedback(dryRunFailureFeedback(result));
          setFinalCheck("failed");
          return;
        }
        if (cancelled) {
          return;
        }

        setFinalFailedStep(null);
        setFinalCheck("success");
      } catch (error) {
        if (!cancelled) {
          setFinalCheck("failed");
          setFinalFeedback(transportFailureFeedback(error));
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    };

    void runFinalCheck();

    return () => {
      cancelled = true;
    };
  }, [currentStep, draft, finalAttempt]);

  function touchField(path: SetupFieldPath) {
    setTouchedFields((current) => ({ ...current, [path]: true }));
  }

  function touchStepFields(stepId: SetupStepId = step.id) {
    const paths = getStepFieldPaths(stepId, draft);
    if (paths.length === 0) {
      return;
    }
    setTouchedFields((current) => {
      const next = { ...current };
      for (const path of paths) {
        next[path] = true;
      }
      return next;
    });
  }

  function getVisibleFieldError(path: SetupFieldPath) {
    return touchedFields[path] ? validateSetupField(path, draft) : null;
  }

  function getFieldControlProps(path: SetupFieldPath) {
    const error = getVisibleFieldError(path);
    return {
      maxLength: fieldLimits[path],
      onBlur: () => touchField(path),
      "aria-invalid": error ? true : undefined,
    };
  }

  function renderModelSelectField({
    path,
    value,
    options,
    onChange,
  }: {
    path: Extract<SetupFieldPath, "llm.model" | "embedding.model">;
    value: string;
    options: string[];
    onChange: (value: string) => void;
  }) {
    const error = getVisibleFieldError(path);

    return (
      <div className={styles.field}>
        <span className={styles.fieldLabel}>
          模型
          <span className={styles.requiredMarker}>必填</span>
        </span>
        <ModelSelect
          value={value}
          options={options}
          error={error}
          onChange={onChange}
          onBlur={() => touchField(path)}
        />
        {error ? (
          <span className={styles.fieldError} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  function getActionHint() {
    if (busy || isFinalTesting) {
      return "正在检查配置…";
    }

    if (currentStepErrors[0]) {
      return currentStepErrors[0].error;
    }

    if (!currentStepComplete) {
      if (step.id === "llm") {
        return "当前 LLM 供应商或模式暂未开放。";
      }
      return "请先完成当前步骤的必填项。";
    }

    if (step.id === "llm" && llmTest.status !== "success") {
      if (llmTest.status === "testing") {
        return "正在测试默认 LLM 服务…";
      }
      return llmTest.status === "failed"
        ? "请处理错误后重新测试默认 LLM 服务。"
        : "请先测试默认 LLM 服务连接。";
    }
    if (step.id === "embedding" && embeddingTest.status !== "success") {
      if (embeddingTest.status === "testing") {
        return "正在测试默认 Embedding 服务…";
      }
      return embeddingTest.status === "failed"
        ? "请处理错误后重新测试默认 Embedding 服务。"
        : "请先测试默认 Embedding 服务连接。";
    }
    if (
      step.id === "review" &&
      finalCheck !== "success" &&
      finalCheck !== "failed"
    ) {
      return "正在检查配置…";
    }

    return null;
  }

  const resetLlmTest = () => {
    llmTestRun.current += 1;
    setLlmTest({ status: "idle", feedback: null });
  };

  const resetEmbeddingTest = () => {
    embeddingTestRun.current += 1;
    setEmbeddingTest({ status: "idle", feedback: null });
  };

  const updateLlm = (value: Partial<SetupDraft["llm"]>) => {
    setDraft((current) => ({
      ...current,
      llm: { ...current.llm, ...value },
    }));
    setFinalCheck("idle");
    setFinalFailedStep(null);
    setFinalFeedback(null);
    resetLlmTest();
  };

  const updateEmbedding = (value: Partial<SetupDraft["embedding"]>) => {
    setDraft((current) => ({
      ...current,
      embedding: { ...current.embedding, ...value },
    }));
    setFinalCheck("idle");
    setFinalFailedStep(null);
    setFinalFeedback(null);
    resetEmbeddingTest();
  };

  const updateOwner = (value: Partial<SetupDraft["owner"]>) => {
    setDraft((current) => ({
      ...current,
      owner: { ...current.owner, ...value },
    }));
    setFinalCheck("idle");
    setFinalFailedStep(null);
    setFinalFeedback(null);
  };

  const testLlmService = async () => {
    if (
      draft.llm.provider === "anthropic" ||
      (draft.llm.provider === "openai" && draft.llm.mode !== "responses")
    ) {
      setLlmTest({
        status: "failed",
        feedback: localFeedback(
          "当前模式暂不可用",
          "涉及字段：LLM 供应商",
          "UNSUPPORTED",
        ),
      });
      return false;
    }

    const errors = getStepValidationErrors("llm", draft);
    if (errors[0]) {
      touchStepFields("llm");
      setLlmTest({
        status: "failed",
        feedback: localFeedback("配置项还不完整", errors[0].error),
      });
      return false;
    }

    const runId = ++llmTestRun.current;
    setLlmTest({ status: "testing", feedback: null });
    try {
      const response = await runSetupCheck("llm", draft.llm, "step", runId);
      if (runId !== llmTestRun.current) {
        return false;
      }
      setLlmTest(testStateFromCheck(response));
      return response.ok;
    } catch (error) {
      if (runId !== llmTestRun.current) {
        return false;
      }
      setLlmTest({
        status: "failed",
        feedback: transportFailureFeedback(error),
      });
      return false;
    }
  };

  const testEmbeddingService = async () => {
    const errors = getStepValidationErrors("embedding", draft);
    if (errors[0]) {
      touchStepFields("embedding");
      setEmbeddingTest({
        status: "failed",
        feedback: localFeedback("配置项还不完整", errors[0].error),
      });
      return false;
    }

    const runId = ++embeddingTestRun.current;
    setEmbeddingTest({ status: "testing", feedback: null });
    try {
      const response = await runSetupCheck(
        "embedding",
        draft.embedding,
        "step",
        runId,
      );
      if (runId !== embeddingTestRun.current) {
        return false;
      }
      setEmbeddingTest(testStateFromCheck(response));
      return response.ok;
    } catch (error) {
      if (runId !== embeddingTestRun.current) {
        return false;
      }
      setEmbeddingTest({
        status: "failed",
        feedback: transportFailureFeedback(error),
      });
      return false;
    }
  };

  const goNext = async () => {
    if (!currentStepComplete || currentStepErrors.length > 0) {
      touchStepFields();
      setNotice(currentStepErrors[0]?.error ?? "请先完成必填项。");
      return;
    }

    setPrimaryFeedback(null);

    if (step.id === "llm" && llmTest.status !== "success") {
      touchStepFields("llm");
      setNotice("请先测试默认 LLM 服务连接。");
      return;
    }
    if (step.id === "embedding" && embeddingTest.status !== "success") {
      touchStepFields("embedding");
      setNotice("请先测试默认 Embedding 服务连接。");
      return;
    }

    if (!isLastStep) {
      setStepMotion("forward");
      setCurrentStep((value) => Math.min(value + 1, setupSteps.length - 1));
      setFinalCheck("idle");
      setFinalFailedStep(null);
      setFinalFeedback(null);
      setPrimaryFeedback(null);
      setNotice(null);
      return;
    }

    if (finalCheck === "failed") {
      setFinalAttempt((value) => value + 1);
      setFinalFeedback(null);
      setPrimaryFeedback(null);
      setNotice(null);
      return;
    }

    if (finalCheck === "success") {
      setBusy(true);
      setNotice(null);
      try {
        const result = await commitSetup(draft);
        if (!result.ok) {
          setFinalCheck("failed");
          setFinalFailedStep("finalize");
          setFinalFeedback(
            localFeedback("写入配置失败", "请稍后重试。", "COMMIT_FAILED"),
          );
          return;
        }
        window.localStorage.clear();
        window.sessionStorage.setItem(DASHBOARD_FIRST_LOGIN_STORAGE_KEY, "1");
        router.replace("/dashboard");
      } catch (error) {
        setFinalCheck("failed");
        setFinalFailedStep("finalize");
        setFinalFeedback(transportFailureFeedback(error));
      } finally {
        setBusy(false);
      }
      return;
    }

    setNotice(null);
  };

  const goBack = () => {
    if (isFinalTesting) {
      return;
    }

    setStepMotion("backward");
    setCurrentStep((value) => Math.max(value - 1, 0));
    setFinalCheck("idle");
    setFinalFailedStep(null);
    setFinalFeedback(null);
    setPrimaryFeedback(null);
    setNotice(null);
  };

  return (
    <main className={styles.shell}>
      <div className={styles.ambient} />
      <header className={styles.topbar}>
        <div>
          <span className={styles.eyebrow}>EMA WebUI</span>
          <h1>初始化配置</h1>
        </div>
        <span className={styles.versionBadge}>{APP_VERSION_BADGE}</span>
      </header>

      <section className={styles.setupFrame}>
        <aside className={styles.stepRail} aria-label="初始化步骤">
          <ol className={styles.stepList}>
            {setupSteps.map((item, index) => {
              const state =
                index < currentStep
                  ? "done"
                  : index === currentStep
                    ? "current"
                    : "queued";
              return (
                <li
                  key={item.id}
                  className={`${styles.stepItem} ${styles[state]}`}
                  aria-current={index === currentStep ? "step" : undefined}
                >
                  <span className={styles.stepDot} />
                  <span className={styles.stepText}>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                </li>
              );
            })}
          </ol>
        </aside>

        <section className={styles.contentPanel}>
          <div
            key={step.id}
            className={`${styles.stepStage} ${styles[stepMotion]}`}
          >
            <div className={styles.stepHeader}>
              <span>{String(currentStep + 1).padStart(2, "0")}</span>
              <div>
                <h2>{step.title}</h2>
                <p>{step.description}</p>
              </div>
            </div>

            {notice && step.id !== "review" ? (
              <div className={styles.notice}>{notice}</div>
            ) : null}

            <div className={styles.contentBody}>{renderStepContent()}</div>
          </div>

          <footer className={styles.actions}>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                setDraft(initialDraft);
                resetLlmTest();
                resetEmbeddingTest();
                setTouchedFields({});
                setFinalCheck("idle");
                setFinalFailedStep(null);
                setFinalFeedback(null);
                setFinalAttempt(0);
                setPrimaryFeedback(null);
                setStepMotion("backward");
                setCurrentStep(0);
                setNotice(null);
              }}
              disabled={isFinalTesting}
            >
              重置
            </button>
            <div className={styles.actionHintSlot} aria-live="polite">
              {primaryDisabled &&
              !busy &&
              primaryFeedback === null &&
              displayActionHint ? (
                <span className={styles.actionHint}>{displayActionHint}</span>
              ) : null}
            </div>
            <div className={styles.actionGroup}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={goBack}
                disabled={isFirstStep || isFinalTesting}
              >
                上一步
              </button>
              <button
                type="button"
                className={`${styles.primaryButton} ${
                  primaryFeedback === "success"
                    ? styles.primaryButtonSuccess
                    : primaryFeedback === "failed"
                      ? styles.primaryButtonFailed
                      : busy
                        ? styles.primaryButtonLoading
                        : ""
                }`}
                onClick={() => void goNext()}
                disabled={primaryDisabled}
                title={displayActionHint ?? undefined}
                aria-live="polite"
              >
                {renderPrimaryButtonContent()}
              </button>
            </div>
          </footer>
        </section>
      </section>
    </main>
  );

  function renderStepContent() {
    switch (step.id) {
      case "llm": {
        const llmComingSoon =
          draft.llm.provider === "anthropic" ||
          (draft.llm.provider === "openai" && draft.llm.mode !== "responses");

        return (
          <div className={styles.stack}>
            <div
              className={`${styles.segmentedControl} ${styles.segmentedTriple}`}
              role="tablist"
              aria-label="LLM 服务供应商"
            >
              <button
                type="button"
                role="tab"
                aria-selected={draft.llm.provider === "google"}
                className={`${styles.segmentedTab} ${
                  draft.llm.provider === "google" ? styles.segmentedActive : ""
                }`}
                onClick={() => updateLlm(llmDefaults.google)}
              >
                Google
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={draft.llm.provider === "openai"}
                className={`${styles.segmentedTab} ${
                  draft.llm.provider === "openai" ? styles.segmentedActive : ""
                }`}
                onClick={() => updateLlm(llmDefaults.openai)}
              >
                OpenAI
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={draft.llm.provider === "anthropic"}
                className={`${styles.segmentedTab} ${
                  draft.llm.provider === "anthropic"
                    ? styles.segmentedActive
                    : ""
                }`}
                onClick={() => updateLlm(llmDefaults.anthropic)}
              >
                Anthropic
              </button>
            </div>
            {draft.llm.provider === "google" ? (
              <label className={styles.switchRow}>
                <span>
                  <strong>使用 Vertex AI</strong>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.llm.useVertexAi}
                  onChange={(event) =>
                    updateLlm({ useVertexAi: event.target.checked })
                  }
                />
                <span className={styles.switchTrack} aria-hidden="true">
                  <span className={styles.switchThumb} />
                </span>
              </label>
            ) : draft.llm.provider === "openai" ? (
              <div className={styles.setupControlGroup}>
                <span className={styles.setupControlTitle}>接口协议</span>
                <div
                  className={styles.segmentedControl}
                  role="tablist"
                  aria-label="OpenAI 接口协议"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={draft.llm.mode === "chat"}
                    className={`${styles.segmentedTab} ${
                      draft.llm.mode === "chat" ? styles.segmentedActive : ""
                    }`}
                    onClick={() => updateLlm({ mode: "chat" })}
                  >
                    Chat Completions
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={draft.llm.mode === "responses"}
                    className={`${styles.segmentedTab} ${
                      draft.llm.mode === "responses"
                        ? styles.segmentedActive
                        : ""
                    }`}
                    onClick={() => updateLlm({ mode: "responses" })}
                  >
                    Responses API
                  </button>
                </div>
              </div>
            ) : null}
            {llmComingSoon ? (
              <div className={styles.comingSoonPanel}>
                <span>coming soon</span>
              </div>
            ) : (
              <>
                <div className={styles.formGrid}>
                  {renderModelSelectField({
                    path: "llm.model",
                    value: draft.llm.model,
                    options: llmModelOptions[draft.llm.provider],
                    onChange: (model) => updateLlm({ model }),
                  })}
                  {draft.llm.provider === "google" && draft.llm.useVertexAi ? (
                    <>
                      <Field
                        label="项目"
                        hint="填写环境变量名"
                        error={getVisibleFieldError("llm.projectEnvKey")}
                      >
                        <input
                          value={draft.llm.projectEnvKey}
                          placeholder={
                            llmDefaults[draft.llm.provider].projectEnvKey
                          }
                          required
                          aria-required="true"
                          {...getFieldControlProps("llm.projectEnvKey")}
                          onChange={(event) =>
                            updateLlm({ projectEnvKey: event.target.value })
                          }
                        />
                      </Field>
                      <Field
                        label="区域"
                        hint="填写环境变量名"
                        error={getVisibleFieldError("llm.locationEnvKey")}
                      >
                        <input
                          value={draft.llm.locationEnvKey}
                          placeholder={
                            llmDefaults[draft.llm.provider].locationEnvKey
                          }
                          required
                          aria-required="true"
                          {...getFieldControlProps("llm.locationEnvKey")}
                          onChange={(event) =>
                            updateLlm({ locationEnvKey: event.target.value })
                          }
                        />
                      </Field>
                      <Field
                        label="凭据"
                        hint="填写环境变量名"
                        error={getVisibleFieldError("llm.credentialsEnvKey")}
                      >
                        <input
                          value={draft.llm.credentialsEnvKey}
                          placeholder={
                            llmDefaults[draft.llm.provider].credentialsEnvKey
                          }
                          required
                          aria-required="true"
                          {...getFieldControlProps("llm.credentialsEnvKey")}
                          onChange={(event) =>
                            updateLlm({
                              credentialsEnvKey: event.target.value,
                            })
                          }
                        />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field
                        label="Base URL"
                        error={getVisibleFieldError("llm.baseUrl")}
                      >
                        <input
                          value={draft.llm.baseUrl}
                          placeholder={llmDefaults[draft.llm.provider].baseUrl}
                          required
                          aria-required="true"
                          {...getFieldControlProps("llm.baseUrl")}
                          onChange={(event) =>
                            updateLlm({ baseUrl: event.target.value })
                          }
                        />
                      </Field>
                      <Field
                        label="ApiKey"
                        hint="填写环境变量名"
                        error={getVisibleFieldError("llm.envKey")}
                      >
                        <input
                          value={draft.llm.envKey}
                          placeholder={llmDefaults[draft.llm.provider].envKey}
                          required
                          aria-required="true"
                          {...getFieldControlProps("llm.envKey")}
                          onChange={(event) =>
                            updateLlm({ envKey: event.target.value })
                          }
                        />
                      </Field>
                    </>
                  )}
                </div>
                <ServiceTestButton
                  status={llmTest.status}
                  disabled={busy || isFinalTesting}
                  onClick={() => {
                    setNotice(null);
                    void testLlmService().then((ok) => {
                      if (!ok) {
                        scrollStepErrorIntoView();
                      }
                    });
                  }}
                />
                {llmTest.status === "failed" ? (
                  <div ref={stepErrorRef}>
                    <CheckFeedbackDetails feedback={llmTest.feedback} />
                  </div>
                ) : null}
              </>
            )}
          </div>
        );
      }
      case "embedding":
        return (
          <div className={styles.stack}>
            <div
              className={styles.segmentedControl}
              role="tablist"
              aria-label="Embedding 服务供应商"
            >
              <button
                type="button"
                role="tab"
                aria-selected={draft.embedding.provider === "google"}
                className={`${styles.segmentedTab} ${
                  draft.embedding.provider === "google"
                    ? styles.segmentedActive
                    : ""
                }`}
                onClick={() => updateEmbedding(embeddingDefaults.google)}
              >
                Google
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={draft.embedding.provider === "openai"}
                className={`${styles.segmentedTab} ${
                  draft.embedding.provider === "openai"
                    ? styles.segmentedActive
                    : ""
                }`}
                onClick={() => updateEmbedding(embeddingDefaults.openai)}
              >
                OpenAI
              </button>
            </div>
            {draft.embedding.provider === "google" ? (
              <label className={styles.switchRow}>
                <span>
                  <strong>使用 Vertex AI</strong>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.embedding.useVertexAi}
                  onChange={(event) =>
                    updateEmbedding({ useVertexAi: event.target.checked })
                  }
                />
                <span className={styles.switchTrack} aria-hidden="true">
                  <span className={styles.switchThumb} />
                </span>
              </label>
            ) : null}
            <div className={styles.formGrid}>
              {renderModelSelectField({
                path: "embedding.model",
                value: draft.embedding.model,
                options: embeddingModelOptions[draft.embedding.provider],
                onChange: (model) => updateEmbedding({ model }),
              })}
              {draft.embedding.provider === "google" &&
              draft.embedding.useVertexAi ? (
                <>
                  <Field
                    label="项目"
                    hint="填写环境变量名"
                    error={getVisibleFieldError("embedding.projectEnvKey")}
                  >
                    <input
                      value={draft.embedding.projectEnvKey}
                      placeholder={
                        embeddingDefaults[draft.embedding.provider]
                          .projectEnvKey
                      }
                      required
                      aria-required="true"
                      {...getFieldControlProps("embedding.projectEnvKey")}
                      onChange={(event) =>
                        updateEmbedding({ projectEnvKey: event.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="区域"
                    hint="填写环境变量名"
                    error={getVisibleFieldError("embedding.locationEnvKey")}
                  >
                    <input
                      value={draft.embedding.locationEnvKey}
                      placeholder={
                        embeddingDefaults[draft.embedding.provider]
                          .locationEnvKey
                      }
                      required
                      aria-required="true"
                      {...getFieldControlProps("embedding.locationEnvKey")}
                      onChange={(event) =>
                        updateEmbedding({ locationEnvKey: event.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="凭据"
                    hint="填写环境变量名"
                    error={getVisibleFieldError("embedding.credentialsEnvKey")}
                  >
                    <input
                      value={draft.embedding.credentialsEnvKey}
                      placeholder={
                        embeddingDefaults[draft.embedding.provider]
                          .credentialsEnvKey
                      }
                      required
                      aria-required="true"
                      {...getFieldControlProps("embedding.credentialsEnvKey")}
                      onChange={(event) =>
                        updateEmbedding({
                          credentialsEnvKey: event.target.value,
                        })
                      }
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field
                    label="Base URL"
                    error={getVisibleFieldError("embedding.baseUrl")}
                  >
                    <input
                      value={draft.embedding.baseUrl}
                      placeholder={
                        embeddingDefaults[draft.embedding.provider].baseUrl
                      }
                      required
                      aria-required="true"
                      {...getFieldControlProps("embedding.baseUrl")}
                      onChange={(event) =>
                        updateEmbedding({ baseUrl: event.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="ApiKey"
                    hint="填写环境变量名"
                    error={getVisibleFieldError("embedding.envKey")}
                  >
                    <input
                      value={draft.embedding.envKey}
                      placeholder={
                        embeddingDefaults[draft.embedding.provider].envKey
                      }
                      required
                      aria-required="true"
                      {...getFieldControlProps("embedding.envKey")}
                      onChange={(event) =>
                        updateEmbedding({ envKey: event.target.value })
                      }
                    />
                  </Field>
                </>
              )}
            </div>
            <ServiceTestButton
              status={embeddingTest.status}
              disabled={busy || isFinalTesting}
              onClick={() => {
                setNotice(null);
                void testEmbeddingService().then((ok) => {
                  if (!ok) {
                    scrollStepErrorIntoView();
                  }
                });
              }}
            />
            {embeddingTest.status === "failed" ? (
              <div ref={stepErrorRef}>
                <CheckFeedbackDetails feedback={embeddingTest.feedback} />
              </div>
            ) : null}
          </div>
        );
      case "owner":
        return (
          <div className={styles.formGrid}>
            <Field label="名称" error={getVisibleFieldError("owner.name")}>
              <input
                value={draft.owner.name}
                required
                aria-required="true"
                {...getFieldControlProps("owner.name")}
                onChange={(event) => updateOwner({ name: event.target.value })}
              />
            </Field>
            <Field
              label="QQ 号"
              optional
              hint="让EMA在QQ平台也能记得你"
              error={getVisibleFieldError("owner.qq")}
            >
              <input
                value={draft.owner.qq}
                inputMode="numeric"
                {...getFieldControlProps("owner.qq")}
                onChange={(event) =>
                  updateOwner({ qq: event.target.value.replace(/\D/g, "") })
                }
              />
            </Field>
          </div>
        );
      case "review":
        return (
          <div className={styles.finalReview}>
            <div className={styles.finalCheckPanel}>
              <div
                className={styles.finalTrack}
                style={finalTrackStyle}
                role="list"
                aria-label="最终检查进度"
              >
                {finalReviewSteps.map((item) => {
                  const state = getFinalStepState(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`${styles.finalStep} ${
                        state === "testing"
                          ? styles.finalStepTesting
                          : state === "done"
                            ? styles.finalStepDone
                            : state === "failed"
                              ? styles.finalStepFailed
                              : ""
                      }`}
                      role="listitem"
                    >
                      <span className={styles.finalNode}>
                        {state === "pending" ? (
                          <span className={styles.finalPendingDot} />
                        ) : (
                          <span
                            className={styles.finalCheckGlyph}
                            aria-hidden="true"
                          >
                            {state === "testing" ? (
                              <LoaderCircle />
                            ) : state === "done" ? (
                              <Check />
                            ) : (
                              <X />
                            )}
                          </span>
                        )}
                      </span>
                      <span>{item.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {finalCheck === "failed" && finalFeedback ? (
              <div className={styles.finalIssueStack}>
                <CheckFeedbackDetails feedback={finalFeedback} />
              </div>
            ) : null}

            {finalCheck === "success" ? (
              <div className={styles.welcomeMessage} role="status">
                <strong>
                  <span className={styles.welcomePrefix}>欢迎，</span>
                  <span className={styles.welcomeName}>
                    {draft.owner.name.trim() || "你"}
                  </span>
                </strong>
              </div>
            ) : null}
          </div>
        );
    }
  }
}
