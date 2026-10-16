from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
import hmac

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError
from app.core.security import (
    generate_session_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.db.base import utcnow
from app.db.models.college import UserBranchAssignment, UserCollegeSection
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


def _assert_may_register_as(role: UserRole, invite_code: str | None) -> None:
    """Nobody can grant themselves the teacher role by editing the registration payload."""
    if role != UserRole.teacher:
        return
    expected = settings.teacher_invite_code
    if expected:
        if not invite_code or not hmac.compare_digest(invite_code, expected):
            raise ForbiddenError("A valid teacher invite code is required.", code="INVALID_INVITE_CODE")
    elif settings.is_production:
        raise ForbiddenError("Teacher registration is closed; accounts are provisioned by the institution.", code="TEACHER_REGISTRATION_CLOSED")


def register_user(
    db: Session, *, full_name: str, email: str, password: str, role: UserRole, invite_code: str | None = None,
    college_id: str | None = None, college_code: str | None = None, section_id: str | None = None,
    branch_id: str | None = None, all_sections: bool = False,
) -> User:
    if role == UserRole.admin:
        raise ForbiddenError("This role cannot be self-registered.", code="ROLE_NOT_ALLOWED")
    from app.services import college_service

    # Everything is validated before the first row is written, so a rejection leaves no partial account.
    # Students and teachers prove the same admin-issued college code; only "all sections" is teacher-only.
    target = college_service.validate_registration_target(
        db, college_id=college_id, branch_id=branch_id, section_id=section_id, all_sections=all_sections,
        college_code=college_code, require_code=True, allow_all_sections=role == UserRole.teacher,
    )
    if target is None:
        college_required = settings.teacher_college_required if role == UserRole.teacher else settings.student_college_required
        if college_required:
            raise ValidationFailedError("Select your college, enter its college code and choose a section.", code="COLLEGE_REQUIRED")
        if role == UserRole.teacher:
            _assert_may_register_as(role, invite_code)
    # (with a valid target the admin-issued college code is the proof; it grants nothing beyond the role)
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
    if target is not None:
        user.college_id = target[0].id
    db.add(user)
    if target is not None:
        db.flush()
        if target[2] is not None:
            db.add(UserCollegeSection(user_id=user.id, college_section_id=target[2].id))
        else:  # branch-wide: a branch assignment, never a section row
            db.add(UserBranchAssignment(user_id=user.id, branch_id=target[1].id))
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
    if user.role == UserRole.admin:  # administrators sign in only through the admin endpoint
        raise UnauthorizedError("Incorrect email or password.", code="INVALID_CREDENTIALS")
    if user.status != UserStatus.active:
        raise UnauthorizedError("This account is not active.", code="ACCOUNT_INACTIVE")
    audit_service.record(db, actor_id=user.id, action="login", resource_type="user", resource_id=user.id)
    return user


def create_session(db: Session, user: User, ttl: timedelta | None = None) -> str:
    """Returns the raw token to set as a cookie; only its hash is persisted."""
    token = generate_session_token()
    session = UserSession(
        user_id=user.id,
        session_hash=hash_token(token),
        expires_at=utcnow() + (ttl or timedelta(hours=settings.session_ttl_hours)),
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


def list_active_sessions(db: Session, user: User) -> list[UserSession]:
    """For shared/public devices: lets a student see every device currently signed in to
    their account and sign out of one they forgot to log out of elsewhere."""
    stmt = (
        select(UserSession)
        .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None), UserSession.expires_at > utcnow())
        .order_by(UserSession.created_at.desc())
    )
    return list(db.execute(stmt).scalars())


def revoke_session_by_id(db: Session, user: User, session_id: str) -> None:
    session = db.get(UserSession, session_id)
    if not session or session.user_id != user.id:
        raise NotFoundError("Session not found.")
    if session.revoked_at is None:
        session.revoked_at = utcnow()
        db.commit()
        audit_service.record(db, actor_id=user.id, action="session_revoked", resource_type="user_session", resource_id=session.id)


def revoke_all_sessions_except(db: Session, user: User, *, keep_token: str | None) -> int:
    """Signs out every other device — the "I'm on a shared computer, lock everything else
    out" action. Returns how many sessions were revoked."""
    keep_hash = hash_token(keep_token) if keep_token else None
    sessions = db.execute(
        select(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
    ).scalars()
    count = 0
    for session in sessions:
        if keep_hash and session.session_hash == keep_hash:
            continue
        session.revoked_at = utcnow()
        count += 1
    if count:
        db.commit()
        audit_service.record(db, actor_id=user.id, action="sessions_revoked_all", resource_type="user", resource_id=user.id)
    return count


def request_password_reset(db: Session, email: str) -> str | None:
    """Returns the raw reset token only in non-production so the team can test the flow
    without an email provider wired up yet. In production this must be emailed, never returned."""
    normalized_email = email.strip().lower()
    _check_rate_limit(f"reset:{normalized_email}")

    user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if not user or user.role == UserRole.admin:
        # Do not reveal whether the email exists; the admin password is changed only via server configuration.
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
    # A reset usually means the old credential (or a shared-device login) is suspect: end every session.
    for session in db.execute(
        select(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
    ).scalars():
        session.revoked_at = utcnow()
    db.commit()
    audit_service.record(db, actor_id=user.id, action="password_reset", resource_type="user", resource_id=user.id)
