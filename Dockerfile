# Single image for every Node service; docker-compose selects the command.
#
# Debian slim rather than Alpine on purpose: esbuild (via tsx/vitest) ships
# glibc binaries, and Playwright — needed by the crawler in later phases —
# officially supports Debian but not musl. The size saving is not worth the
# class of breakage Alpine invites here.
FROM node:22-slim AS base

# HUSKY=0 stops the `prepare` hook from failing: git isn't present in the image.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0 \
    NODE_ENV=production

RUN corepack enable

WORKDIR /app

# Manifests first so the dependency layer caches across source-only changes.
# Workspace packages must be present before install, or pnpm cannot link them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps ./apps

# --prod=false: the services run TypeScript directly through tsx, which is a
# devDependency. Omitting dev deps would produce an image that cannot start.
RUN pnpm install --frozen-lockfile --prod=false

# Config and helper sources needed by the verify service and the scan CLI.
COPY tsconfig.json tsconfig.base.json vitest.config.ts biome.json ./
COPY scripts ./scripts
COPY examples ./examples

RUN useradd --system --create-home --shell /usr/sbin/nologin awe \
    && chown -R awe:awe /app
USER awe

EXPOSE 3000

# Overridden per service in docker-compose.yml.
CMD ["pnpm", "start:api"]
