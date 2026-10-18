# syntax=docker/dockerfile:1
# Web app: Next.js standalone server (ADR 0016). Build from the repo root:
#   docker build -f docker/web.Dockerfile -t madar-web .
ARG BASE_REGISTRY=docker.io/library
ARG NODE_IMAGE=node:24-alpine

FROM ${BASE_REGISTRY}/${NODE_IMAGE} AS build
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH \
    COREPACK_NPM_REGISTRY=${NPM_REGISTRY} npm_config_registry=${NPM_REGISTRY} \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1 \
    # Optional: a proxy's CA certificate, passed as `--secret id=ca,src=<file>` (build only).
    NODE_EXTRA_CA_CERTS=/run/secrets/ca \
    # Rewrites are resolved at build time; Caddy routes /api in production, this is the fallback.
    API_INTERNAL_URL=http://api:4000
RUN --mount=type=secret,id=ca,required=false corepack enable
WORKDIR /app
COPY . .
RUN --mount=type=secret,id=ca,required=false --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN --mount=type=secret,id=ca,required=false pnpm turbo run build --filter=@madar/web

FROM ${BASE_REGISTRY}/${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
