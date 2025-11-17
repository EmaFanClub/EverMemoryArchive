// 会话状态
export enum SessionStatus {
  ACTIVE = "active",
  PAUSED = "paused",
  COMPLETED = "completed"
}

// 消息角色
export enum MessageRole {
  USER = "user",
  ASSISTANT = "assistant",
  SYSTEM = "system"
}

// 会话类型
export interface Session {
  id: string;
  user_id: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  title?: string;
}

// 消息类型
export interface Message {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

// 认证响应
export interface AuthResponse {
  session_id: string;
  message: string;
}

// 创建会话响应
export interface CreateSessionResponse {
  session_id: string;
  message: string;
}

// 会话列表响应
export interface SessionListResponse {
  sessions: Session[];
}

// 消息历史响应
export interface MessageHistoryResponse {
  messages: Message[];
}

// 发送消息请求
export interface SendMessageRequest {
  message: string;
}

// 发送消息响应
export interface SendMessageResponse {
  message: string;
  response: string;
}

// 用户状态
export interface UserState {
  sessionId: string | null;
  isAuthenticated: boolean;
}

// 工具调用块
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// 文本块
export interface TextBlock {
  type: "text";
  text: string;
}

// 思考块
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

// 内容块类型
export type ContentBlock = TextBlock | ToolUseBlock | ThinkingBlock;
