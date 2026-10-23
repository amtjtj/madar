import json
import logging

from app.llm import FakeModel
from tests.conftest import AUTH

MINUTES = {
    "title": "بررسی صف برداشت",
    "kind": "regular",
    "date": "۲ آبان ۱۴۰۵",
    "agenda": "- صف امروز",
    "notes": "صف زیاد بود. تا پنجشنبه با فنی هماهنگ شود\nپاسخ آماده‌ها باید آپدیت شود",
}
REPLY = {
    "subject": "بودجه آبان",
    "body": "لطفاً تا پنجشنبه برآورد هزینه را بفرستید.",
    "sender": "سارا محمدی",
    "recipient": "مریم احمدی",
    "intent": "موافقم ولی تا آخر ماه وقت لازم داریم",
}


def test_minutes_from_the_notes_with_suggested_decisions(make_client):
    client, fake = make_client()
    res = client.post("/v1/minutes", json=MINUTES, headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["text"].startswith("خلاصه آزمایشی دستیار:")
    assert "- صف زیاد بود" in body["text"]
    assert body["decisions"] == ["تا پنجشنبه با فنی هماهنگ شود", "پاسخ آماده‌ها باید آپدیت شود"]
    kind, system, user = fake.calls[0]
    assert kind == "minutes"
    assert "نام تازه اضافه نکن" in system
    assert "دستور جلسه: - صف امروز" in user
    assert "یادداشت‌ها:\nصف زیاد بود" in user


def test_minutes_output_is_cleaned_and_capped(make_client):
    rows = [f"  - مصوبه {i}  " for i in range(9)] + [7, "", "  - مصوبه 0"]
    reply = json.dumps({"text": "  - بند اول\n\n\n\n- بند   دوم  ", "decisions": rows})
    client, _ = make_client(FakeModel(["```json\n" + reply + "\n```"]))
    body = client.post("/v1/minutes", json=MINUTES, headers=AUTH).json()
    assert body["text"] == "- بند اول\n\n- بند دوم"
    assert body["decisions"] == [f"مصوبه {i}" for i in range(6)]


def test_minutes_retry_once_then_ai_failed(make_client):
    good = json.dumps({"text": "- مرتب", "decisions": []}, ensure_ascii=False)
    client, fake = make_client(FakeModel(["oops", good]))
    res = client.post("/v1/minutes", json=MINUTES, headers=AUTH)
    assert res.status_code == 200 and len(fake.calls) == 2
    client, _ = make_client(FakeModel(["no", '{"text": "  ", "decisions": []}']))
    res = client.post("/v1/minutes", json=MINUTES, headers=AUTH)
    assert res.status_code == 502
    assert res.json() == {"error": {"code": "ai_failed"}}


def test_minutes_validates_and_has_no_people_field(make_client):
    client, _ = make_client()
    assert (
        client.post("/v1/minutes", json={**MINUTES, "notes": "ab"}, headers=AUTH).status_code == 400
    )
    extra = {**MINUTES, "participants": ["علی"]}
    assert client.post("/v1/minutes", json=extra, headers=AUTH).status_code == 400
    assert client.post("/v1/minutes", json=MINUTES).status_code == 401


def test_letter_reply_draft(make_client):
    client, fake = make_client()
    thread = [{"sender": "سارا محمدی", "subject": "بودجه", "body": "نامه اول"}]
    res = client.post("/v1/letter-reply", json={**REPLY, "thread": thread}, headers=AUTH)
    assert res.status_code == 200
    text = res.json()["text"]
    assert text.startswith("با سلام و احترام،")
    assert "موافقم ولی تا آخر ماه وقت لازم داریم" in text
    assert "\n\n" in text
    _, system, user = fake.calls[0]
    assert "تعهد، عدد یا تاریخی از خودت نساز" in system
    assert "نامه قبلی از سارا محمدی" in user
    assert "منظور پاسخ‌دهنده: موافقم" in user


def test_letter_reply_without_intent_and_limits(make_client):
    client, fake = make_client()
    no_intent = {k: v for k, v in REPLY.items() if k != "intent"}
    assert client.post("/v1/letter-reply", json=no_intent, headers=AUTH).status_code == 200
    assert "منظور پاسخ‌دهنده" not in fake.calls[0][2]
    three = [{"sender": "الف", "subject": "ب", "body": "پ"}] * 3
    res = client.post("/v1/letter-reply", json={**REPLY, "thread": three}, headers=AUTH)
    assert res.status_code == 400


def test_answer_takes_the_conversation_so_far(make_client):
    client, fake = make_client()
    source = {"n": 1, "kind": "task", "title": "حذف کارمزد", "text": "از آبان"}
    history = [{"question": "کارمزد چه شد؟", "answer": "حذف شد [1]."}]
    body = {"question": "کی؟", "today": "۱ آبان", "sources": [source], "history": history}
    assert client.post("/v1/answer", json=body, headers=AUTH).status_code == 200
    user = fake.calls[0][2]
    assert "گفت‌وگوی قبلی" in user and "سوال: کارمزد چه شد؟" in user
    assert user.index("سوال: کی؟") > user.index("جواب: حذف شد")
    four = {**body, "history": history * 4}
    assert client.post("/v1/answer", json=four, headers=AUTH).status_code == 400


def test_drafts_are_never_logged(make_client, caplog):
    client, _ = make_client()
    with caplog.at_level(logging.INFO, logger="madar.ai"):
        client.post("/v1/minutes", json=MINUTES, headers=AUTH)
        client.post("/v1/letter-reply", json=REPLY, headers=AUTH)
    assert "kind=minutes" in caplog.text and "kind=letter_reply" in caplog.text
    assert "پنجشنبه" not in caplog.text and "بودجه" not in caplog.text
