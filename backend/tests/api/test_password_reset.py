"""Email OTP-based password reset: real API + database, no mocks beyond the email provider's own
network call (never hit for real in automated tests — EmailJS is unconfigured in the test env,
so every send is a no-op and the OTP comes back in the response instead, exactly as it does in
real local development without EmailJS credentials)."""

import threading

import pytest

from tests.conftest import unique_email

FORGOT_MESSAGE = "If an account exists with that email address, a verification code will be sent."


def _register(client, *, email=None, password="original-password", role="student", full_name="Reset Me"):
    email = email or unique_email("reset")
    resp = client.post("/api/v1/auth/register", json={"full_name": full_name, "email": email, "password": password, "role": role})
    assert resp.status_code == 201, resp.text
    return email, resp.json()["user"]


def _request_otp(client, email):
    resp = client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert resp.status_code == 202, resp.text
    return resp.json()["dev_otp"]


def _reset_token(client, email, otp):
    resp = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": otp})
    assert resp.status_code == 200, resp.text
    return resp.json()["reset_token"]


def _full_flow(client, email):
    """Request + verify in one call, for tests that only care about the end state."""
    otp = _request_otp(client, email)
    return _reset_token(client, email, otp)


@pytest.fixture
def admin_user(db_session, monkeypatch):
    """A real admin account, built the same way test_admin.py / test_college_registration.py do:
    remove any stale one, then bootstrap fresh from configured credentials."""
    import secrets

    from app.config import get_settings
    from app.services import admin_service
    from tests.api.test_admin import _remove_admins

    settings = get_settings()
    # Email-shaped on purpose: this is the realistic case the forgot-password schema must still
    # reject with the generic response, not a format rejection that would sidestep the test.
    username, password = f"admin-{secrets.token_hex(4)}@example.com", secrets.token_urlsafe(18)
    monkeypatch.setattr(settings, "admin_username", username)
    monkeypatch.setattr(settings, "admin_password", password)
    _remove_admins(db_session)
    admin_service.reset_rate_limits()
    admin_service.bootstrap_admin(db_session)
    return {"email": username, "password": password}


@pytest.fixture(autouse=True)
def _no_real_email(monkeypatch):
    """No automated test ever sends a real email: EmailJS is reported as unconfigured, so the
    provider call is always a no-op, exactly like local dev without credentials."""
    from app.integrations import email as email_integration

    monkeypatch.setattr(email_integration.settings, "emailjs_service_id", None)
    monkeypatch.setattr(email_integration.settings, "emailjs_template_id", None)
    monkeypatch.setattr(email_integration.settings, "emailjs_public_key", None)


@pytest.fixture(autouse=True)
def _clean_rate_limits():
    """Every test starts with a fresh in-process rate-limit budget — otherwise the per-IP bucket
    (shared by every request this whole test run makes through Starlette's TestClient, which
    always reports the same fake client address) fills up from unrelated tests and this file's
    own tests start tripping 429s on each other."""
    from app.services import auth_service

    auth_service.reset_rate_limits()
    yield
    auth_service.reset_rate_limits()


# ---- forgot-password (request OTP) -------------------------------------------------------------

def test_forgot_password_returns_otp_in_dev_mode_for_a_real_registered_email(client):
    email, _ = _register(client)
    resp = client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert resp.status_code == 202
    body = resp.json()
    assert body["message"] == FORGOT_MESSAGE
    assert body["dev_otp"] and len(body["dev_otp"]) == 6 and body["dev_otp"].isdigit()


def test_forgot_password_unknown_email_gets_the_identical_generic_response(client):
    resp = client.post("/api/v1/auth/forgot-password", json={"email": unique_email("ghost")})
    assert resp.status_code == 202
    body = resp.json()
    assert body["message"] == FORGOT_MESSAGE
    assert body["dev_otp"] is None


