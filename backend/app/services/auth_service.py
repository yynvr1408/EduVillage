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
from app.db.models.user import PasswordResetOtpChallenge, PasswordResetToken, RegistrationOtpChallenge, User, UserSession
from app.services import audit_service, rate_limit_service

logger = logging.getLogger(__name__)
settings = get_settings()

# Login/reset attempts are rate-limited via the shared, database-backed limiter (correct no
# matter how many app processes/instances are running) — see app/services/rate_limit_service.py.
_MAX_ATTEMPTS = 10
_WINDOW = timedelta(minutes=15)
# A per-IP budget for password-reset requests is deliberately looser than the per-email one:
# LanternEd is explicitly used from shared community/school devices (see the "shared device"
# login option), where one public IP legitimately serves many different students resetting
# their own, different accounts — a tight per-IP limit would lock all of them out together.
_RESET_IP_MAX_ATTEMPTS = 30
_RESET_IP_WINDOW = timedelta(minutes=15)


def _check_rate_limit(db: Session, key: str, *, max_attempts: int | None = None, window: timedelta | None = None) -> None:
    # Resolved from the module globals at call time (not as default-argument values), so tests
    # can monkeypatch _MAX_ATTEMPTS / _WINDOW and have it actually take effect.
    max_attempts = _MAX_ATTEMPTS if max_attempts is None else max_attempts
    window = _WINDOW if window is None else window
    if rate_limit_service.record(db, key, window) > max_attempts:
        raise UnauthorizedError("Too many attempts. Please try again later.", code="RATE_LIMITED", status_code=429)


