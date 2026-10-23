"""HTTP surface. Only the API calls it, over the internal network, with the shared token."""

import hmac
import logging

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import Settings
from .llm import ChatModel, FakeModel, ModelUnavailableError, OpenAICompatibleModel
from .schemas import (
    ReportSummaryRequest,
    ReportSummaryResponse,
    TaskBreakdownRequest,
    TaskBreakdownResponse,
)
from .service import ModelOutputError, report_summary, task_breakdown


def _error(status: int, code: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code}})


class Unauthorized(Exception):
    pass


def create_app(settings: Settings, model: ChatModel | None = None) -> FastAPI:
    chat: ChatModel = model or (
        FakeModel()
        if settings.provider == "fake"
        else OpenAICompatibleModel(settings.base_url, settings.model, settings.timeout)
    )
    app = FastAPI(title="madar-ai", docs_url=None, redoc_url=None, openapi_url=None)

    def authorized(authorization: str = Header(default="")) -> None:
        expected = f"Bearer {settings.token}"
        if not hmac.compare_digest(authorization.encode(), expected.encode()):
            raise Unauthorized

    @app.exception_handler(Unauthorized)
    async def _unauthorized(_: Request, __: Exception) -> JSONResponse:
        return _error(401, "unauthenticated")

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, __: Exception) -> JSONResponse:
        # No echo of the input: it may hold company data.
        return _error(400, "validation_failed")

    @app.exception_handler(ModelUnavailableError)
    async def _unavailable(_: Request, __: Exception) -> JSONResponse:
        return _error(503, "ai_unavailable")

    @app.exception_handler(ModelOutputError)
    async def _failed(_: Request, __: Exception) -> JSONResponse:
        return _error(502, "ai_failed")

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {"status": "ok", "model": chat.name, "modelReachable": await chat.reachable()}

    @app.post(
        "/v1/report-summary",
        dependencies=[Depends(authorized)],
        response_model=ReportSummaryResponse,
        response_model_by_alias=True,
    )
    async def summary(req: ReportSummaryRequest) -> ReportSummaryResponse:
        return await report_summary(chat, req)

    @app.post(
        "/v1/task-breakdown",
        dependencies=[Depends(authorized)],
        response_model=TaskBreakdownResponse,
        response_model_by_alias=True,
    )
    async def breakdown(req: TaskBreakdownRequest) -> TaskBreakdownResponse:
        return await task_breakdown(chat, req)

    return app


def from_env() -> FastAPI:
    """The uvicorn factory (`uvicorn --factory app.main:from_env`)."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    return create_app(Settings.from_env())
