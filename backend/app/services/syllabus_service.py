"""Turns a pasted syllabus or an uploaded PDF into proposed curriculum lessons.

Nothing is saved here: the teacher reviews the proposal and then creates the lessons (bulk endpoint)."""

import io
import re

from app.core.exceptions import ValidationFailedError

MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PAGES = 100
MAX_LESSONS = 200
MAX_TEXT_CHARS = 200_000

_HEADING = re.compile(
    r"^\s*(?:(?:unit|module|chapter|lesson|week|topic|session|day|part)\b[\s\d.:)\-ivxIVX]*|\d{1,3}[.)]\s+|[ivxIVX]{1,6}[.)]\s+)",
    re.IGNORECASE,
)
_BULLET = re.compile(r"^\s*[-*•●▪]+\s*")


def _clean(line: str) -> str:
    return re.sub(r"\s+", " ", _BULLET.sub("", line)).strip()


def split_into_lessons(text: str) -> list[dict]:
    """A line that looks like a heading (Unit 1, Chapter 2, 3. Topic, Week 4 ...) starts a lesson and the lines
    under it become its description. With no headings at all, every short line becomes a lesson title."""
    lines = [ln for ln in (text or "").replace("\r", "\n").split("\n")]
    cleaned = [(_clean(ln), bool(_HEADING.match(ln))) for ln in lines]
    cleaned = [(c, h) for c, h in cleaned if c]
    if len(text or "") > MAX_TEXT_CHARS:
        raise ValidationFailedError("The syllabus text is too long.", code="SYLLABUS_TOO_LONG")
    lessons: list[dict] = []
    if any(h for _, h in cleaned):
        current = None
        for c, h in cleaned:
            if h:
                current = {"title": c[:255], "content": []}
                lessons.append(current)
            elif current is not None:
                current["content"].append(c)
        for lesson in lessons:
            lesson["content"] = "\n".join(lesson["content"]) or None
    else:
        lessons = [{"title": c[:255], "content": None} for c, _ in cleaned if len(c) <= 255]
    if not lessons:
        raise ValidationFailedError("No lessons could be found in that text.", code="SYLLABUS_EMPTY")
    return lessons[:MAX_LESSONS]


def extract_pdf_text(data: bytes) -> tuple[str, int]:
    if len(data) > MAX_PDF_BYTES:
        raise ValidationFailedError("The PDF is larger than 10 MB.", code="FILE_TOO_LARGE")
    if not data.lstrip()[:5] == b"%PDF-":
        raise ValidationFailedError("That file is not a PDF.", code="NOT_A_PDF")
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ValidationFailedError("That PDF is password protected.", code="PDF_ENCRYPTED")
        pages = len(reader.pages)
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:MAX_PAGES])
    except ValidationFailedError:
        raise
    except (PyPdfError, ValueError, KeyError, OSError) as exc:
        raise ValidationFailedError("That PDF could not be read.", code="PDF_UNREADABLE") from exc
    if not text.strip():
        raise ValidationFailedError(
            "No text was found in that PDF (scanned pictures of pages cannot be read). Paste the lessons instead.",
            code="PDF_NO_TEXT",
        )
    return text, pages
