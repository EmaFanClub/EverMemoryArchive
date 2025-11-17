# Mini Agent 前端

基于 React + TypeScript + Vite + TailwindCSS 构建的现代化对话界面。

## 技术栈

- **框架**: React 18.2
- **语言**: TypeScript 5.2
- **构建工具**: Vite 5.0
- **样式**: TailwindCSS 3.3
- **路由**: React Router 6.20
- **HTTP 客户端**: Axios 1.6
- **Markdown 渲染**: react-markdown 9.0
- **图标**: lucide-react
- **日期处理**: date-fns 3.0

## 功能特性

### 🔐 用户认证
- 简单的用户名/密码登录
- 自动 session 管理
- 路由守卫保护

### 💬 会话管理
- 创建新对话
- 查看所有会话列表
- 切换不同会话
- 删除会话
- 会话状态显示（活跃/暂停/完成）

### 🤖 智能对话
- 实时消息发送和接收
- Markdown 格式支持
- 代码高亮显示
- 思考过程展示
- 工具调用可视化
- 消息历史记录
- 自动滚动到最新消息

### 🎨 用户界面
- 现代化设计
- 响应式布局
- 优雅的动画效果
- 自定义滚动条
- 自适应输入框
- 加载状态提示

## 项目结构

```
frontend/
├── public/                 # 静态资源
├── src/
│   ├── components/         # React 组件
│   │   ├── Login.tsx       # 登录页面
│   │   ├── SessionList.tsx # 会话列表
│   │   ├── Chat.tsx        # 聊天界面
│   │   └── Message.tsx     # 消息展示
│   ├── services/           # API 服务
│   │   └── api.ts          # API 客户端
│   ├── types/              # TypeScript 类型
│   │   └── index.ts        # 类型定义
│   ├── App.tsx             # 主应用
│   ├── main.tsx            # 入口文件
│   ├── index.css           # 全局样式
│   └── vite-env.d.ts       # Vite 类型声明
├── index.html              # HTML 模板
├── package.json            # 依赖配置
├── tsconfig.json           # TypeScript 配置
├── vite.config.ts          # Vite 配置
├── tailwind.config.js      # Tailwind 配置
├── postcss.config.js       # PostCSS 配置
└── README.md               # 项目文档
```

## 快速开始

### 1. 安装依赖

```bash
cd frontend
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

前端将运行在 http://localhost:3000

### 3. 构建生产版本

```bash
npm run build
```

构建产物将输出到 `dist/` 目录。

### 4. 预览生产版本

```bash
npm run preview
```

## API 配置

前端通过 Vite 代理连接后端 API：

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
```

如果后端运行在不同的地址，请修改 `target` 配置。

## 组件说明

### Login 组件

用户登录界面，包含：
- 用户名输入
- 密码输入
- 错误提示
- 加载状态

**路径**: `src/components/Login.tsx`

### SessionList 组件

会话列表侧边栏，包含：
- 创建新会话按钮
- 会话列表展示
- 会话状态标签
- 删除会话功能
- 退出登录按钮

**路径**: `src/components/SessionList.tsx`

### Chat 组件

主聊天界面，包含：
- 消息历史展示
- 流式响应支持
- 消息输入框
- 发送按钮
- 错误提示
- 加载状态

**路径**: `src/components/Chat.tsx`

### Message 组件

单个消息展示，包含：
- 用户消息样式
- AI 消息样式
- Markdown 渲染
- 代码高亮
- 时间戳
- 思考块展示
- 工具调用展示

**路径**: `src/components/Message.tsx`

## API 服务层

`src/services/api.ts` 提供了完整的 API 封装：

### 认证 API
- `login(username, password)` - 用户登录

### 会话 API
- `createSession()` - 创建新会话
- `getSessions()` - 获取会话列表
- `getSessionHistory(chatSessionId)` - 获取会话历史
- `deleteSession(chatSessionId)` - 删除会话

### 对话 API
- `sendMessage(chatSessionId, message)` - 发送消息
- `sendMessageStream(...)` - 流式发送消息（预留接口）

## 类型系统

所有类型定义在 `src/types/index.ts`：

- `Session` - 会话类型
- `Message` - 消息类型
- `MessageRole` - 消息角色枚举
- `SessionStatus` - 会话状态枚举
- `ContentBlock` - 内容块类型（文本/工具/思考）

## 样式系统

### TailwindCSS

使用 Tailwind 的实用类进行样式开发：

```tsx
<div className="flex items-center gap-2 p-4 bg-primary-500 rounded-lg">
  ...
</div>
```

### 主题颜色

```javascript
// tailwind.config.js
theme: {
  extend: {
    colors: {
      primary: {
        50: '#f0f9ff',
        // ...
        900: '#0c4a6e',
      }
    }
  }
}
```

### 自定义样式

全局样式在 `src/index.css` 中定义：
- 滚动条样式
- Markdown 样式
- 代码块样式
- 表格样式

## 开发规范

### TypeScript

- 所有组件使用 TypeScript
- 为所有 props 定义接口
- 使用严格模式

### 组件规范

- 使用函数组件和 Hooks
- 组件文件名使用 PascalCase
- 一个文件一个组件（除非是紧密相关的小组件）

### 代码风格

- 使用 ESLint 进行代码检查
- 遵循 React Hooks 规则
- 避免不必要的重渲染

```bash
# 运行 ESLint
npm run lint
```

## 常见问题

### 1. 如何修改 API 地址？

编辑 `vite.config.ts` 中的 proxy 配置：

```typescript
proxy: {
  '/api': {
    target: 'http://your-backend-url',
    changeOrigin: true,
  }
}
```

### 2. 如何添加新的路由？

在 `src/App.tsx` 中添加新路由：

```tsx
<Route path="/new-page" element={<NewPage />} />
```

### 3. 如何自定义主题颜色？

编辑 `tailwind.config.js` 中的颜色配置。

### 4. 如何处理跨域问题？

开发环境使用 Vite 代理解决跨域。生产环境需要后端配置 CORS。

## 性能优化

- 使用 React.memo 避免不必要的重渲染
- 使用 useCallback 和 useMemo 优化性能
- 消息列表虚拟化（如果消息数量很大）
- 图片懒加载
- 代码分割和路由懒加载

## 部署

### 构建生产版本

```bash
npm run build
```

### 部署到静态服务器

将 `dist/` 目录部署到任何静态服务器：
- Nginx
- Apache
- Vercel
- Netlify
- GitHub Pages

### Nginx 配置示例

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /path/to/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 浏览器支持

- Chrome (最新版本)
- Firefox (最新版本)
- Safari (最新版本)
- Edge (最新版本)

## 许可证

MIT License

## 相关链接

- [后端 API 文档](../backend/README.md)
- [项目主文档](../README.md)
- [React 官方文档](https://react.dev/)
- [Vite 官方文档](https://vitejs.dev/)
- [TailwindCSS 官方文档](https://tailwindcss.com/)