def test_forgot_password_invalid_email_format_is_a_422_not_a_500(client):
    resp = client.post("/api/v1/auth/forgot-password", json={"email": "not-an-email"})
    assert resp.status_code == 422


def test_forgot_password_admin_account_is_treated_like_a_nonexistent_one(client, admin_user):
    resp = client.post("/api/v1/auth/forgot-password", json={"email": admin_user["email"]})
    assert resp.status_code == 202
    assert resp.json()["dev_otp"] is None


def test_suspended_account_is_treated_like_a_nonexistent_one(client, db_session):
    from app.db.models.user import User
    from app.db.models.enums import UserStatus

    email, user = _register(client, email=unique_email("suspended"))
    db_session.query(User).filter_by(id=user["id"]).update({"status": UserStatus.suspended})
    db_session.commit()

    resp = client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert resp.status_code == 202
    assert resp.json()["dev_otp"] is None


def test_otp_request_cooldown_blocks_an_immediate_second_request(client):
    email, _ = _register(client, email=unique_email("cooldown"))
    first = client.post("/api/v1/auth/forgot-password", json={"email": email}).json()["dev_otp"]
    again = client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert again.status_code == 202
    assert again.json()["message"] == FORGOT_MESSAGE  # cooldown status is never revealed
    assert again.json()["dev_otp"] is None  # ...but internally, no new OTP was actually issued

    # The original OTP is still the valid one.
    verify = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": first})
    assert verify.status_code == 200


def test_a_new_otp_request_after_cooldown_invalidates_the_previous_one(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "otp_request_cooldown_seconds", 0)
    email, _ = _register(client, email=unique_email("super"))
    first_otp = client.post("/api/v1/auth/forgot-password", json={"email": email}).json()["dev_otp"]
    second_otp = client.post("/api/v1/auth/forgot-password", json={"email": email}).json()["dev_otp"]
    assert first_otp != second_otp

    stale = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": first_otp})
    assert stale.status_code == 401 and stale.json()["error"]["code"] == "INVALID_OTP"

    fresh = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": second_otp})
    assert fresh.status_code == 200


def test_email_provider_failure_still_returns_the_safe_generic_response(client, monkeypatch):
    from app.integrations import email as email_integration

    monkeypatch.setattr(email_integration, "send_otp_email", lambda **kw: False)
    email, _ = _register(client, email=unique_email("providerdown"))
    resp = client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert resp.status_code == 202
    assert resp.json()["message"] == FORGOT_MESSAGE  # the caller never learns delivery failed


def test_forgot_password_rate_limit_is_enforced(client, monkeypatch):
    from app.services import auth_service

    monkeypatch.setattr(auth_service, "_MAX_ATTEMPTS", 3)
    email = unique_email("ratelimited")
    for _ in range(3):
        assert client.post("/api/v1/auth/forgot-password", json={"email": email}).status_code == 202
    limited = client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert limited.status_code == 429


def test_forgot_password_never_logs_the_otp(client, caplog):
    import logging

    email, _ = _register(client, email=unique_email("quiet"))
    with caplog.at_level(logging.DEBUG):
        otp = client.post("/api/v1/auth/forgot-password", json={"email": email}).json()["dev_otp"]
    assert otp not in caplog.text


# ---- verify-reset-otp ---------------------------------------------------------------------------

def test_valid_otp_issues_a_reset_authorization(client):
    email, _ = _register(client, email=unique_email("validotp"))
    otp = _request_otp(client, email)
    resp = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": otp})
    assert resp.status_code == 200
    body = resp.json()
    assert body["reset_token"] and body["expires_in_minutes"] == 10


def test_incorrect_otp_is_rejected_with_a_generic_error(client):
    email, _ = _register(client, email=unique_email("wrongotp"))
    _request_otp(client, email)
    resp = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": "000000"})
    assert resp.status_code == 401 and resp.json()["error"]["code"] == "INVALID_OTP"


