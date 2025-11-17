import axios, { AxiosInstance } from 'axios';
import type {
  AuthResponse,
  CreateSessionResponse,
  SessionListResponse,
  MessageHistoryResponse,
  SendMessageRequest,
  SendMessageResponse,
} from '../types';

class APIService {
  private client: AxiosInstance;
  private sessionId: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: '/api',
      timeout: 60000, // 60 seconds for agent responses
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 从 localStorage 恢复 sessionId
    this.sessionId = localStorage.getItem('sessionId');

    // 请求拦截器 - 添加 session ID
    this.client.interceptors.request.use((config) => {
      if (this.sessionId && config.url !== '/auth/login') {
        config.params = {
          ...config.params,
          session_id: this.sessionId,
        };
      }
      return config;
    });

    // 响应拦截器 - 处理错误
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          this.logout();
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // 设置 session ID
  setSessionId(sessionId: string) {
    this.sessionId = sessionId;
    localStorage.setItem('sessionId', sessionId);
  }

  // 获取 session ID
  getSessionId(): string | null {
    return this.sessionId;
  }

  // 登出
  logout() {
    this.sessionId = null;
    localStorage.removeItem('sessionId');
  }

  // ========== 认证 API ==========

  /**
   * 用户登录
   */
  async login(username: string, password: string): Promise<AuthResponse> {
    const formData = new FormData();
    formData.append('username', username);
    formData.append('password', password);

    const response = await this.client.post<AuthResponse>('/auth/login', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    this.setSessionId(response.data.session_id);
    return response.data;
  }

  // ========== 会话 API ==========

  /**
   * 创建新会话
   */
  async createSession(): Promise<CreateSessionResponse> {
    const response = await this.client.post<CreateSessionResponse>('/sessions/create');
    return response.data;
  }

  /**
   * 获取用户的所有会话
   */
  async getSessions(): Promise<SessionListResponse> {
    const response = await this.client.get<SessionListResponse>('/sessions/list');
    return response.data;
  }

  /**
   * 获取会话的消息历史
   */
  async getSessionHistory(chatSessionId: string): Promise<MessageHistoryResponse> {
    const response = await this.client.get<MessageHistoryResponse>(
      `/sessions/${chatSessionId}/history`
    );
    return response.data;
  }

  /**
   * 删除会话
   */
  async deleteSession(chatSessionId: string): Promise<void> {
    await this.client.delete(`/sessions/${chatSessionId}`);
  }

  // ========== 对话 API ==========

  /**
   * 发送消息到指定会话
   */
  async sendMessage(
    chatSessionId: string,
    message: string
  ): Promise<SendMessageResponse> {
    const data: SendMessageRequest = { message };
    const response = await this.client.post<SendMessageResponse>(
      `/chat/${chatSessionId}/message`,
      data
    );
    return response.data;
  }

  /**
   * 流式发送消息（使用 EventSource）
   */
  async sendMessageStream(
    chatSessionId: string,
    message: string,
    onMessage: (text: string) => void,
    onThinking: (thinking: string) => void,
    onToolUse: (toolName: string, toolInput: Record<string, unknown>) => void,
    onComplete: () => void,
    onError: (error: Error) => void
  ): Promise<void> {
    try {
      const response = await this.client.post(
        `/chat/${chatSessionId}/message/stream`,
        { message },
        {
          responseType: 'stream',
          headers: {
            Accept: 'text/event-stream',
          },
          adapter: 'fetch', // 使用 fetch adapter 以支持流式响应
        }
      );

      // 处理流式响应
      const reader = response.data.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              onComplete();
              return;
            }

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'text') {
                onMessage(parsed.text);
              } else if (parsed.type === 'thinking') {
                onThinking(parsed.thinking);
              } else if (parsed.type === 'tool_use') {
                onToolUse(parsed.name, parsed.input);
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      onError(error as Error);
    }
  }
}

// 导出单例
export const apiService = new APIService();
