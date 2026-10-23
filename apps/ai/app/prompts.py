"""System prompts and the user messages built from request facts (Persian, for the model)."""

from .schemas import ReportSummaryRequest, TaskBreakdownRequest

REPORT_SYSTEM = """تو «دستیار مدار» هستی و برای مدیران یک شرکت ایرانی خلاصه هفتگی می‌نویسی.
قواعد:
- فقط از عددها و موردهایی که در پیام آمده استفاده کن؛ چیزی از خودت نساز و حدس نزن.
- هیچ فردی را ارزیابی، مقایسه یا رتبه‌بندی نکن و نام هیچ کسی را نیاور.
- لحن آرام و حرفه‌ای؛ بدون اغراق و بدون سرزنش.
- ۳ تا ۵ جمله کوتاه فارسی، بدون فهرست، بدون عنوان و بدون Markdown.
- عددها را با رقم فارسی بنویس.
- اول وضع کلی هفته، بعد مهم‌ترین نگرانی (کار گذشته از سررسید یا پروژه در خطر)، و اگر بود یک نکته مثبت."""

BREAKDOWN_SYSTEM = """تو «دستیار مدار» هستی و یک هدف یک‌جمله‌ای را به کارهای مشخص تقسیم می‌کنی.
فقط یک شیء JSON برگردان با این شکل و هیچ متن دیگری ننویس:
{"tasks": [{"title": "…", "dueInDays": 3}]}
قواعد:
- ۳ تا ۸ کار، به ترتیبی که باید انجام شوند.
- عنوان هر کار کوتاه، فارسی و با فعل امر (مثلاً «تعیین بودجه کمپین»)، حداکثر ۸۰ نویسه.
- dueInDays یعنی چند روز بعد از امروز سررسید است (عدد صحیح، کارهای بعدی دیرتر).
- نام هیچ فردی را نیاور و مسئول تعیین نکن؛ مسئول را خود کاربر انتخاب می‌کند."""


def _percent(value: float) -> str:
    return f"{round(value * 100)}٪"


def report_message(req: ReportSummaryRequest) -> str:
    scope = "کل شرکت" if req.scope == "company" else "بخش"
    lines = [
        f"گزارش {scope} «{req.name}»، {req.week_label}"
        + (" (هفته هنوز تمام نشده)" if req.partial else ""),
        f"- کار انجام‌شده: {req.totals.done} (هفته قبل {req.previous.done})",
        f"- کار تازه: {req.totals.created} (هفته قبل {req.previous.created})",
        f"- کار باز گذشته از سررسید در پایان هفته: {req.totals.overdue or 0}"
        + (f" (هفته قبل {req.previous.overdue})" if req.previous.overdue is not None else ""),
    ]
    if req.stuck:
        lines.append(f"- کار گیرکرده یا بی‌حرکت: {req.stuck}")
    for d in req.departments:
        progress = (
            f"، پیشرفت اهداف {_percent(d.goal_progress)}" if d.goal_progress is not None else ""
        )
        behind = "، عقب‌تر از برنامه" if d.behind else ""
        lines.append(f"- بخش {d.name}: {d.done} انجام‌شده، {d.overdue} گذشته{progress}{behind}")
    for g in req.goals:
        change = f" (تغییر این هفته {_percent(g.change)})" if g.change is not None else ""
        lines.append(f"- هدف «{g.title}»: پیشرفت {_percent(g.progress)}{change}")
    for p in req.at_risk_projects:
        lines.append(
            f"- پروژه در خطر «{p.name}»: {p.done} از {p.total} کار انجام‌شده، {p.overdue} گذشته"
        )
    for title in req.highlights:
        lines.append(f"- کار مهم انجام‌شده: «{title}»")
    return "\n".join(lines)


def breakdown_message(req: TaskBreakdownRequest) -> str:
    return f"امروز: {req.today}\nبخش: {req.department}\nجمله: {req.sentence}"
