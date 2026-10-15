from pydantic import BaseModel, ConfigDict

from app.db.models.enums import ResourceStatus


class UploadInitRequest(BaseModel):
    course_id: str
    lesson_id: str | None = None
    filename: str
    mime_type: str
    size_bytes: int


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


class DownloadResponse(BaseModel):
    method: str
    url: str
    stream: bool = False
