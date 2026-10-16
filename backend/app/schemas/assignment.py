from datetime import datetime

from app.schemas.common import UtcDatetime
from pydantic import BaseModel, ConfigDict, Field

from app.db.models.enums import AssignmentStatus, SubmissionStatus


class AssignmentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    instructions: str | None = None
    due_at: UtcDatetime | None = None
    status: AssignmentStatus = AssignmentStatus.draft


class AssignmentUpdate(BaseModel):
    title: str | None = None
    instructions: str | None = None
    due_at: UtcDatetime | None = None
    status: AssignmentStatus | None = None


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    created_by: str
    title: str
    instructions: str | None
    due_at: UtcDatetime | None
    status: AssignmentStatus


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
    attachments: list[AttachmentOut] = []
