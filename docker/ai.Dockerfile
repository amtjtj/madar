# The AI service (ADR 0025): stateless FastAPI in front of a model server. Build from the repo root:
#   docker build -f docker/ai.Dockerfile -t madar-ai .
# Behind sanctions, point BASE_REGISTRY at a domestic mirror and PIP_INDEX_URL at a PyPI mirror.
ARG BASE_REGISTRY=docker.io/library
ARG PYTHON_IMAGE=python:3.13-slim

FROM ${BASE_REGISTRY}/${PYTHON_IMAGE} AS build
ARG PIP_INDEX_URL=https://pypi.org/simple
ENV PIP_INDEX_URL=${PIP_INDEX_URL} PIP_DISABLE_PIP_VERSION_CHECK=1 UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv UV_INDEX_URL=${PIP_INDEX_URL} \
    # Optional: a proxy's CA certificate, passed as `--secret id=ca,src=<file>` (build only).
    SSL_CERT_FILE=/run/secrets/ca
RUN --mount=type=secret,id=ca,required=false \
    sh -c '[ -f /run/secrets/ca ] || unset SSL_CERT_FILE; pip install --no-cache-dir uv==0.11.32'
WORKDIR /app
COPY apps/ai/pyproject.toml apps/ai/uv.lock ./
RUN --mount=type=secret,id=ca,required=false \
    sh -c '[ -f /run/secrets/ca ] || unset SSL_CERT_FILE; uv sync --frozen --no-dev --no-install-project'
COPY apps/ai/app ./app

FROM ${BASE_REGISTRY}/${PYTHON_IMAGE} AS runtime
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1
RUN useradd --system --uid 10001 madar
WORKDIR /app
COPY --from=build /opt/venv /opt/venv
COPY --from=build /app/app ./app
ARG APP_VERSION=0.0.0
ENV APP_VERSION=${APP_VERSION}
USER madar
EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:4200/health', timeout=4).status == 200 else 1)"
CMD ["uvicorn", "--factory", "app.main:from_env", "--host", "0.0.0.0", "--port", "4200", "--no-access-log"]
