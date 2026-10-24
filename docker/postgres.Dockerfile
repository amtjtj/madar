# PostgreSQL with pgvector (ADR 0026), built on the same Alpine image the stack has always used, so an
# existing data directory keeps its collation and needs no dump or reindex. Build from the repo root:
#   docker build -f docker/postgres.Dockerfile -t madar-postgres:18-pgvector0.8.1 .
# Behind sanctions, point BASE_REGISTRY at a domestic mirror and PGVECTOR_URL at a reachable copy of
# the pgvector source archive (or build elsewhere and `docker save` / `docker load`).
ARG BASE_REGISTRY=docker.io/library
ARG POSTGRES_IMAGE=postgres:18-alpine

FROM ${BASE_REGISTRY}/${POSTGRES_IMAGE}
ARG PGVECTOR_VERSION=0.8.1
ARG PGVECTOR_URL=https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz
# Optional: a proxy's CA certificate, passed as `--secret id=ca,src=<file>` (build only).
RUN --mount=type=secret,id=ca,required=false \
    set -eux; \
    # apk trusts only the system bundle: add the proxy's CA for this step, restored below.
    bundle=/etc/ssl/certs/ca-certificates.crt; cp "$bundle" /tmp/ca-bundle.orig; \
    [ -f /run/secrets/ca ] && cat /run/secrets/ca >> "$bundle"; \
    apk add --no-cache --virtual .build-deps build-base curl; \
    ca=""; [ -f /run/secrets/ca ] && ca="--cacert /run/secrets/ca"; \
    curl -fsSL $ca "$PGVECTOR_URL" -o /tmp/pgvector.tar.gz; \
    mkdir /tmp/pgvector; tar -xzf /tmp/pgvector.tar.gz -C /tmp/pgvector --strip-components=1; \
    cd /tmp/pgvector; \
    # Portable (no -march=native) and without LLVM bitcode, so no clang is needed.
    make OPTFLAGS="" with_llvm=no; make install with_llvm=no; \
    cd /; rm -rf /tmp/pgvector /tmp/pgvector.tar.gz; \
    apk del .build-deps; \
    cp /tmp/ca-bundle.orig "$bundle"; rm /tmp/ca-bundle.orig
