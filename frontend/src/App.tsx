import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './components/Login';
import { SessionList } from './components/SessionList';
import { Chat } from './components/Chat';
import { apiService } from './services/api';

// 主页面组件
function HomePage() {
  const [currentSessionId, setCurrentSessionId] = useState<string>('');

  return (
    <div className="flex h-screen">
      <SessionList
        currentSessionId={currentSessionId}
        onSessionSelect={setCurrentSessionId}
      />
      <Chat sessionId={currentSessionId} />
    </div>
  );
}

// 路由守卫组件
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = !!apiService.getSessionId();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
