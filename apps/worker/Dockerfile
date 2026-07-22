# Build context is the repo root (workspace-aware):
#   docker build -f apps/worker/Dockerfile -t awe-worker .
FROM node:22-alpine

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile --prod=false

ENV NODE_ENV=production

CMD ["pnpm", "exec", "tsx", "apps/worker/src/index.ts"]
