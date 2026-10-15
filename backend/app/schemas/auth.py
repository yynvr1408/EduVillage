from datetime import datetime
from typing import Literal

from app.schemas.common import UtcDatetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.db.models.enums import UserRole
from app.schemas.user import UserOut


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)
    role: Literal[UserRole.student, UserRole.teacher]
    invite_code: str | None = Field(default=None, max_length=128)  # legacy teacher gate
    college_id: str | None = Field(default=None, max_length=36)
    college_code: str | None = Field(default=None, max_length=64)  # required for teachers
    branch_id: str | None = Field(default=None, max_length=36)
    section_id: str | None = Field(default=None, max_length=36)
    all_sections: bool = False  # teachers only: branch-wide assignment instead of one section


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    user: UserOut


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=256)


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: UtcDatetime
    expires_at: UtcDatetime


class RevokeAllResponse(BaseModel):
    revoked_count: int
