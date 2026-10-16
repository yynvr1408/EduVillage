import hashlib
import hmac
import logging
import secrets
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings

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
from app.db.models.user import PasswordResetOtpChallenge, PasswordResetToken, User, UserSession
from app.services import audit_service

logger = logging.getLogger(__name__)
settings = get_settings()

# Login/reset attempts are rate-limited in-process; swap for a Redis-backed limiter under real load.
_login_attempts: dict[str, list] = {}
_MAX_ATTEMPTS = 10
_WINDOW = timedelta(minutes=15)
# A per-IP budget for password-reset requests is deliberately looser than the per-email one:
# EduVillage is explicitly used from shared community/school devices (see the "shared device"
# login option), where one public IP legitimately serves many different students resetting
# their own, different accounts — a tight per-IP limit would lock all of them out together.
_RESET_IP_MAX_ATTEMPTS = 30
_RESET_IP_WINDOW = timedelta(minutes=15)


def _check_rate_limit(key: str, *, max_attempts: int | None = None, window: timedelta | None = None) -> None:
    # Resolved from the module globals at call time (not as default-argument values), so tests
    # can monkeypatch _MAX_ATTEMPTS / _WINDOW and have it actually take effect.
    max_attempts = _MAX_ATTEMPTS if max_attempts is None else max_attempts
    window = _WINDOW if window is None else window
    now = utcnow()
    attempts = [t for t in _login_attempts.get(key, []) if now - t < window]
    if len(attempts) >= max_attempts:
        raise UnauthorizedError("Too many attempts. Please try again later.", code="RATE_LIMITED", status_code=429)
    attempts.append(now)
    _login_attempts[key] = attempts


def reset_rate_limits() -> None:
    """Test-only: clears every in-process rate-limit bucket (login + password-reset)."""
    _login_attempts.clear()


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


RESET_PURPOSE = "password_reset"


def _generate_otp() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(6))


def _hash_otp(otp: str) -> str:
    """Keyed hash (HMAC, not a bare SHA-256): a six-digit code has only 1,000,000 possible
    values, so an unkeyed hash would be offline-brute-forceable straight from a DB leak. Keying
    it with session_secret means that leak alone isn't enough — reusing that existing secret
    rather than introducing a dedicated one for a single-purpose, already-short-lived value."""
    return hmac.new(settings.session_secret.encode("utf-8"), otp.encode("utf-8"), hashlib.sha256).hexdigest()


