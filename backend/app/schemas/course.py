from datetime import datetime

from app.schemas.common import UtcDatetime
from pydantic import BaseModel, ConfigDict, Field

from app.db.models.enums import CourseStatus, CourseTeacherRole, EnrollmentStatus


class CourseCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    subject: str | None = None
    status: CourseStatus = CourseStatus.draft


class CourseUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    subject: str | None = None
    status: CourseStatus | None = None


class CourseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    description: str | None
    subject: str | None
    teacher_id: str
    status: CourseStatus
    created_at: UtcDatetime
    teacher_name: str | None = None


class CourseDeleteOut(BaseModel):
    """deleted=True: the row is gone (it was an empty, untouched draft). deleted=False: it had
    real activity (enrollments, lessons, classes...) so it was archived instead — course carries
    the now-archived record."""

    deleted: bool
    course: CourseOut | None = None


class EnrollmentCreate(BaseModel):
    student_id: str | None = None  # omitted => the authenticated student self-enrolls


class RosterBranchOut(BaseModel):
    id: str
    name: str


class RosterSectionOut(BaseModel):
    id: str
    name: str


class EnrollmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    student_id: str
    status: EnrollmentStatus
    enrolled_at: UtcDatetime
    student_name: str | None = None
    student_email: str | None = None
    branch: RosterBranchOut | None = None
    section: RosterSectionOut | None = None


class CoTeacherCreate(BaseModel):
    teacher_id: str


class CoTeacherOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    teacher_id: str
    role: CourseTeacherRole
    added_at: UtcDatetime
