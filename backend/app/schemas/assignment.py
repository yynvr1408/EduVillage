from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.db.models.enums import AssignmentStatus, SubmissionStatus


class AssignmentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    instructions: str | None = None
    due_at: datetime | None = None
    status: AssignmentStatus = AssignmentStatus.draft


class AssignmentUpdate(BaseModel):
    title: str | None = None
    instructions: str | None = None
    due_at: datetime | None = None
    status: AssignmentStatus | None = None


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    created_by: str
    title: str
    instructions: str | None
    due_at: datetime | None
    status: AssignmentStatus


class SubmissionSave(BaseModel):
    answer: dict
    submit: bool = False  # false = draft save; true = finalize as submitted


class SubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    assignment_id: str
    student_id: str
    answer: dict
    status: SubmissionStatus
    version: int
    submitted_at: datetime | None
    updated_at: datetime
