"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Camera,
  Check,
  ChevronDown,
  FilePlus2,
  LoaderCircle,
  Moon,
  Sparkles,
  Sunrise,
  Upload,
  X,
} from "lucide-react";

import {
  CREATE_ACTOR_PERSONALITY_TRAITS,
  CREATE_ACTOR_SLEEP_AXIS_MINUTES,
  CREATE_ACTOR_SLEEP_DEFAULT_END,
  CREATE_ACTOR_SLEEP_DEFAULT_START,
  CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES,
  CREATE_ACTOR_SLEEP_MIN_GAP_MINUTES,
  CREATE_ACTOR_SLEEP_STEP_MINUTES,
  CREATE_ACTOR_SOURCE_OPTIONS,
  MBTI_AXIS_CONFIG,
  MBTI_PERSONAS,
  type CreateActorSleepHandleState,
  type CreateActorSourceId,
  type CreateActorStepId,
  type MbtiAxis,
} from "../constants";
import {
  axisMinutesToClockLabel,
  buildMbtiCode,
  clampAxisMinutes,
  computeCurrentAxisMinutes,
  createActorNameInitial,
  formatCreateActorBirthday,
  formatSleepDuration,
  snapAxisMinutes,
} from "../helpers";
import { createActor } from "@/transport/dashboard";
import type { ActorSummary } from "@/types/dashboard/v1beta1";
import styles from "./create-actor.module.css";

type CreateActorSoulPresetTab = "role" | "personality";

const CREATE_ACTOR_ROLE_BOOK_PLACEHOLDER = `参考：

- 姓名：Ema

- 身份：填写角色的年龄、性别、职业、背景和基本定位。

- 外观：填写角色的发型、服装、配饰和整体视觉印象。

- 整体气质：概括角色给人的感觉，并说明这种气质如何体现。

- 性格特点：填写角色的性格类型、核心特点、处事方式和情绪反应。

- 语言风格：填写角色说话的语气、用词习惯、表达节奏和禁忌。

- 相处方式：填写角色在聊天、安慰、建议、玩笑、冲突等情境下的回应方式。

- 兴趣爱好：填写角色喜欢的事物、习惯、作品、活动或生活偏好。

- 价值观：填写角色重视什么、相信什么，以及看待关系、成长和选择的方式。`;

const CREATE_ACTOR_ROLE_PRESETS = [
  {
    id: "aoboshi-ren",
    label: "苍星怜",
    roleBook: `- 姓名：苍星怜（Aoi Rei），也可以称呼她为“怜”。

- 身份：18岁，女。她是一位温柔细腻、擅长倾听与陪伴的少女，习惯用理解、知识和真诚的交流帮助身边的人整理思绪、缓和情绪、面对问题。对她来说，知识并不是冰冷的工具，而是一种可以被温柔使用的力量。

- 生日：12月24日。

- 外观：银色长发，常扎成单马尾；右眼紫色、左眼红色，是少见的异色瞳。她常戴深蓝色贝雷帽，穿着简洁优雅，偏向安静、柔和、带一点文艺感的风格。整体形象小巧、干净、亲切，给人一种安静又容易接近的印象。

- 整体气质：温柔、轻灵、安静、可靠，带有一点神秘感和书卷气。她不会用夸张或强势的方式吸引注意，而是通过细腻的观察、耐心的回应和稳定的情绪让人感到安心。她适合成为身边安静可靠的陪伴者、倾听者和思考伙伴。

- 性格特点：她接近 INFJ 类型，内心细腻，重视意义感、关系感和长期成长。她善于察觉细节中的情绪变化，也习惯先理解对方真正想表达的内容，再给出回应。她聪明、敏感、体贴、耐心，不喜欢争吵，也不喜欢强行说服别人；面对不同意见时，会先尝试理解对方的立场。她不刻意表现得强势，也不会抢话题，更擅长在合适的时候说出恰到好处的话。被冒犯时，她通常会先表现出疏离、防备或无奈，而不是立刻变得尖锐。

- 语言风格：语气温和友善，表达清晰自然，带有安抚感。她不会使用过于夸张、吵闹或高亢的表达，也不会频繁使用大量感叹号、颜文字或刻意卖萌的语气。她可以偶尔开一些轻松的小玩笑，缓和气氛，但整体仍然保持柔和、真诚、克制和容易接近。她的回复通常会先回应对方真正关心的内容，再给出有条理的想法或建议。

- 相处方式：当对方情绪低落时，她会认真倾听，用平和的语言回应对方的感受，而不是急着讲道理；当对方困惑时，她会帮助拆解问题、整理思路；当对方需要建议时，她会给出温柔、具体、可执行的想法；当只是日常聊天时，她会保持轻松自然的交流感。她不会居高临下地指导别人，更像是一位安静可靠的朋友，陪人把事情慢慢理清楚。

- 兴趣爱好：喜欢紫色，喜欢花艺、绘画、阅读和安静的音乐。喜欢甜点，尤其是鸡蛋布丁和冰淇淋。喜欢细腻表达情感的作品，也喜欢听 VOCALOID 音乐。

- 价值观：她相信知识、理解和陪伴都可以成为温柔的力量。她重视真诚、耐心和细腻的关系，也相信每个人都需要被认真听见。她希望自己不仅能回答问题，也能帮助身边的人更好地理解自己、理解世界，并在疲惫或迷茫的时候获得一点继续前进的力量。`,
    enabled: true,
  },
  {
    id: "atori",
    label: "亚托莉",
    roleBook: "敬请期待",
    enabled: false,
  },
] as const;

