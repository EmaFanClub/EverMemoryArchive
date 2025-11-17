import { Message as MessageType, MessageRole } from '../types';
import { User, Bot, Lightbulb, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { format } from 'date-fns';

interface MessageProps {
  message: MessageType;
}

interface ThinkingBlockProps {
  thinking: string;
}

interface ToolUseBlockProps {
  toolName: string;
  toolInput: Record<string, unknown>;
}

// 思考块组件
export function ThinkingBlock({ thinking }: ThinkingBlockProps) {
  return (
    <div className="my-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
      <div className="flex items-start gap-2">
        <Lightbulb className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-medium text-amber-800 mb-1">思考过程</div>
          <div className="text-sm text-amber-700 whitespace-pre-wrap">{thinking}</div>
        </div>
      </div>
    </div>
  );
}

// 工具使用块组件
export function ToolUseBlock({ toolName, toolInput }: ToolUseBlockProps) {
  return (
    <div className="my-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
      <div className="flex items-start gap-2">
        <Wrench className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-medium text-blue-800 mb-1">
            使用工具: <code className="px-1.5 py-0.5 bg-blue-100 rounded">{toolName}</code>
          </div>
          <pre className="text-xs text-blue-700 overflow-x-auto">
            {JSON.stringify(toolInput, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function Message({ message }: MessageProps) {
  const isUser = message.role === MessageRole.USER;
  const isSystem = message.role === MessageRole.SYSTEM;

  // 系统消息样式
  if (isSystem) {
    return (
      <div className="flex justify-center my-4">
        <div className="bg-gray-100 text-gray-600 text-sm px-4 py-2 rounded-full">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-4`}>
      {/* Avatar */}
      <div
        className={`
          w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
          ${isUser ? 'bg-primary-500' : 'bg-gray-700'}
        `}
      >
        {isUser ? (
          <User className="w-5 h-5 text-white" />
        ) : (
          <Bot className="w-5 h-5 text-white" />
        )}
      </div>

      {/* Message Content */}
      <div className={`flex-1 ${isUser ? 'flex flex-col items-end' : ''}`}>
        <div
          className={`
            inline-block max-w-[85%] px-4 py-3 rounded-2xl
            ${
              isUser
                ? 'bg-primary-500 text-white'
                : 'bg-gray-100 text-gray-800'
            }
          `}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // 自定义代码块样式
                  code: ({ inline, className, children, ...props }) => {
                    if (inline) {
                      return (
                        <code
                          className="px-1.5 py-0.5 bg-gray-200 rounded text-sm font-mono"
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code
                        className={`block p-3 bg-gray-800 text-gray-100 rounded-lg overflow-x-auto ${className}`}
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  // 自定义链接样式
                  a: ({ children, ...props }) => (
                    <a
                      className="text-primary-600 hover:text-primary-700 underline"
                      target="_blank"
                      rel="noopener noreferrer"
                      {...props}
                    >
                      {children}
                    </a>
                  ),
                  // 自定义表格样式
                  table: ({ children, ...props }) => (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200" {...props}>
                        {children}
                      </table>
                    </div>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className={`text-xs text-gray-400 mt-1 px-1 ${isUser ? 'text-right' : ''}`}>
          {format(new Date(message.created_at), 'HH:mm:ss')}
        </div>
      </div>
    </div>
  );
}
