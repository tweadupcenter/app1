# syntax=docker/dockerfile:1.7
# Image multi-cibles : `--target web` (application) ou `--target worker` (conversions, vidéo, expirations).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY db/package.json db/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @immo/web build

# --- Application web ---------------------------------------------------------
FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 STORAGE_DIR=/data/storage
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate && useradd -r -u 10001 immo && mkdir -p /data/storage && chown immo /data/storage
COPY --from=build --chown=immo /app /app
USER immo
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@immo/web", "start"]

# --- Worker (Chromium + ffmpeg + poppler) -----------------------------------
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS worker
ENV NODE_ENV=production STORAGE_DIR=/data/storage
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg poppler-utils && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@10.28.0 --activate && mkdir -p /data/storage && chown pwuser /data/storage
WORKDIR /app
COPY --from=build --chown=pwuser /app /app
USER pwuser
CMD ["pnpm", "--filter", "@immo/worker", "start"]
