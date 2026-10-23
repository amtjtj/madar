"""Request and response bodies (camelCase on the wire, like the rest of Madar's API)."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Text = Annotated[str, Field(min_length=1, max_length=200)]


class Body(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Totals(Body):
    done: int = Field(ge=0)
    created: int = Field(ge=0)
    overdue: int | None = Field(default=None, ge=0)


class DepartmentFacts(Body):
    name: Text
    done: int = Field(ge=0)
    overdue: int = Field(ge=0)
    behind: bool
    goal_progress: float | None = Field(default=None, ge=0, le=1)


class GoalFacts(Body):
    title: Text
    progress: float = Field(ge=0, le=1)
    change: float | None = None


class ProjectFacts(Body):
    name: Text
    done: int = Field(ge=0)
    total: int = Field(ge=0)
    overdue: int = Field(ge=0)


class ReportSummaryRequest(Body):
    """
    The facts of one weekly report. It never carries people: the API leaves out every name
    (CLAUDE.md AI rules; the report itself never counts or compares people, ADR 0015).
    """

    scope: Literal["company", "department"]
    name: Text
    week_label: Text
    partial: bool
    totals: Totals
    previous: Totals
    departments: list[DepartmentFacts] = Field(default_factory=list, max_length=50)
    goals: list[GoalFacts] = Field(default_factory=list, max_length=30)
    at_risk_projects: list[ProjectFacts] = Field(default_factory=list, max_length=20)
    highlights: list[Text] = Field(default_factory=list, max_length=10)
    stuck: int = Field(default=0, ge=0)


class ReportSummaryResponse(Body):
    text: str
    model: str
    tokens: int


class TaskBreakdownRequest(Body):
    sentence: Annotated[str, Field(min_length=3, max_length=300)]
    department: Text
    today: Text


class SuggestedTask(Body):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    due_in_days: int | None = Field(default=None, ge=0, le=365)


class ModelTask(BaseModel):
    """One task as a model writes it: extra keys ignored, a long title cut, a bad date dropped."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")
    title: Annotated[str, Field(min_length=1)]
    due_in_days: int | None = None


class TaskBreakdownResponse(Body):
    tasks: list[SuggestedTask]
    model: str
    tokens: int


class EmbedRequest(Body):
    """Texts to embed (ADR 0026): chunks of company knowledge, or one question."""

    texts: list[Annotated[str, Field(min_length=1, max_length=4000)]] = Field(
        min_length=1, max_length=64
    )


class EmbedResponse(Body):
    vectors: list[list[float]]
    model: str


class AnswerSource(Body):
    """One chunk the asking person may see, numbered for citations."""

    n: int = Field(ge=1, le=20)
    kind: Literal["task", "letter", "meeting", "channel"]
    title: Text
    text: Annotated[str, Field(min_length=1, max_length=2000)]


class AnswerRequest(Body):
    question: Annotated[str, Field(min_length=3, max_length=500)]
    today: Text
    sources: list[AnswerSource] = Field(min_length=1, max_length=8)
    history: list["Turn"] = Field(default_factory=list, max_length=3)


class AnswerResponse(Body):
    text: str
    cited: list[int]
    model: str
    tokens: int


class Turn(Body):
    """An earlier question and answer on the same «از مدار بپرس» page (not stored anywhere)."""

    question: Annotated[str, Field(min_length=1, max_length=500)]
    answer: Annotated[str, Field(min_length=1, max_length=1500)]


class MinutesRequest(Body):
    """A meeting's facts and the minute-taker's own notes; no participant list (ADR 0025)."""

    title: Text
    kind: Literal["regular", "okr_review", "one_on_one"]
    date: Text
    agenda: Annotated[str, Field(max_length=4000)] = ""
    notes: Annotated[str, Field(min_length=3, max_length=8000)]


class MinutesResponse(Body):
    text: str
    decisions: list[str]
    model: str
    tokens: int


class ThreadLetter(Body):
    sender: Text
    subject: Text
    body: Annotated[str, Field(min_length=1, max_length=3000)]


class LetterReplyRequest(Body):
    subject: Text
    body: Annotated[str, Field(min_length=1, max_length=8000)]
    sender: Text
    recipient: Text
    thread: list[ThreadLetter] = Field(default_factory=list, max_length=2)
    intent: Annotated[str, Field(max_length=300)] = ""


class LetterReplyResponse(Body):
    text: str
    model: str
    tokens: int


AnswerRequest.model_rebuild()
