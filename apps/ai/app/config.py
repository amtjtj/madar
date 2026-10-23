"""Settings from the environment. The service refuses to start without its token."""

import os
from dataclasses import dataclass
from pathlib import Path

#: The monorepo's one `.env` (development); real environment variables win.
ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


def load_root_env(path: Path = ROOT_ENV) -> None:
    if not path.is_file():
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

    @classmethod
    def from_env(cls) -> "Settings":
        load_root_env()
        token = os.environ.get("AI_SERVICE_TOKEN", "")
        if len(token) < 16:
            raise RuntimeError("AI_SERVICE_TOKEN must be set (at least 16 characters)")
        provider = os.environ.get("LLM_PROVIDER", "openai")
        if provider not in ("openai", "fake"):
            raise RuntimeError("LLM_PROVIDER must be openai or fake")
        return cls(
            token=token,
            provider=provider,
            base_url=os.environ.get("LLM_BASE_URL", "http://llm:8080/v1"),
            model=os.environ.get("LLM_MODEL", "qwen2.5-7b-instruct"),
            timeout=float(os.environ.get("LLM_TIMEOUT", "85")),
        )
