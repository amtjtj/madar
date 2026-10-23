"""Settings from the environment. The service refuses to start without its token."""

import os
from dataclasses import dataclass


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
