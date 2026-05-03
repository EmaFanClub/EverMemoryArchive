export type CreateActorStepId = 1 | 2 | 3 | 4 | 5;
export type CreateActorSourceId = "blank" | "import" | "history";

export interface CreateActorSourceOption {
  id: CreateActorSourceId;
  label: string;
  description: string;
  icon: "blank" | "import" | "history";
  enabled: boolean;
}

export const CREATE_ACTOR_SOURCE_OPTIONS: CreateActorSourceOption[] = [
  {
    id: "blank",
    label: "空白档案",
    description: "从一片空白开始，一点点把它书写成人。",
    icon: "blank",
    enabled: true,
  },
  {
    id: "import",
    label: "导入档案",
    description: "从旧的档案开始，寻找故人的模样。",
    icon: "import",
    enabled: false,
  },
  {
    id: "history",
    label: "学习记录",
    description: "从剧本或聊天记录开始,让符号变为真实。",
    icon: "history",
    enabled: false,
  },
];

export type MbtiAxis = "EI" | "SN" | "TF" | "JP";

export const MBTI_AXIS_CONFIG: Array<{
  axis: MbtiAxis;
  options: Array<{ id: string; label: string; title: string }>;
}> = [
  {
    axis: "EI",
    options: [
      { id: "E", label: "E", title: "外向 Extraverted" },
      { id: "I", label: "I", title: "内向 Introverted" },
    ],
  },
  {
    axis: "SN",
    options: [
      { id: "N", label: "N", title: "直觉 iNtuitive" },
      { id: "S", label: "S", title: "实感 Sensing" },
    ],
  },
  {
    axis: "TF",
    options: [
      { id: "T", label: "T", title: "思考 Thinking" },
      { id: "F", label: "F", title: "情感 Feeling" },
    ],
  },
  {
    axis: "JP",
    options: [
      { id: "J", label: "J", title: "判断 Judging" },
      { id: "P", label: "P", title: "知觉 Perceiving" },
    ],
  },
];

export type MbtiFamily = "analyst" | "diplomat" | "sentinel" | "explorer";

export interface MbtiPersona {
  code: string;
  family: MbtiFamily;
  familyLabel: string;
  title: string;
}

export const MBTI_PERSONAS: Record<string, MbtiPersona> = {
  INTJ: {
    code: "INTJ",
    family: "analyst",
    familyLabel: "分析家",
    title: "建筑师",
  },
  INTP: {
    code: "INTP",
    family: "analyst",
    familyLabel: "分析家",
    title: "逻辑学家",
  },
  ENTJ: {
    code: "ENTJ",
    family: "analyst",
    familyLabel: "分析家",
    title: "指挥官",
  },
  ENTP: {
    code: "ENTP",
    family: "analyst",
    familyLabel: "分析家",
    title: "辩论家",
  },
  INFJ: {
    code: "INFJ",
    family: "diplomat",
    familyLabel: "外交家",
    title: "提倡者",
  },
  INFP: {
    code: "INFP",
    family: "diplomat",
    familyLabel: "外交家",
    title: "调停者",
  },
  ENFJ: {
    code: "ENFJ",
    family: "diplomat",
    familyLabel: "外交家",
    title: "主人公",
  },
  ENFP: {
    code: "ENFP",
    family: "diplomat",
    familyLabel: "外交家",
    title: "竞选者",
  },
  ISTJ: {
    code: "ISTJ",
    family: "sentinel",
    familyLabel: "守护者",
    title: "物流师",
  },
  ISFJ: {
    code: "ISFJ",
    family: "sentinel",
    familyLabel: "守护者",
    title: "守卫者",
  },
  ESTJ: {
    code: "ESTJ",
    family: "sentinel",
    familyLabel: "守护者",
    title: "总经理",
  },
  ESFJ: {
    code: "ESFJ",
    family: "sentinel",
    familyLabel: "守护者",
    title: "执政官",
  },
  ISTP: {
    code: "ISTP",
    family: "explorer",
    familyLabel: "探险家",
    title: "鉴赏家",
  },
  ISFP: {
    code: "ISFP",
    family: "explorer",
    familyLabel: "探险家",
    title: "探险家",
  },
  ESTP: {
    code: "ESTP",
    family: "explorer",
    familyLabel: "探险家",
    title: "企业家",
  },
  ESFP: {
    code: "ESFP",
    family: "explorer",
    familyLabel: "探险家",
    title: "表演者",
  },
};

export const CREATE_ACTOR_PERSONALITY_TRAITS: Array<{
  id: string;
  label: string;
}> = [
  { id: "gentle", label: "温柔" },
  { id: "cool", label: "高冷" },
  { id: "warm", label: "热情" },
  { id: "rational", label: "理性" },
  { id: "tsundere", label: "傲娇" },
  { id: "responsible", label: "责任感" },
  { id: "delicate", label: "细腻" },
  { id: "lazy", label: "慵懒" },
  { id: "humorous", label: "幽默" },
  { id: "steady", label: "沉稳" },
  { id: "resilient", label: "坚韧" },
  { id: "shy", label: "羞涩" },
];

export const CREATE_ACTOR_SLEEP_AXIS_MINUTES = 24 * 60;
export const CREATE_ACTOR_SLEEP_STEP_MINUTES = 5;
export const CREATE_ACTOR_SLEEP_MIN_GAP_MINUTES = 6 * 60;
export const CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES = 12 * 60;
export const CREATE_ACTOR_SLEEP_DEFAULT_START = 11 * 60; // axis 11h → 23:00
export const CREATE_ACTOR_SLEEP_DEFAULT_END = 19 * 60; // axis 19h → 07:00

export interface CreateActorSleepHandleState {
  handle: "start" | "end" | "range";
  pointerId: number;
  offsetMinutes: number;
  trackWidth: number;
}
