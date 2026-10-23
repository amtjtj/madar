import json
import logging

from tests.conftest import AUTH

REPORT = {
    "scope": "department",
    "name": "پشتیبانی",
    "weekLabel": "۳ تا ۹ آبان ۱۴۰۵",
    "partial": False,
    "totals": {"done": 42, "created": 30, "overdue": 2},
    "previous": {"done": 34, "created": 28, "overdue": None},
    "atRiskProjects": [{"name": "پشتیبانی شبانه", "done": 3, "total": 10, "overdue": 2}],
    "highlights": ["راه‌اندازی پاسخ خودکار"],
    "stuck": 1,
}
BREAKDOWN = {"sentence": "کمپین یلدا را راه بینداز", "department": "مارکتینگ", "today": "۱ آبان"}


def test_requires_the_token(make_client):
    client, _ = make_client()
    assert client.post("/v1/task-breakdown", json=BREAKDOWN).status_code == 401
    bad = {"Authorization": "Bearer wrong"}
    assert client.post("/v1/report-summary", json=REPORT, headers=bad).status_code == 401


def test_health_is_open_and_says_whether_the_model_answers(make_client):
    from app.llm import FakeModel

    client, _ = make_client(FakeModel(available=False))
    body = client.get("/health").json()
    assert body == {
        "status": "ok",
        "model": "fake",
        "modelReachable": False,
        "embedModel": "fake-embed",
        "embedReachable": True,
    }


def test_rejects_invalid_input_without_echoing_it(make_client):
    client, _ = make_client()
    res = client.post("/v1/task-breakdown", json={**BREAKDOWN, "sentence": "ab"}, headers=AUTH)
    assert res.status_code == 400
    assert res.json() == {"error": {"code": "validation_failed"}}
    extra = client.post("/v1/report-summary", json={**REPORT, "people": ["x"]}, headers=AUTH)
    assert extra.status_code == 400


def test_breaks_a_sentence_into_tasks(make_client):
    client, fake = make_client()
    res = client.post("/v1/task-breakdown", json=BREAKDOWN, headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["model"] == "fake"
    assert len(body["tasks"]) == 4
    assert body["tasks"][0] == {"title": "برنامه‌ریزی: کمپین یلدا را راه بینداز", "dueInDays": 2}
    assert "جمله: کمپین یلدا را راه بینداز" in fake.calls[0][2]


def test_retries_malformed_output_once_then_fails(make_client):
    from app.llm import FakeModel

    good = json.dumps({"tasks": [{"title": "تعیین بودجه"}]}, ensure_ascii=False)
    client, fake = make_client(FakeModel(["not json", "```json\n" + good + "\n```"]))
    res = client.post("/v1/task-breakdown", json=BREAKDOWN, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["tasks"] == [{"title": "تعیین بودجه", "dueInDays": None}]
    assert len(fake.calls) == 2

    client, _ = make_client(FakeModel(["oops", '{"tasks": []}']))
    res = client.post("/v1/task-breakdown", json=BREAKDOWN, headers=AUTH)
    assert res.status_code == 502
    assert res.json() == {"error": {"code": "ai_failed"}}


def test_keeps_at_most_ten_tasks(make_client):
    from app.llm import FakeModel

    many = json.dumps({"tasks": [{"title": f"کار {i}"} for i in range(14)]})
    client, _ = make_client(FakeModel([many]))
    res = client.post("/v1/task-breakdown", json=BREAKDOWN, headers=AUTH)
    assert len(res.json()["tasks"]) == 10


def test_summarises_a_report_from_its_facts_only(make_client):
    client, fake = make_client()
    res = client.post("/v1/report-summary", json=REPORT, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["text"].startswith("خلاصه آزمایشی دستیار:")
    kind, system, user = fake.calls[0]
    assert kind == "report_summary"
    assert "نام هیچ کسی را نیاور" in system
    assert "کار انجام‌شده: 42 (هفته قبل 34)" in user
    assert "پروژه در خطر «پشتیبانی شبانه»" in user


def test_an_unreachable_model_is_503(make_client):
    from app.llm import FakeModel

    client, _ = make_client(FakeModel(available=False))
    res = client.post("/v1/report-summary", json=REPORT, headers=AUTH)
    assert res.status_code == 503
    assert res.json() == {"error": {"code": "ai_unavailable"}}


def test_logs_never_hold_company_text(make_client, caplog):
    client, _ = make_client()
    with caplog.at_level(logging.INFO, logger="madar.ai"):
        client.post("/v1/task-breakdown", json=BREAKDOWN, headers=AUTH)
        client.post("/v1/report-summary", json=REPORT, headers=AUTH)
    text = caplog.text
    assert "kind=task_breakdown" in text
    assert "یلدا" not in text
    assert "پشتیبانی" not in text


def test_settings_come_from_the_environment(tmp_path, monkeypatch):
    import pytest

    from app.config import Settings, load_root_env

    env = tmp_path / ".env"
    env.write_text("# comment\nAI_SERVICE_TOKEN=from-file-0123456789\nLLM_PROVIDER=fake\n")
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    load_root_env(env)
    assert Settings.from_env().token == "from-file-0123456789"
    monkeypatch.setenv("AI_SERVICE_TOKEN", "short")
    with pytest.raises(RuntimeError):
        Settings.from_env()


def test_the_root_env_is_optional_outside_the_repo():
    from pathlib import Path

    from app.config import load_root_env, root_env

    # The Docker image: /app/app/config.py has no repo root above it.
    assert root_env(Path("/app/app/config.py")) is None
    load_root_env(Path("/nonexistent/.env"))  # no error


def test_keeps_usable_rows_of_a_loose_answer(make_client):
    from app.llm import FakeModel

    loose = json.dumps(
        {
            "tasks": [
                {"title": "تعیین بودجه", "dueInDays": 3, "assignee": "x", "description": "y"},
                {"title": "", "dueInDays": 2},
                {"title": "طراحی بنر", "dueInDays": 900},
                {"nope": True},
            ]
        },
        ensure_ascii=False,
    )
    client, _ = make_client(FakeModel([loose]))
    res = client.post("/v1/task-breakdown", json=BREAKDOWN, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["tasks"] == [
        {"title": "تعیین بودجه", "dueInDays": 3},
        {"title": "طراحی بنر", "dueInDays": None},
    ]


def test_no_retry_when_the_budget_is_spent():
    import asyncio

    import pytest

    from app.llm import FakeModel
    from app.schemas import TaskBreakdownRequest
    from app.service import ModelOutputError, task_breakdown

    fake = FakeModel(["oops", '{"tasks": [{"title": "x"}]}'])
    req = TaskBreakdownRequest.model_validate(BREAKDOWN)
    with pytest.raises(ModelOutputError):
        asyncio.run(task_breakdown(fake, req, budget=0))
    assert len(fake.calls) == 1


def test_a_reply_that_is_not_a_completion_is_ai_failed(monkeypatch):
    import asyncio

    import httpx
    import pytest

    from app.llm import ModelReplyError, OpenAICompatibleModel

    model = OpenAICompatibleModel("http://llm.test/v1", "m", 5)
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"oops": 1}))
    model._client = httpx.AsyncClient(base_url="http://llm.test/v1", transport=transport)
    with pytest.raises(ModelReplyError):
        asyncio.run(model.complete("report_summary", "s", "u", as_json=False, max_tokens=5))
