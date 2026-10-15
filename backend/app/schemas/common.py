from pydantic import BaseModel


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
