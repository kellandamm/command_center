# syntax=docker/dockerfile:1.7
# Personal command center dashboard — single Node container on :8080.
#   docker build -t command-center .
# See SELFHOST.md for configuration.

FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@10.11.1
WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/agent-core/package.json packages/agent-core/
COPY apps/extension/package.json apps/extension/
COPY harness/package.json harness/
COPY apps/server ./apps/server
RUN pnpm install --frozen-lockfile --filter @homepage/server...
RUN pnpm --filter @homepage/server typecheck \
 && pnpm --filter @homepage/server test \
 && pnpm --filter @homepage/server build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080
WORKDIR /app
COPY --from=build /src/apps/server/dist/server.mjs ./server.mjs
COPY --from=build /src/apps/server/dist/server.mjs.map ./server.mjs.map
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data && chown -R app:app /data

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.title="command-center" \
      org.opencontainers.image.description="Self-hosted personal command center dashboard" \
      org.opencontainers.image.source="https://github.com/OWNER/REPO"

USER app
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "server.mjs"]
