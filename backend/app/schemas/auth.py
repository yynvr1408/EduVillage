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
    # Proves control of `email` (see /auth/register/verify-otp). Required unless the deployment
    # has registration-OTP switched off.
    verification_token: str | None = Field(default=None, max_length=128)


class RequestRegistrationOtpRequest(BaseModel):
    email: EmailStr


class VerifyRegistrationOtpRequest(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class RegistrationVerificationOut(BaseModel):
    verification_token: str
    expires_in_minutes: int


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginOtpRequired(BaseModel):
    """202 body: the account is already signed in elsewhere, so this sign-in needs the emailed code."""

    otp_required: bool = True
    email: str
    message: str
    otp_ttl_minutes: int
    resend_cooldown_seconds: int


class AuthResponse(BaseModel):
    user: UserOut


class RegistrationPendingOut(BaseModel):
    """202 body: the account was created but needs the college administrator's approval before
    it can sign in — no session is established."""

    status: Literal["pending_approval"] = "pending_approval"
    message: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class VerifyResetOtpRequest(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ResetPasswordRequest(BaseModel):
    reset_token: str
    new_password: str = Field(min_length=8, max_length=256)
    # Accepted but not required: if sent, it must match new_password. The frontend already
    # enforces this before submitting (see Phase 7's allowance for frontend-only confirmation);
    # this is just a courtesy check for a caller that does send it.
    confirm_password: str | None = Field(default=None, min_length=8, max_length=256)


class ResetAuthorizationOut(BaseModel):
    reset_token: str
    expires_in_minutes: int


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: UtcDatetime
    expires_at: UtcDatetime


class RevokeAllResponse(BaseModel):
    revoked_count: int
