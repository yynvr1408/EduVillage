from datetime import datetime

from app.schemas.common import UtcDatetime
from pydantic import BaseModel, ConfigDict, Field

from app.db.models.enums import AssignmentStatus, SubmissionStatus


class AssignmentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    instructions: str | None = None
    due_at: UtcDatetime | None = None
    status: AssignmentStatus = AssignmentStatus.draft
    max_score: int = Field(default=100, ge=1, le=1000)


class AssignmentUpdate(BaseModel):
    title: str | None = None
    instructions: str | None = None
    due_at: UtcDatetime | None = None
    status: AssignmentStatus | None = None
    max_score: int | None = Field(default=None, ge=1, le=1000)


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    created_by: str
    title: str
    instructions: str | None
    due_at: UtcDatetime | None
    status: AssignmentStatus
    max_score: int = 100


class SubmissionSave(BaseModel):
    answer: dict
    submit: bool = False  # false = draft save; true = finalize as submitted


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    size_bytes: int
    mime_type: str
    created_at: UtcDatetime


class AttachmentInitRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(default="application/octet-stream", max_length=120)
    size_bytes: int = Field(gt=0)


class AttachmentInitResponse(BaseModel):
    attachment_id: str
    upload: dict


class SubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    assignment_id: str
    student_id: str
    answer: dict
    status: SubmissionStatus
    version: int
    submitted_at: UtcDatetime | None
    updated_at: UtcDatetime
    score: float | None = None
    feedback: str | None = None
    graded_at: UtcDatetime | None = None
    student_name: str | None = None
    attachments: list[AttachmentOut] = []


class SubmissionGrade(BaseModel):
    score: float = Field(ge=0)
    feedback: str | None = Field(default=None, max_length=4000)
