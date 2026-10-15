from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import ConflictError, UnauthorizedError
from app.core.security import (
    generate_session_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.db.base import utcnow
from app.db.models.enums import UserRole, UserStatus
from app.db.models.user import PasswordResetToken, User, UserSession
from app.services import audit_service

settings = get_settings()

# Login attempts are rate-limited in-process; swap for a Redis-backed limiter under real load.
_login_attempts: dict[str, list] = {}
_MAX_ATTEMPTS = 10
_WINDOW = timedelta(minutes=15)


def _check_rate_limit(key: str) -> None:
    now = utcnow()
    attempts = [t for t in _login_attempts.get(key, []) if now - t < _WINDOW]
    if len(attempts) >= _MAX_ATTEMPTS:
        raise UnauthorizedError("Too many attempts. Please try again later.", code="RATE_LIMITED", status_code=429)
    attempts.append(now)
    _login_attempts[key] = attempts


def register_user(db: Session, *, full_name: str, email: str, password: str, role: UserRole) -> User:
    normalized_email = email.strip().lower()
    existing = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if existing:
        raise ConflictError("An account with this email already exists.", code="EMAIL_TAKEN")

    user = User(
        full_name=full_name.strip(),
        email=normalized_email,
        password_hash=hash_password(password),
        role=role,
        status=UserStatus.active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    audit_service.record(db, actor_id=user.id, action="register", resource_type="user", resource_id=user.id)
    return user


def authenticate_user(db: Session, *, email: str, password: str) -> User:
    normalized_email = email.strip().lower()
    _check_rate_limit(normalized_email)

    user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        audit_service.record(db, actor_id=user.id if user else None, action="login_failed", resource_type="user")
        raise UnauthorizedError("Incorrect email or password.", code="INVALID_CREDENTIALS")
    if user.status != UserStatus.active:
        raise UnauthorizedError("This account is not active.", code="ACCOUNT_INACTIVE")
    audit_service.record(db, actor_id=user.id, action="login", resource_type="user", resource_id=user.id)
    return user


def create_session(db: Session, user: User) -> str:
    """Returns the raw token to set as a cookie; only its hash is persisted."""
    token = generate_session_token()
    session = UserSession(
        user_id=user.id,
        session_hash=hash_token(token),
        expires_at=utcnow() + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(session)
    db.commit()
    return token


def get_user_from_session_token(db: Session, token: str) -> User | None:
    session_hash = hash_token(token)
    session = db.execute(
        select(UserSession).where(UserSession.session_hash == session_hash)
    ).scalar_one_or_none()
    if not session or session.revoked_at is not None or session.expires_at < utcnow():
        return None
    return db.get(User, session.user_id)


def revoke_session(db: Session, token: str) -> None:
    session_hash = hash_token(token)
    session = db.execute(
        select(UserSession).where(UserSession.session_hash == session_hash)
    ).scalar_one_or_none()
    if session and session.revoked_at is None:
        session.revoked_at = utcnow()
        db.commit()
        audit_service.record(db, actor_id=session.user_id, action="logout", resource_type="user", resource_id=session.user_id)


def request_password_reset(db: Session, email: str) -> str | None:
    """Returns the raw reset token only in non-production so the team can test the flow
    without an email provider wired up yet. In production this must be emailed, never returned."""
    normalized_email = email.strip().lower()
    _check_rate_limit(f"reset:{normalized_email}")

    user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if not user:
        # Do not reveal whether the email exists.
        return None

    token = generate_session_token()
    reset = PasswordResetToken(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=utcnow() + timedelta(hours=1),
    )
    db.add(reset)
    db.commit()
    return None if settings.is_production else token


def reset_password(db: Session, *, token: str, new_password: str) -> None:
    token_hash = hash_token(token)
    reset = db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)
    ).scalar_one_or_none()
    if not reset or reset.used_at is not None or reset.expires_at < utcnow():
        raise UnauthorizedError("This reset link is invalid or has expired.", code="INVALID_RESET_TOKEN")

    user = db.get(User, reset.user_id)
    if not user:
        raise UnauthorizedError("This reset link is invalid or has expired.", code="INVALID_RESET_TOKEN")

    user.password_hash = hash_password(new_password)
    reset.used_at = utcnow()
    db.commit()