def test_otp_for_an_unknown_email_gets_the_same_generic_error(client):
    resp = client.post("/api/v1/auth/verify-reset-otp", json={"email": unique_email("noaccount"), "otp": "123456"})
    assert resp.status_code == 401 and resp.json()["error"]["code"] == "INVALID_OTP"


def test_malformed_otp_is_a_422(client):
    email, _ = _register(client, email=unique_email("malformed"))
    _request_otp(client, email)
    resp = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": "12a456"})
    assert resp.status_code == 422


def test_otp_attempt_limit_is_enforced_then_the_otp_is_dead_even_if_later_guessed_correctly(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "otp_max_attempts", 3)
    email, _ = _register(client, email=unique_email("attempts"))
    otp = _request_otp(client, email)

    for _ in range(3):
        wrong = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": "999999"})
        assert wrong.status_code == 401

    # The budget is exhausted — even the real OTP no longer works.
    exhausted = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": otp})
    assert exhausted.status_code == 401 and exhausted.json()["error"]["code"] == "INVALID_OTP"


def test_expired_otp_is_rejected(client, db_session, monkeypatch):
    from datetime import timedelta

    from app.db.base import utcnow
    from app.db.models.user import PasswordResetOtpChallenge

    email, _ = _register(client, email=unique_email("expiredotp"))
    otp = _request_otp(client, email)

    row = db_session.query(PasswordResetOtpChallenge).filter_by(user_id=_user_id(db_session, email)).one()
    row.expires_at = utcnow() - timedelta(minutes=1)
    db_session.commit()

    resp = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": otp})
    assert resp.status_code == 401 and resp.json()["error"]["code"] == "INVALID_OTP"


def test_revoked_otp_is_rejected(client, db_session):
    from app.db.base import utcnow
    from app.db.models.user import PasswordResetOtpChallenge

    email, _ = _register(client, email=unique_email("revokedotp"))
    otp = _request_otp(client, email)

    row = db_session.query(PasswordResetOtpChallenge).filter_by(user_id=_user_id(db_session, email)).one()
    row.revoked_at = utcnow()
    db_session.commit()

    resp = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": otp})
    assert resp.status_code == 401 and resp.json()["error"]["code"] == "INVALID_OTP"


def test_otp_cannot_be_reused_after_successful_verification(client):
    email, _ = _register(client, email=unique_email("reuseotp"))
    otp = _request_otp(client, email)

    first = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": otp})
    assert first.status_code == 200

    second = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": otp})
    assert second.status_code == 401 and second.json()["error"]["code"] == "INVALID_OTP"


def test_otp_verification_does_not_start_a_session_or_leak_user_details(client):
    email, _ = _register(client, email=unique_email("nosessionotp"))
    otp = _request_otp(client, email)
    resp = client.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": otp})
    assert resp.status_code == 200
    assert "set-cookie" not in {k.lower() for k in resp.headers.keys()}
    assert set(resp.json().keys()) == {"reset_token", "expires_in_minutes"}


def test_concurrent_verification_of_the_same_correct_otp_only_one_succeeds(client):
    email, _ = _register(client, email=unique_email("concurrentotp"))
    otp = _request_otp(client, email)

    from fastapi.testclient import TestClient
    from app.main import app

    results = [None, None]

    def _attempt(i):
        c = TestClient(app)
        results[i] = c.post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": otp})

    threads = [threading.Thread(target=_attempt, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    statuses = sorted(r.status_code for r in results)
    assert statuses == [200, 401]  # exactly one winner


def _user_id(db_session, email):
    from app.db.models.user import User

    return db_session.query(User).filter_by(email=email.strip().lower()).one().id


# ---- reset-password (consume the reset authorization) --------------------------------------------

def test_reset_password_with_valid_reset_token_then_login_with_new_password(client):
    email, _ = _register(client, email=unique_email("reset2"), password="old-password")
    reset_token = _full_flow(client, email)

    reset = client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "new-password-123"})
    assert reset.status_code == 204

    old_login = client.post("/api/v1/auth/login", json={"email": email, "password": "old-password"})
    assert old_login.status_code == 401

    new_login = client.post("/api/v1/auth/login", json={"email": email, "password": "new-password-123"})
    assert new_login.status_code == 200


