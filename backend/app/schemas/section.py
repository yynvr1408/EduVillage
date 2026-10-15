from datetime import datetime

from app.schemas.common import UtcDatetime
from pydantic import BaseModel, ConfigDict, Field


class SectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=40)
    college_section_id: str | None = Field(default=None, max_length=36)


class SectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    name: str
    code: str
    college_section_id: str | None = None


class SectionMemberAdd(BaseModel):
    student_id: str


class SectionMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    section_id: str
    student_id: str
    added_at: UtcDatetime
