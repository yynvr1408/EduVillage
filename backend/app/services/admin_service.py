"""Administrator account bootstrap and authentication.

The credentials come ONLY from server-side configuration (ADMIN_USERNAME / ADMIN_PASSWORD). They are
hashed with argon2 before they touch the database and are never logged, returned or audited in plaintext.
"""

import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import ConflictError, UnauthorizedError
from app.core.security import hash_password, hash_token, verify_password
from app.db.base import utcnow
from app.db.models.enums import UserRole, UserStatus
from app.db.models.user import User, UserSession
from app.services import audit_service, auth_service

logger = logging.getLogger(__name__)

_attempts: dict[str, list] = {}
_WINDOW = timedelta(minutes=15)
# Verified against when the username is unknown so a miss costs the same time as a wrong password.
_DUMMY_HASH = hash_password("not-the-admin-password")


def _admin_key(username: str) -> str:
    return username.strip().lower()


def bootstrap_admin(db: Session) -> None:
    """Creates the administrator from configuration. Idempotent: an existing admin keeps its password unless
    ADMIN_RESET_PASSWORD_ON_START is true. Does nothing (admin login stays impossible) when unconfigured."""
    settings = get_settings()
    if not settings.admin_username or not settings.admin_password:
        logger.warning("ADMIN_USERNAME / ADMIN_PASSWORD are not set - the admin panel login is disabled.")
        return
    username = _admin_key(settings.admin_username)
    admin = db.execute(select(User).where(User.role == UserRole.admin)).scalars().first()
    if admin is None:
        taken = db.execute(select(User).where(User.email == username)).scalar_one_or_none()
        if taken is not None:
            logger.error("Cannot create the admin account: the configured username is already used by another account.")
            return
        db.add(User(full_name="Administrator", email=username, password_hash=hash_password(settings.admin_password),
                    role=UserRole.admin, status=UserStatus.active))
        db.commit()
        logger.info("Administrator account created from configuration.")
        return
    changed = False
    if admin.email != username:
        admin.email = username
        changed = True
    if settings.admin_reset_password_on_start and not verify_password(settings.admin_password, admin.password_hash):
        admin.password_hash = hash_password(settings.admin_password)
        auth_service.revoke_all_sessions_except(db, admin, keep_token=None)
        changed = True
    if admin.status != UserStatus.active:
        admin.status = UserStatus.active
        changed = True
    if changed:
        db.commit()
        logger.info("Administrator account updated from configuration.")


def _assert_not_locked(key: str) -> None:
    now = utcnow()
    recent = [t for t in _attempts.get(key, []) if now - t < _WINDOW]
    _attempts[key] = recent
    if len(recent) >= get_settings().admin_login_max_attempts:
        raise UnauthorizedError("Too many attempts. Please try again later.", code="RATE_LIMITED", status_code=429)


def _register_failure(*keys: str) -> None:
    now = utcnow()
    for key in keys:
        _attempts.setdefault(key, []).append(now)


def reset_rate_limits() -> None:
    _attempts.clear()


def _active_admin_session(db: Session, admin_id: str) -> UserSession | None:
    """The one other admin session that's still 'fresh' (seen within admin_idle_timeout_seconds),
    if any — idle sessions past that window don't count and are cleaned up as they're found."""
    now = utcnow()
    idle_cutoff = now - timedelta(seconds=get_settings().admin_idle_timeout_seconds)
    sessions = db.execute(
        select(UserSession).where(
            UserSession.user_id == admin_id, UserSession.revoked_at.is_(None), UserSession.expires_at > now
        )
    ).scalars().all()
    fresh = None
    for session in sessions:
        if session.last_seen_at >= idle_cutoff:
            fresh = session
        else:
            session.revoked_at = now  # idle: dead, free up the slot
    db.commit()
    return fresh


def authenticate_admin(db: Session, *, username: str, password: str, client_ip: str | None) -> tuple[User, str]:
    """Returns (admin, raw session token). Every credential failure is the same generic error.
    Single-active-session policy: a login is rejected outright while another admin session is
    still fresh; an idle one (no request in admin_idle_timeout_seconds) is treated as dead
    instead, so a forgotten-logout never permanently locks the admin out."""
    key = _admin_key(username)
    keys = (f"user:{key}", f"ip:{client_ip or 'unknown'}")
    for k in keys:  # only FAILED attempts count, so a legitimate sign-in never uses up the allowance
        _assert_not_locked(k)

    admin = db.execute(select(User).where(User.email == key, User.role == UserRole.admin)).scalar_one_or_none()
    valid = verify_password(password, admin.password_hash if admin else _DUMMY_HASH)
    if not admin or not valid or admin.status != UserStatus.active:
        _register_failure(*keys)
        audit_service.record(db, actor_id=None, action="admin_login_failed", resource_type="admin")
        raise UnauthorizedError("Incorrect username or password.", code="INVALID_CREDENTIALS")

    if _active_admin_session(db, admin.id) is not None:
        audit_service.record(db, actor_id=admin.id, action="admin_login_blocked_session_active", resource_type="admin", resource_id=admin.id)
        raise ConflictError(
            "An admin is already signed in. Try again in a moment, or ask them to sign out.",
            code="ADMIN_SESSION_ACTIVE",
        )

    ttl = timedelta(minutes=get_settings().admin_session_ttl_minutes)
    token = auth_service.create_session(db, admin, ttl=ttl)
    _attempts.pop(f"user:{key}", None)
    audit_service.record(db, actor_id=admin.id, action="admin_login", resource_type="admin", resource_id=admin.id)
    return admin, token


def get_admin_from_session_token(db: Session, token: str) -> User | None:
    """Like auth_service.get_user_from_session_token, but admin-specific: also enforces the idle
    timeout (regular student/teacher sessions deliberately don't expire on idling) and touches
    last_seen_at on every valid use, which is what makes that timeout mean anything."""
    session_hash = hash_token(token)
    session = db.execute(select(UserSession).where(UserSession.session_hash == session_hash)).scalar_one_or_none()
    if not session or session.revoked_at is not None or session.expires_at < utcnow():
        return None
    idle_cutoff = utcnow() - timedelta(seconds=get_settings().admin_idle_timeout_seconds)
    if session.last_seen_at < idle_cutoff:
        session.revoked_at = utcnow()
        db.commit()
        return None
    user = db.get(User, session.user_id)
    if user is None or user.role != UserRole.admin:
        return None
    session.last_seen_at = utcnow()
    db.commit()
    return user
