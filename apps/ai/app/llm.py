"""The model gateway: any OpenAI-compatible server on our own network, or a deterministic fake."""

import json
import re
from dataclasses import dataclass
from typing import Literal, Protocol

import httpx

Kind = Literal["report_summary", "task_breakdown"]


@dataclass(frozen=True)
class Completion:
    text: str
    tokens: int


class ModelUnavailableError(Exception):
    """The model server did not answer (down, timeout, refused)."""


class ModelReplyError(Exception):
    """The model server answered with something that is not a chat completion."""


class ChatModel(Protocol):
    name: str

    async def complete(
        self, kind: Kind, system: str, user: str, *, as_json: bool, max_tokens: int
    ) -> Completion: ...

    async def reachable(self) -> bool: ...

    async def close(self) -> None: ...


class OpenAICompatibleModel:
    """vLLM (GPU) or llama.cpp's server (CPU): both speak `/v1/chat/completions`."""

    def __init__(self, base_url: str, model: str, timeout: float) -> None:
        self.name = model
        self._client = httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=timeout)

    async def complete(
        self, kind: Kind, system: str, user: str, *, as_json: bool, max_tokens: int
    ) -> Completion:
        body: dict[str, object] = {
            "model": self.name,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.3,
            "max_tokens": max_tokens,
        }
        if as_json:
            body["response_format"] = {"type": "json_object"}
        try:
            response = await self._client.post("/chat/completions", json=body)
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise ModelUnavailableError(type(error).__name__) from error
        try:
            data = response.json()
            text = str(data["choices"][0]["message"]["content"] or "")
            tokens = int((data.get("usage") or {}).get("total_tokens") or 0)
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise ModelReplyError(type(error).__name__) from error
        return Completion(text=text, tokens=tokens)

    async def close(self) -> None:
        await self._client.aclose()

    async def reachable(self) -> bool:
        try:
            response = await self._client.get("/models", timeout=3)
        except httpx.HTTPError:
            return False
        return response.status_code == 200


class FakeModel:
    """
    Deterministic answers for tests, CI and demos without a model. `script` replaces the answers
    in order (to test malformed output); otherwise they are derived from the prompt.
    """

    name = "fake"

    def __init__(self, script: list[str] | None = None, *, available: bool = True) -> None:
        self._script = list(script or [])
        self._available = available
        self.calls: list[tuple[Kind, str, str]] = []

    async def complete(
        self, kind: Kind, system: str, user: str, *, as_json: bool, max_tokens: int
    ) -> Completion:
        self.calls.append((kind, system, user))
        if not self._available:
            raise ModelUnavailableError("fake model is down")
        if self._script:
            return Completion(text=self._script.pop(0), tokens=10)
        if kind == "task_breakdown":
            match = re.search(r"جمله: (.+)", user)
            subject = (match.group(1) if match else "کار").strip()
            steps = ["برنامه‌ریزی", "آماده‌سازی", "اجرا", "گزارش نتیجه"]
            tasks = [
                {"title": f"{step}: {subject}", "dueInDays": (i + 1) * 2}
                for i, step in enumerate(steps)
            ]
            return Completion(text=json.dumps({"tasks": tasks}, ensure_ascii=False), tokens=40)
        lines = [line for line in user.splitlines() if line.startswith("- ")][:2]
        text = "خلاصه آزمایشی دستیار: " + " ".join(line[2:] for line in lines)
        return Completion(text=text, tokens=30)

    async def reachable(self) -> bool:
        return self._available

    async def close(self) -> None:
        return None
