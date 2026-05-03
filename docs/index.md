# EverMemoryArchive

EverMemoryArchive is an agent application for creating memory-based actors that can chat through the WebUI and connected channels.

## Packages

- `packages/ema`: core runtime, controllers, persistence, memory, channels, and model integrations.
- `packages/ema-webui`: Next.js WebUI and API routes.

## Quick Start

Install dependencies:

```bash
pnpm install
```

Start a development WebUI with an in-memory MongoDB instance:

```bash
pnpm webui -- --dev
```

Start with a remote MongoDB instance:

```bash
pnpm webui -- --prod --mongo "mongodb://user:password@host:27017/ema?authSource=admin"
```

Before setup, create a `.env` file from `.env.example` and fill the provider secrets referenced by setup.

## References

- [Core References](/core/)
- [API Reference](/api-reference/)