def request_password_reset(db: Session, email: str, *, ip: str | None = None) -> str | None:
    """Returns the raw OTP only in non-production, so the flow is testable without EmailJS wired
    up. In production the OTP is only ever emailed, never returned. The response is identical
    whether the account exists, is ineligible, or is inside its resend cooldown — none of that is
    ever revealed to the caller.
    Rate-limited by both email and (when known) requester IP, same budget either way so an
    enumeration attempt gains no timing signal from which one tripped first."""
    from app.integrations import email as email_integration

    normalized_email = email.strip().lower()
    _check_rate_limit(f"reset-email:{normalized_email}")
    if ip:
        _check_rate_limit(f"reset-ip:{ip}", max_attempts=_RESET_IP_MAX_ATTEMPTS, window=_RESET_IP_WINDOW)

    user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if not user or user.role == UserRole.admin or user.status != UserStatus.active:
        # Do not reveal whether the email exists, or why it's ineligible (admin / suspended /
        # pending): the response is identical to the success case either way.
        return None

    now = utcnow()
    latest = db.execute(
        select(PasswordResetOtpChallenge)
        .where(PasswordResetOtpChallenge.user_id == user.id, PasswordResetOtpChallenge.purpose == RESET_PURPOSE)
        .order_by(PasswordResetOtpChallenge.created_at.desc())
    ).scalars().first()
    if latest and (now - latest.created_at) < timedelta(seconds=settings.otp_request_cooldown_seconds):
        # Inside the resend cooldown: no new email, no new row — and still the same generic
        # response, so this can't be used to probe account existence/activity either.
        return None

    # A fresh request supersedes any still-outstanding code already sent — only the newest works.
    db.execute(
        update(PasswordResetOtpChallenge)
        .where(
            PasswordResetOtpChallenge.user_id == user.id,
            PasswordResetOtpChallenge.purpose == RESET_PURPOSE,
            PasswordResetOtpChallenge.verified_at.is_(None),
            PasswordResetOtpChallenge.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )

    otp = _generate_otp()
    ttl_minutes = settings.otp_ttl_minutes
    challenge = PasswordResetOtpChallenge(
        user_id=user.id,
        otp_hash=_hash_otp(otp),
        purpose=RESET_PURPOSE,
        expires_at=now + timedelta(minutes=ttl_minutes),
        max_attempts=settings.otp_max_attempts,
    )
    db.add(challenge)
    db.commit()

    sent = email_integration.send_otp_email(to=user.email, otp=otp, ttl_minutes=ttl_minutes)
    if not sent:
        # Sanitized: never the OTP or the recipient's address.
        logger.warning("otp_email_not_sent user_id=%s", user.id)
    return None if settings.is_production else otp


def verify_reset_otp(db: Session, *, email: str, otp: str, ip: str | None = None) -> str:
    """Verifies the OTP and, only on success, issues a short-lived single-use reset
    AUTHORIZATION (an opaque token, stored the same way the old reset-link token was) that
    `reset_password` requires. Never starts a session and never returns user details."""
    normalized_email = email.strip().lower()
    _check_rate_limit(f"reset-otp-email:{normalized_email}")
    if ip:
        _check_rate_limit(f"reset-otp-ip:{ip}", max_attempts=_RESET_IP_MAX_ATTEMPTS, window=_RESET_IP_WINDOW)

    now = utcnow()
    user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    generic_error = UnauthorizedError("That code is incorrect or has expired.", code="INVALID_OTP")
    if not user:
        raise generic_error

    challenge = db.execute(
        select(PasswordResetOtpChallenge)
        .where(
            PasswordResetOtpChallenge.user_id == user.id,
            PasswordResetOtpChallenge.purpose == RESET_PURPOSE,
            PasswordResetOtpChallenge.verified_at.is_(None),
            PasswordResetOtpChallenge.revoked_at.is_(None),
            PasswordResetOtpChallenge.expires_at > now,
        )
        .order_by(PasswordResetOtpChallenge.created_at.desc())
    ).scalars().first()
    if not challenge:
        raise generic_error

    # Atomic attempt claim: the row lock serializes concurrent guesses against the same
    # challenge, so the attempt cap can never be bypassed by racing requests.
    claimed = db.execute(
        update(PasswordResetOtpChallenge)
        .where(
            PasswordResetOtpChallenge.id == challenge.id,
            PasswordResetOtpChallenge.attempts < PasswordResetOtpChallenge.max_attempts,
            PasswordResetOtpChallenge.verified_at.is_(None),
            PasswordResetOtpChallenge.revoked_at.is_(None),
            PasswordResetOtpChallenge.expires_at > now,
        )
        .values(attempts=PasswordResetOtpChallenge.attempts + 1)
    )
    db.commit()
    if claimed.rowcount != 1:
        raise generic_error

    db.refresh(challenge)
    if not hmac.compare_digest(challenge.otp_hash, _hash_otp(otp)):
        raise generic_error

    # Atomic verified-claim: of several concurrent requests submitting the same correct OTP,
    # only the one that actually flips verified_at here goes on to mint a reset authorization.
    verified_claim = db.execute(
        update(PasswordResetOtpChallenge)
        .where(PasswordResetOtpChallenge.id == challenge.id, PasswordResetOtpChallenge.verified_at.is_(None))
        .values(verified_at=now)
    )
    db.commit()
    if verified_claim.rowcount != 1:
        raise generic_error

    reset_token = generate_session_token()
    reset = PasswordResetToken(
        user_id=user.id,
        token_hash=hash_token(reset_token),
        expires_at=now + timedelta(minutes=settings.reset_token_ttl_minutes),
    )
    db.add(reset)
    db.commit()
    return reset_token


def reset_password(db: Session, *, reset_token: str, new_password: str) -> None:
    token_hash = hash_token(reset_token)
    now = utcnow()
    # Atomic claim: the WHERE clause re-checks every condition at UPDATE time under the row's own
    # lock, so of two concurrent requests for the same authorization, only one can ever flip
    # used_at here — the loser's rowcount is 0 and it is rejected, never a second successful reset.
    claimed = db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.revoked_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .values(used_at=now)
    )
    db.commit()
    if claimed.rowcount != 1:
        raise UnauthorizedError("This reset authorization is invalid or has expired.", code="INVALID_RESET_TOKEN")

    reset = db.execute(select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)).scalar_one()
    user = db.get(User, reset.user_id)
    if not user:
        raise UnauthorizedError("This reset authorization is invalid or has expired.", code="INVALID_RESET_TOKEN")

    user.password_hash = hash_password(new_password)
    # Any other still-outstanding authorization for this account dies with this one.
    db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.id != reset.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    # The OTP challenge(s) that led here are fully spent now too.
    db.execute(
        update(PasswordResetOtpChallenge)
        .where(
            PasswordResetOtpChallenge.user_id == user.id,
            PasswordResetOtpChallenge.purpose == RESET_PURPOSE,
            PasswordResetOtpChallenge.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
    # A reset usually means the old credential (or a shared-device login) is suspect: end every
    # session. Resetting the password never itself starts a new one — the user must log in again.
    db.execute(
        update(UserSession)
        .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.commit()
    audit_service.record(db, actor_id=user.id, action="password_reset", resource_type="user", resource_id=user.id)
