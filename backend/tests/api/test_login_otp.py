"""A second sign-in to an account that is already signed in elsewhere needs the emailed OTP; the password alone is
not enough. Real API and database; the only fake is the outgoing EmailJS HTTP call."""

import secrets
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.db.base import utcnow
from app.db.models.user import PasswordResetOtpChallenge, UserSession
from app.integrations import email as email_integration
from app.main import app
from app.services import auth_service

PASSWORD = "password123"


@pytest.fixture(autouse=True)
def otp_rule(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "concurrent_login_otp", True)
    monkeypatch.setattr(settings, "otp_request_cooldown_seconds", 0)
    auth_service.reset_rate_limits()
    yield
    auth_service.reset_rate_limits()


def signup(role="student"):
    c = TestClient(app)
    email = f"otp-{secrets.token_hex(4)}@example.com"
    r = c.post("/api/v1/auth/register", json={"full_name": "Otp User", "email": email, "password": PASSWORD, "role": role})
    assert r.status_code == 201, r.text
    return c, email


def login(email, password=PASSWORD, client=None):
    c = client or TestClient(app)
    return c, c.post("/api/v1/auth/login", json={"email": email, "password": password})


def verify(client, email, otp):
    return client.post("/api/v1/auth/login/verify-otp", json={"email": email, "otp": otp})


@pytest.mark.parametrize("role", ["student", "teacher"])
def test_second_device_needs_otp_and_the_approver_gets_the_session(role):
    first, email = signup(role)
    second, r = login(email)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["otp_required"] is True and body["email"] == email
    assert "set-cookie" not in r.headers  # no session was issued
    assert second.get("/api/v1/users/me").status_code == 401  # password alone did not sign this device in
    assert first.get("/api/v1/users/me").status_code == 200  # the first session is untouched until approval

    ok = verify(second, email, body["dev_otp"])
    assert ok.status_code == 200 and ok.json()["user"]["email"] == email
    assert second.get("/api/v1/users/me").status_code == 200  # the device that proved mailbox control is signed in
    assert first.get("/api/v1/users/me").status_code == 401  # and the earlier session was handed over


def test_wrong_password_never_reaches_the_otp_step():
    first, email = signup()
    _, r = login(email, "wrong-password")
    assert r.status_code == 401 and r.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert "otp_required" not in r.text


def test_wrong_codes_are_rejected_and_attempts_are_capped(db_session):
    _, email = signup()
    second, r = login(email)
    otp = r.json()["dev_otp"]
    wrong = "000000" if otp != "000000" else "111111"
    for _ in range(get_settings().otp_max_attempts):
        bad = verify(second, email, wrong)
        assert bad.status_code == 401 and bad.json()["error"]["code"] == "INVALID_OTP"
    auth_service.reset_rate_limits()
    assert verify(second, email, otp).status_code == 401  # even the right code is dead after the cap


def test_code_is_single_use_and_expires(db_session):
    _, email = signup()
    second, r = login(email)
    otp = r.json()["dev_otp"]
    assert verify(second, email, otp).status_code == 200
    assert verify(TestClient(app), email, otp).status_code == 401  # replay

    third, r2 = login(email)  # the second device is now the active one; a third needs approval again
    assert r2.status_code == 202
    for ch in db_session.execute(select(PasswordResetOtpChallenge).where(PasswordResetOtpChallenge.verified_at.is_(None))).scalars():
        ch.expires_at = utcnow() - timedelta(minutes=1)
    db_session.commit()
    assert verify(third, email, r2.json()["dev_otp"]).status_code == 401


def test_a_new_request_supersedes_the_previous_code():
    _, email = signup()
    _, r1 = login(email)
    second, r2 = login(email)  # cooldown is 0 in this test, so a fresh code is issued and the old one dies
    assert r1.json()["dev_otp"] != r2.json()["dev_otp"]
    assert verify(second, email, r1.json()["dev_otp"]).status_code == 401
    assert verify(second, email, r2.json()["dev_otp"]).status_code == 200


