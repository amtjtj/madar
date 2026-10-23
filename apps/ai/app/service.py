"""The capabilities: checks on what the model returns, and one retry on malformed output."""

import json
import logging
import re
import time
from collections.abc import Awaitable, Callable

from pydantic import ValidationError

from .embed import Embedder
from .llm import ChatModel, Kind
from .prompts import (
    ANSWER_SYSTEM,
    BREAKDOWN_SYSTEM,
    REPORT_SYSTEM,
    answer_message,
    breakdown_message,
    report_message,
)
from .schemas import (
    AnswerRequest,
    AnswerResponse,
    EmbedRequest,
    EmbedResponse,
    ModelTask,
    ReportSummaryRequest,
    ReportSummaryResponse,
    SuggestedTask,
    TaskBreakdownRequest,
    TaskBreakdownResponse,
)

# Never the prompt or the answer: only what ran, how long and how many tokens (ADR 0025).
log = logging.getLogger("madar.ai")

MAX_TASKS = 10
MAX_SUMMARY_CHARS = 1200
MAX_ANSWER_CHARS = 1500


class ModelOutputError(Exception):
    """The model answered, but not with something usable."""


def _record(kind: Kind | str, started: float, tokens: int) -> None:
    log.info("kind=%s ms=%d tokens=%d", kind, (time.monotonic() - started) * 1000, tokens)


async def report_summary(model: ChatModel, req: ReportSummaryRequest) -> ReportSummaryResponse:
    started = time.monotonic()
    completion = await model.complete(
        "report_summary", REPORT_SYSTEM, report_message(req), as_json=False, max_tokens=400
    )
    _record("report_summary", started, completion.tokens)
    text = " ".join(completion.text.split())
    if not text:
        raise ModelOutputError("empty summary")
    if len(text) > MAX_SUMMARY_CHARS:
        text = text[:MAX_SUMMARY_CHARS].rsplit(" ", 1)[0] + "…"
    return ReportSummaryResponse(text=text, model=model.name, tokens=completion.tokens)


def _parse_breakdown(text: str) -> list[SuggestedTask]:
    """
    The tasks in a model's answer. Some servers wrap JSON in a code fence even when asked not to;
    a row that is not a usable task is skipped rather than failing the whole answer.
    """
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end < start:
        raise ModelOutputError("no JSON object")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as error:
        raise ModelOutputError("invalid JSON") from error
    rows = data.get("tasks") if isinstance(data, dict) else None
    tasks: list[SuggestedTask] = []
    for row in rows if isinstance(rows, list) else []:
        try:
            parsed = ModelTask.model_validate(row)
        except ValidationError:
            continue
        title = " ".join(parsed.title.split())[:200]
        due = parsed.due_in_days
        if not title:
            continue
        tasks.append(
            SuggestedTask(
                title=title, due_in_days=due if due is not None and 0 <= due <= 365 else None
            )
        )
    if not tasks:
        raise ModelOutputError("no usable task")
    return tasks[:MAX_TASKS]


async def task_breakdown(
    model: ChatModel,
    req: TaskBreakdownRequest,
    *,
    budget: float,
    gone: Callable[[], Awaitable[bool]] | None = None,
) -> TaskBreakdownResponse:
    """
    One retry on a malformed answer, only while at least half of the time budget is left and the
    caller is still waiting (the API gives up after its own timeout, slightly above `budget`).
    """
    tokens = 0
    begun = time.monotonic()
    for attempt in range(2):
        started = time.monotonic()
        completion = await model.complete(
            "task_breakdown", BREAKDOWN_SYSTEM, breakdown_message(req), as_json=True, max_tokens=600
        )
        tokens += completion.tokens
        _record("task_breakdown", started, completion.tokens)
        try:
            tasks = _parse_breakdown(completion.text)
        except ModelOutputError:
            out_of_time = time.monotonic() - begun > budget / 2
            if attempt == 1 or out_of_time or (gone is not None and await gone()):
                raise
            continue
        return TaskBreakdownResponse(tasks=tasks, model=model.name, tokens=tokens)
    raise ModelOutputError("unreachable")


async def embed(embedder: Embedder, req: EmbedRequest) -> EmbedResponse:
    started = time.monotonic()
    vectors = await embedder.embed(req.texts)
    _record("embed", started, len(req.texts))
    return EmbedResponse(vectors=vectors, model=embedder.name)


_CITATION = re.compile(r"\[([0-9۰-۹]{1,2})\]")
_PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")


def _tidy(text: str) -> str:
    """Paragraphs kept, spaces collapsed, cut at a word near the limit."""
    paragraphs = [" ".join(line.split()) for line in text.splitlines()]
    text = "\n".join(p for p in paragraphs if p)
    if len(text) > MAX_ANSWER_CHARS:
        text = text[:MAX_ANSWER_CHARS].rsplit(" ", 1)[0] + "…"
    return text


def citations(text: str, known: set[int]) -> list[int]:
    """The source numbers an answer cites, in order of first mention; unknown numbers dropped."""
    cited: list[int] = []
    for match in _CITATION.finditer(text):
        n = int(match.group(1).translate(_PERSIAN_DIGITS))
        if n in known and n not in cited:
            cited.append(n)
    return cited


async def answer(model: ChatModel, req: AnswerRequest) -> AnswerResponse:
    """An answer from the given sources only."""
    started = time.monotonic()
    completion = await model.complete(
        "answer", ANSWER_SYSTEM, answer_message(req), as_json=False, max_tokens=500
    )
    _record("answer", started, completion.tokens)
    known = {source.n for source in req.sources}

    # Citations reach the web as `[n]` with Latin digits; a number that is no source is dropped.
    def citation(match: re.Match[str]) -> str:
        n = int(match.group(1).translate(_PERSIAN_DIGITS))
        return f"[{n}]" if n in known else ""

    text = _CITATION.sub(citation, completion.text)
    text = _tidy(text)
    if not text:
        raise ModelOutputError("empty answer")
    return AnswerResponse(
        text=text, cited=citations(text, known), model=model.name, tokens=completion.tokens
    )
