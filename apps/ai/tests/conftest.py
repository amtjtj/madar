import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.embed import FakeEmbedder
from app.llm import FakeModel
from app.main import create_app

TOKEN = "test-token-0123456789"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def settings() -> Settings:
    return Settings(token=TOKEN, provider="fake", base_url="", model="fake", timeout=5)


@pytest.fixture
def make_client():
    def make(
        model: FakeModel | None = None, embedder: FakeEmbedder | None = None
    ) -> tuple[TestClient, FakeModel]:
        fake = model or FakeModel()
        return TestClient(create_app(settings(), fake, embedder or FakeEmbedder())), fake

    return make