def test_resend_cooldown_does_not_email_again_but_the_first_code_still_works(monkeypatch):
    monkeypatch.setattr(get_settings(), "otp_request_cooldown_seconds", 600)
    _, email = signup()
    second, r1 = login(email)
    _, r2 = login(email)
    assert r2.status_code == 202 and "dev_otp" not in r2.json()  # inside the cooldown: no new code
    assert verify(second, email, r1.json()["dev_otp"]).status_code == 200


def test_same_browser_with_a_valid_session_signs_in_again_without_otp():
    first, email = signup()
    _, r = login(email, client=first)  # carries the user's own valid session cookie
    assert r.status_code == 200 and r.json()["user"]["email"] == email


def test_no_otp_when_nobody_is_signed_in():
    first, email = signup()
    assert first.post("/api/v1/auth/logout").status_code == 204
    _, r = login(email)
    assert r.status_code == 200


def test_expired_first_session_does_not_trigger_otp(db_session):
    first, email = signup()
    for s in db_session.execute(select(UserSession)).scalars():
        s.expires_at = utcnow() - timedelta(minutes=1)
    db_session.commit()
    _, r = login(email)
    assert r.status_code == 200


def test_login_and_password_reset_codes_are_not_interchangeable():
    _, email = signup()
    second, r = login(email)
    login_otp = r.json()["dev_otp"]
    reset_otp = TestClient(app).post("/api/v1/auth/forgot-password", json={"email": email}).json()["dev_otp"]
    assert login_otp != reset_otp
    assert verify(second, email, reset_otp).status_code == 401  # a reset code cannot approve a login
    auth_service.reset_rate_limits()
    assert TestClient(app).post("/api/v1/auth/verify-reset-otp", json={"email": email, "otp": login_otp}).status_code == 401
    auth_service.reset_rate_limits()
    assert verify(second, email, login_otp).status_code == 200  # each still works for its own purpose


def test_verify_is_generic_for_unknown_accounts_and_admins():
    for email in ("nobody@example.com", "admin@example.com"):
        r = verify(TestClient(app), email, "123456")
        assert r.status_code == 401 and r.json()["error"]["code"] == "INVALID_OTP"


def test_otp_is_emailed_to_the_account_and_never_returned_when_email_is_configured(monkeypatch):
    settings = get_settings()
    sent = []
    monkeypatch.setattr(settings, "emailjs_service_id", "svc")
    monkeypatch.setattr(settings, "emailjs_template_id", "tpl")
    monkeypatch.setattr(settings, "emailjs_public_key", "pub")
    monkeypatch.setattr(email_integration, "send_otp_email", lambda *, to, otp, ttl_minutes: sent.append((to, otp)) or True)
    _, email = signup()
    second, r = login(email)
    assert r.status_code == 202 and "dev_otp" not in r.json()
    assert len(sent) == 1 and sent[0][0] == email  # only ever sent to the account's own address
    assert sent[0][1] not in r.text
    assert verify(second, email, sent[0][1]).status_code == 200


def test_send_failure_is_reported_and_no_session_is_issued(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "emailjs_service_id", "svc")
    monkeypatch.setattr(settings, "emailjs_template_id", "tpl")
    monkeypatch.setattr(settings, "emailjs_public_key", "pub")
    monkeypatch.setattr(email_integration, "send_otp_email", lambda **kw: False)
    first, email = signup()
    second, r = login(email)
    assert r.status_code == 503 and r.json()["error"]["code"] == "OTP_SEND_FAILED"
    assert second.get("/api/v1/users/me").status_code == 401
    assert first.get("/api/v1/users/me").status_code == 200


def test_production_without_email_does_not_lock_users_out(monkeypatch):
    monkeypatch.setattr(get_settings(), "app_env", "production")
    monkeypatch.setattr(get_settings(), "emailjs_service_id", None)
    first, email = signup()
    _, r = login(email)
    assert r.status_code == 200


def test_rule_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(get_settings(), "concurrent_login_otp", False)
    first, email = signup()
    _, r = login(email)
    assert r.status_code == 200
