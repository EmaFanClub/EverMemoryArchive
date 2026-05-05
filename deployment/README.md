# Docker Deployment

This directory contains a local Docker Compose setup for running EMA WebUI with MongoDB.

## Local Development

Start the stack from the repository root:

```bash
docker compose -f deployment/local.yml up
```

Run in the background:

```bash
docker compose -f deployment/local.yml up -d
```

Follow logs:

```bash
docker compose -f deployment/local.yml logs -f
```

Stop the stack:

```bash
docker compose -f deployment/local.yml down
```

Rebuild the app image:

```bash
docker compose -f deployment/local.yml up --build
```

## Services

- `mongodb`: local MongoDB 7 instance on port `27017`.
- `app`: Node.js 22 WebUI app on port `3000`.

Open [http://localhost:3000](http://localhost:3000) after the app starts.
Setup generates a 16-character default WebUI access token that can be edited.
After setup, `/dashboard` and API routes require logging in at `/login`; the
browser keeps the token in a 24-hour HttpOnly cookie.

## MongoDB

The compose file passes MongoDB through the WebUI startup command:

```bash
pnpm webui -- --dev --mongo "mongodb://admin:password@mongodb:27017/ema?authSource=admin" --host 0.0.0.0
```

MongoDB is intentionally not configured through `.env`. The public startup interface is the `pnpm webui -- --mongo ...` argument.

Default local credentials:

- Username: `admin`
- Password: `password`
- Database: `ema`

These defaults are for local development only.

## Data

Local Docker data is stored under the repository root:

- `.ema/docker-mongodb`: MongoDB data.
- `.ema/docker-local`: EMA runtime data, logs, workspace, and LanceDB data.
- `.data/next-js-cache`: Next.js development cache.

To reset the local Docker stack data:

```bash
docker compose -f deployment/local.yml down
rm -rf .ema/docker-mongodb .ema/docker-local .data/next-js-cache
```

## Provider Secrets

Setup and dashboard settings store model provider credentials directly. Enter the actual API key for API-key based providers, or the raw service-account JSON for Vertex AI.

Older installs that stored environment variable names such as `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_APPLICATION_CREDENTIALS` must revisit setup and save direct credentials before using the runtime.
