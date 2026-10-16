from datetime import datetime

from sqlalchemy import Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, new_uuid, utcnow
from app.db.models.enums import UserRole, UserStatus


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, native_enum=False), nullable=False)
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, native_enum=False), nullable=False, default=UserStatus.active
    )

    # Prepared for college-scoped onboarding. Nullable on purpose: existing users are NOT assigned to any
    # college automatically, and current login/registration do not require one.
    college_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("colleges.id", ondelete="SET NULL", name="fk_users_college_id_colleges", use_alter=True), nullable=True, index=True
    )

    sessions: Mapped[list["UserSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserSession(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    session_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)
    # Touched on every validated request. Only actually enforced as an idle timeout for admin
    # sessions (see admin_service.get_admin_from_session_token) — regular student/teacher
    # sessions deliberately stay valid across idle periods (shared/community-device use).
    last_seen_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)

    user: Mapped[User] = relationship(back_populates="sessions")


class PasswordResetOtpChallenge(UUIDPrimaryKeyMixin, Base):
    """Stage 1 of the reset flow: the six-digit code emailed to the user. `otp_hash` is a keyed
    hash (HMAC, not plain SHA-256) — a six-digit code has only 1,000,000 possible values, so an
    unsalted/unkeyed hash would be offline-brute-forceable from a DB leak alone; HMAC with a
    server-side secret (session_secret) means the attacker also needs that secret. Scoped by
    `purpose` so an OTP minted for one workflow can never be redeemed by another."""

    __tablename__ = "password_reset_otp_challenges"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    otp_hash: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    purpose: Mapped[str] = mapped_column(String(40), nullable=False, default="password_reset")
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    # Right after the correct OTP is entered (stage 1 complete, before any password is set).
    verified_at: Mapped[datetime | None] = mapped_column(nullable=True)
    # Only once the resulting reset authorization is actually redeemed (stage 2 complete) — lets
    # "verified but the user never finished resetting" be told apart from "fully used".
    consumed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    # A newer OTP request (or a completed reset) supersedes this one.
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)


class PasswordResetToken(UUIDPrimaryKeyMixin, Base):
    """Stage 2 of the reset flow: the short-lived, single-use reset AUTHORIZATION issued only
    after `PasswordResetOtpChallenge` verification succeeds — never issued directly from an
    emailed link (there isn't one any more; the OTP is the thing that's emailed)."""

    __tablename__ = "password_reset_tokens"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(nullable=True)
    # Set when a newer reset request supersedes this one, or when a sibling token gets redeemed —
    # never when this exact token is itself redeemed (that's used_at).
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)
