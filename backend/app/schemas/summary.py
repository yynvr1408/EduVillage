from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.db.models.enums import JobStatus, SummaryStatus


class SummaryJobRequest(BaseModel):
    transcript_text: str | None = None
    resource_id: str | None = None  # audio/video resource to transcribe, if no transcript_text given


class SummaryJobOut(BaseModel):
    job_id: str
    status: JobStatus


class JobStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_type: str
    status: JobStatus
    attempts: int
    error_code: str | None
    completed_at: datetime | None


class SummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    class_id: str
    transcript_id: str | None
    content_json: dict
    status: SummaryStatus
    reviewed_by: str | None
    reviewed_at: datetime | None
