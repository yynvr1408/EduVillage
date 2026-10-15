from datetime import datetime

from app.schemas.common import UtcDatetime
from pydantic import BaseModel, ConfigDict

from app.db.models.enums import JobStatus, SummaryStatus


class SummaryJobRequest(BaseModel):
    transcript_text: str | None = None
    resource_id: str | None = None  # audio/video resource to transcribe, if no transcript_text given


class SummaryEdit(BaseModel):
    """Teacher edits to AI output before approval. Only the provided keys change."""

    overview: str | None = None
    key_concepts: list[str] | None = None
    definitions: list[str] | None = None
    examples: list[str] | None = None
    revision_questions: list[str] | None = None


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
    completed_at: UtcDatetime | None


class SummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    class_id: str
    transcript_id: str | None
    recording_id: str | None = None
    generator: str | None = None  # 'llm' or the labeled 'stub' fallback
    generator_model: str | None = None
    content_json: dict
    status: SummaryStatus
    reviewed_by: str | None
    reviewed_at: UtcDatetime | None
