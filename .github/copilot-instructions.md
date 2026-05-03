## Project Structure

- [`packages/ema`](/packages/ema): Core runtime, controllers, database access, channels, memory, and LLM/embedding integrations.
- [`packages/ema-webui`](/packages/ema-webui): Next.js WebUI and REST API routes for the EMA application.

## Development Process

The project is developed with TypeScript, pnpm, Next.js, and Vitest.

- Keep public classes, methods, and exported types documented with JSDoc when their behavior is not obvious from the signature.
- Write focused tests in `**/*.spec.ts` for core behavior and regressions.
- Format code with `pnpm format`.
- Keep docs in sync when public behavior, setup, or workflows change.

## Common Commands

```bash
pnpm webui -- --dev
pnpm --filter ema-webui lint
pnpm --filter ema-webui build
pnpm --filter ema build
pnpm --filter ema test --run
pnpm format
```

## Core Development

The `ema` package owns the application runtime:

- actor lifecycle and runtime state
- controller APIs used by WebUI routes
- MongoDB and LanceDB persistence
- channel runtimes such as QQ
- chat, memory, LLM, embedding, and search integration

Prefer adding behavior through existing controllers and services instead of bypassing them from the WebUI.

## WebUI Development

The `ema-webui` package owns the Next.js application:

- pages and UI components
- transport functions
- `/api/v1beta1/*` routes that adapt WebUI DTOs to `ema` controllers

Keep API routes REST-shaped and actor-scoped where applicable. Avoid reintroducing WebUI mock server state for behavior that already exists in `ema`.
