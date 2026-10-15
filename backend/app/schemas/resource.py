from app.schemas.common import UtcDatetime
from pydantic import BaseModel, ConfigDict

from datetime import datetime

from app.db.models.enums import ProcessingStatus, ResourceStatus, ResourceType


class UploadInitRequest(BaseModel):
    course_id: str
    lesson_id: str | None = None
    filename: str
    mime_type: str
    size_bytes: int
    title: str | None = None
    description: str | None = None
    resource_type: ResourceType | None = None  # inferred from the file's contents when omitted


class ResourceUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    is_published: bool | None = None


class UploadInitResponse(BaseModel):
    resource_id: str
    upload: dict


class ResourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    lesson_id: str | None
    filename: str
    mime_type: str
    size_bytes: int
    status: ResourceStatus
    title: str | None = None
    description: str | None = None
    resource_type: ResourceType | None = None
    is_published: bool = False
    processing_status: ProcessingStatus = ProcessingStatus.pending
    processing_error: str | None = None
    version: int = 1
    checksum_sha256: str | None = None
    created_at: UtcDatetime | None = None
    updated_at: UtcDatetime | None = None


class DownloadResponse(BaseModel):
    method: str
    url: str
    stream: bool = False
