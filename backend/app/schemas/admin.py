import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.db.models.enums import CollegeStatus
from app.schemas.common import UtcDatetime


class AdminLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class AdminOut(BaseModel):
    username: str
    display_name: str


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = re.sub(r"\s+", " ", value).strip()
    return value or None


class CollegeCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    location: str | None = Field(default=None, max_length=160)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=40)
    status: CollegeStatus = CollegeStatus.active
    # Optional: an admin may supply their own code; otherwise a secure one is generated.
    code: str | None = Field(default=None, max_length=32)

    @field_validator("name", "location", "contact_phone")
    @classmethod
    def _tidy(cls, v):
        return _clean(v)


class CollegeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    location: str | None = Field(default=None, max_length=160)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=40)

    @field_validator("name", "location", "contact_phone")
    @classmethod
    def _tidy(cls, v):
        return _clean(v)


class CollegeStatusChange(BaseModel):
    status: CollegeStatus


class CollegeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    location: str | None
    contact_email: str | None
    contact_phone: str | None
    code: str
    code_generated_at: UtcDatetime
    status: CollegeStatus
    created_at: UtcDatetime
    updated_at: UtcDatetime


class CollegePage(BaseModel):
    items: list[CollegeOut]
    total: int
    limit: int
    offset: int


class OverviewOut(BaseModel):
    total_colleges: int
    active_colleges: int
    inactive_colleges: int
    total_codes_generated: int  # current codes + every replaced code


class BranchCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    short_code: str | None = Field(default=None, max_length=20)

    @field_validator("name", "short_code")
    @classmethod
    def _tidy(cls, v):
        return _clean(v)


class BranchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    short_code: str | None = Field(default=None, max_length=20)

    @field_validator("name", "short_code")
    @classmethod
    def _tidy(cls, v):
        return _clean(v)


class BranchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    college_id: str
    name: str
    short_code: str | None
    status: CollegeStatus


class CollegeSectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def _tidy(cls, v):
        return _clean(v)


class CollegeSectionUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def _tidy(cls, v):
        return _clean(v)


class CollegeSectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    college_id: str
    branch_id: str
    name: str
    status: CollegeStatus


class PublicBranchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    short_code: str | None


class PublicCollegeOut(BaseModel):
    """What an unauthenticated visitor may see: never the code or contact details."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    location: str | None
