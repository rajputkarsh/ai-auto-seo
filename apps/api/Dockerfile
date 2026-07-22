# Build context is the repo root (workspace-aware):
#   docker build -f apps/api/Dockerfile -t awe-api .
FROM node:22-alpine

RUN corepack enable
WORKDIR /app

# Manifests first so dependency layers cache across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile --prod=false

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["pnpm", "exec", "tsx", "apps/api/src/index.ts"]
