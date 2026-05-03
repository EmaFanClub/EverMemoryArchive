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

Model provider secrets are still regular environment variables such as `GEMINI_API_KEY` or `OPENAI_API_KEY`.

For local Docker runs, export them in your shell or add them to your own Compose override file. In setup and dashboard settings, EMA stores the environment variable names, not the secret values.
