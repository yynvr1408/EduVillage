from datetime import datetime

from pydantic import BaseModel, Field


class SyncOperationIn(BaseModel):
    operation_id: str = Field(min_length=1, max_length=128)
    operation_type: str
    entity_id: str
    payload: dict
    client_updated_at: datetime | None = None


class SyncBatchRequest(BaseModel):
    operations: list[SyncOperationIn] = Field(min_length=1, max_length=50)


class SyncOperationResult(BaseModel):
    operation_id: str
    status: str  # accepted | rejected | conflict
    server_entity_id: str | None = None
    server_version: int | None = None
    server_updated_at: datetime | None = None
    error_code: str | None = None
    message: str | None = None


class SyncBatchResponse(BaseModel):
    results: list[SyncOperationResult]
