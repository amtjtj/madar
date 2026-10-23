"""Settings from the environment. The service refuses to start without its token."""

import os
from dataclasses import dataclass
from pathlib import Path


def root_env(module: Path = Path(__file__)) -> Path | None:
    """The monorepo's one `.env` (apps/ai/app/config.py → repo root), or None outside the repo
    (the Docker image puts the code at /app/app, where there is no such parent)."""
    parents = module.resolve().parents
    return parents[3] / ".env" if len(parents) > 3 else None


def load_root_env(path: Path | None = None) -> None:
    """Development only: fills unset variables from the root `.env`; real variables win."""
    path = path if path is not None else root_env()
    if path is None or not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


@dataclass(frozen=True)
class Settings:
    #: Shared secret between the API and this service (`Authorization: Bearer …`).
    token: str
    #: `openai` (any OpenAI-compatible server: vLLM, llama.cpp) or `fake` (tests, CI, demos).
    provider: str
    #: Base URL of the model server, e.g. `http://llm:8080/v1`.
    base_url: str
    #: Model name the server expects.
    model: str
    #: Seconds before a model call gives up (a 7B model on CPU is slow).
    timeout: float
    #: Embeddings (ADR 0026): `openai` or `fake`, defaulting to the chat provider.
    embed_provider: str = "fake"
    #: Base URL of the embedding server, e.g. `http://embed:8080/v1`.
    embed_base_url: str = ""
    #: Embedding model name (1024 dimensions, e.g. bge-m3).
    embed_model: str = "bge-m3"

    @classmethod
    def from_env(cls) -> "Settings":
        load_root_env()
        token = os.environ.get("AI_SERVICE_TOKEN", "")
        if len(token) < 16:
            raise RuntimeError("AI_SERVICE_TOKEN must be set (at least 16 characters)")
        provider = os.environ.get("LLM_PROVIDER", "openai")
        if provider not in ("openai", "fake"):
            raise RuntimeError("LLM_PROVIDER must be openai or fake")
        embed_provider = os.environ.get("EMBED_PROVIDER", provider)
        if embed_provider not in ("openai", "fake"):
            raise RuntimeError("EMBED_PROVIDER must be openai or fake")
        return cls(
            token=token,
            provider=provider,
            base_url=os.environ.get("LLM_BASE_URL", "http://llm:8080/v1"),
            model=os.environ.get("LLM_MODEL", "qwen2.5-7b-instruct"),
            timeout=float(os.environ.get("LLM_TIMEOUT", "85")),
            embed_provider=embed_provider,
            embed_base_url=os.environ.get("EMBED_BASE_URL", "http://embed:8080/v1"),
            embed_model=os.environ.get("EMBED_MODEL", "bge-m3"),
        )
