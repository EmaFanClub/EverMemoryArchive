import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { Session, SessionStatus } from '../types';
import { MessageSquare, Plus, Trash2, LogOut, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale/zh-CN';

interface SessionListProps {
  currentSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
}

export function SessionList({ currentSessionId, onSessionSelect }: SessionListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const response = await apiService.getSessions();
      setSessions(response.sessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSession = async () => {
    setCreating(true);
    try {
      const response = await apiService.createSession();
      await loadSessions();
      onSessionSelect(response.session_id);
    } catch (error) {
      console.error('Failed to create session:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个会话吗？')) return;

    try {
      await apiService.deleteSession(sessionId);
      await loadSessions();
      if (currentSessionId === sessionId) {
        onSessionSelect('');
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleLogout = () => {
    apiService.logout();
    navigate('/login');
  };

  const getStatusBadge = (status: SessionStatus) => {
    const badges = {
      [SessionStatus.ACTIVE]: { text: '活跃', className: 'bg-green-100 text-green-700' },
      [SessionStatus.PAUSED]: { text: '暂停', className: 'bg-yellow-100 text-yellow-700' },
      [SessionStatus.COMPLETED]: { text: '完成', className: 'bg-gray-100 text-gray-700' },
    };
    const badge = badges[status];
    return (
      <span className={`text-xs px-2 py-1 rounded-full ${badge.className}`}>
        {badge.text}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="w-80 bg-gray-50 border-r border-gray-200 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col h-screen">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">对话列表</h2>
        <button
          onClick={handleCreateSession}
          disabled={creating}
          className="w-full bg-primary-500 hover:bg-primary-600 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {creating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              创建中...
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              新建对话
            </>
          )}
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>还没有对话</p>
            <p className="text-sm mt-1">点击上方按钮创建新对话</p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => onSessionSelect(session.id)}
                className={`
                  p-3 rounded-lg cursor-pointer transition-all
                  ${
                    currentSessionId === session.id
                      ? 'bg-primary-100 border-2 border-primary-500'
                      : 'bg-white hover:bg-gray-100 border-2 border-transparent'
                  }
                `}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <MessageSquare className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <span className="font-medium text-gray-800 truncate">
                        {session.title || `会话 ${session.id.slice(0, 8)}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      {getStatusBadge(session.status)}
                      <span>
                        {formatDistanceToNow(new Date(session.updated_at), {
                          addSuffix: true,
                          locale: zhCN,
                        })}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteSession(session.id, e)}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <button
          onClick={handleLogout}
          className="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          退出登录
        </button>
      </div>
    </div>
  );
}
