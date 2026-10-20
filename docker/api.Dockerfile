# API, worker and migrations in one image (ADR 0016). Build from the repo root:
#   docker build -f docker/api.Dockerfile -t madar-api .
# Behind sanctions, point BASE_REGISTRY and NPM_REGISTRY at a domestic mirror.
ARG BASE_REGISTRY=docker.io/library
ARG NODE_IMAGE=node:24-alpine

FROM ${BASE_REGISTRY}/${NODE_IMAGE} AS base
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH \
    COREPACK_NPM_REGISTRY=${NPM_REGISTRY} npm_config_registry=${NPM_REGISTRY} \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1 \
    # Optional: a proxy's CA certificate, passed as `--secret id=ca,src=<file>` (build only).
    NODE_EXTRA_CA_CERTS=/run/secrets/ca
RUN --mount=type=secret,id=ca,required=false corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN --mount=type=secret,id=ca,required=false --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN --mount=type=secret,id=ca,required=false pnpm turbo run build --filter=@madar/api... --filter=@madar/db

# Only the API's production dependencies, with @madar/db and @madar/shared copied in (built).
RUN --mount=type=secret,id=ca,required=false --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter=@madar/api deploy --prod --legacy /out \
    && rm -rf /out/src /out/test /out/*.config.* /out/tsconfig*.json /out/CLAUDE.md \
    # better-auth's optional peers (Next.js, React, Vitest) resolve to the workspace's copies;
    # the API never imports them, so they stay out of the image.
    && cd /out/node_modules/.pnpm \
    && rm -rf next@* @next+* @playwright+* playwright@* playwright-core@* vitest@* @vitest+* \
       vite@* @rolldown+* rolldown@* happy-dom@* react@* react-dom@* @img+* sharp@* \
    && find -L /out/node_modules -type l -delete

FROM ${BASE_REGISTRY}/${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
ARG APP_VERSION=0.0.0
ENV APP_VERSION=${APP_VERSION}
# Attachments (ADR 0019): a named volume mounted here takes this owner on first use.
RUN mkdir -p /data/files && chown node:node /data/files
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "dist/scripts/healthcheck.js", "api"]
# Other commands: `node dist/worker.js`, `node node_modules/@madar/db/dist/migrate.js`.
CMD ["node", "--enable-source-maps", "dist/main.js"]
