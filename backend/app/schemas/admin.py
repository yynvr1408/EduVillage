import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.db.models.enums import CollegeDeletionRequestStatus, CollegeRegistrationRequestStatus, CollegeStatus, UserRole, UserStatus
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


class CollegeAdministratorCreate(BaseModel):
    user_id: str = Field(min_length=1)


class CollegeAdministratorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    college_id: str
    full_name: str
    email: str
    assigned_at: UtcDatetime


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


class StudentVisibleTeacherBranchOut(BaseModel):
    id: str
    name: str


class StudentVisibleTeacherSectionOut(BaseModel):
    id: str
    name: str


class StudentVisibleCourseOut(BaseModel):
    id: str
    title: str


class CollegeRegistrationRequestCreate(BaseModel):
    """Public, unauthenticated: a college registering itself, pending platform-admin approval."""

    college_name: str = Field(min_length=2, max_length=160)
    location: str | None = Field(default=None, max_length=160)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=40)
    admin_full_name: str = Field(min_length=1, max_length=255)
    admin_email: EmailStr
    admin_password: str = Field(min_length=8, max_length=256)
    # Proves control of admin_email — see POST /auth/register/verify-otp, reused as-is.
    verification_token: str = Field(min_length=1, max_length=128)

    @field_validator("college_name", "location", "contact_phone", "admin_full_name")
    @classmethod
    def _tidy(cls, v):
        return _clean(v)


class CollegeRegistrationRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    college_name: str
    location: str | None
    contact_email: str | None
    contact_phone: str | None
    admin_full_name: str
    admin_email: str
    status: CollegeRegistrationRequestStatus
    rejected_reason: str | None
    resulting_college_id: str | None
    created_at: UtcDatetime
    decided_at: UtcDatetime | None


class DecisionReject(BaseModel):
    """Shared by college-registration-request rejection and student/teacher registration rejection."""

    reason: str | None = Field(default=None, max_length=500)


class MemberReassign(BaseModel):
    """Moves an already-admitted member to a different branch/section of the same college."""

    branch_id: str = Field(min_length=1)
    section_id: str | None = None
    all_sections: bool = False  # teacher-only: branch-wide, mutually exclusive with section_id


class PendingUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    email: str
    role: UserRole
    status: UserStatus
    created_at: UtcDatetime


class CollegeDeletionRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    college_id: str
    status: CollegeDeletionRequestStatus
    requested_at: UtcDatetime
    confirmed_at: UtcDatetime | None


class DeletionOtpRequest(BaseModel):
    """The confirming college administrator's own password — step 1 of the two-step confirmation."""

    password: str = Field(min_length=1, max_length=256)


class AuditEventOut(BaseModel):
    id: str
    actor_id: str | None
    actor_email: str | None
    action: str
    resource_type: str
    resource_id: str | None
    created_at: UtcDatetime


class AuditEventPage(BaseModel):
    items: list[AuditEventOut]
    total: int
    limit: int
    offset: int


class DeletionOtpVerify(BaseModel):
    otp: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class StudentVisibleTeacherOut(BaseModel):
    """A teacher a student may discover within their own college/section. Discovery only — does
    not imply enrollment or course access."""

    id: str
    full_name: str
    branch: StudentVisibleTeacherBranchOut | None
    section: StudentVisibleTeacherSectionOut | None
    all_sections: bool
    courses: list[StudentVisibleCourseOut]
