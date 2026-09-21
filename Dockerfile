# syntax=docker/dockerfile:1

# Marketplace Search — self-hosted image.
#
# Build (with the Facebook scraper, ~1.2 GB):
#   docker build -t marketplace-search .
# Build demo-only (no Chromium, ~250 MB):
#   docker build --build-arg INSTALL_CHROMIUM=false -t marketplace-search:demo .

ARG NODE_VERSION=22-bookworm-slim

# ---------- build the web bundle and compile the server ----------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
# Playwright's browser is installed in the runtime stage, not here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

# ---------- production dependencies only ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace=server --include-workspace-root

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
ARG INSTALL_CHROMIUM=true
# Browsers go somewhere every user can read, not into root's home.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4310 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist \
    CHROMIUM_NO_SANDBOX=true \
    SOURCE=demo

WORKDIR /app
# --chown on the COPY itself; a later `chown -R` would duplicate every file
# into a new layer and roughly double the image size.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/server/package.json ./server/package.json
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/web/dist ./web/dist

# Chromium plus its system libraries. Skipped when INSTALL_CHROMIUM=false,
# which leaves a much smaller image that can only run SOURCE=demo.
RUN if [ "$INSTALL_CHROMIUM" = "true" ]; then \
      npx --no-install playwright install --with-deps chromium && \
      chmod -R a+rX /ms-playwright && \
      rm -rf /var/lib/apt/lists/*; \
    fi

# /data holds the SQLite database and must be writable by the running user.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 4310

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4310)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