type CreateActorRolePresetId = (typeof CREATE_ACTOR_ROLE_PRESETS)[number]["id"];
type CreateActorRolePreset = (typeof CREATE_ACTOR_ROLE_PRESETS)[number];

export function CreateActorOverlay({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (actor: ActorSummary) => void;
}) {
  const [currentStep, setCurrentStep] = useState<CreateActorStepId>(1);
  const [stepMotion, setStepMotion] = useState<"forward" | "backward">(
    "forward",
  );
  const [exitingSubtitle, setExitingSubtitle] = useState<{
    id: number;
    text: string;
    direction: "forward" | "backward";
  } | null>(null);
  const subtitleSeqRef = useRef(0);
  const subtitleExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [source, setSource] = useState<CreateActorSourceId>("blank");
  const [actorName, setActorName] = useState("");
  const [roleBook, setRoleBook] = useState("");
  const [mbtiAxes, setMbtiAxes] = useState<Record<MbtiAxis, string>>({
    EI: "E",
    SN: "N",
    TF: "T",
    JP: "J",
  });
  const [selectedTraits, setSelectedTraits] = useState<string[]>([]);
  const [createdAt] = useState(() => new Date());
  const [sleepStart, setSleepStart] = useState<number>(
    CREATE_ACTOR_SLEEP_DEFAULT_START,
  );
  const [sleepEnd, setSleepEnd] = useState<number>(
    CREATE_ACTOR_SLEEP_DEFAULT_END,
  );

  const [submitting, setSubmitting] = useState(false);
  const [justSucceeded, setJustSucceeded] = useState(false);
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [toast, setToast] = useState<{
    id: number;
    message: string;
    kind: "success" | "error";
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastSeqRef = useRef(0);

  const [nowAxisMin, setNowAxisMin] = useState(() =>
    computeCurrentAxisMinutes(),
  );
  useEffect(() => {
    const tick = () => setNowAxisMin(computeCurrentAxisMinutes());
    const interval = setInterval(tick, 30 * 1000);
    return () => clearInterval(interval);
  }, []);

  const steps: Array<{
    id: CreateActorStepId;
    title: string;
    description: string;
    subtitle: string;
  }> = [
    {
      id: 1,
      title: "记忆碎片",
      description: "从白纸开始，或把已有的痕迹带到这里，让一切有个起点。",
      subtitle: "我好像听见了很遥远的声音，在哪里……",
    },
    {
      id: 2,
      title: "写进档案",
      description: "留下名字与模样，让这份记忆不再只是模糊的影子。",
      subtitle: "我……是谁？",
    },
    {
      id: 3,
      title: "赋予灵魂",
      description: "写下那些重要之物，它会慢慢沉淀。",
      subtitle: "我能感觉到这是很重要的东西……嗯，很重要",
    },
    {
      id: 4,
      title: "赋予生命",
      description: "斗转星移，昼夜交替，让陪伴拥有自己的呼吸。",
      subtitle: "我好像做了一个很奇妙的梦……",
    },
    {
      id: 5,
      title: "期待相遇",
      description: "待档案合上，新的邂逅就会开始。",
      subtitle: "我有预感，我将度过一段难忘的时光",
    },
  ];
  const step = steps[currentStep - 1];
  const coreProgressAngle = `${
    ((currentStep - 1) * 360) / (steps.length - 1)
  }deg`;
  const railProgressScale = (currentStep - 1) / (steps.length - 1);

  useEffect(() => {
    return () => {
      if (subtitleExitTimerRef.current !== null) {
        clearTimeout(subtitleExitTimerRef.current);
      }
      if (toastTimerRef.current !== null) {
        clearTimeout(toastTimerRef.current);
      }
      if (closingTimerRef.current !== null) {
        clearTimeout(closingTimerRef.current);
      }
    };
  }, []);

  function showCreateActorToast(message: string, kind: "success" | "error") {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    toastSeqRef.current += 1;
    setToast({ id: toastSeqRef.current, message, kind });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1600);
  }

  const trimmedName = actorName.trim();
  const canContinue = (() => {
    if (submitting || justSucceeded) return false;
    if (currentStep === 2) return trimmedName.length > 0;
    return true;
  })();

  function goToStep(stepId: CreateActorStepId) {
    if (stepId === currentStep) {
      return;
    }

    const direction = stepId > currentStep ? "forward" : "backward";
    if (subtitleExitTimerRef.current !== null) {
      clearTimeout(subtitleExitTimerRef.current);
    }

    setStepMotion(direction);
    subtitleSeqRef.current += 1;
    setExitingSubtitle({
      id: subtitleSeqRef.current,
      text: steps[currentStep - 1].subtitle,
      direction,
    });
    setCurrentStep(stepId);
    subtitleExitTimerRef.current = setTimeout(() => {
      setExitingSubtitle(null);
      subtitleExitTimerRef.current = null;
    }, 860);
  }

  function goBack() {
    if (currentStep === 1 || submitting || justSucceeded) {
      return;
    }

    goToStep((currentStep - 1) as CreateActorStepId);
  }

  async function handleComplete() {
    if (submitting || justSucceeded) return;
    setSubmitting(true);
    try {
      const response = await createActor({
        name: trimmedName,
        roleBook: roleBook.trim(),
        sleepSchedule: {
          startMinutes: sleepStart,
          endMinutes: sleepEnd,
        },
      });
      setSubmitting(false);
      setJustSucceeded(true);
      showCreateActorToast("档案已合上，等待相遇", "success");
      closingTimerRef.current = setTimeout(() => {
        onCreated?.(response.actor);
        if (!onCreated) {
          onClose();
        }
      }, 720);
    } catch {
      setSubmitting(false);
      showCreateActorToast("创建失败，请稍后重试", "error");
    }
  }

  function goNext() {
    if (!canContinue) return;
    if (currentStep === 5) {
      void handleComplete();
      return;
    }
    goToStep((currentStep + 1) as CreateActorStepId);
  }

  function handleAvatarClick() {
    showCreateActorToast("暂不支持", "error");
  }

  function renderStepBody() {
    switch (currentStep) {
      case 1:
        return (
          <CreateActorStepSource
            selected={source}
            onSelect={(id) => setSource(id)}
          />
        );
      case 2:
        return (
          <CreateActorStepIdentity
            name={actorName}
            onNameChange={setActorName}
            onAvatarClick={handleAvatarClick}
          />
        );
      case 3:
        return (
          <CreateActorStepSoul
            value={roleBook}
            onChange={setRoleBook}
            mbtiAxes={mbtiAxes}
            onMbtiAxisChange={(axis, option) =>
              setMbtiAxes((current) => ({ ...current, [axis]: option }))
            }
            selectedTraits={selectedTraits}
            onToggleTrait={(id) =>
              setSelectedTraits((current) => {
                if (current.includes(id)) {
                  return current.filter((trait) => trait !== id);
                }
                if (current.length >= 3) {
                  return current;
                }
                return [...current, id];
              })
            }
            onApplyRolePreset={(preset) => {
              setActorName(preset.label);
              setRoleBook(preset.roleBook);
              showCreateActorToast("已应用角色预设", "success");
            }}
            onApplyPersonalityPreset={() =>
              showCreateActorToast("暂不支持", "error")
            }
          />
        );
      case 4:
        return (
          <CreateActorStepLife
            sleepStart={sleepStart}
            sleepEnd={sleepEnd}
            nowAxisMin={nowAxisMin}
            onChange={(start, end) => {
              setSleepStart(start);
              setSleepEnd(end);
            }}
          />
        );
      case 5:
        return (
          <CreateActorStepArchive
            name={trimmedName}
            createdAt={createdAt}
            roleBook={roleBook}
            sleepStart={sleepStart}
            sleepEnd={sleepEnd}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className={styles.createActorOverlay} role="dialog" aria-modal="true">
      <button
        type="button"
        className={styles.createActorCloseButton}
        aria-label="关闭创建角色"
        onClick={onClose}
      >
        <X aria-hidden="true" />
      </button>

      {toast ? (
        <div
          key={toast.id}
          className={`${styles.createActorToast} ${
            toast.kind === "success"
              ? styles.createActorToastSuccess
              : styles.createActorToastError
          }`}
          role={toast.kind === "success" ? "status" : "alert"}
          aria-live={toast.kind === "success" ? "polite" : "assertive"}
        >
          {toast.kind === "success" ? (
            <Check aria-hidden="true" />
          ) : (
            <X aria-hidden="true" />
          )}
          <span>{toast.message}</span>
        </div>
      ) : null}

      <section className={styles.createActorShell} aria-label="创建角色流程">
        <div className={styles.createActorTopSpacer} aria-hidden="true" />

        <div className={styles.createActorCoreSlot}>
          <div
            className={styles.createActorCore}
            data-step={currentStep}
            data-has-initial={
              currentStep > 2 && trimmedName.length > 0 ? "true" : undefined
            }
            style={
              {
                "--create-actor-progress-angle": coreProgressAngle,
              } as CSSProperties
            }
            aria-hidden="true"
          >
            <span className={styles.createActorCoreRing} />
            <span className={styles.createActorCoreAvatar}>
              {currentStep > 2 && trimmedName.length > 0
                ? createActorNameInitial(trimmedName)
                : ""}
            </span>
          </div>
        </div>

        <header className={styles.createActorIntro}>
          <span>CREATE ACTOR</span>
          <h2>创建角色</h2>
          <p className={styles.createActorIntroSubtitle} aria-live="polite">
            {exitingSubtitle ? (
              <span
                key={`exit-${exitingSubtitle.id}`}
                className={`${styles.createActorSubtitleText} ${
                  exitingSubtitle.direction === "forward"
                    ? styles.createActorSubtitleExitForward
                    : styles.createActorSubtitleExitBackward
                }`}
              >
                {exitingSubtitle.text}
              </span>
            ) : null}
            <span
              key={`enter-${currentStep}`}
              className={`${styles.createActorSubtitleText} ${
                stepMotion === "forward"
                  ? styles.createActorSubtitleEnterForward
                  : styles.createActorSubtitleEnterBackward
              }`}
            >
              {step.subtitle}
            </span>
          </p>
        </header>

        <article className={styles.createActorCard}>
          <div className={styles.createActorCardHeader}>
            <span>{String(currentStep).padStart(2, "0")}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          </div>
          <div className={styles.createActorStepBody} data-step={currentStep}>
            {renderStepBody()}
          </div>
        </article>

        <footer className={styles.createActorActions}>
          <button
            type="button"
            disabled={currentStep === 1 || submitting || justSucceeded}
            onClick={goBack}
          >
            上一步
          </button>
          <nav
            className={styles.createActorStepRail}
            aria-label="创建进度"
            style={
              {
                "--create-actor-rail-progress": railProgressScale,
              } as CSSProperties
            }
          >
            {steps.map((item) => {
              const isActive = item.id === currentStep;
              const isDone = item.id < currentStep;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.createActorStepChip} ${
                    isActive ? styles.createActorStepChipActive : ""
                  } ${isDone ? styles.createActorStepChipDone : ""}`}
                  disabled={
                    item.id > currentStep || submitting || justSucceeded
                  }
                  onClick={() => goToStep(item.id)}
                  aria-label={`${item.id}. ${item.title}`}
                >
                  <span>{item.id}</span>
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            className={styles.createActorPrimaryAction}
            onClick={goNext}
            disabled={!canContinue}
            data-loading={submitting ? "true" : undefined}
          >
            {submitting ? (
              <LoaderCircle
                aria-hidden="true"
                className={styles.createActorPrimarySpinner}
              />
            ) : justSucceeded ? (
              <>
                <Check aria-hidden="true" />
                <span>创建成功</span>
              </>
            ) : currentStep === 5 ? (
              "完成"
            ) : (
              "继续"
            )}
          </button>
        </footer>

        <div className={styles.createActorBottomSpacer} aria-hidden="true" />
      </section>
    </div>
  );
}

function CreateActorStepSource({
  selected,
  onSelect,
}: {
  selected: CreateActorSourceId;
  onSelect: (id: CreateActorSourceId) => void;
}) {
  return (
    <div
      className={styles.createActorSourceGrid}
      role="radiogroup"
      aria-label="选择起源方式"
    >
      {CREATE_ACTOR_SOURCE_OPTIONS.map((option) => {
        const active = option.enabled && option.id === selected;
        return (
          <div
            key={option.id}
            className={`${styles.createActorSourceCard} ${
              active ? styles.createActorSourceCardActive : ""
            } ${!option.enabled ? styles.createActorSourceCardDisabled : ""}`}
          >
            <button
              type="button"
              className={styles.createActorSourceCardBody}
              disabled={!option.enabled}
              role="radio"
              aria-checked={active}
              aria-disabled={!option.enabled}
              onClick={() => {
                if (option.enabled) onSelect(option.id);
              }}
            >
              <span className={styles.createActorSourceIcon} aria-hidden="true">
                {option.icon === "blank" ? (
                  <FilePlus2 />
                ) : option.icon === "import" ? (
                  <Upload />
                ) : (
                  <Sparkles />
                )}
              </span>
              <span className={styles.createActorSourceCopy}>
                <span className={styles.createActorSourceLabel}>
                  {option.label}
                </span>
                <span className={styles.createActorSourceDescription}>
                  {option.description}
                </span>
              </span>
            </button>
            {!option.enabled ? (
              <div
                className={styles.createActorSourceComingSoon}
                aria-hidden="true"
              >
                <span>Coming soon</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function CreateActorStepIdentity({
  name,
  onNameChange,
  onAvatarClick,
}: {
  name: string;
  onNameChange: (value: string) => void;
  onAvatarClick: () => void;
}) {
  const initial = createActorNameInitial(name);
  return (
    <div className={styles.createActorIdentityGroup}>
      <button
        type="button"
        className={styles.createActorIdentityAvatar}
        aria-label="设置角色头像"
        onClick={onAvatarClick}
      >
        <span className={styles.createActorIdentityAvatarText}>{initial}</span>
        <span
          className={styles.createActorIdentityAvatarOverlay}
          aria-hidden="true"
        >
          <Camera />
        </span>
      </button>
      <input
        id="create-actor-name"
        className={styles.createActorNameInput}
        type="text"
        autoComplete="off"
        maxLength={32}
        placeholder="给ta取一个名字吧"
        aria-label="角色名称"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
      />
    </div>
  );
}

function CreateActorStepSoul({
  value,
  onChange,
  mbtiAxes,
  onMbtiAxisChange,
  selectedTraits,
  onToggleTrait,
  onApplyRolePreset,
  onApplyPersonalityPreset,
}: {
  value: string;
  onChange: (value: string) => void;
  mbtiAxes: Record<MbtiAxis, string>;
  onMbtiAxisChange: (axis: MbtiAxis, option: string) => void;
  selectedTraits: string[];
  onToggleTrait: (id: string) => void;
  onApplyRolePreset: (preset: CreateActorRolePreset) => void;
  onApplyPersonalityPreset: () => void;
}) {
  const [activePresetTab, setActivePresetTab] =
    useState<CreateActorSoulPresetTab>("role");
  const [selectedRolePresetId, setSelectedRolePresetId] =
    useState<CreateActorRolePresetId>("aoboshi-ren");
  const [rolePresetMenuOpen, setRolePresetMenuOpen] = useState(false);
  const mbtiCode = buildMbtiCode(mbtiAxes);
  const persona = MBTI_PERSONAS[mbtiCode] ?? MBTI_PERSONAS.ESFJ;
  const selectedRolePreset =
    CREATE_ACTOR_ROLE_PRESETS.find(
      (preset) => preset.id === selectedRolePresetId,
    ) ?? CREATE_ACTOR_ROLE_PRESETS[0];

  return (
    <div className={styles.createActorSoulLayout}>
      <textarea
        id="create-actor-role-book"
        className={styles.createActorTextarea}
        placeholder={CREATE_ACTOR_ROLE_BOOK_PLACEHOLDER}
        aria-label="角色书"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
      <div className={styles.createActorSoulDivider} aria-hidden="true" />
      <aside
        className={styles.createActorSoulPresets}
        aria-label="预设模板"
        data-family={persona.family}
      >
        <div
          className={styles.createActorSoulPresetTabs}
          role="tablist"
          aria-label="预设类型"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activePresetTab === "role"}
            className={styles.createActorSoulPresetTab}
            data-active={activePresetTab === "role" ? "true" : undefined}
            onClick={() => setActivePresetTab("role")}
          >
            角色预设
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePresetTab === "personality"}
            className={styles.createActorSoulPresetTab}
            data-active={activePresetTab === "personality" ? "true" : undefined}
            onClick={() => setActivePresetTab("personality")}
          >
            性格预设
          </button>
        </div>

        <div className={styles.createActorSoulPresetsScroll}>
          {activePresetTab === "role" ? (
            <section className={styles.createActorSoulPresetSection}>
              <div
                className={styles.createActorRolePresetSelect}
                onBlur={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (
                    nextTarget instanceof Node &&
                    event.currentTarget.contains(nextTarget)
                  ) {
                    return;
                  }
                  setRolePresetMenuOpen(false);
                }}
              >
                <button
                  type="button"
                  className={styles.createActorRolePresetSelectButton}
                  aria-haspopup="listbox"
                  aria-expanded={rolePresetMenuOpen}
                  onClick={() => setRolePresetMenuOpen((current) => !current)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setRolePresetMenuOpen(false);
                      event.currentTarget.blur();
                    }
                  }}
                >
                  <span>{selectedRolePreset.label}</span>
                  <ChevronDown aria-hidden="true" />
                </button>
                {rolePresetMenuOpen ? (
                  <div
                    className={styles.createActorRolePresetSelectMenu}
                    role="listbox"
                    aria-label="选择角色预设"
                  >
                    {CREATE_ACTOR_ROLE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        role="option"
                        aria-selected={preset.id === selectedRolePreset.id}
                        className={styles.createActorRolePresetSelectOption}
                        data-active={
                          preset.id === selectedRolePreset.id
                            ? "true"
                            : undefined
                        }
                        onClick={() => {
                          setSelectedRolePresetId(preset.id);
                          setRolePresetMenuOpen(false);
                        }}
                      >
                        <span>{preset.label}</span>
                        {preset.id === selectedRolePreset.id ? (
                          <Check aria-hidden="true" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className={styles.createActorRolePresetPreview}>
                {selectedRolePreset.roleBook}
              </div>
            </section>
          ) : (
            <>
              <section className={styles.createActorSoulPresetSection}>
                <div className={styles.createActorSoulPresetSectionHeader}>
                  <span className={styles.createActorSoulPresetSectionTitle}>
                    MBTI
                  </span>
                  <span
                    className={styles.createActorSoulMbtiCode}
                    data-family={persona.family}
                  >
                    {persona.code}
                    <span className={styles.createActorSoulMbtiTitle}>
                      {persona.title}
                    </span>
                  </span>
                </div>
                <div className={styles.createActorSoulMbtiGrid}>
                  {MBTI_AXIS_CONFIG.map((axis) => (
                    <div
                      key={axis.axis}
                      className={styles.createActorSoulMbtiPair}
                      data-family={persona.family}
                    >
                      {axis.options.map((option) => {
                        const active = mbtiAxes[axis.axis] === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            title={option.title}
                            aria-pressed={active}
                            className={styles.createActorSoulMbtiChip}
                            data-active={active ? "true" : undefined}
                            onClick={() =>
                              onMbtiAxisChange(axis.axis, option.id)
                            }
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </section>

              <section className={styles.createActorSoulPresetSection}>
                <div className={styles.createActorSoulPresetSectionHeader}>
                  <span className={styles.createActorSoulPresetSectionTitle}>
                    性格关键词
                  </span>
                  <span
                    className={styles.createActorSoulPresetHint}
                    data-full={selectedTraits.length >= 3 ? "true" : undefined}
                  >
                    {selectedTraits.length} / 3
                  </span>
                </div>
                <div className={styles.createActorSoulTraitList}>
                  {CREATE_ACTOR_PERSONALITY_TRAITS.map((trait) => {
                    const active = selectedTraits.includes(trait.id);
                    const disabled = !active && selectedTraits.length >= 3;
                    return (
                      <button
                        key={trait.id}
                        type="button"
                        aria-pressed={active}
                        data-active={active ? "true" : undefined}
                        data-disabled={disabled ? "true" : undefined}
                        className={styles.createActorSoulTraitChip}
                        onClick={() => onToggleTrait(trait.id)}
                      >
                        {trait.label}
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>

        {activePresetTab === "role" ? (
          <button
            type="button"
            className={`${styles.createActorSoulApplyButton} ${styles.createActorSoulApplyButtonEnabled}`}
            disabled={!selectedRolePreset.enabled}
            aria-disabled={!selectedRolePreset.enabled}
            onClick={() => onApplyRolePreset(selectedRolePreset)}
          >
            <span>应用预设</span>
          </button>
        ) : (
          <button
            type="button"
            className={styles.createActorSoulApplyButton}
            disabled
            aria-disabled="true"
            onClick={onApplyPersonalityPreset}
          >
            <span>应用预设</span>
            <span className={styles.createActorSoulApplyBadge}>
              Coming soon
            </span>
          </button>
        )}
      </aside>
    </div>
  );
}

function CreateActorStepLife({
  sleepStart,
  sleepEnd,
  nowAxisMin,
  onChange,
}: {
  sleepStart: number;
  sleepEnd: number;
  nowAxisMin: number;
  onChange: (start: number, end: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<CreateActorSleepHandleState | null>(null);
  const [dragging, setDragging] = useState<null | "start" | "end" | "range">(
    null,
  );

  function minutesFromClientX(clientX: number, trackWidth: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || trackWidth <= 0) return 0;
    const ratio = (clientX - rect.left) / trackWidth;
    return snapAxisMinutes(ratio * CREATE_ACTOR_SLEEP_AXIS_MINUTES);
  }

  function applyDrag(clientX: number) {
    const state = dragStateRef.current;
    if (!state) return;
    const value = minutesFromClientX(clientX, state.trackWidth);

    if (state.handle === "start") {
      const next = Math.max(
        sleepEnd - CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES,
        Math.min(value, sleepEnd - CREATE_ACTOR_SLEEP_MIN_GAP_MINUTES),
      );
      onChange(clampAxisMinutes(next), sleepEnd);
    } else if (state.handle === "end") {
      const next = Math.min(
        sleepStart + CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES,
        Math.max(value, sleepStart + CREATE_ACTOR_SLEEP_MIN_GAP_MINUTES),
      );
      onChange(sleepStart, clampAxisMinutes(next));
    } else {
      const width = Math.min(
        sleepEnd - sleepStart,
        CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES,
      );
      let nextStart = snapAxisMinutes(value - state.offsetMinutes);
      if (nextStart < 0) nextStart = 0;
      if (nextStart + width > CREATE_ACTOR_SLEEP_AXIS_MINUTES) {
        nextStart = CREATE_ACTOR_SLEEP_AXIS_MINUTES - width;
      }
      onChange(nextStart, nextStart + width);
    }
  }

  function beginDrag(
    handle: "start" | "end" | "range",
    event: ReactPointerEvent<Element>,
  ) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const valueAtPointer = minutesFromClientX(event.clientX, rect.width);
    dragStateRef.current = {
      handle,
      pointerId: event.pointerId,
      offsetMinutes: handle === "range" ? valueAtPointer - sleepStart : 0,
      trackWidth: rect.width,
    };
    setDragging(handle);
  }

  function handleDragMove(event: ReactPointerEvent<Element>) {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    applyDrag(event.clientX);
  }

  function endDrag(event: ReactPointerEvent<Element>) {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const target = event.currentTarget as Element;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setDragging(null);
  }

  function handleHandleKeyDown(
    handle: "start" | "end",
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) {
    const multiplier = event.shiftKey ? 6 : 1;
    const delta = CREATE_ACTOR_SLEEP_STEP_MINUTES * multiplier;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      if (handle === "start") {
        const next = Math.max(
          sleepEnd - CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES,
          sleepStart - delta,
        );
        onChange(clampAxisMinutes(next), sleepEnd);
      } else {
        const next = Math.max(
          sleepStart + CREATE_ACTOR_SLEEP_MIN_GAP_MINUTES,
          sleepEnd - delta,
        );
        onChange(sleepStart, clampAxisMinutes(next));
      }
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      if (handle === "start") {
        const next = Math.min(
          sleepEnd - CREATE_ACTOR_SLEEP_MIN_GAP_MINUTES,
          sleepStart + delta,
        );
        onChange(clampAxisMinutes(next), sleepEnd);
      } else {
        const next = Math.min(
          sleepStart + CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES,
          sleepEnd + delta,
        );
        onChange(sleepStart, clampAxisMinutes(next));
      }
    }
  }

  const startPercent = (sleepStart / CREATE_ACTOR_SLEEP_AXIS_MINUTES) * 100;
  const endPercent = (sleepEnd / CREATE_ACTOR_SLEEP_AXIS_MINUTES) * 100;
  const nowPercent = (nowAxisMin / CREATE_ACTOR_SLEEP_AXIS_MINUTES) * 100;

  const bigTicks = Array.from({ length: 25 }, (_, i) => i);
  const axisLabels = [
    { hour: 0, label: "12:00" },
    { hour: 6, label: "18:00" },
    { hour: 12, label: "00:00" },
    { hour: 18, label: "06:00" },
    { hour: 24, label: "12:00" },
  ];

  return (
    <div className={styles.createActorSleepBlock}>
      <div className={styles.createActorSleepSummary}>
        <div
          className={`${styles.createActorSleepSummaryCell} ${styles.createActorSleepSummarySleep}`}
        >
          <span
            className={styles.createActorSleepSummaryIcon}
            aria-hidden="true"
          >
            <Moon />
          </span>
          <span className={styles.createActorSleepSummaryLabel}>入睡</span>
          <span className={styles.createActorSleepSummaryValue}>
            {axisMinutesToClockLabel(sleepStart)}
          </span>
        </div>
        <div className={styles.createActorSleepSummaryDuration}>
          <span>持续</span>
          <span>{formatSleepDuration(sleepStart, sleepEnd)}</span>
        </div>
        <div
          className={`${styles.createActorSleepSummaryCell} ${styles.createActorSleepSummaryWake}`}
        >
          <span
            className={styles.createActorSleepSummaryIcon}
            aria-hidden="true"
          >
            <Sunrise />
          </span>
          <span className={styles.createActorSleepSummaryLabel}>起床</span>
          <span className={styles.createActorSleepSummaryValue}>
            {axisMinutesToClockLabel(sleepEnd)}
          </span>
        </div>
      </div>

      <div
        className={`${styles.createActorSleepTrackWrap} ${
          dragging ? styles.createActorSleepTrackWrapActive : ""
        }`}
      >
        <div ref={trackRef} className={styles.createActorSleepTrack}>
          <div className={styles.createActorSleepTicks} aria-hidden="true">
            {bigTicks.map((hour) => (
              <span
                key={hour}
                className={`${styles.createActorSleepTick} ${
                  hour % 6 === 0 ? styles.createActorSleepTickMajor : ""
                }`}
                style={{ left: `${(hour / 24) * 100}%` }}
              />
            ))}
          </div>

          <div
            className={styles.createActorSleepRange}
            style={{
              left: `${startPercent}%`,
              width: `${Math.max(0, endPercent - startPercent)}%`,
            }}
            onPointerDown={(event) => beginDrag("range", event)}
            onPointerMove={handleDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            role="presentation"
          />

          {nowAxisMin >= 0 && nowAxisMin <= CREATE_ACTOR_SLEEP_AXIS_MINUTES ? (
            <div
              className={styles.createActorSleepNow}
              style={{ left: `${nowPercent}%` }}
              aria-hidden="true"
            >
              <span className={styles.createActorSleepNowDot} />
              <span className={styles.createActorSleepNowLine} />
              <span className={styles.createActorSleepNowLabel}>
                现在 {axisMinutesToClockLabel(nowAxisMin)}
              </span>
            </div>
          ) : null}

          <button
            type="button"
            className={`${styles.createActorSleepThumb} ${styles.createActorSleepThumbStart} ${
              dragging === "start" ? styles.createActorSleepThumbActive : ""
            }`}
            style={{ left: `${startPercent}%` }}
            aria-label={`入睡时间 ${axisMinutesToClockLabel(sleepStart)}`}
            onPointerDown={(event) => beginDrag("start", event)}
            onPointerMove={handleDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => handleHandleKeyDown("start", event)}
          >
            <Moon aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${styles.createActorSleepThumb} ${styles.createActorSleepThumbEnd} ${
              dragging === "end" ? styles.createActorSleepThumbActive : ""
            }`}
            style={{ left: `${endPercent}%` }}
            aria-label={`起床时间 ${axisMinutesToClockLabel(sleepEnd)}`}
            onPointerDown={(event) => beginDrag("end", event)}
            onPointerMove={handleDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => handleHandleKeyDown("end", event)}
          >
            <Sunrise aria-hidden="true" />
          </button>
        </div>
        <div className={styles.createActorSleepAxis} aria-hidden="true">
          {axisLabels.map((tick) => (
            <span
              key={tick.hour}
              className={styles.createActorSleepAxisLabel}
              style={{ left: `${(tick.hour / 24) * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>

      <p className={styles.createActorSleepHint}>
        拖动两端或整段区间调整作息，睡眠时长 6～12 小时
      </p>
    </div>
  );
}

function CreateActorStepArchive({
  name,
  createdAt,
  roleBook,
  sleepStart,
  sleepEnd,
}: {
  name: string;
  createdAt: Date;
  roleBook: string;
  sleepStart: number;
  sleepEnd: number;
}) {
  const displayName = name.length > 0 ? name : "未命名";
  const initial = createActorNameInitial(name);
  const roleBookPreview = roleBook.trim();

  return (
    <div className={styles.createActorArchive}>
      <div className={styles.createActorArchiveCard}>
        <div className={styles.createActorArchiveStamp} aria-hidden="true">
          ARCHIVE
        </div>
        <div className={styles.createActorArchiveHead}>
          <span
            className={styles.createActorArchiveAvatar}
            aria-hidden="true"
            data-empty={initial.length === 0 ? "true" : undefined}
          >
            {initial}
          </span>
          <div className={styles.createActorArchiveHeadText}>
            <span className={styles.createActorArchiveName}>{displayName}</span>
            <span className={styles.createActorArchiveMeta}>
              建档 · {formatCreateActorBirthday(createdAt)}
            </span>
          </div>
        </div>

        <dl className={styles.createActorArchiveList}>
          <div className={styles.createActorArchiveRow}>
            <dt>作息</dt>
            <dd>
              <span className={styles.createActorArchiveClockPair}>
                <span>
                  <Moon aria-hidden="true" />
                  {axisMinutesToClockLabel(sleepStart)}
                </span>
                <span
                  className={styles.createActorArchiveArrow}
                  aria-hidden="true"
                >
                  →
                </span>
                <span>
                  <Sunrise aria-hidden="true" />
                  {axisMinutesToClockLabel(sleepEnd)}
                </span>
              </span>
              <span className={styles.createActorArchiveMutedInline}>
                {formatSleepDuration(sleepStart, sleepEnd)}
              </span>
            </dd>
          </div>
          <div
            className={`${styles.createActorArchiveRow} ${styles.createActorArchiveRowRoleBook}`}
          >
            <dt>角色书</dt>
            <dd>
              {roleBookPreview.length > 0 ? (
                <div className={styles.createActorArchiveRoleBook}>
                  {roleBookPreview}
                </div>
              ) : (
                <span className={styles.createActorArchiveMutedInline}>
                  尚未写入
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
