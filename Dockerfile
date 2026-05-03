FROM node:22-alpine

RUN npm install -g pnpm@10.16.1

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY scripts ./scripts
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "webui", "--", "--dev", "--host", "0.0.0.0"]
