from datetime import datetime

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
    created_at: datetime
    teacher_name: str | None = None


class EnrollmentCreate(BaseModel):
    student_id: str | None = None  # omitted => the authenticated student self-enrolls


class EnrollmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    student_id: str
    status: EnrollmentStatus
    enrolled_at: datetime


class CoTeacherCreate(BaseModel):
    teacher_id: str


class CoTeacherOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    teacher_id: str
    role: CourseTeacherRole
    added_at: datetime
