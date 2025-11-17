import { useEffect, useState, useRef } from 'react';
import { apiService } from '../services/api';
import { Message as MessageType, MessageRole } from '../types';
import { Message, ThinkingBlock, ToolUseBlock } from './Message';
import { Send, Loader2, AlertCircle, MessageSquare } from 'lucide-react';

interface ChatProps {
  sessionId: string;
}

export function Chat({ sessionId }: ChatProps) {
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // 流式响应状态
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingTools, setStreamingTools] = useState<Array<{ name: string; input: Record<string, unknown> }>>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (sessionId) {
      loadMessages();
    }
  }, [sessionId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, streamingThinking, streamingTools]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadMessages = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiService.getSessionHistory(sessionId);
      setMessages(response.messages);
    } catch (err) {
      console.error('Failed to load messages:', err);
      setError('加载消息失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || sending) return;

    const userMessage = input.trim();
    setInput('');
    setSending(true);
    setError('');

    // 清空流式状态
    setStreamingText('');
    setStreamingThinking('');
    setStreamingTools([]);

    // 立即添加用户消息到界面
    const tempUserMessage: MessageType = {
      id: `temp-${Date.now()}`,
      session_id: sessionId,
      role: MessageRole.USER,
      content: userMessage,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMessage]);

    try {
      // 使用普通请求（因为流式响应需要特殊处理）
      const response = await apiService.sendMessage(sessionId, userMessage);

      // 添加助手响应
      const assistantMessage: MessageType = {
        id: `temp-assistant-${Date.now()}`,
        session_id: sessionId,
        role: MessageRole.ASSISTANT,
        content: response.response,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

    } catch (err: any) {
      console.error('Failed to send message:', err);

      // 提取详细错误信息
      let errorMessage = '发送消息失败';
      if (err.response?.data?.detail) {
        errorMessage = err.response.data.detail;
      } else if (err.message) {
        errorMessage = err.message;
      }

      setError(errorMessage);
      // 移除临时用户消息
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 自动调整 textarea 高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 text-lg">请选择或创建一个对话</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-screen bg-gray-50">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
          </div>
        ) : messages.length === 0 && !streamingText ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 text-lg mb-2">开始新的对话</p>
              <p className="text-gray-400 text-sm">向 Mini Agent 提问任何问题</p>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}

            {/* 流式响应显示 */}
            {sending && (
              <div className="flex gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                </div>
                <div className="flex-1">
                  {streamingThinking && (
                    <ThinkingBlock thinking={streamingThinking} />
                  )}
                  {streamingTools.map((tool, idx) => (
                    <ToolUseBlock
                      key={idx}
                      toolName={tool.name}
                      toolInput={tool.input}
                    />
                  ))}
                  {streamingText && (
                    <div className="inline-block max-w-[85%] px-4 py-3 rounded-2xl bg-gray-100 text-gray-800">
                      <div className="prose prose-sm max-w-none">
                        {streamingText}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="px-4 py-3 bg-red-50 border-t border-red-200">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-start gap-3 text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium mb-1">发生错误</div>
                <pre className="text-sm whitespace-pre-wrap font-mono bg-red-100 p-2 rounded overflow-x-auto">{error}</pre>
              </div>
              <button
                onClick={() => setError('')}
                className="text-red-500 hover:text-red-700 transition-colors text-xl leading-none"
                aria-label="关闭错误提示"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-gray-200 bg-white p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-3 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息... (Shift+Enter 换行)"
              disabled={sending}
              rows={1}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all outline-none resize-none max-h-32 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="bg-primary-500 hover:bg-primary-600 text-white p-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              {sending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Mini Agent 可能会出错，请验证重要信息
          </p>
        </div>
      </div>
    </div>
  );
}