def test_reset_password_does_not_itself_start_an_authenticated_session(client):
    email, _ = _register(client, email=unique_email("nosession"), password="old-password")
    reset_token = _full_flow(client, email)
    reset_resp = client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "new-password-123"})
    assert reset_resp.status_code == 204
    assert "set-cookie" not in {k.lower() for k in reset_resp.headers.keys()}
    assert client.get("/api/v1/users/me").status_code == 401


def test_reset_password_revokes_existing_sessions(client):
    email, _ = _register(client, email=unique_email("revoke"), password="old-password")
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "old-password"})
    assert login.status_code == 200
    assert client.get("/api/v1/users/me").status_code == 200  # the session works before the reset

    reset_token = _full_flow(client, email)
    client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "new-password-123"})

    assert client.get("/api/v1/users/me").status_code == 401  # the old session is dead now


def test_reset_password_with_invalid_reset_token_rejected(client):
    resp = client.post("/api/v1/auth/reset-password", json={"reset_token": "not-a-real-token", "new_password": "whatever123"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "INVALID_RESET_TOKEN"


def test_reset_token_cannot_be_reused(client):
    email, _ = _register(client, email=unique_email("reset3"), password="old-password")
    reset_token = _full_flow(client, email)

    first = client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "first-new-pass"})
    assert first.status_code == 204

    second = client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "second-new-pass"})
    assert second.status_code == 401


def test_expired_reset_token_is_rejected(client, db_session):
    from datetime import timedelta

    from app.core.security import hash_token
    from app.db.base import utcnow
    from app.db.models.user import PasswordResetToken

    email, _ = _register(client, email=unique_email("expired"))
    reset_token = _full_flow(client, email)

    row = db_session.query(PasswordResetToken).filter_by(token_hash=hash_token(reset_token)).one()
    row.expires_at = utcnow() - timedelta(minutes=1)
    db_session.commit()

    resp = client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "whatever-123"})
    assert resp.status_code == 401 and resp.json()["error"]["code"] == "INVALID_RESET_TOKEN"


def test_revoked_reset_token_is_rejected(client, db_session):
    from app.core.security import hash_token
    from app.db.base import utcnow
    from app.db.models.user import PasswordResetToken

    email, _ = _register(client, email=unique_email("revoked"))
    reset_token = _full_flow(client, email)

    row = db_session.query(PasswordResetToken).filter_by(token_hash=hash_token(reset_token)).one()
    row.revoked_at = utcnow()
    db_session.commit()

    resp = client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "whatever-123"})
    assert resp.status_code == 401 and resp.json()["error"]["code"] == "INVALID_RESET_TOKEN"


def test_reset_token_whose_account_no_longer_exists_is_rejected(client, db_session):
    from app.db.models.user import User

    email, user = _register(client, email=unique_email("ghostacct"))
    reset_token = _full_flow(client, email)

    # Remove the account for real. PostgreSQL enforces foreign keys (SQLite does not by default), so the rows that
    # point at the user (audit events, sessions) go first.
    from sqlalchemy import delete

    from app.db.models.sync_operation import AuditEvent
    from app.db.models.user import UserSession

    db_session.execute(delete(AuditEvent).where(AuditEvent.actor_id == user["id"]))
    db_session.execute(delete(UserSession).where(UserSession.user_id == user["id"]))
    db_session.query(User).filter_by(id=user["id"]).delete()
    db_session.commit()

    resp = client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "whatever-123"})
    assert resp.status_code == 401 and resp.json()["error"]["code"] == "INVALID_RESET_TOKEN"