def reset_rate_limits() -> None:
    """Test-only: clears every rate-limit bucket (login + password-reset, and admin's own)."""
    rate_limit_service.reset_all()


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
    branch_id: str | None = None, all_sections: bool = False, verification_token: str | None = None,
) -> User:
    if role == UserRole.admin:
        raise ForbiddenError("This role cannot be self-registered.", code="ROLE_NOT_ALLOWED")
    normalized_email = email.strip().lower()
    if normalized_email in settings.blocked_registration_emails:
        raise ForbiddenError("This email address cannot be used to register an account.", code="EMAIL_NOT_ALLOWED")
    if settings.require_registration_otp:
        if not verification_token:
            raise ForbiddenError("Verify your email address before registering.", code="EMAIL_NOT_VERIFIED")
        consume_registration_verification(db, email=normalized_email, verification_token=verification_token)
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
    existing = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if existing:
        raise ConflictError("An account with this email already exists.", code="EMAIL_TAKEN")

    user = User(
        full_name=full_name.strip(),
        email=normalized_email,
        password_hash=hash_password(password),
        role=role,
        # A college-scoped registration awaits that college's delegated administrator's approval
        # (see institution_admin.py's registration-review endpoints and authenticate_user below).
        # A collegeless registration (only reachable when *_college_required is off — a dev/test
        # convenience, see config.py) has no administrator who could ever approve it, so it stays
        # active immediately, exactly as before this feature existed.
        status=UserStatus.pending if target is not None else UserStatus.active,
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
    _check_rate_limit(db, normalized_email)

    user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        audit_service.record(db, actor_id=user.id if user else None, action="login_failed", resource_type="user")
        raise UnauthorizedError("Incorrect email or password.", code="INVALID_CREDENTIALS")
    if user.role == UserRole.admin:  # administrators sign in only through the admin endpoint
        raise UnauthorizedError("Incorrect email or password.", code="INVALID_CREDENTIALS")
    if user.status == UserStatus.pending:
        raise UnauthorizedError(
            "Your registration is awaiting approval from your institution's administrator.", code="REGISTRATION_PENDING"
        )
    if user.status == UserStatus.rejected:
        raise UnauthorizedError(
            "Your registration was declined by your institution. Contact them for details.", code="REGISTRATION_REJECTED"
        )
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


def _GENERIC_OTP_ERROR() -> UnauthorizedError:
    return UnauthorizedError("That code is incorrect or has expired.", code="INVALID_OTP")


def _claim_otp(db: Session, user: User, purpose: str, otp: str) -> None:
    """Verifies `otp` against the newest outstanding challenge of `purpose` for `user`, atomically.
    Raises one generic error for every failure; returns only when the code was correct and has just been
    marked verified (so it can never be redeemed twice)."""
    now = utcnow()
    challenge = db.execute(
        select(PasswordResetOtpChallenge)
        .where(
            PasswordResetOtpChallenge.user_id == user.id,
            PasswordResetOtpChallenge.purpose == purpose,
            PasswordResetOtpChallenge.verified_at.is_(None),
            PasswordResetOtpChallenge.revoked_at.is_(None),
            PasswordResetOtpChallenge.expires_at > now,
        )
        .order_by(PasswordResetOtpChallenge.created_at.desc())
    ).scalars().first()
    if not challenge:
        raise _GENERIC_OTP_ERROR()

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
        raise _GENERIC_OTP_ERROR()

    db.refresh(challenge)
    if not hmac.compare_digest(challenge.otp_hash, _hash_otp(otp)):
        raise _GENERIC_OTP_ERROR()

    # Atomic verified-claim: of several concurrent requests submitting the same correct OTP,
    # only the one that actually flips verified_at here succeeds.
    verified_claim = db.execute(
        update(PasswordResetOtpChallenge)
        .where(PasswordResetOtpChallenge.id == challenge.id, PasswordResetOtpChallenge.verified_at.is_(None))
        .values(verified_at=now)
    )
    db.commit()
    if verified_claim.rowcount != 1:
        raise _GENERIC_OTP_ERROR()


def request_password_reset(db: Session, email: str, *, ip: str | None = None) -> str | None:
    """Returns the raw OTP only in non-production, so the flow is testable without EmailJS wired
    up. In production the OTP is only ever emailed, never returned. The response is identical
    whether the account exists, is ineligible, or is inside its resend cooldown — none of that is
    ever revealed to the caller.
    Rate-limited by both email and (when known) requester IP, same budget either way so an
    enumeration attempt gains no timing signal from which one tripped first."""
    from app.integrations import email as email_integration

    normalized_email = email.strip().lower()
    _check_rate_limit(db, f"reset-email:{normalized_email}")
    if ip:
        _check_rate_limit(db, f"reset-ip:{ip}", max_attempts=_RESET_IP_MAX_ATTEMPTS, window=_RESET_IP_WINDOW)

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
    _check_rate_limit(db, f"reset-otp-email:{normalized_email}")
    if ip:
        _check_rate_limit(db, f"reset-otp-ip:{ip}", max_attempts=_RESET_IP_MAX_ATTEMPTS, window=_RESET_IP_WINDOW)

    now = utcnow()
    user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if not user:
        raise _GENERIC_OTP_ERROR()
    _claim_otp(db, user, RESET_PURPOSE, otp)

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


# ---- second-device login approval ------------------------------------------------------------------

LOGIN_PURPOSE = "login_approval"


def has_active_session(db: Session, user: User) -> bool:
    return (
        db.execute(
            select(UserSession.id).where(
                UserSession.user_id == user.id, UserSession.revoked_at.is_(None), UserSession.expires_at > utcnow()
            )
        ).first()
        is not None
    )


def _token_is_users_active_session(db: Session, token: str | None, user: User) -> bool:
    if not token:
        return False
    owner = get_user_from_session_token(db, token)
    return owner is not None and owner.id == user.id


def login_requires_otp(db: Session, user: User, presented_token: str | None) -> bool:
    """A student/teacher who is ALREADY signed in somewhere may only start another session by proving, with a
    code emailed to the account's own address, that the account owner approves it. Knowing the password is not
    enough. Not required when this very browser holds the user's valid session (re-login on the same device),
    when nobody is signed in, or for administrators (separate login)."""
    if not settings.concurrent_login_otp or user.role not in (UserRole.student, UserRole.teacher):
        return False
    if not has_active_session(db, user):
        return False
    if _token_is_users_active_session(db, presented_token, user):
        return False
    if settings.is_production and not settings.emailjs_configured:
        # No way to deliver a code: failing closed would lock everyone out for the session lifetime.
        logger.warning("Concurrent-login OTP skipped: EmailJS is not configured in production.")
        return False
    return True


def request_login_otp(db: Session, user: User, *, ip: str | None = None) -> tuple[bool, str | None]:
    """Emails a login-approval code. Returns (code_was_sent, raw_otp_for_development). The raw code is returned
    only outside production and only when email is not configured; in production it is only ever emailed."""
    from app.core.exceptions import ServiceUnavailableError
    from app.integrations import email as email_integration

    _check_rate_limit(db, f"login-otp-req-email:{user.email}")
    if ip:
        _check_rate_limit(db, f"login-otp-req-ip:{ip}", max_attempts=_RESET_IP_MAX_ATTEMPTS, window=_RESET_IP_WINDOW)

    now = utcnow()
    latest = db.execute(
        select(PasswordResetOtpChallenge)
        .where(PasswordResetOtpChallenge.user_id == user.id, PasswordResetOtpChallenge.purpose == LOGIN_PURPOSE)
        .order_by(PasswordResetOtpChallenge.created_at.desc())
    ).scalars().first()
    if latest and (now - latest.created_at) < timedelta(seconds=settings.otp_request_cooldown_seconds):
        return False, None  # the code already sent is still valid; do not email again inside the cooldown

    db.execute(
        update(PasswordResetOtpChallenge)
        .where(
            PasswordResetOtpChallenge.user_id == user.id,
            PasswordResetOtpChallenge.purpose == LOGIN_PURPOSE,
            PasswordResetOtpChallenge.verified_at.is_(None),
            PasswordResetOtpChallenge.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    otp = _generate_otp()
    challenge = PasswordResetOtpChallenge(
        user_id=user.id,
        otp_hash=_hash_otp(otp),
        purpose=LOGIN_PURPOSE,
        expires_at=now + timedelta(minutes=settings.otp_ttl_minutes),
        max_attempts=settings.otp_max_attempts,
    )
    db.add(challenge)
    db.commit()
    audit_service.record(db, actor_id=user.id, action="login_otp_requested", resource_type="user", resource_id=user.id)

    sent = email_integration.send_login_approval_otp_email(to=user.email, otp=otp, ttl_minutes=settings.otp_ttl_minutes)
    if not sent and settings.emailjs_configured:
        challenge.revoked_at = utcnow()
        db.commit()
        logger.warning("login_otp_email_not_sent user_id=%s", user.id)
        raise ServiceUnavailableError("We could not send the verification code. Please try again shortly.", code="OTP_SEND_FAILED")
    return sent, (None if settings.is_production or settings.emailjs_configured else otp)


def verify_login_otp(db: Session, *, email: str, otp: str, ip: str | None = None) -> User:
    """Redeems the approval code. On success the account's other sessions are ended and the caller (who just
    proved control of the mailbox) is the one who gets the session - the router creates it."""
    normalized_email = email.strip().lower()
    _check_rate_limit(db, f"login-otp-email:{normalized_email}")
    if ip:
        _check_rate_limit(db, f"login-otp-ip:{ip}", max_attempts=_RESET_IP_MAX_ATTEMPTS, window=_RESET_IP_WINDOW)
    user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if not user or user.role not in (UserRole.student, UserRole.teacher) or user.status != UserStatus.active:
        raise _GENERIC_OTP_ERROR()
    _claim_otp(db, user, LOGIN_PURPOSE, otp)
    ended = revoke_all_sessions_except(db, user, keep_token=None)
    audit_service.record(db, actor_id=user.id, action="login_otp_verified", resource_type="user", resource_id=user.id)
    if ended:
        logger.info("login_otp_handover user_id=%s ended_sessions=%s", user.id, ended)
    return user


# ---- registration email verification ---------------------------------------------------------
# Separate from the two OTP flows above: those prove control of an EXISTING account's mailbox
# (user_id FK). This proves control of a mailbox for an account that doesn't exist YET, so the
# challenge is keyed by email instead, in its own table (RegistrationOtpChallenge) — see that
# model's docstring. Combines OTP + the resulting short-lived authorization in one row.


def request_registration_otp(db: Session, email: str, *, ip: str | None = None) -> tuple[bool, str | None]:
    """Emails a registration email-verification code. Rejects up front (not silently, unlike
    password-reset) if the email is blocklisted or already registered — there is no existing
    account to protect from enumeration here; the caller is about to try to register anyway, and
    /auth/register would reject the same email with the same codes regardless."""
    from app.core.exceptions import ServiceUnavailableError
    from app.integrations import email as email_integration

    normalized_email = email.strip().lower()
    if normalized_email in settings.blocked_registration_emails:
        raise ForbiddenError("This email address cannot be used to register an account.", code="EMAIL_NOT_ALLOWED")
    _check_rate_limit(db, f"register-otp-req-email:{normalized_email}")
    if ip:
        _check_rate_limit(db, f"register-otp-req-ip:{ip}", max_attempts=_RESET_IP_MAX_ATTEMPTS, window=_RESET_IP_WINDOW)

    existing = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if existing:
        raise ConflictError("An account with this email already exists.", code="EMAIL_TAKEN")

    now = utcnow()
    latest = db.execute(
        select(RegistrationOtpChallenge)
        .where(RegistrationOtpChallenge.email == normalized_email)
        .order_by(RegistrationOtpChallenge.created_at.desc())
    ).scalars().first()
    if (
        latest
        and latest.revoked_at is None
        and latest.consumed_at is None
        and (now - latest.created_at) < timedelta(seconds=settings.otp_request_cooldown_seconds)
    ):
        return False, None  # the code already sent is still valid; do not email again inside the cooldown

    db.execute(
        update(RegistrationOtpChallenge)
        .where(
            RegistrationOtpChallenge.email == normalized_email,
            RegistrationOtpChallenge.verified_at.is_(None),
            RegistrationOtpChallenge.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    otp = _generate_otp()
    challenge = RegistrationOtpChallenge(
        email=normalized_email,
        otp_hash=_hash_otp(otp),
        expires_at=now + timedelta(minutes=settings.otp_ttl_minutes),
        max_attempts=settings.otp_max_attempts,
    )
    db.add(challenge)
    db.commit()

    sent = email_integration.send_registration_otp_email(to=normalized_email, otp=otp, ttl_minutes=settings.otp_ttl_minutes)
    if not sent and settings.emailjs_configured:
        challenge.revoked_at = utcnow()
        db.commit()
        logger.warning("registration_otp_email_not_sent")
        raise ServiceUnavailableError("We could not send the verification code. Please try again shortly.", code="OTP_SEND_FAILED")
    return sent, (None if settings.is_production or settings.emailjs_configured else otp)


def verify_registration_otp(db: Session, *, email: str, otp: str, ip: str | None = None) -> str:
    """Verifies the OTP and, only on success, issues a short-lived single-use registration
    verification token that register_user() requires. Atomic attempt-claim and verified-claim,
    same pattern as _claim_otp, just against RegistrationOtpChallenge (email-keyed, not user-keyed)."""
    normalized_email = email.strip().lower()
    _check_rate_limit(db, f"register-otp-email:{normalized_email}")
    if ip:
        _check_rate_limit(db, f"register-otp-ip:{ip}", max_attempts=_RESET_IP_MAX_ATTEMPTS, window=_RESET_IP_WINDOW)

    now = utcnow()
    challenge = db.execute(
        select(RegistrationOtpChallenge)
        .where(
            RegistrationOtpChallenge.email == normalized_email,
            RegistrationOtpChallenge.verified_at.is_(None),
            RegistrationOtpChallenge.revoked_at.is_(None),
            RegistrationOtpChallenge.expires_at > now,
        )
        .order_by(RegistrationOtpChallenge.created_at.desc())
    ).scalars().first()
    if not challenge:
        raise _GENERIC_OTP_ERROR()

    claimed = db.execute(
        update(RegistrationOtpChallenge)
        .where(
            RegistrationOtpChallenge.id == challenge.id,
            RegistrationOtpChallenge.attempts < RegistrationOtpChallenge.max_attempts,
            RegistrationOtpChallenge.verified_at.is_(None),
            RegistrationOtpChallenge.revoked_at.is_(None),
            RegistrationOtpChallenge.expires_at > now,
        )
        .values(attempts=RegistrationOtpChallenge.attempts + 1)
    )
    db.commit()
    if claimed.rowcount != 1:
        raise _GENERIC_OTP_ERROR()

    db.refresh(challenge)
    if not hmac.compare_digest(challenge.otp_hash, _hash_otp(otp)):
        raise _GENERIC_OTP_ERROR()

    verification_token = generate_session_token()
    verified_claim = db.execute(
        update(RegistrationOtpChallenge)
        .where(RegistrationOtpChallenge.id == challenge.id, RegistrationOtpChallenge.verified_at.is_(None))
        .values(
            verified_at=now,
            verification_token_hash=hash_token(verification_token),
            token_expires_at=now + timedelta(minutes=settings.reset_token_ttl_minutes),
        )
    )
    db.commit()
    if verified_claim.rowcount != 1:
        raise _GENERIC_OTP_ERROR()
    return verification_token


def consume_registration_verification(db: Session, *, email: str, verification_token: str) -> None:
    """Redeems the token from verify_registration_otp. Raises ForbiddenError (never reveals why
    beyond a generic message) if it's missing, expired, already used, or for a different email
    than the one actually being registered — register_user calls this before creating the account,
    so an unverified or mismatched email can never result in an active account."""
    now = utcnow()
    token_hash = hash_token(verification_token)
    normalized_email = email.strip().lower()
    claimed = db.execute(
        update(RegistrationOtpChallenge)
        .where(
            RegistrationOtpChallenge.verification_token_hash == token_hash,
            RegistrationOtpChallenge.email == normalized_email,
            RegistrationOtpChallenge.token_expires_at > now,
            RegistrationOtpChallenge.consumed_at.is_(None),
            RegistrationOtpChallenge.revoked_at.is_(None),
        )
        .values(consumed_at=now)
    )
    db.commit()
    if claimed.rowcount != 1:
        raise ForbiddenError("Email verification is required and must match the email you're registering with.", code="EMAIL_NOT_VERIFIED")


# ---- two-phase college deletion confirmation ---------------------------------------------------
# A super admin can only REQUEST a college's deletion (see college_service.request_college_deletion);
# completing it needs the college's own delegated administrator to separately prove (a) their own
# password and (b) control of the college's registered contact mailbox, via this OTP, reusing the
# exact same _generate_otp/_hash_otp/_claim_otp primitives as every other OTP purpose above — just a
# new purpose string and, unlike every other purpose here, an email recipient the caller chooses
# (the college's contact_email) rather than the confirming user's own address.

DELETION_PURPOSE = "college_deletion"


def request_deletion_otp(db: Session, confirming_user: User, *, send_to_email: str, ip: str | None = None) -> tuple[bool, str | None]:
    """Emails a college-deletion confirmation code to `send_to_email` (the college's own contact
    address, not the confirming user's). Returns (code_was_sent, raw_otp_for_development), same
    convention as request_login_otp."""
    from app.integrations import email as email_integration

    _check_rate_limit(db, f"deletion-otp-req:{confirming_user.id}")
    if ip:
        _check_rate_limit(db, f"deletion-otp-req-ip:{ip}", max_attempts=_RESET_IP_MAX_ATTEMPTS, window=_RESET_IP_WINDOW)

    now = utcnow()
    latest = db.execute(
        select(PasswordResetOtpChallenge)
        .where(PasswordResetOtpChallenge.user_id == confirming_user.id, PasswordResetOtpChallenge.purpose == DELETION_PURPOSE)
        .order_by(PasswordResetOtpChallenge.created_at.desc())
    ).scalars().first()
    if latest and (now - latest.created_at) < timedelta(seconds=settings.otp_request_cooldown_seconds):
        return False, None  # the code already sent is still valid; do not email again inside the cooldown

    db.execute(
        update(PasswordResetOtpChallenge)
        .where(
            PasswordResetOtpChallenge.user_id == confirming_user.id,
            PasswordResetOtpChallenge.purpose == DELETION_PURPOSE,
            PasswordResetOtpChallenge.verified_at.is_(None),
            PasswordResetOtpChallenge.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    otp = _generate_otp()
    challenge = PasswordResetOtpChallenge(
        user_id=confirming_user.id,
        otp_hash=_hash_otp(otp),
        purpose=DELETION_PURPOSE,
        expires_at=now + timedelta(minutes=settings.otp_ttl_minutes),
        max_attempts=settings.otp_max_attempts,
    )
    db.add(challenge)
    db.commit()

    sent = email_integration.send_college_deletion_otp_email(to=send_to_email, otp=otp, ttl_minutes=settings.otp_ttl_minutes)
    return sent, (None if settings.is_production or settings.emailjs_configured else otp)


def verify_deletion_otp(db: Session, confirming_user: User, *, otp: str, ip: str | None = None) -> None:
    _check_rate_limit(db, f"deletion-otp-verify:{confirming_user.id}")
    if ip:
        _check_rate_limit(db, f"deletion-otp-verify-ip:{ip}", max_attempts=_RESET_IP_MAX_ATTEMPTS, window=_RESET_IP_WINDOW)
    _claim_otp(db, confirming_user, DELETION_PURPOSE, otp)
