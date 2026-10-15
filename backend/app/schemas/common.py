from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator, BaseModel, PlainSerializer


def _to_naive_utc(value: datetime) -> datetime:
    """Storage convention: naive UTC everywhere. An aware input (e.g. '...Z' or '+05:30') is CONVERTED, not
    merely stripped - otherwise PostgreSQL would reinterpret it in the server's local zone and a deadline
    could silently move by hours."""
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _to_utc_iso(value: datetime) -> str:
    """Output: always explicit UTC ('...Z'), so browsers never guess a timezone."""
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return aware.isoformat().replace("+00:00", "Z")


UtcDatetime = Annotated[
    datetime,
    AfterValidator(_to_naive_utc),
    PlainSerializer(_to_utc_iso, return_type=str, when_used="json"),
]


class ErrorDetail(BaseModel):
    code: str
    message: str
    request_id: str | None = None
    details: dict = {}


class ErrorResponse(BaseModel):
    error: ErrorDetail


class Page(BaseModel):
    items: list
    total: int
    limit: int
    offset: int
