"""The embedding gateway (ADR 0026): an OpenAI-compatible `/v1/embeddings` server on our own
network (llama.cpp with bge-m3), or a deterministic fake for tests, CI and demos."""

import hashlib
import math
import re
from typing import Protocol

import httpx

from .llm import ModelReplyError, ModelUnavailableError

#: Vector size the API's `knowledge_chunks.embedding` column holds (bge-m3).
DIMENSIONS = 1024


class Embedder(Protocol):
    name: str

    async def embed(self, texts: list[str]) -> list[list[float]]: ...

    async def reachable(self) -> bool: ...

    async def close(self) -> None: ...


def _checked(vectors: list[list[float]]) -> list[list[float]]:
    for vector in vectors:
        if len(vector) != DIMENSIONS or not all(math.isfinite(x) for x in vector):
            raise ModelReplyError("embedding size")
    return vectors


class OpenAICompatibleEmbedder:
    def __init__(self, base_url: str, model: str, timeout: float) -> None:
        self.name = model
        self._client = httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=timeout)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            response = await self._client.post(
                "/embeddings", json={"model": self.name, "input": texts}
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise ModelUnavailableError(type(error).__name__) from error
        try:
            rows = sorted(response.json()["data"], key=lambda row: int(row["index"]))
            vectors = [[float(x) for x in row["embedding"]] for row in rows]
        except (ValueError, KeyError, TypeError) as error:
            raise ModelReplyError(type(error).__name__) from error
        if len(vectors) != len(texts):
            raise ModelReplyError("embedding count")
        return _checked(vectors)

    async def reachable(self) -> bool:
        try:
            response = await self._client.get("/models", timeout=3)
        except httpx.HTTPError:
            return False
        return response.status_code == 200

    async def close(self) -> None:
        await self._client.aclose()


_WORD = re.compile(r"\w+")


class FakeEmbedder:
    """
    A bag of hashed words, normalised: texts that share words are close, so tests and demos find
    what they look for without a model. Deterministic across runs and machines.
    """

    name = "fake-embed"

    def __init__(self, *, available: bool = True) -> None:
        self._available = available
        self.calls: list[list[str]] = []

    async def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(texts)
        if not self._available:
            raise ModelUnavailableError("fake embedder is down")
        return [self.vector(text) for text in texts]

    @staticmethod
    def vector(text: str) -> list[float]:
        vector = [0.0] * DIMENSIONS
        for word in _WORD.findall(text.lower()):
            digest = hashlib.sha256(word.encode()).digest()
            vector[int.from_bytes(digest[:4], "big") % DIMENSIONS] += 1.0
        norm = math.sqrt(sum(x * x for x in vector))
        if norm == 0:
            vector[0] = 1.0
            return vector
        return [x / norm for x in vector]

    async def reachable(self) -> bool:
        return self._available

    async def close(self) -> None:
        return None
