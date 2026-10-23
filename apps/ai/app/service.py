"""The two capabilities: checks on what the model returns, and one retry on malformed output."""

import json
import logging
import time

from pydantic import ValidationError

from .llm import ChatModel, Kind
from .prompts import BREAKDOWN_SYSTEM, REPORT_SYSTEM, breakdown_message, report_message
from .schemas import (
    ModelBreakdown,
    ReportSummaryRequest,
    ReportSummaryResponse,
    TaskBreakdownRequest,
    TaskBreakdownResponse,
)

# Never the prompt or the answer: only what ran, how long and how many tokens (ADR 0025).
log = logging.getLogger("madar.ai")

MAX_TASKS = 10
MAX_SUMMARY_CHARS = 1200


class ModelOutputError(Exception):
    """The model answered, but not with something usable."""


def _record(kind: Kind, started: float, tokens: int) -> None:
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


def _parse_breakdown(text: str) -> ModelBreakdown:
    # Some servers wrap JSON in a code fence even when asked not to.
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end < start:
        raise ModelOutputError("no JSON object")
    try:
        return ModelBreakdown.model_validate(json.loads(text[start : end + 1]))
    except (json.JSONDecodeError, ValidationError) as error:
        raise ModelOutputError("invalid breakdown") from error


async def task_breakdown(model: ChatModel, req: TaskBreakdownRequest) -> TaskBreakdownResponse:
    tokens = 0
    for attempt in range(2):
        started = time.monotonic()
        completion = await model.complete(
            "task_breakdown", BREAKDOWN_SYSTEM, breakdown_message(req), as_json=True, max_tokens=600
        )
        tokens += completion.tokens
        _record("task_breakdown", started, completion.tokens)
        try:
            parsed = _parse_breakdown(completion.text)
        except ModelOutputError:
            if attempt == 1:
                raise
            continue
        return TaskBreakdownResponse(
            tasks=parsed.tasks[:MAX_TASKS], model=model.name, tokens=tokens
        )
    raise ModelOutputError("unreachable")
