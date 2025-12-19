# EverMemoryArchive
![Logo](./resources/logo.png)

[English](./README.md) | 中文

**EverMemoryArchive** 是Ema Fan Club通过长期记忆赋予agent持续演化的人格的一次尝试。我们致力于为每个人构建真正懂你的AI伙伴——它既是处理日常事务的多面手，也是理解你情感需求的知己。


## 设计框架

![设计框架](./resources/framework2025-12-17.png)


## 快速开始

```bash
pnpm install
```

### 环境变量配置

将 `.env.example` 文件复制为 `.env` 并填写您的 API 密钥：

```bash
cp .env.example .env
```

LLM 功能需要以下变量：
- `GEMINI_API_KEY`: 您的 Gemini 或 OpenAI 兼容的 API 密钥。
- `GEMINI_API_BASE`: API 基础地址（默认为 Google Gemini API）。
- `GEMINI_MODEL`: 使用的模型名称（例如 `gemini-3-flash-preview`）。

运行或开发应用：

```bash
pnpm start
# 或者
pnpm dev
```

## 贡献

请参阅 [CONTRIBUTING_CN.md](./CONTRIBUTING_CN.md) 了解更多细节。