def test_confirm_password_mismatch_is_rejected_when_sent(client):
    email, _ = _register(client, email=unique_email("mismatch"))
    reset_token = _full_flow(client, email)
    resp = client.post(
        "/api/v1/auth/reset-password",
        json={"reset_token": reset_token, "new_password": "fine-password-123", "confirm_password": "different-password-1"},
    )
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "PASSWORD_MISMATCH"


def test_password_policy_rejection_too_short(client):
    email, _ = _register(client, email=unique_email("shortpw"))
    reset_token = _full_flow(client, email)
    resp = client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "short"})
    assert resp.status_code == 422

    # The authorization survives a rejected attempt and can still be redeemed with a valid password.
    ok = client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "fine-password-123"})
    assert ok.status_code == 204


def test_concurrent_redemption_of_the_same_reset_token_only_one_succeeds(client):
    email, _ = _register(client, email=unique_email("concurrent"), password="old-password")
    reset_token = _full_flow(client, email)

    from fastapi.testclient import TestClient
    from app.main import app

    results = [None, None]

    def _attempt(i, pw):
        c = TestClient(app)
        results[i] = c.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": pw})

    threads = [
        threading.Thread(target=_attempt, args=(0, "winner-password-1")),
        threading.Thread(target=_attempt, args=(1, "winner-password-2")),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    statuses = sorted(r.status_code for r in results)
    assert statuses == [204, 401]  # exactly one winner, one rejection — never both succeeding

    winning_password = "winner-password-1" if results[0].status_code == 204 else "winner-password-2"
    assert TestClient(app).post("/api/v1/auth/login", json={"email": email, "password": winning_password}).status_code == 200


# ---- student vs teacher, and institution-membership independence (sections 9 & 11) --------------

def test_student_and_teacher_accounts_use_the_identical_recovery_endpoints(client):
    for role in ("student", "teacher"):
        email, _ = _register(client, email=unique_email(f"role-{role}"), password="old-password", role=role)
        reset_token = _full_flow(client, email)
        resp = client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "new-password-999"})
        assert resp.status_code == 204, f"{role} recovery failed: {resp.text}"
        assert client.post("/api/v1/auth/login", json={"email": email, "password": "new-password-999"}).status_code == 200


def test_password_reset_does_not_touch_role_college_or_status(client, admin_user, db_session):
    from sqlalchemy import select
    from app.db.models.enums import UserStatus
    from app.db.models.user import User
    import secrets

    from fastapi.testclient import TestClient
    from app.main import app
    from tests.api.test_admin import BASE, CSRF

    admin_client = TestClient(app, headers=CSRF)
    login = admin_client.post(f"{BASE}/auth/login", json={"username": admin_user["email"], "password": admin_user["password"]})
    assert login.status_code == 200, login.text
    college = admin_client.post(f"{BASE}/colleges", json={"name": f"Reset College {secrets.token_hex(4)}"}).json()
    branch = admin_client.post(f"{BASE}/colleges/{college['id']}/branches", json={"name": "CS"}).json()
    section = admin_client.post(f"{BASE}/branches/{branch['id']}/sections", json={"name": "A"}).json()

    email = unique_email("institution")
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Institution Teacher", "email": email, "password": "original-password", "role": "teacher",
            "college_id": college["id"], "college_code": college["code"], "branch_id": branch["id"], "section_id": section["id"],
        },
    )
    assert reg.status_code == 202, reg.text  # pending the college administrator's approval
    user_id = db_session.execute(select(User.id).where(User.email == email)).scalar_one()
    db_session.get(User, user_id).status = UserStatus.active  # approve directly: not what this test is about
    db_session.commit()

    reset_token = _full_flow(client, email)
    assert client.post("/api/v1/auth/reset-password", json={"reset_token": reset_token, "new_password": "brand-new-password-1"}).status_code == 204

    db_session.expire_all()
    row = db_session.get(User, user_id)
    assert row.role.value == "teacher"
    assert row.college_id == college["id"]
    assert row.status.value == "active"
