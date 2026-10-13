# syntax=docker/dockerfile:1.7
# AI Homepage — self-hosted server + browser-extension build, in one image.
#   docker build -t ai-homepage .
# See SELFHOST.md for configuration.

# ---------------------------------------------------------------- build
FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@10.11.1
WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/agent-core/package.json packages/agent-core/
COPY apps/server/package.json apps/server/
COPY apps/extension/package.json apps/extension/
COPY harness/package.json harness/
# The extension's postinstall runs `wxt prepare`, which needs its config, so install after copying everything.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @homepage/server typecheck \
 && pnpm --filter @homepage/server test \
 && pnpm --filter @homepage/server build \
 && pnpm --filter @homepage/extension zip

# ---------------------------------------------------------------- runtime
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/public \
    PORT=8080
WORKDIR /app

# Runtime deps that cannot be bundled (native binary / resolved at runtime), then Chromium + its OS libraries.
COPY --from=build /src/apps/server/dist/runtime-package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund \
 && npx --no-install playwright-core install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=build /src/apps/server/dist/server.mjs ./server.mjs
COPY --from=build /src/apps/server/dist/server.mjs.map ./server.mjs.map
COPY --from=build /src/apps/extension/.output/*-chrome.zip /tmp/extension.zip
RUN mkdir -p /app/public /data \
 && mv /tmp/extension.zip /app/public/extension.zip \
 && groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
 && chown -R app:app /data

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.title="ai-homepage" \
      org.opencontainers.image.description="Self-hosted AI-built personal homepage (fork of ThariqS/ai-newtab)" \
      org.opencontainers.image.source="https://github.com/OWNER/REPO"

USER app
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "server.mjs"]
