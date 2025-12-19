# EverMemoryArchive
![Logo](./resources/logo.png)

English | [中文](./README_CN.md)

**EverMemoryArchive** represents Ema Fan Club's initiative to imbue agents with continuously evolving personalities via long-term memory mechanisms. Our goal is to build AI companions that truly understand you—functioning as versatile assistants for daily operations while serving as empathetic partners attuned to your emotional landscape.


## Framework
![framework](./resources/framework2025-12-17.png)


## Getting Started

```bash
pnpm install
```

### Environment Variables

Copy the `.env.example` file to `.env` and fill in your API keys:

```bash
cp .env.example .env
```

The following variables are required for LLM functionality:
- `GEMINI_API_KEY`: Your Gemini or OpenAI-compatible API key.
- `GEMINI_API_BASE`: API base URL (defaults to Google Gemini API).
- `GEMINI_MODEL`: The model name to use (e.g., `gemini-3-flash-preview`).

Run or develop application:

```bash
pnpm start
# or
pnpm dev
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.
