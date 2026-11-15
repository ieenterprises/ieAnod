FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN corepack enable && pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN pnpm exec vite build \
    && node_modules/.bin/esbuild src/providers/container-browser/worker.ts src/providers/container-browser/bridge.ts --bundle --platform=node --format=esm --outdir=/app/browser-dist --out-extension:.js=.mjs \
    && pnpm prune --prod && pnpm store prune

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates chromium xvfb xauth xdotool ffmpeg \
    fonts-liberation fonts-noto-core fonts-noto-color-emoji \
    python3 python-is-python3 python3-pip python3-venv python3-requests python3-bs4 pipx \
    poppler-utils jq curl git unzip ripgrep qpdf zip xz-utils file sqlite3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/browser-dist/worker.mjs ./worker.mjs
COPY --from=build --chown=node:node /app/browser-dist/bridge.mjs ./bridge.mjs
COPY --chown=node:node docs/src/content/docs ./docs/src/content/docs
COPY --chmod=555 src/providers/container-browser/xvfb.sh /usr/local/bin/Xvfb
COPY --chmod=555 deployment/render/docker-shim.sh /usr/local/bin/docker
COPY --chmod=555 deployment/render/chromium-render.sh /app/src/providers/container-browser/chromium.sh
COPY --chown=node:node deployment/render/bootstrap.mjs ./bootstrap.mjs
RUN chmod 555 /app/node_modules/agent-browser/bin/agent-browser-linux-* \
    && mkdir -p /data /var/lib/nod/workspaces /home/node/.local/bin \
    && ln -s /var/lib/nod/workspaces /workspace \
    && chown -R node:node /data /var/lib/nod /home/node \
    && chmod 700 /data /var/lib/nod
USER node
ENV NODE_ENV=production
ENV NOD_ENVIRONMENT=production
ENV NOD_DATA_ROOT=/var/lib/nod
ENV NOD_HOST=0.0.0.0
ENV LANG=C.UTF-8
ENV NPM_CONFIG_PREFIX=/home/node/.local
ENV PIPX_HOME=/home/node/.local/pipx
ENV PIPX_BIN_DIR=/home/node/.local/bin
ENV PATH=/home/node/.local/bin:$PATH
EXPOSE 10000
CMD ["node", "/app/bootstrap.mjs"]
